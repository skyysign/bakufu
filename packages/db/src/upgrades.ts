import { effectiveMemberConfig } from './rank-track-state';
import { purchasedCollectorRank } from './rank-state';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig } from '../../config/src/index';
import { calculateUpgradePurchase, GameError, type UpgradeResult } from '../../core/src/index';
import { requireMember } from './game';
import { purchasedUpgradeRank } from './upgrade-state';
import { transaction, type Database } from './connection';
import { requireExpectedRevision } from './settings-revision';

export async function buyUpgrade(
  db: Database,
  actorId: string,
  realmId: string,
  upgradeId: string,
  targetRank: number,
  requestKey: string,
  expectedRevision?: number,
): Promise<UpgradeResult> {
  [actorId, realmId, requestKey].forEach((value) => z.uuid().parse(value));
  z.literal('pack_discount').parse(upgradeId);
  z.number().int().min(1).max(5).parse(targetRank);
  return transaction(db, async (tx) => {
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    const member = await requireMember(tx, realmId, actorId);
    const previous = (
      await tx.query(
        'SELECT upgrade_id,rank,result FROM upgrade_purchases WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.upgrade_id !== upgradeId || previous.rank !== targetRank)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This purchase request key was already used for another rank.',
          409,
        );
      return previous.result as UpgradeResult;
    }
    await requireExpectedRevision(tx, realmId, expectedRevision);
    if (parseRealmConfig(realm.config).legacyPurchasesRetired)
      throw new GameError(
        'LEGACY_PURCHASES_RETIRED',
        'Use collector rank progression for new upgrades.',
        409,
      );
    const config = await effectiveMemberConfig(
      tx,
      realmId,
      actorId,
      parseRealmConfig(realm.config),
      realm.config.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, actorId) : 0,
    );
    const currentRank = await purchasedUpgradeRank(tx, realmId, actorId);
    const quote = calculateUpgradePurchase(
      config,
      currentRank,
      targetRank,
      member.xp,
      member.balance,
    );
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const result: UpgradeResult = {
      ok: true,
      purchaseId: randomUUID(),
      upgradeId: 'pack_discount',
      ...quote,
      purchasedAt: now.toISOString(),
    };
    await tx.query(
      'INSERT INTO upgrade_purchases(realm_id,id,account_id,request_key,upgrade_id,rank,result,config_snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [realmId, result.purchaseId, actorId, requestKey, upgradeId, targetRank, result, config, now],
    );
    await tx.query('UPDATE memberships SET balance=$3 WHERE realm_id=$1 AND account_id=$2', [
      realmId,
      actorId,
      result.balance,
    ]);
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'upgrade_purchase',$7)",
      [
        realmId,
        randomUUID(),
        actorId,
        `upgrade:${requestKey}`,
        -result.charged,
        result.balance,
        now,
      ],
    );
    return result;
  });
}
