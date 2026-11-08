import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { GameError } from '../../core/src/index';
import { requireMember } from './game';
import { transaction, type Database, type Transaction } from './connection';
import { releaseExpiredTrades } from './trade-state';

/**
 * Collection repair for realm administrators: look at one member's cards,
 * wallet and recent losses, then restore a recycled card, return a card to an
 * earlier owner or adjust gems. Every action is audited and idempotent and runs
 * under the realm lock, like gameplay. Members are addressed by their public
 * member code (the trade code), never by account ID.
 */

const uuid = z.uuid().transform((value) => value.toLowerCase());
const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('restore_card'),
    requestKey: uuid,
    memberCode: uuid,
    cardId: uuid,
    takeBackGems: z.boolean(),
    note: z.string().trim().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal('return_card'),
    requestKey: uuid,
    memberCode: uuid,
    cardId: uuid,
    note: z.string().trim().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal('adjust_gems'),
    requestKey: uuid,
    memberCode: uuid,
    amount: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((value) => value !== 0, 'Enter a gem amount other than 0.'),
    note: z.string().trim().min(1).max(200),
  }),
]);
export type AdminCollectionCommand = z.input<typeof commandSchema>;

const receiptSchema = z.strictObject({
  ok: z.literal(true),
  actionId: z.uuid(),
  kind: z.enum(['restore_card', 'return_card', 'adjust_gems']),
  memberCode: z.uuid(),
  cardId: z.uuid().nullable(),
  characterName: z.string().nullable(),
  amount: z.number().int(),
  balance: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  /** The undone recycling, kept so retries of its request still get its receipt. */
  recycling: z
    .strictObject({
      id: z.uuid(),
      accountId: z.uuid(),
      requestKey: z.uuid(),
      cardId: z.uuid(),
      result: z.record(z.string(), z.unknown()),
      configSnapshot: z.record(z.string(), z.unknown()),
      createdAt: z.iso.datetime(),
    })
    .optional(),
});
export type AdminCollectionReceipt = z.infer<typeof receiptSchema>;

type Artwork = { url: string; sourceUrl: string; permission: string } | null;
export type AdminCollectionCard = {
  cardId: string;
  characterId: string;
  name: string;
  series: string;
  tier: string;
  artwork: Artwork;
  acquiredAt: string;
};
export type AdminMemberCollection = {
  member: {
    memberCode: string;
    name: string;
    role: 'admin' | 'player';
    balance: number;
    xp: number;
  };
  cards: (AdminCollectionCard & { locked: 'trade' | 'market' | null })[];
  cardCount: number;
  recycled: (AdminCollectionCard & {
    recycledAt: string;
    credited: number;
    /** Who holds this character now, when someone pulled it again. */
    heldBy: string | null;
  })[];
  givenAway: (AdminCollectionCard & {
    movedAt: string;
    via: 'trade' | 'market' | 'admin';
    price: number | null;
    holder: string;
    holderCode: string;
    /** Still with the member it went to, so it can be returned. */
    returnable: boolean;
  })[];
  ledger: {
    amount: number;
    balanceAfter: number;
    reason: string;
    createdAt: string;
  }[];
  actions: {
    actionId: string;
    kind: string;
    characterName: string | null;
    amount: number;
    note: string;
    by: string;
    createdAt: string;
  }[];
};

const nameSql = (alias: string) =>
  `COALESCE(NULLIF(${alias}.display_name,''),NULLIF(${alias}.username,''))`;
function memberLabel(name: string | null, code: string) {
  return name ?? `Member ${code.slice(0, 8)}`;
}

async function requireRealmAdmin(tx: Transaction, realmId: string, actorId: string, lock: boolean) {
  if (
    !(await tx.query(`SELECT id FROM realms WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [realmId]))
      .rowCount
  )
    throw new GameError('NOT_FOUND', 'Realm not found.', 404);
  if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
    throw new GameError(
      'FORBIDDEN',
      'Only a realm administrator can manage player collections.',
      403,
    );
}

async function memberByCode(tx: Transaction, realmId: string, code: string) {
  const row = (
    await tx.query(
      `SELECT m.account_id,m.trade_code,m.role,m.balance,m.xp,${nameSql('p')} AS name
      FROM memberships m LEFT JOIN discord_profiles p ON p.account_id=m.account_id
      WHERE m.realm_id=$1 AND m.trade_code=$2`,
      [realmId, code],
    )
  ).rows[0];
  if (!row) throw new GameError('NOT_FOUND', 'That member is not in this realm.', 404);
  return row as {
    account_id: string;
    trade_code: string;
    role: 'admin' | 'player';
    balance: number;
    xp: number;
    name: string | null;
  };
}

const cardColumns = `owned.id AS "cardId",c.id AS "characterId",c.name,c.series,c.tier,
  c.provenance->'artwork' AS artwork,owned.acquired_at AS "acquiredAt"`;

export async function adminMemberCollection(
  db: Database,
  actorId: string,
  realmIdInput: string,
  memberCodeInput: string,
): Promise<AdminMemberCollection> {
  const actor = uuid.parse(actorId),
    realmId = uuid.parse(realmIdInput),
    code = uuid.parse(memberCodeInput);
  return transaction(
    db,
    async (tx) => {
      await requireRealmAdmin(tx, realmId, actor, false);
      const member = await memberByCode(tx, realmId, code),
        account = member.account_id;
      const iso = (value: Date) => value.toISOString();
      const cards = (
        await tx.query(
          `SELECT ${cardColumns},
            CASE WHEN EXISTS(SELECT 1 FROM trade_cards t JOIN trades tr ON tr.realm_id=t.realm_id AND tr.id=t.trade_id
              WHERE t.realm_id=owned.realm_id AND t.card_id=owned.id AND t.released_at IS NULL AND tr.status='pending') THEN 'trade'
              WHEN EXISTS(SELECT 1 FROM market_listings l WHERE l.realm_id=owned.realm_id AND l.card_id=owned.id AND l.status='active') THEN 'market'
            END AS locked
          FROM cards owned JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id
          WHERE owned.realm_id=$1 AND owned.owner_id=$2 AND owned.recycled_at IS NULL
          ORDER BY owned.acquired_at DESC, owned.id LIMIT 300`,
          [realmId, account],
        )
      ).rows;
      const cardCount = Number(
        (
          await tx.query(
            'SELECT count(*) AS n FROM cards WHERE realm_id=$1 AND owner_id=$2 AND recycled_at IS NULL',
            [realmId, account],
          )
        ).rows[0].n,
      );
      const recycled = (
        await tx.query(
          `SELECT ${cardColumns},r.created_at AS "recycledAt",(r.result->>'credited')::integer AS credited,
            (SELECT COALESCE(${nameSql('hp')},'') || '|' || hm.trade_code::text FROM cards held
              JOIN memberships hm ON hm.realm_id=held.realm_id AND hm.account_id=held.owner_id
              LEFT JOIN discord_profiles hp ON hp.account_id=held.owner_id
              WHERE held.realm_id=owned.realm_id AND held.character_id=owned.character_id AND held.recycled_at IS NULL LIMIT 1) AS held,
            EXISTS(SELECT 1 FROM cards held WHERE held.realm_id=owned.realm_id AND held.character_id=owned.character_id AND held.recycled_at IS NULL) AS claimed
          FROM recyclings r JOIN cards owned ON owned.realm_id=r.realm_id AND owned.id=r.card_id
          JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id
          WHERE r.realm_id=$1 AND r.account_id=$2 ORDER BY r.created_at DESC LIMIT 50`,
          [realmId, account],
        )
      ).rows;
      const givenAway = (
        await tx.query(
          `SELECT DISTINCT ON (owned.id) ${cardColumns},t.created_at AS "movedAt",
            CASE WHEN t.admin_action_id IS NOT NULL THEN 'admin'
              WHEN EXISTS(SELECT 1 FROM market_listings l WHERE l.realm_id=t.realm_id AND l.sale_trade_id=t.trade_id) THEN 'market'
              ELSE 'trade' END AS via,
            (SELECT l.price FROM market_listings l WHERE l.realm_id=t.realm_id AND l.sale_trade_id=t.trade_id LIMIT 1) AS price,
            ${nameSql('hp')} AS holder,hm.trade_code AS "holderCode",
            (owned.recycled_at IS NULL AND owned.owner_id!=$2) AS returnable
          FROM card_transfers t JOIN cards owned ON owned.realm_id=t.realm_id AND owned.id=t.card_id
          JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id
          JOIN memberships hm ON hm.realm_id=owned.realm_id AND hm.account_id=owned.owner_id
          LEFT JOIN discord_profiles hp ON hp.account_id=owned.owner_id
          WHERE t.realm_id=$1 AND t.from_id=$2 AND owned.owner_id!=$2
          ORDER BY owned.id,t.sequence DESC`,
          [realmId, account],
        )
      ).rows
        .sort((a, b) => b.movedAt.getTime() - a.movedAt.getTime())
        .slice(0, 50);
      const ledger = (
        await tx.query(
          `SELECT amount,balance_after AS "balanceAfter",reason,created_at AS "createdAt" FROM wallet_ledger
          WHERE realm_id=$1 AND account_id=$2 ORDER BY created_at DESC,id DESC LIMIT 25`,
          [realmId, account],
        )
      ).rows;
      const actions = (
        await tx.query(
          `SELECT a.id AS "actionId",a.kind,a.result->>'characterName' AS "characterName",a.amount,a.note,
            ${nameSql('ap')} AS by,am.trade_code AS "byCode",a.created_at AS "createdAt"
          FROM admin_collection_actions a
          JOIN memberships am ON am.realm_id=a.realm_id AND am.account_id=a.actor_id
          LEFT JOIN discord_profiles ap ON ap.account_id=a.actor_id
          WHERE a.realm_id=$1 AND (a.account_id=$2 OR a.from_id=$2) ORDER BY a.created_at DESC LIMIT 25`,
          [realmId, account],
        )
      ).rows;
      const card = (row: Record<string, unknown>): AdminCollectionCard => ({
        cardId: row.cardId as string,
        characterId: row.characterId as string,
        name: row.name as string,
        series: row.series as string,
        tier: row.tier as string,
        artwork: (row.artwork as Artwork) ?? null,
        acquiredAt: iso(row.acquiredAt as Date),
      });
      return {
        member: {
          memberCode: member.trade_code,
          name: memberLabel(member.name, member.trade_code),
          role: member.role,
          balance: member.balance,
          xp: member.xp,
        },
        cards: cards.map((row) => ({
          ...card(row),
          locked: row.locked ?? null,
        })),
        cardCount,
        recycled: recycled.map((row) => {
          const [name, holderCode] = row.held ? String(row.held).split('|') : [null, null];
          return {
            ...card(row),
            recycledAt: iso(row.recycledAt),
            credited: row.credited ?? 0,
            heldBy: row.claimed ? memberLabel(name || null, holderCode ?? '00000000') : null,
          };
        }),
        givenAway: givenAway.map((row) => ({
          ...card(row),
          movedAt: iso(row.movedAt),
          via: row.via,
          price: row.price ?? null,
          holder: memberLabel(row.holder, row.holderCode),
          holderCode: row.holderCode,
          returnable: row.returnable,
        })),
        ledger: ledger.map((row) => ({
          ...row,
          createdAt: iso(row.createdAt),
        })),
        actions: actions.map(({ byCode, ...row }) => ({
          ...row,
          by: memberLabel(row.by, byCode),
          createdAt: iso(row.createdAt),
        })),
      };
    },
    true,
  );
}

export async function adminCollectionCommand(
  db: Database,
  actorId: string,
  realmIdInput: string,
  input: unknown,
): Promise<AdminCollectionReceipt> {
  const actor = uuid.parse(actorId),
    realmId = uuid.parse(realmIdInput),
    command = commandSchema.parse(input);
  return transaction(db, async (tx) => {
    await requireRealmAdmin(tx, realmId, actor, true);
    const previous = (
      await tx.query(
        'SELECT kind,account_id,card_id,amount,note,result FROM admin_collection_actions WHERE realm_id=$1 AND actor_id=$2 AND request_key=$3',
        [realmId, actor, command.requestKey],
      )
    ).rows[0];
    const member = await memberByCode(tx, realmId, command.memberCode);
    if (previous) {
      const receipt = receiptSchema.parse(previous.result);
      const same =
        previous.kind === command.kind &&
        previous.account_id === member.account_id &&
        previous.note === command.note &&
        (command.kind === 'adjust_gems'
          ? previous.amount === command.amount
          : previous.card_id === command.cardId &&
            (command.kind !== 'restore_card' || (previous.amount !== 0) === command.takeBackGems));
      if (!same)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This request key was already used for a different collection action.',
          409,
        );
      return receipt;
    }
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const actionId = randomUUID();
    let amount = 0,
      cardId: string | null = null,
      fromId: string | null = null,
      characterName: string | null = null,
      recycling: AdminCollectionReceipt['recycling'];

    if (command.kind === 'restore_card') {
      const row = (
        await tx.query(
          `SELECT owned.id,owned.owner_id,owned.character_id,owned.recycled_at,c.name,
            r.id AS recycling_id,r.account_id,r.request_key,r.result,r.config_snapshot,r.created_at
          FROM cards owned JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id
          LEFT JOIN recyclings r ON r.realm_id=owned.realm_id AND r.card_id=owned.id
          WHERE owned.realm_id=$1 AND owned.id=$2`,
          [realmId, command.cardId],
        )
      ).rows[0];
      if (!row || !row.recycled_at || !row.recycling_id || row.account_id !== member.account_id)
        throw new GameError(
          'CARD_UNAVAILABLE',
          'This member has no recycled copy of that card to restore.',
          404,
        );
      if (
        (
          await tx.query(
            'SELECT 1 FROM cards WHERE realm_id=$1 AND character_id=$2 AND recycled_at IS NULL',
            [realmId, row.character_id],
          )
        ).rowCount
      )
        throw new GameError(
          'CHARACTER_CLAIMED',
          `${row.name} has been pulled again by someone else, so this copy can’t come back. Return that newer card instead if appropriate.`,
          409,
        );
      const credited = Number(row.result.credited ?? 0);
      if (command.takeBackGems && credited > 0) {
        if (member.balance < credited)
          throw new GameError(
            'INSUFFICIENT_GEMS',
            `This member only has ${member.balance.toLocaleString('en-US')} gems, less than the ${credited.toLocaleString('en-US')} gems recycling paid. Restore without taking gems back, or adjust gems separately.`,
            409,
          );
        amount = -credited;
      }
      cardId = row.id;
      characterName = row.name;
      recycling = {
        id: row.recycling_id,
        accountId: row.account_id,
        requestKey: row.request_key,
        cardId: row.id,
        result: row.result,
        configSnapshot: row.config_snapshot,
        createdAt: row.created_at.toISOString(),
      };
    } else if (command.kind === 'return_card') {
      await releaseExpiredTrades(tx, realmId);
      const row = (
        await tx.query(
          `SELECT owned.id,owned.owner_id,owned.original_owner_id,owned.recycled_at,c.name FROM cards owned
          JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id
          WHERE owned.realm_id=$1 AND owned.id=$2`,
          [realmId, command.cardId],
        )
      ).rows[0];
      if (!row || row.recycled_at)
        throw new GameError(
          'CARD_UNAVAILABLE',
          'That card is no longer in anyone’s collection.',
          404,
        );
      if (row.owner_id === member.account_id)
        throw new GameError('CARD_UNAVAILABLE', 'This member already has that card.', 409);
      const earlierOwner =
        row.original_owner_id === member.account_id ||
        !!(
          await tx.query(
            'SELECT 1 FROM card_transfers WHERE realm_id=$1 AND card_id=$2 AND to_id=$3',
            [realmId, row.id, member.account_id],
          )
        ).rowCount;
      if (!earlierOwner)
        throw new GameError(
          'NOT_PREVIOUS_OWNER',
          'A card can only be returned to someone who owned it before.',
          409,
        );
      if (
        (
          await tx.query(
            `SELECT 1 FROM trade_cards t JOIN trades tr ON tr.realm_id=t.realm_id AND tr.id=t.trade_id
            WHERE t.realm_id=$1 AND t.card_id=$2 AND t.released_at IS NULL AND tr.status='pending'`,
            [realmId, row.id],
          )
        ).rowCount ||
        (
          await tx.query(
            "SELECT 1 FROM market_listings WHERE realm_id=$1 AND card_id=$2 AND status='active'",
            [realmId, row.id],
          )
        ).rowCount
      )
        throw new GameError(
          'CARD_LOCKED',
          'The current holder has this card in a pending trade or market listing. It has to be withdrawn first.',
          409,
        );
      cardId = row.id;
      fromId = row.owner_id;
      characterName = row.name;
    } else amount = command.amount;

    const balance = member.balance + amount;
    if (balance < 0)
      throw new GameError(
        'INSUFFICIENT_GEMS',
        `This member only has ${member.balance.toLocaleString('en-US')} gems.`,
        409,
      );
    if (balance > 2_147_483_647)
      throw new GameError('WALLET_LIMIT', 'The wallet cannot hold this amount.', 409);
    const result: AdminCollectionReceipt = {
      ok: true,
      actionId,
      kind: command.kind,
      memberCode: member.trade_code,
      cardId,
      characterName,
      amount,
      balance,
      createdAt: now.toISOString(),
      ...(recycling ? { recycling } : {}),
    };
    await tx.query(
      `INSERT INTO admin_collection_actions(realm_id,id,actor_id,request_key,kind,account_id,card_id,from_id,amount,note,result,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        realmId,
        actionId,
        actor,
        command.requestKey,
        command.kind,
        member.account_id,
        cardId,
        fromId,
        amount,
        command.note,
        result,
        now,
      ],
    );
    if (recycling) {
      // The card returns to the same row, so its origin and XP history stay
      // intact; the undone recycling lives on in this action's receipt.
      await tx.query('DELETE FROM recyclings WHERE realm_id=$1 AND id=$2', [realmId, recycling.id]);
      await tx.query('UPDATE cards SET recycled_at=NULL WHERE realm_id=$1 AND id=$2', [
        realmId,
        cardId,
      ]);
    }
    if (command.kind === 'return_card') {
      const sequence = (
        await tx.query(
          'SELECT COALESCE(max(sequence),0)+1 AS next FROM card_transfers WHERE realm_id=$1 AND card_id=$2',
          [realmId, cardId],
        )
      ).rows[0].next;
      await tx.query(
        'INSERT INTO card_transfers(realm_id,id,trade_id,admin_action_id,card_id,sequence,from_id,to_id,created_at) VALUES($1,$2,NULL,$3,$4,$5,$6,$7,$8)',
        [realmId, randomUUID(), actionId, cardId, sequence, fromId, member.account_id, now],
      );
      await tx.query('UPDATE cards SET owner_id=$3 WHERE realm_id=$1 AND id=$2', [
        realmId,
        cardId,
        member.account_id,
      ]);
    }
    if (amount) {
      await tx.query('UPDATE memberships SET balance=$3 WHERE realm_id=$1 AND account_id=$2', [
        realmId,
        member.account_id,
        balance,
      ]);
      await tx.query(
        "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'admin_adjustment',$7)",
        [
          realmId,
          randomUUID(),
          member.account_id,
          `admin-collection:${actionId}`,
          amount,
          balance,
          now,
        ],
      );
    }
    return result;
  });
}

async function hasAdminActions(tx: Transaction) {
  return (await tx.query("SELECT to_regclass('admin_collection_actions') IS NOT NULL AS present"))
    .rows[0].present as boolean;
}

/** The receipt of a recycling that an admin later undid (for request retries). */
export async function reversedRecycling(
  tx: Transaction,
  realmId: string,
  accountId: string,
  requestKey: string,
) {
  // Databases that are still on an older schema (before 0027) have no actions.
  if (!(await hasAdminActions(tx))) return null;
  const row = (
    await tx.query(
      `SELECT result->'recycling' AS recycling FROM admin_collection_actions
      WHERE realm_id=$1 AND kind='restore_card' AND account_id=$2 AND result->'recycling'->>'requestKey'=$3`,
      [realmId, accountId, requestKey],
    )
  ).rows[0];
  return row ? (row.recycling as { cardId: string; result: unknown }) : null;
}

/** Restore check: each action reconciles with the wallet, card moves and recyclings. */
export async function validateAdminCollectionBackup(tx: Transaction): Promise<void> {
  const fail = () => {
    throw new Error('Backup admin collection history does not reconcile.');
  };
  if (!(await hasAdminActions(tx))) return;
  const actions = (await tx.query('SELECT * FROM admin_collection_actions')).rows,
    ledger = (await tx.query("SELECT * FROM wallet_ledger WHERE reason='admin_adjustment'")).rows,
    moves = (await tx.query('SELECT * FROM card_transfers WHERE admin_action_id IS NOT NULL')).rows;
  for (const action of actions) {
    const parsed = receiptSchema.safeParse(action.result);
    if (
      !parsed.success ||
      parsed.data.actionId !== action.id ||
      parsed.data.kind !== action.kind ||
      parsed.data.amount !== action.amount ||
      parsed.data.cardId !== action.card_id ||
      parsed.data.createdAt !== action.created_at.toISOString()
    )
      fail();
    const receipt = parsed.data!;
    const money = ledger.filter(
      (row) =>
        row.realm_id === action.realm_id && row.operation_key === `admin-collection:${action.id}`,
    );
    if (action.amount === 0 ? money.length !== 0 : money.length !== 1) fail();
    if (
      money[0] &&
      (money[0].account_id !== action.account_id ||
        money[0].amount !== action.amount ||
        money[0].balance_after !== receipt.balance ||
        money[0].created_at.getTime() !== action.created_at.getTime())
    )
      fail();
    const moved = moves.filter(
      (row) => row.realm_id === action.realm_id && row.admin_action_id === action.id,
    );
    if (action.kind === 'return_card') {
      if (
        moved.length !== 1 ||
        moved[0].card_id !== action.card_id ||
        moved[0].from_id !== action.from_id ||
        moved[0].to_id !== action.account_id ||
        moved[0].created_at.getTime() !== action.created_at.getTime()
      )
        fail();
    } else if (moved.length) fail();
    if (action.kind === 'restore_card') {
      const recycling = receipt.recycling;
      if (
        !recycling ||
        recycling.cardId !== action.card_id ||
        recycling.accountId !== action.account_id ||
        (action.amount !== 0 && action.amount !== -Number(recycling.result.credited))
      )
        fail();
      const credit = (
        await tx.query(
          "SELECT amount FROM wallet_ledger WHERE realm_id=$1 AND account_id=$2 AND operation_key=$3 AND reason='recycling'",
          [action.realm_id, recycling!.accountId, `recycle:${recycling!.requestKey}`],
        )
      ).rows[0];
      const stillRecycled = (
        await tx.query('SELECT 1 FROM recyclings WHERE realm_id=$1 AND id=$2', [
          action.realm_id,
          recycling!.id,
        ])
      ).rowCount;
      if (!credit || credit.amount !== Number(recycling!.result.credited) || stillRecycled) fail();
    }
  }
  for (const row of ledger)
    if (
      !actions.some(
        (action) =>
          action.realm_id === row.realm_id && row.operation_key === `admin-collection:${action.id}`,
      )
    )
      fail();
  for (const row of moves)
    if (
      !actions.some(
        (action) =>
          action.realm_id === row.realm_id &&
          action.id === row.admin_action_id &&
          action.kind === 'return_card',
      )
    )
      fail();
}
