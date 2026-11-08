import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig } from '../../config/src/index';
import { calculateRankTrackPurchase, type RankTrackResult } from '../../core/src/rank-tracks';
import { GameError } from '../../core/src/errors';
import { transaction, type Database } from './connection';
import { requireMember } from './game';
import { purchasedRankTrackLevels } from './rank-track-state';
import { requireExpectedRevision } from './settings-revision';

export async function buyRankTrackLevel(
  db: Database,
  actorId: string,
  realmId: string,
  trackId: string,
  targetLevel: number,
  requestKey: string,
  expectedRevision?: number,
): Promise<RankTrackResult> {
  [actorId, realmId, requestKey].forEach((value) => z.uuid().parse(value));
  z.string()
    .regex(/^[a-z][a-z0-9_-]{0,39}$/)
    .parse(trackId);
  z.number().int().min(1).max(10).parse(targetLevel);
  return transaction(db, async (tx) => {
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    const member = await requireMember(tx, realmId, actorId);
    const previous = (
      await tx.query(
        'SELECT track_id,level,result FROM rank_track_purchases WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.track_id !== trackId || previous.level !== targetLevel)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This request key belongs to another rank level.',
          409,
        );
      return previous.result as RankTrackResult;
    }
    await requireExpectedRevision(tx, realmId, expectedRevision);
    const config = parseRealmConfig(realm.config),
      levels = await purchasedRankTrackLevels(tx, realmId, actorId);
    const quote = calculateRankTrackPurchase(config, levels, trackId, targetLevel, member.balance);
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const result: RankTrackResult = {
      ok: true,
      purchaseId: randomUUID(),
      ...quote,
      purchasedAt: now.toISOString(),
    };
    await tx.query(
      'INSERT INTO rank_track_purchases(realm_id,id,account_id,request_key,track_id,level,result,config_snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [realmId, result.purchaseId, actorId, requestKey, trackId, targetLevel, result, config, now],
    );
    await tx.query('UPDATE memberships SET balance=$3 WHERE realm_id=$1 AND account_id=$2', [
      realmId,
      actorId,
      result.balance,
    ]);
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'rank_track_purchase',$7)",
      [
        realmId,
        randomUUID(),
        actorId,
        `rank-track:${requestKey}`,
        -result.charged,
        result.balance,
        now,
      ],
    );
    return result;
  });
}
