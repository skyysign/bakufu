import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig } from '../../config/src/index';
import { calculateRankPurchase, type CollectorRankResult } from '../../core/src/ranks';
import { GameError } from '../../core/src/errors';
import { transaction, type Database } from './connection';
import { requireMember } from './game';
import { purchasedCollectorRank } from './rank-state';
import { requireExpectedRevision } from './settings-revision';

export async function buyCollectorRank(
  db: Database,
  actorId: string,
  realmId: string,
  targetRank: number,
  requestKey: string,
  expectedRevision?: number,
): Promise<CollectorRankResult> {
  [actorId, realmId, requestKey].forEach((value) => z.uuid().parse(value));
  z.number().int().min(1).max(10).parse(targetRank);
  return transaction(db, async (tx) => {
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    const member = await requireMember(tx, realmId, actorId);
    const previous = (
      await tx.query(
        'SELECT rank,result FROM rank_purchases WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.rank !== targetRank)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This rank request key was already used for a different rank.',
          409,
        );
      return previous.result as CollectorRankResult;
    }
    await requireExpectedRevision(tx, realmId, expectedRevision);
    if (parseRealmConfig(realm.config).legacyPurchasesRetired)
      throw new GameError(
        'LEGACY_PURCHASES_RETIRED',
        'Use collector rank progression for new upgrades.',
        409,
      );
    const config = parseRealmConfig(realm.config),
      rank = await purchasedCollectorRank(tx, realmId, actorId);
    const quote = calculateRankPurchase(config, rank, targetRank, member.balance);
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const result: CollectorRankResult = {
      ok: true,
      purchaseId: randomUUID(),
      ...quote,
      purchasedAt: now.toISOString(),
    };
    await tx.query(
      'INSERT INTO rank_purchases(realm_id,id,account_id,request_key,rank,result,config_snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [realmId, result.purchaseId, actorId, requestKey, targetRank, result, config, now],
    );
    await tx.query('UPDATE memberships SET balance=$3 WHERE realm_id=$1 AND account_id=$2', [
      realmId,
      actorId,
      result.balance,
    ]);
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'rank_purchase',$7)",
      [realmId, randomUUID(), actorId, `rank:${requestKey}`, -result.charged, result.balance, now],
    );
    return result;
  });
}
