import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig, type Tier, type RealmConfig } from '../../config/src/index';
import {
  GameError,
  tradeBalances,
  type CharacterValue,
  type TradeOffer,
} from '../../core/src/index';
import { characterValuesForRealm } from './character-values';
import { purchasedCollectorRank } from './rank-state';
import { effectiveMemberConfig } from './rank-track-state';
import { transaction, type Database, type Transaction } from './connection';
import { requireMember } from './game';
import { requireExpectedRevision } from './settings-revision';
import { releaseExpiredTrades } from './trade-state';

const uuid = z.uuid().transform((value) => value.toLowerCase());
export const marketCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('list'),
    cardId: uuid,
    price: z.number().int().min(1).max(1_000_000),
  }),
  z.strictObject({ action: z.enum(['buy', 'cancel']), listingId: uuid }),
]);
export type MarketCommand = z.infer<typeof marketCommandSchema>;
export type MarketStatus = 'active' | 'sold' | 'cancelled';
export type MarketResult = {
  ok: true;
  listingId: string;
  cardId: string;
  price: number;
  status: MarketStatus;
  message: string;
  balance: number;
  tradeId: string | null;
};
export type MarketListing = {
  id: string;
  cardId: string;
  characterId: string;
  name: string;
  series: string;
  tier: Tier;
  price: number;
  sellerCode: string;
  sellerName: string | null;
  isMine: boolean;
  status: MarketStatus;
  createdAt: string;
  closedAt: string | null;
  tradeId: string | null;
  categories: string[];
  sourceKey: string;
  artwork?: { url: string; sourceUrl: string; permission: string };
  valuation?: CharacterValue;
};
export type MarketPage = {
  listings: MarketListing[];
  tradingEnabled: boolean;
  balance: number;
  maxPrice: number;
  nextOffset: number | null;
};

// Callers authorize membership and lock the realm before reserving/moving cards.
export async function assertMarketCardsAvailable(
  tx: Transaction,
  realmId: string,
  cardIds: string[],
) {
  if (!cardIds.length) return;
  if (
    (
      await tx.query(
        "SELECT 1 FROM market_listings WHERE realm_id=$1 AND card_id=ANY($2::uuid[]) AND status='active' LIMIT 1",
        [realmId, cardIds],
      )
    ).rowCount
  )
    throw new GameError(
      'CARD_LOCKED',
      'This card is listed on the market. Cancel the listing before trading or recycling it.',
      409,
    );
}

const browseSchema = z.strictObject({
  query: z.string().trim().max(80).default(''),
  scope: z.enum(['all', 'mine']).default('all'),
  limit: z.number().int().min(1).max(100).default(60),
  offset: z.number().int().min(0).max(10000).default(0),
});
export async function listMarket(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown = {},
): Promise<MarketPage> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const options = browseSchema.parse(input);
  return transaction(
    db,
    async (tx) => {
      const member = await requireMember(tx, realmId, actorId);
      const stored = (await tx.query('SELECT config FROM realms WHERE id=$1', [realmId])).rows[0]
        .config;
      const config = parseRealmConfig(stored);
      const rows = (
        await tx.query(
          `SELECT l.id,l.card_id AS "cardId",c.character_id AS "characterId",d.name,d.series,d.tier,l.price,
      d.categories,d.source_key AS "sourceKey",d.provenance->'artwork' AS artwork,
      m.trade_code AS "sellerCode",COALESCE(p.display_name,p.username) AS "sellerName",l.seller_id=$2 AS "isMine",l.status,l.created_at,l.closed_at,l.sale_trade_id AS "tradeId"
      FROM market_listings l JOIN cards c ON c.realm_id=l.realm_id AND c.id=l.card_id
      JOIN characters d ON d.realm_id=c.realm_id AND d.id=c.character_id
      JOIN memberships m ON m.realm_id=l.realm_id AND m.account_id=l.seller_id
      LEFT JOIN discord_profiles p ON p.account_id=l.seller_id
      WHERE l.realm_id=$1 AND (($3='all' AND l.status='active') OR ($3='mine' AND l.seller_id=$2))
        AND ($4='' OR strpos(lower(d.name || ' ' || d.series || ' ' || COALESCE(p.display_name,'') || ' ' || COALESCE(p.username,'')),lower($4))>0 OR m.trade_code::text=$4)
      ORDER BY (l.status='active') DESC,l.created_at DESC,l.id DESC LIMIT $5 OFFSET $6`,
          [realmId, actorId, options.scope, options.query, options.limit + 1, options.offset],
        )
      ).rows;
      // Listing cards show the same valuation evidence as collection cards.
      const values = rows.length
        ? await characterValuesForRealm(
            tx,
            realmId,
            config,
            await effectiveMemberConfig(
              tx,
              realmId,
              actorId,
              config,
              stored.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, actorId) : 0,
            ),
          )
        : {};
      return {
        listings: rows
          .slice(0, options.limit)
          .map((row) => ({
            id: row.id,
            cardId: row.cardId,
            characterId: row.characterId,
            name: row.name,
            series: row.series,
            tier: row.tier,
            price: row.price,
            sellerCode: row.sellerCode,
            sellerName: row.sellerName,
            isMine: row.isMine,
            status: row.status,
            createdAt: row.created_at.toISOString(),
            closedAt: row.closed_at?.toISOString() ?? null,
            tradeId: row.tradeId,
            categories: row.categories,
            sourceKey: row.sourceKey,
            ...(row.artwork ? { artwork: row.artwork } : {}),
            ...(values[row.characterId] ? { valuation: values[row.characterId] } : {}),
          })),
        tradingEnabled: config.trading.enabled,
        balance: member.balance,
        maxPrice: config.trading.maxGemsPerSide,
        nextOffset:
          rows.length > options.limit && options.offset + options.limit <= 10000
            ? options.offset + options.limit
            : null,
      };
    },
    true,
  );
}

// A fixed-price listing is the seller's consent. Buying accepts those immutable
// terms. Record the accepted sale using the same two-party transfer journal as
// direct trades, keeping exports, discovery history and restores consistent.
async function completeSale(
  tx: Transaction,
  realmId: string,
  sellerId: string,
  buyerId: string,
  card: { id: string; character_id: string },
  price: number,
  config: RealmConfig,
  now: Date,
): Promise<{ tradeId: string; balance: number }> {
  const seller = await requireMember(tx, realmId, sellerId),
    buyer = await requireMember(tx, realmId, buyerId);
  const sellerOffer: TradeOffer = { cardIds: [card.id], gems: 0 },
    empty: TradeOffer = { cardIds: [], gems: 0 },
    buyerOffer: TradeOffer = { cardIds: [], gems: price };
  const balances = tradeBalances(seller.balance, buyer.balance, sellerOffer, buyerOffer),
    tradeId = randomUUID();
  await tx.query(
    "INSERT INTO trades(realm_id,id,creator_id,counterparty_id,status,offer_version,config_snapshot,created_at,updated_at,expires_at,completed_at) VALUES($1,$2,$3,$4,'completed',2,$5,$6,$6,$7,$6)",
    [
      realmId,
      tradeId,
      sellerId,
      buyerId,
      config,
      now,
      new Date(now.getTime() + config.trading.expiresAfterMinutes * 60000),
    ],
  );
  await tx.query(
    'INSERT INTO trade_versions(realm_id,trade_id,version,changed_by,creator_offer,counterparty_offer,created_at) VALUES($1,$2,1,$3,$4,$5,$6),($1,$2,2,$7,$4,$8,$6)',
    [realmId, tradeId, sellerId, sellerOffer, empty, now, buyerId, buyerOffer],
  );
  for (const accountId of [sellerId, buyerId])
    await tx.query(
      'INSERT INTO trade_confirmations(realm_id,trade_id,version,account_id,created_at) VALUES($1,$2,2,$3,$4)',
      [realmId, tradeId, accountId, now],
    );
  for (const version of [1, 2])
    await tx.query(
      'INSERT INTO trade_cards(realm_id,trade_id,offer_version,card_id,account_id,released_at) VALUES($1,$2,$3,$4,$5,$6)',
      [realmId, tradeId, version, card.id, sellerId, now],
    );
  const sequence = (
    await tx.query(
      'SELECT COALESCE(max(sequence),0)+1 AS next FROM card_transfers WHERE realm_id=$1 AND card_id=$2',
      [realmId, card.id],
    )
  ).rows[0].next;
  await tx.query(
    'INSERT INTO card_transfers(realm_id,id,trade_id,card_id,sequence,from_id,to_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [realmId, randomUUID(), tradeId, card.id, sequence, sellerId, buyerId, now],
  );
  await tx.query('UPDATE cards SET owner_id=$3 WHERE realm_id=$1 AND id=$2', [
    realmId,
    card.id,
    buyerId,
  ]);
  await tx.query(
    `INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version,character_id,card_id,trade_id,created_at)
    SELECT $1,$2,$3,'trade_collection',0,1,$4,$5,$6,$7 WHERE NOT EXISTS(SELECT 1 FROM xp_ledger WHERE realm_id=$1 AND account_id=$3 AND character_id=$4 AND reason IN('first_collection','trade_collection'))`,
    [realmId, randomUUID(), buyerId, card.character_id, card.id, tradeId, now],
  );
  for (const [accountId, balance, amount] of [
    [sellerId, balances.aAfter, balances.aDelta],
    [buyerId, balances.bAfter, balances.bDelta],
  ] as [string, number, number][]) {
    await tx.query('UPDATE memberships SET balance=$3 WHERE realm_id=$1 AND account_id=$2', [
      realmId,
      accountId,
      balance,
    ]);
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'trade',$7)",
      [realmId, randomUUID(), accountId, `trade:${tradeId}`, amount, balance, now],
    );
  }
  return { tradeId, balance: balances.bAfter };
}

export async function marketCommand(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
  requestKey: string,
  expectedRevision?: number,
): Promise<MarketResult> {
  [actorId, realmId, requestKey].forEach((value) => z.uuid().parse(value));
  const command = marketCommandSchema.parse(input),
    fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  return transaction(db, async (tx) => {
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    const member = await requireMember(tx, realmId, actorId);
    const previous = (
      await tx.query(
        'SELECT fingerprint,result FROM market_requests WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This market request key was used for a different action.',
          409,
        );
      return previous.result as MarketResult;
    }
    const config = parseRealmConfig(realm.config);
    if (command.action !== 'cancel') {
      await requireExpectedRevision(tx, realmId, expectedRevision);
      if (!config.trading.enabled)
        throw new GameError(
          'TRADING_DISABLED',
          'The market and new trades are disabled in this realm.',
          409,
        );
    }
    await releaseExpiredTrades(tx, realmId);
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    let listingId: string,
      cardId: string,
      price: number,
      status: MarketStatus,
      tradeId: string | null = null,
      balance = member.balance,
      message: string;
    if (command.action === 'list') {
      if (command.price > config.trading.maxGemsPerSide)
        throw new GameError(
          'INVALID_PRICE',
          "The asking price exceeds this realm's gem trade limit.",
        );
      const card = (
        await tx.query(
          'SELECT id FROM cards WHERE realm_id=$1 AND id=$2 AND owner_id=$3 AND recycled_at IS NULL',
          [realmId, command.cardId, actorId],
        )
      ).rows[0];
      if (!card)
        throw new GameError('CARD_UNAVAILABLE', 'Choose a card from your active collection.', 409);
      await assertMarketCardsAvailable(tx, realmId, [card.id]);
      if (
        (
          await tx.query(
            'SELECT 1 FROM trade_cards WHERE realm_id=$1 AND card_id=$2 AND released_at IS NULL',
            [realmId, card.id],
          )
        ).rowCount
      )
        throw new GameError(
          'CARD_LOCKED',
          'This card is reserved in a trade. Finish or cancel that trade first.',
          409,
        );
      listingId = randomUUID();
      cardId = card.id;
      price = command.price;
      status = 'active';
      message = `Card listed for ${price} gems.`;
      await tx.query(
        "INSERT INTO market_listings(realm_id,id,seller_id,card_id,price,status,created_at) VALUES($1,$2,$3,$4,$5,'active',$6)",
        [realmId, listingId, actorId, cardId, price, now],
      );
    } else {
      const listing = (
        await tx.query('SELECT * FROM market_listings WHERE realm_id=$1 AND id=$2', [
          realmId,
          command.listingId,
        ])
      ).rows[0];
      if (!listing) throw new GameError('NOT_FOUND', 'Listing not found.', 404);
      if (command.action === 'cancel' && listing.seller_id !== actorId)
        throw new GameError('FORBIDDEN', 'Only the seller can cancel this listing.', 403);
      if (listing.status !== 'active')
        throw new GameError(
          'LISTING_CLOSED',
          'This listing is already closed. No assets were transferred.',
          409,
        );
      listingId = listing.id;
      cardId = listing.card_id;
      price = listing.price;
      if (command.action === 'cancel') {
        status = 'cancelled';
        message = 'Listing cancelled. Your card is available again.';
        await tx.query(
          "UPDATE market_listings SET status='cancelled',closed_at=$3 WHERE realm_id=$1 AND id=$2",
          [realmId, listingId, now],
        );
      } else {
        if (listing.seller_id === actorId)
          throw new GameError(
            'OWN_LISTING',
            'You cannot buy your own listing. Cancel it to keep the card.',
            409,
          );
        if (price > config.trading.maxGemsPerSide)
          throw new GameError(
            'INVALID_PRICE',
            'This listing exceeds the current realm gem trade limit.',
            409,
          );
        const card = (
          await tx.query(
            'SELECT id,character_id FROM cards WHERE realm_id=$1 AND id=$2 AND owner_id=$3 AND recycled_at IS NULL',
            [realmId, cardId, listing.seller_id],
          )
        ).rows[0];
        if (!card)
          throw new GameError(
            'CARD_UNAVAILABLE',
            'This card is no longer available. No gems were spent.',
            409,
          );
        if (
          (
            await tx.query(
              'SELECT 1 FROM trade_cards WHERE realm_id=$1 AND card_id=$2 AND released_at IS NULL',
              [realmId, cardId],
            )
          ).rowCount
        )
          throw new GameError(
            'CARD_LOCKED',
            'This card is reserved in a trade. No gems were spent.',
            409,
          );
        const sale = await completeSale(
          tx,
          realmId,
          listing.seller_id,
          actorId,
          card,
          price,
          config,
          now,
        );
        tradeId = sale.tradeId;
        balance = sale.balance;
        status = 'sold';
        message = 'Purchase completed. The card is in your collection.';
        await tx.query(
          "UPDATE market_listings SET status='sold',buyer_id=$3,sale_trade_id=$4,closed_at=$5 WHERE realm_id=$1 AND id=$2",
          [realmId, listingId, actorId, tradeId, now],
        );
      }
    }
    const result: MarketResult = {
      ok: true,
      listingId,
      cardId,
      price,
      status,
      message,
      balance,
      tradeId,
    };
    await tx.query(
      'INSERT INTO market_requests(realm_id,account_id,request_key,listing_id,fingerprint,command,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [realmId, actorId, requestKey, listingId, fingerprint, command, result, now],
    );
    return result;
  });
}
