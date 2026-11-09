import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig, type Tier } from '../../config/src/index';
import { calculateRecycleCredit, GameError } from '../../core/src/index';
import { requireInstanceAdmin } from './auth';
import { requireMember } from './game';
import { transaction, type Database, type Transaction } from './connection';
import { batchItemKey, recycleOwnedCard, recycleRules } from './recycling';
import { releaseExpiredTrades } from './trade-state';

/*
 * Removing characters. A removed character leaves the game (no draws, no
 * glossary entry, no wishes) but its row stays, so receipts and history keep
 * stable IDs. A card someone owns is recycled for its owner: they get the
 * card's recycle value, exactly as if they had recycled it themselves. Cards
 * listed on the market or reserved in a trade are never touched; those
 * characters are skipped until the listing or trade ends.
 */

/** Characters one removal may name explicitly. */
export const characterRemovalLimit = 500;
/** Characters a preview lists in full; the hash covers all of them. */
const previewListLimit = 200;

const selectionSchema = z.union([
  z.strictObject({ characterIds: z.array(z.uuid()).min(1).max(characterRemovalLimit) }),
  z.strictObject({ withoutArtwork: z.literal(true) }),
]);
const applySchema = z.strictObject({
  selection: selectionSchema,
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestKey: z.uuid(),
});

export type CharacterRemovalPreview = {
  previewHash: string;
  /** Characters that will be removed. */
  removable: number;
  /** Removed characters someone owns; each owner is refunded. */
  owned: number;
  refundGems: number;
  /** Characters kept because their card is on the market or in a pending trade. */
  skipped: { characterId: string; name: string; reason: 'market' | 'trade' }[];
  /** Active packs left with fewer characters than the realm's minimum pool. */
  thinPacks: string[];
  characters: {
    characterId: string;
    name: string;
    series: string;
    tier: Tier;
    owner: string | null;
    refund: number | null;
  }[];
};
export type CharacterRemovalResult = {
  ok: true;
  removalId: string;
  removed: number;
  refundedCards: number;
  refundedGems: number;
  skipped: number;
  wishesCleared: number;
  removedAt: string;
};

async function requireCatalogAdmin(tx: Transaction, actorId: string, realmId: string) {
  // Catalog changes are instance-level actions; the actor must also run this realm.
  await requireInstanceAdmin(tx, actorId);
  const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
    .rows[0];
  if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
  if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
    throw new GameError('FORBIDDEN', 'Only a realm administrator can remove characters.', 403);
  return realm.config as { schemaVersion: number };
}

type Candidate = {
  id: string;
  name: string;
  series: string;
  tier: Tier;
  card_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  locked: 'market' | 'trade' | null;
};

async function review(
  tx: Transaction,
  actorId: string,
  realmId: string,
  selection: z.infer<typeof selectionSchema>,
) {
  const rawConfig = await requireCatalogAdmin(tx, actorId, realmId);
  await releaseExpiredTrades(tx, realmId);
  const candidates = (
    await tx.query(
      `SELECT c.id,c.name,c.series,c.tier,owned.id AS card_id,owned.owner_id,
        COALESCE(p.display_name,p.username) AS owner_name,
        CASE WHEN EXISTS(SELECT 1 FROM market_listings l WHERE l.realm_id=owned.realm_id AND l.card_id=owned.id AND l.status='active') THEN 'market'
          WHEN EXISTS(SELECT 1 FROM trade_cards t WHERE t.realm_id=owned.realm_id AND t.card_id=owned.id AND t.released_at IS NULL) THEN 'trade'
          END AS locked
      FROM characters c
      LEFT JOIN cards owned ON owned.realm_id=c.realm_id AND owned.character_id=c.id AND owned.recycled_at IS NULL
      LEFT JOIN discord_profiles p ON p.account_id=owned.owner_id
      WHERE c.realm_id=$1 AND c.retired_at IS NULL
        AND (CASE WHEN $2::uuid[] IS NULL THEN NOT (c.provenance ? 'artwork') ELSE c.id=ANY($2::uuid[]) END)
      ORDER BY c.name,c.id`,
      [realmId, 'characterIds' in selection ? selection.characterIds : null],
    )
  ).rows as Candidate[];
  if ('characterIds' in selection && candidates.length !== new Set(selection.characterIds).size)
    throw new GameError(
      'NOT_FOUND',
      'Some of these characters are not in this realm or were already removed.',
      404,
    );
  const removable = candidates.filter((c) => !c.locked);
  // Refunds are the owner's recycle value, computed as recycling would.
  const refunds: { characterId: string; cardId: string; ownerId: string; credited: number }[] = [];
  const byOwner = new Map<string, Candidate[]>();
  for (const c of removable)
    if (c.owner_id) byOwner.set(c.owner_id, [...(byOwner.get(c.owner_id) ?? []), c]);
  for (const [ownerId, cards] of [...byOwner].sort(([a], [b]) => a.localeCompare(b))) {
    const rules = await recycleRules(tx, realmId, ownerId, rawConfig);
    let balance = (
      await tx.query('SELECT balance FROM memberships WHERE realm_id=$1 AND account_id=$2', [
        realmId,
        ownerId,
      ])
    ).rows[0].balance as number;
    for (const card of cards.sort((a, b) => a.card_id!.localeCompare(b.card_id!))) {
      const credit = calculateRecycleCredit(
        card.tier,
        balance,
        rules.config,
        rules.values?.[card.id]?.recycleValue,
      );
      balance = credit.balance;
      refunds.push({
        characterId: card.id,
        cardId: card.card_id!,
        ownerId,
        credited: credit.credited,
      });
    }
  }
  const removedIds = new Set(removable.map((c) => c.id));
  const config = parseRealmConfig(rawConfig);
  const thinPacks = (
    await tx.query(
      `SELECT p.name,(SELECT count(*)::int FROM characters c WHERE c.realm_id=p.realm_id AND c.retired_at IS NULL
        AND (p.category IS NULL OR p.category=ANY(c.categories)) AND NOT (c.id=ANY($2::uuid[]))) AS size
      FROM packs p WHERE p.realm_id=$1 AND p.retired_at IS NULL ORDER BY p.name`,
      [realmId, [...removedIds]],
    )
  ).rows
    .filter((pack) => pack.size < config.minimumPoolSize)
    .map((pack) => pack.name as string);
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        selection,
        removable: removable.map((c) => c.id),
        refunds,
        skipped: candidates.filter((c) => c.locked).map((c) => c.id),
      }),
    )
    .digest('hex');
  return { rawConfig, candidates, removable, refunds, thinPacks, hash };
}

export async function previewCharacterRemoval(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<CharacterRemovalPreview> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const selection = selectionSchema.parse(input);
  return transaction(db, async (tx) => {
    const value = await review(tx, actorId, realmId, selection);
    const refundByCharacter = new Map(value.refunds.map((r) => [r.characterId, r.credited]));
    return {
      previewHash: value.hash,
      removable: value.removable.length,
      owned: value.refunds.length,
      refundGems: value.refunds.reduce((sum, r) => sum + r.credited, 0),
      skipped: value.candidates
        .filter((c) => c.locked)
        .map((c) => ({ characterId: c.id, name: c.name, reason: c.locked! })),
      thinPacks: value.thinPacks,
      characters: value.removable.slice(0, previewListLimit).map((c) => ({
        characterId: c.id,
        name: c.name,
        series: c.series,
        tier: c.tier,
        owner: c.owner_id ? (c.owner_name ?? 'A player') : null,
        refund: refundByCharacter.get(c.id) ?? null,
      })),
    };
  });
}

/**
 * Removes the reviewed characters and refunds their owners, all in one
 * transaction. A retry with the same request key replays the result; a
 * review made stale by any change (a pull, a trade, a price) is refused.
 */
export async function removeCharacters(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<CharacterRemovalResult> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const request = applySchema.parse(input);
  return transaction(db, async (tx) => {
    await requireCatalogAdmin(tx, actorId, realmId);
    const previous = (
      await tx.query(
        'SELECT preview_hash,result FROM character_removals WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, request.requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.preview_hash !== request.previewHash)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This request key was used for a different removal.',
          409,
        );
      return previous.result as CharacterRemovalResult;
    }
    const value = await review(tx, actorId, realmId, request.selection);
    if (value.hash !== request.previewHash)
      throw new GameError(
        'PREVIEW_STALE',
        'The realm changed since your review (a pull, trade or listing). Review the removal again.',
        409,
      );
    if (!value.removable.length)
      throw new GameError(
        'NO_CHANGES',
        'Nothing to remove: every selected character is on the market or in a trade.',
        409,
      );
    // Refund owners by recycling their cards for them (same journal and ledger).
    const refunds: {
      characterId: string;
      cardId: string;
      ownerId: string;
      recyclingId: string;
      credited: number;
    }[] = [];
    let ownerId: string | null = null,
      rules: Awaited<ReturnType<typeof recycleRules>> | null = null,
      balance = 0;
    for (const refund of value.refunds) {
      if (refund.ownerId !== ownerId) {
        ownerId = refund.ownerId;
        rules = await recycleRules(tx, realmId, ownerId, value.rawConfig);
        balance = (
          await tx.query('SELECT balance FROM memberships WHERE realm_id=$1 AND account_id=$2', [
            realmId,
            ownerId,
          ])
        ).rows[0].balance;
      }
      const recycled = await recycleOwnedCard(
        tx,
        realmId,
        refund.ownerId,
        refund.cardId,
        batchItemKey(request.requestKey, refund.cardId),
        rules!,
        balance,
        value.rawConfig.schemaVersion,
      );
      balance = recycled.balance;
      refunds.push({ ...refund, recyclingId: recycled.recyclingId, credited: recycled.credited });
    }
    const ids = value.removable.map((c) => c.id);
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    await tx.query('UPDATE characters SET retired_at=$3 WHERE realm_id=$1 AND id=ANY($2::uuid[])', [
      realmId,
      ids,
      now,
    ]);
    const wishesCleared =
      (
        await tx.query(
          'DELETE FROM wishlist_entries WHERE realm_id=$1 AND character_id=ANY($2::uuid[])',
          [realmId, ids],
        )
      ).rowCount ?? 0;
    const result: CharacterRemovalResult = {
      ok: true,
      removalId: randomUUID(),
      removed: ids.length,
      refundedCards: refunds.length,
      refundedGems: refunds.reduce((sum, r) => sum + r.credited, 0),
      skipped: value.candidates.length - ids.length,
      wishesCleared,
      removedAt: now.toISOString(),
    };
    await tx.query(
      `INSERT INTO character_removals(realm_id,id,account_id,request_key,preview_hash,character_ids,refunds,result,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        realmId,
        result.removalId,
        actorId,
        request.requestKey,
        request.previewHash,
        JSON.stringify(ids),
        JSON.stringify(refunds),
        result,
        now,
      ],
    );
    return result;
  });
}

const refundSchema = z.strictObject({
  characterId: z.uuid(),
  cardId: z.uuid(),
  ownerId: z.uuid(),
  recyclingId: z.uuid(),
  credited: z.number().int().min(0),
});
/**
 * Restore check: each removal's refunds are real recyclings of cards of the
 * removed characters (or recyclings an admin undid later), and every removed
 * character was named by a removal and has no card left in a collection.
 */
export async function validateCharacterRemovals(tx: Transaction) {
  const present = (
    await tx.query("SELECT to_regclass('character_removals') IS NOT NULL AS present")
  ).rows[0].present as boolean;
  if (!present) return;
  function fail(message: string): never {
    throw new Error(`Backup character removals are invalid: ${message}.`);
  }
  const named = new Set<string>();
  for (const row of (await tx.query('SELECT * FROM character_removals')).rows) {
    const ids = z.array(z.uuid()).min(1).safeParse(row.character_ids);
    const refunds = z.array(refundSchema).safeParse(row.refunds);
    if (!ids.success || !refunds.success) fail('journal');
    for (const id of ids.data!) named.add(`${row.realm_id}:${id}`);
    if (
      row.result?.ok !== true ||
      row.result.removalId !== row.id ||
      row.result.removed !== ids.data!.length ||
      row.result.refundedCards !== refunds.data!.length ||
      row.result.refundedGems !== refunds.data!.reduce((sum, r) => sum + r.credited, 0)
    )
      fail('result');
    for (const refund of refunds.data!) {
      if (!ids.data!.includes(refund.characterId)) fail('refund character');
      const recycling = (
        await tx.query(
          `SELECT r.account_id,r.card_id,(r.result->>'credited')::int AS credited,c.character_id
          FROM recyclings r JOIN cards c ON c.realm_id=r.realm_id AND c.id=r.card_id
          WHERE r.realm_id=$1 AND r.id=$2`,
          [row.realm_id, refund.recyclingId],
        )
      ).rows[0];
      if (recycling) {
        if (
          recycling.account_id !== refund.ownerId ||
          recycling.card_id !== refund.cardId ||
          recycling.credited !== refund.credited ||
          recycling.character_id !== refund.characterId
        )
          fail('refund recycling');
        continue;
      }
      // An admin may have undone the refund after the character was added back.
      const undone = (
        await tx.query(
          `SELECT 1 FROM admin_collection_actions WHERE realm_id=$1 AND kind='restore_card'
          AND card_id=$2 AND result->'recycling'->>'id'=$3`,
          [row.realm_id, refund.cardId, refund.recyclingId],
        )
      ).rowCount;
      if (!undone) fail('missing refund');
    }
  }
  for (const row of (
    await tx.query(
      `SELECT c.realm_id,c.id,EXISTS(SELECT 1 FROM cards o WHERE o.realm_id=c.realm_id AND o.character_id=c.id AND o.recycled_at IS NULL) AS owned
      FROM characters c WHERE c.retired_at IS NOT NULL`,
    )
  ).rows) {
    if (!named.has(`${row.realm_id}:${row.id}`)) fail('unjournaled removal');
    if (row.owned) fail('removed character still owned');
  }
}
