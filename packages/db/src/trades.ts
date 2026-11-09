import { assertMarketCardsAvailable } from './market';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig } from '../../config/src/index';
import {
  GameError,
  requireTradeVersion,
  tradeBalances,
  validateTradePair,
  type TradeOffer,
  type TradeResult,
  type TradeRules,
  type TradeStatus,
} from '../../core/src/index';
import { transaction, type Database, type Transaction } from './connection';
import { requireMember } from './game';
import { requireExpectedRevision } from './settings-revision';
import { releaseExpiredTrades } from './trade-state';
import { characterValuesForRealm } from './character-values';

/*
 * Trades. Protocol 1 (trades created before proposals): each player edits only
 * their own side and both confirm. Protocol 2 (every new trade): a version
 * holds both sides, whoever writes it (create or counter-offer) confirms it at
 * once, and the other player accepts, counters or declines. A player's cards
 * are reserved only while that player has confirmed the current version, so
 * asking for someone's card never locks it.
 */
const offerSchema = z.strictObject({
  cardIds: z.array(z.uuid()).max(10),
  gems: z.number().int().min(0).max(1_000_000),
});
const commandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    counterpartyCode: z.uuid(),
    offer: offerSchema,
    /** What the creator asks for from the other player (protocol 2). */
    request: offerSchema.optional(),
  }),
  z.strictObject({
    action: z.literal('edit'),
    tradeId: z.uuid(),
    version: z.number().int().positive(),
    offer: offerSchema,
    /** The other player's side of a counter-offer (protocol 2). */
    request: offerSchema.optional(),
  }),
  z.strictObject({
    action: z.enum(['confirm', 'cancel']),
    tradeId: z.uuid(),
    version: z.number().int().positive(),
  }),
]);
const emptyOffer: TradeOffer = { cardIds: [], gems: 0 };
const sameOffer = (a: TradeOffer, b: TradeOffer) => JSON.stringify(a) === JSON.stringify(b);

async function availableCards(
  tx: Transaction,
  realmId: string,
  accountId: string,
  ids: string[],
  tradeId?: string,
  requireReservation = false,
) {
  await assertMarketCardsAvailable(tx, realmId, ids);
  const rows = (
    await tx.query(
      `SELECT id,character_id FROM cards WHERE realm_id=$1 AND id=ANY($2::uuid[]) AND owner_id=$3 AND recycled_at IS NULL`,
      [realmId, ids, accountId],
    )
  ).rows as { id: string; character_id: string }[];
  if (rows.length !== ids.length)
    throw new GameError(
      'CARD_UNAVAILABLE',
      'One or more offered cards are no longer in your active collection.',
      409,
    );
  if (
    (
      await tx.query(
        'SELECT 1 FROM trade_cards WHERE realm_id=$1 AND card_id=ANY($2::uuid[]) AND released_at IS NULL AND ($3::uuid IS NULL OR trade_id!=$3) LIMIT 1',
        [realmId, ids, tradeId ?? null],
      )
    ).rowCount
  )
    throw new GameError(
      'CARD_LOCKED',
      'A selected card is already reserved in another trade.',
      409,
    );
  if (
    requireReservation &&
    (
      await tx.query(
        'SELECT 1 FROM trade_cards WHERE realm_id=$1 AND trade_id=$2 AND account_id=$3 AND card_id=ANY($4::uuid[]) AND released_at IS NULL',
        [realmId, tradeId, accountId, ids],
      )
    ).rowCount !== ids.length
  )
    throw new GameError(
      'CARD_UNAVAILABLE',
      'The trade reservations no longer match the offer.',
      409,
    );
  return rows;
}
/** The other player's requested cards must still be theirs and free to trade. */
async function requestedCards(
  tx: Transaction,
  realmId: string,
  ownerId: string,
  ids: string[],
  tradeId?: string,
) {
  if (!ids.length) return;
  const owned = (
    await tx.query(
      'SELECT count(*)::int AS count FROM cards WHERE realm_id=$1 AND id=ANY($2::uuid[]) AND owner_id=$3 AND recycled_at IS NULL',
      [realmId, ids, ownerId],
    )
  ).rows[0].count;
  if (owned !== ids.length)
    throw new GameError(
      'CARD_UNAVAILABLE',
      'One of the requested cards is no longer in their collection.',
      409,
    );
  const locked =
    (
      await tx.query(
        "SELECT 1 FROM market_listings WHERE realm_id=$1 AND card_id=ANY($2::uuid[]) AND status='active' LIMIT 1",
        [realmId, ids],
      )
    ).rowCount ||
    (
      await tx.query(
        'SELECT 1 FROM trade_cards WHERE realm_id=$1 AND card_id=ANY($2::uuid[]) AND released_at IS NULL AND ($3::uuid IS NULL OR trade_id!=$3) LIMIT 1',
        [realmId, ids, tradeId ?? null],
      )
    ).rowCount;
  if (locked)
    throw new GameError(
      'CARD_LOCKED',
      'A requested card is listed on the market or reserved in another trade.',
      409,
    );
}
async function reserve(
  tx: Transaction,
  realmId: string,
  tradeId: string,
  version: number,
  actorId: string,
  ids: string[],
) {
  for (const id of ids)
    await tx.query(
      'INSERT INTO trade_cards(realm_id,trade_id,offer_version,card_id,account_id) VALUES($1,$2,$3,$4,$5)',
      [realmId, tradeId, version, id, actorId],
    );
}
async function release(
  tx: Transaction,
  realmId: string,
  tradeId: string,
  accountId: string,
  now: Date,
) {
  await tx.query(
    'UPDATE trade_cards SET released_at=$4 WHERE realm_id=$1 AND trade_id=$2 AND account_id=$3 AND released_at IS NULL',
    [realmId, tradeId, accountId, now],
  );
}
async function confirm(
  tx: Transaction,
  realmId: string,
  tradeId: string,
  version: number,
  accountId: string,
  now: Date,
) {
  await tx.query(
    'INSERT INTO trade_confirmations(realm_id,trade_id,version,account_id,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [realmId, tradeId, version, accountId, now],
  );
}
async function transferCards(
  tx: Transaction,
  realmId: string,
  tradeId: string,
  from: string,
  to: string,
  ids: string[],
  now: Date,
) {
  for (const card of await availableCards(tx, realmId, from, ids, tradeId, true)) {
    const sequence = (
      await tx.query(
        'SELECT COALESCE(max(sequence),0)+1 AS next FROM card_transfers WHERE realm_id=$1 AND card_id=$2',
        [realmId, card.id],
      )
    ).rows[0].next;
    await tx.query(
      'INSERT INTO card_transfers(realm_id,id,trade_id,card_id,sequence,from_id,to_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [realmId, randomUUID(), tradeId, card.id, sequence, from, to, now],
    );
    await tx.query('UPDATE cards SET owner_id=$3 WHERE realm_id=$1 AND id=$2', [
      realmId,
      card.id,
      to,
    ]);
    await tx.query(
      `INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version,character_id,card_id,trade_id,created_at)
      SELECT $1,$2,$3,'trade_collection',0,1,$4,$5,$6,$7 WHERE NOT EXISTS(SELECT 1 FROM xp_ledger WHERE realm_id=$1 AND account_id=$3 AND character_id=$4 AND reason IN('first_collection','trade_collection'))`,
      [realmId, randomUUID(), to, card.character_id, card.id, tradeId, now],
    );
  }
}
/** Moves cards and gems once both players confirmed the same version. */
async function complete(
  tx: Transaction,
  realmId: string,
  trade: { id: string; creator_id: string; counterparty_id: string },
  a: TradeOffer,
  b: TradeOffer,
  balances: ReturnType<typeof tradeBalances>,
  now: Date,
) {
  await transferCards(
    tx,
    realmId,
    trade.id,
    trade.creator_id,
    trade.counterparty_id,
    a.cardIds,
    now,
  );
  await transferCards(
    tx,
    realmId,
    trade.id,
    trade.counterparty_id,
    trade.creator_id,
    b.cardIds,
    now,
  );
  for (const [id, balance, amount] of [
    [trade.creator_id, balances.aAfter, balances.aDelta],
    [trade.counterparty_id, balances.bAfter, balances.bDelta],
  ] as [string, number, number][]) {
    await tx.query('UPDATE memberships SET balance=$3 WHERE realm_id=$1 AND account_id=$2', [
      realmId,
      id,
      balance,
    ]);
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'trade',$7)",
      [realmId, randomUUID(), id, `trade:${trade.id}`, amount, balance, now],
    );
  }
  await tx.query(
    "UPDATE trades SET status='completed',completed_at=$3,updated_at=$3 WHERE realm_id=$1 AND id=$2",
    [realmId, trade.id, now],
  );
  await tx.query(
    'UPDATE trade_cards SET released_at=$3 WHERE realm_id=$1 AND trade_id=$2 AND released_at IS NULL',
    [realmId, trade.id, now],
  );
}

export async function tradeCommand(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
  requestKey: string,
  expectedRevision?: number,
): Promise<TradeResult> {
  [actorId, realmId, requestKey].forEach((value) => z.uuid().parse(value));
  const command = commandSchema.parse(input);
  if ('offer' in command) command.offer.cardIds.sort();
  if ('request' in command && command.request) command.request.cardIds.sort();
  const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  return transaction(db, async (tx) => {
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    const actor = await requireMember(tx, realmId, actorId);
    const previous = (
      await tx.query(
        'SELECT fingerprint,result FROM trade_requests WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This trade request key was used for a different action.',
          409,
        );
      return previous.result as TradeResult;
    }
    if (command.action !== 'cancel') await requireExpectedRevision(tx, realmId, expectedRevision);
    await releaseExpiredTrades(tx, realmId);
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    let tradeId: string,
      version: number,
      status: TradeStatus = 'pending',
      message = 'Offer saved. Both players must confirm this version.';
    if (command.action === 'create') {
      const config = parseRealmConfig(realm.config),
        rules = config.trading;
      if (!rules.enabled)
        throw new GameError('TRADING_DISABLED', 'New trades are disabled in this realm.', 409);
      const recipient = (
        await tx.query('SELECT account_id FROM memberships WHERE realm_id=$1 AND trade_code=$2', [
          realmId,
          command.counterpartyCode,
        ])
      ).rows[0];
      if (!recipient || recipient.account_id === actorId)
        throw new GameError('INVALID_PARTNER', 'Choose another player’s trade ID from this realm.');
      for (const id of [actorId, recipient.account_id]) {
        const count = (
          await tx.query(
            "SELECT count(*)::integer AS count FROM trades WHERE realm_id=$1 AND status='pending' AND (creator_id=$2 OR counterparty_id=$2)",
            [realmId, id],
          )
        ).rows[0].count;
        if (count >= rules.maxPendingPerPlayer)
          throw new GameError(
            'TRADE_LIMIT',
            'A participant has reached the pending-trade limit.',
            409,
          );
      }
      // A create that names the other player's side is a proposal (protocol 2);
      // without it the trade keeps the original one-side-at-a-time protocol.
      const proposals = command.request !== undefined,
        request = command.request ?? emptyOffer;
      validateTradePair(command.offer, request, rules);
      if (actor.balance < command.offer.gems)
        throw new GameError('INSUFFICIENT_GEMS', 'You do not have the offered gems.', 409);
      await availableCards(tx, realmId, actorId, command.offer.cardIds);
      await requestedCards(tx, realmId, recipient.account_id, request.cardIds);
      tradeId = randomUUID();
      version = 1;
      await tx.query(
        "INSERT INTO trades(realm_id,id,creator_id,counterparty_id,status,offer_version,config_snapshot,created_at,updated_at,expires_at,protocol) VALUES($1,$2,$3,$4,'pending',1,$5,$6,$6,$7,$8)",
        [
          realmId,
          tradeId,
          actorId,
          recipient.account_id,
          config,
          now,
          new Date(now.getTime() + rules.expiresAfterMinutes * 60_000),
          proposals ? 2 : 1,
        ],
      );
      await tx.query(
        'INSERT INTO trade_versions(realm_id,trade_id,version,changed_by,creator_offer,counterparty_offer,created_at) VALUES($1,$2,1,$3,$4,$5,$6)',
        [realmId, tradeId, actorId, command.offer, request, now],
      );
      await reserve(tx, realmId, tradeId, 1, actorId, command.offer.cardIds);
      if (proposals) {
        await confirm(tx, realmId, tradeId, 1, actorId, now);
        message = 'Offer sent. It completes when the other player accepts.';
      }
    } else {
      const trade = (
        await tx.query(
          `SELECT t.*,v.creator_offer,v.counterparty_offer FROM trades t JOIN trade_versions v ON v.realm_id=t.realm_id AND v.trade_id=t.id AND v.version=t.offer_version WHERE t.realm_id=$1 AND t.id=$2 AND (t.creator_id=$3 OR t.counterparty_id=$3)`,
          [realmId, command.tradeId, actorId],
        )
      ).rows[0];
      if (!trade) throw new GameError('NOT_FOUND', 'Trade not found.', 404);
      requireTradeVersion(trade.status, trade.offer_version, command.version);
      tradeId = trade.id;
      version = trade.offer_version;
      const rules: TradeRules = parseRealmConfig(trade.config_snapshot).trading;
      const creator = trade.creator_id === actorId;
      const otherId: string = creator ? trade.counterparty_id : trade.creator_id;
      const proposals = trade.protocol === 2;
      const a = trade.creator_offer as TradeOffer,
        b = trade.counterparty_offer as TradeOffer;
      if (command.action === 'cancel') {
        status = 'cancelled';
        message = 'Trade cancelled. Reserved cards released.';
        await tx.query(
          "UPDATE trades SET status='cancelled',updated_at=$3 WHERE realm_id=$1 AND id=$2",
          [realmId, tradeId, now],
        );
        await tx.query(
          'UPDATE trade_cards SET released_at=$3 WHERE realm_id=$1 AND trade_id=$2 AND released_at IS NULL',
          [realmId, tradeId, now],
        );
      } else if (command.action === 'edit') {
        if (!proposals && command.request)
          throw new GameError(
            'TRADE_PROTOCOL',
            'This older trade can only change your own side. Cancel it and send a new offer.',
            409,
          );
        const mine = command.offer,
          theirs = command.request ?? (creator ? b : a);
        validateTradePair(creator ? mine : theirs, creator ? theirs : mine, rules);
        if (actor.balance < mine.gems)
          throw new GameError('INSUFFICIENT_GEMS', 'You do not have the offered gems.', 409);
        await availableCards(tx, realmId, actorId, mine.cardIds, tradeId);
        if (proposals) await requestedCards(tx, realmId, otherId, theirs.cardIds, tradeId);
        const theirsChanged = !sameOffer(theirs, creator ? b : a);
        if (!sameOffer(mine, creator ? a : b) || theirsChanged) {
          if (version >= 2_147_483_647)
            throw new GameError('TRADE_LIMIT', 'The offer version limit has been reached.', 409);
          version++;
          await tx.query(
            'INSERT INTO trade_versions(realm_id,trade_id,version,changed_by,creator_offer,counterparty_offer,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              realmId,
              tradeId,
              version,
              actorId,
              creator ? mine : theirs,
              creator ? theirs : mine,
              now,
            ],
          );
          await release(tx, realmId, tradeId, actorId, now);
          await reserve(tx, realmId, tradeId, version, actorId, mine.cardIds);
          if (proposals) {
            // A counter-offer is confirmed by its author; the other player's
            // cards are free again until they accept the new version.
            await release(tx, realmId, tradeId, otherId, now);
            await confirm(tx, realmId, tradeId, version, actorId, now);
            message = 'Counter-offer sent. It completes when the other player accepts.';
          }
          await tx.query(
            'UPDATE trades SET offer_version=$3,updated_at=$4 WHERE realm_id=$1 AND id=$2',
            [realmId, tradeId, version, now],
          );
        } else message = 'Offer unchanged.';
      } else {
        validateTradePair(a, b, rules);
        const memberA = await requireMember(tx, realmId, trade.creator_id),
          memberB = await requireMember(tx, realmId, trade.counterparty_id);
        const balances = tradeBalances(memberA.balance, memberB.balance, a, b);
        if (proposals) {
          // Accepting reserves the accepting player's side of this version.
          const mine = creator ? a : b,
            theirs = creator ? b : a;
          await availableCards(tx, realmId, actorId, mine.cardIds, tradeId);
          await requestedCards(tx, realmId, otherId, theirs.cardIds, tradeId);
          await release(tx, realmId, tradeId, actorId, now);
          await reserve(tx, realmId, tradeId, version, actorId, mine.cardIds);
        } else {
          await availableCards(tx, realmId, trade.creator_id, a.cardIds, tradeId, true);
          await availableCards(tx, realmId, trade.counterparty_id, b.cardIds, tradeId, true);
        }
        await confirm(tx, realmId, tradeId, version, actorId, now);
        const count = (
          await tx.query(
            'SELECT count(*)::integer AS count FROM trade_confirmations WHERE realm_id=$1 AND trade_id=$2 AND version=$3',
            [realmId, tradeId, version],
          )
        ).rows[0].count;
        message = 'Your confirmation is saved. Waiting for the other player.';
        if (count === 2) {
          await complete(tx, realmId, trade, a, b, balances, now);
          status = 'completed';
          message = 'Trade completed. Cards and gems transferred.';
        }
      }
    }
    const result: TradeResult = { ok: true, tradeId, version, status, message };
    await tx.query(
      'INSERT INTO trade_requests(realm_id,account_id,request_key,trade_id,fingerprint,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [realmId, actorId, requestKey, tradeId, fingerprint, result, now],
    );
    return result;
  });
}

/** A trade partner's cards and their state, for choosing what to ask for. */
export async function tradePartnerCards(
  db: Database,
  actorId: string,
  realmId: string,
  tradeCode: string,
) {
  [actorId, realmId, tradeCode].forEach((value) => z.uuid().parse(value));
  return transaction(
    db,
    async (tx) => {
      await requireMember(tx, realmId, actorId);
      const config = parseRealmConfig(
        (await tx.query('SELECT config FROM realms WHERE id=$1', [realmId])).rows[0].config,
      );
      const values = config.characterValues.enabled
        ? await characterValuesForRealm(tx, realmId, config)
        : {};
      const partner = (
        await tx.query(
          `SELECT m.account_id,m.trade_code AS "tradeCode",p.username,p.display_name AS "displayName"
          FROM memberships m LEFT JOIN discord_profiles p ON p.account_id=m.account_id
          WHERE m.realm_id=$1 AND m.trade_code=$2`,
          [realmId, tradeCode],
        )
      ).rows[0];
      if (!partner || partner.account_id === actorId)
        throw new GameError('INVALID_PARTNER', 'Choose another player from this realm.', 404);
      const cards = (
        await tx.query(
          `SELECT c.id,c.source_key AS "sourceKey",c.name,c.series,c.categories,c.tier,c.provenance->'artwork' AS artwork,
          owned.id AS "cardId",
          EXISTS(SELECT 1 FROM trade_cards r JOIN trades t ON t.realm_id=r.realm_id AND t.id=r.trade_id
            WHERE r.realm_id=owned.realm_id AND r.card_id=owned.id AND r.released_at IS NULL AND t.status='pending' AND t.expires_at>clock_timestamp()) AS "lockedForTrade",
          EXISTS(SELECT 1 FROM market_listings ml WHERE ml.realm_id=owned.realm_id AND ml.card_id=owned.id AND ml.status='active') AS "listedForSale"
          FROM cards owned JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id
          WHERE owned.realm_id=$1 AND owned.owner_id=$2 AND owned.recycled_at IS NULL
          ORDER BY c.name,owned.id`,
          [realmId, partner.account_id],
        )
      ).rows.map(({ artwork, ...row }) => ({
        ...row,
        ...(artwork ? { artwork } : {}),
        ...(values[row.id] ? { valuation: values[row.id] } : {}),
      }));
      return {
        partner: {
          tradeCode: partner.tradeCode as string,
          username: (partner.username as string | null) ?? null,
          displayName: (partner.displayName as string | null) ?? null,
        },
        cards,
      };
    },
    true,
  );
}
