import { effectiveMemberConfig } from './rank-track-state';
import { purchasedCollectorRank } from './rank-state';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig } from '../../config/src/index';
import { GameError, requireWishlistSpace, type WishlistResult } from '../../core/src/index';
import { requireMember } from './game';
import { wishlistEntries } from './wishlist-state';
import { transaction, type Database, type Transaction } from './connection';
import { requireExpectedRevision } from './settings-revision';
import { batchItemKey } from './recycling';

/** The member's wishlist rules including rank bonuses (slots), computed once. */
async function wishlistRules(
  tx: Transaction,
  realmId: string,
  actorId: string,
  rawConfig: { schemaVersion: number },
) {
  return effectiveMemberConfig(
    tx,
    realmId,
    actorId,
    parseRealmConfig(rawConfig),
    rawConfig.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, actorId) : 0,
  );
}

/**
 * Adds or removes one wish inside the caller's transaction (realm locked,
 * membership and settings revision checked) and journals it under its key.
 */
async function applyWishlistChange(
  tx: Transaction,
  realmId: string,
  actorId: string,
  characterId: string,
  present: boolean,
  requestKey: string,
  config: Awaited<ReturnType<typeof wishlistRules>>,
): Promise<WishlistResult> {
  if (
    !(
      await tx.query(
        // Read through to_jsonb: older schemas (upgrade tests) have no retired_at yet.
        "SELECT 1 FROM characters c WHERE c.realm_id=$1 AND c.id=$2 AND (to_jsonb(c)->>'retired_at') IS NULL",
        [realmId, characterId],
      )
    ).rowCount
  )
    throw new GameError('NOT_FOUND', 'Character not found in this realm.', 404);
  const entries = await wishlistEntries(tx, realmId, actorId);
  const existing = entries.find((entry) => entry.character_id === characterId);
  if (present && !existing) requireWishlistSpace(entries.length, config);
  const changed = present !== !!existing;
  const entryId = existing?.id ?? (present ? randomUUID() : null);
  const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
  if (changed && present)
    await tx.query(
      'INSERT INTO wishlist_entries(realm_id,id,account_id,character_id,created_at) VALUES($1,$2,$3,$4,$5)',
      [realmId, entryId, actorId, characterId, now],
    );
  else if (changed)
    await tx.query(
      'DELETE FROM wishlist_entries WHERE realm_id=$1 AND account_id=$2 AND character_id=$3',
      [realmId, actorId, characterId],
    );
  const result: WishlistResult = {
    ok: true,
    changeId: randomUUID(),
    characterId,
    present,
    entryId,
    changed,
    entryCount: entries.length + (changed ? (present ? 1 : -1) : 0),
    slots: config.wishlist.slots,
    changedAt: now.toISOString(),
  };
  await tx.query(
    'INSERT INTO wishlist_changes(realm_id,id,account_id,request_key,character_id,present,result,config_snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [realmId, result.changeId, actorId, requestKey, characterId, present, result, config, now],
  );
  return result;
}

export async function setWishlistEntry(
  db: Database,
  actorId: string,
  realmId: string,
  characterId: string,
  present: boolean,
  requestKey: string,
  expectedRevision?: number,
): Promise<WishlistResult> {
  [actorId, realmId, characterId, requestKey].forEach((value) => z.uuid().parse(value));
  z.boolean().parse(present);
  return transaction(db, async (tx) => {
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    await requireMember(tx, realmId, actorId);
    const previous = (
      await tx.query(
        'SELECT character_id,present,result FROM wishlist_changes WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.character_id !== characterId || previous.present !== present)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This wishlist request key was already used for a different change.',
          409,
        );
      return previous.result as WishlistResult;
    }
    await requireExpectedRevision(tx, realmId, expectedRevision);
    return applyWishlistChange(
      tx,
      realmId,
      actorId,
      characterId,
      present,
      requestKey,
      await wishlistRules(tx, realmId, actorId, realm.config),
    );
  });
}

/** Wishes one batch may add: more than any realm's slots (at most 20). */
export const wishlistBatchLimit = 20;
const batchSchema = z.strictObject({
  characterIds: z
    .array(z.uuid())
    .min(1)
    .max(wishlistBatchLimit)
    .refine((ids) => new Set(ids).size === ids.length, 'List each character once.'),
  requestKey: z.uuid(),
  expectedRevision: z.number().int().min(0).optional(),
});
export type WishlistBatchResult = { ok: true; added: WishlistResult[]; entryCount: number };
/**
 * Adds several characters to the member's wishlist at once (picked together
 * in the wishlist browser). All or nothing: without room for every one of
 * them, none is added. Each wish is journaled like a single change under a
 * key derived from the batch key, so a retry replays the stored results.
 */
export async function addWishlistEntries(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<WishlistBatchResult> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const request = batchSchema.parse(input);
  const keys = request.characterIds.map((id) => batchItemKey(request.requestKey, id));
  return transaction(db, async (tx) => {
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    await requireMember(tx, realmId, actorId);
    const previous = (
      await tx.query(
        'SELECT character_id,present,request_key,result FROM wishlist_changes WHERE realm_id=$1 AND account_id=$2 AND request_key=ANY($3::uuid[])',
        [realmId, actorId, keys],
      )
    ).rows as {
      character_id: string;
      present: boolean;
      request_key: string;
      result: WishlistResult;
    }[];
    if (previous.length) {
      const byKey = new Map(previous.map((row) => [row.request_key, row]));
      if (
        previous.length !== keys.length ||
        keys.some(
          (key, index) =>
            byKey.get(key)?.character_id !== request.characterIds[index] ||
            byKey.get(key)?.present !== true,
        )
      )
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This wishlist request key was already used for a different change.',
          409,
        );
      const added = keys.map((key) => byKey.get(key)!.result);
      return { ok: true, added, entryCount: added[added.length - 1].entryCount };
    }
    await requireExpectedRevision(tx, realmId, request.expectedRevision);
    const config = await wishlistRules(tx, realmId, actorId, realm.config);
    const added: WishlistResult[] = [];
    for (const [index, characterId] of request.characterIds.entries())
      added.push(
        await applyWishlistChange(tx, realmId, actorId, characterId, true, keys[index], config),
      );
    return { ok: true, added, entryCount: added[added.length - 1].entryCount };
  });
}
