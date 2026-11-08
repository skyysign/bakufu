import { effectiveMemberConfig } from './rank-track-state';
import { purchasedCollectorRank } from './rank-state';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig } from '../../config/src/index';
import { GameError, requireWishlistSpace, type WishlistResult } from '../../core/src/index';
import { requireMember } from './game';
import { wishlistEntries } from './wishlist-state';
import { transaction, type Database } from './connection';
import { requireExpectedRevision } from './settings-revision';

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
    if (
      !(
        await tx.query('SELECT 1 FROM characters WHERE realm_id=$1 AND id=$2', [
          realmId,
          characterId,
        ])
      ).rowCount
    )
      throw new GameError('NOT_FOUND', 'Character not found in this realm.', 404);
    await requireExpectedRevision(tx, realmId, expectedRevision);
    const config = await effectiveMemberConfig(
        tx,
        realmId,
        actorId,
        parseRealmConfig(realm.config),
        realm.config.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, actorId) : 0,
      ),
      entries = await wishlistEntries(tx, realmId, actorId);
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
  });
}
