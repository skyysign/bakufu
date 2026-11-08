import { isDeepStrictEqual } from 'node:util';
import { parseRealmConfig } from '../../config/src/index';
import { calculateGemReward } from '../../core/src/gem-rewards';
import type { Transaction } from './connection';

export async function validateGemRewardBackup(tx: Transaction): Promise<void> {
  const invalid = (
    await tx.query(`SELECT 1 FROM gem_reward_claims c
    LEFT JOIN wallet_ledger l ON l.realm_id=c.realm_id AND l.account_id=c.account_id AND l.operation_key='gem-reward:'||c.request_key::text
    WHERE l.id IS NULL OR l.reason!='gem_reward' OR c.result->>'ok' IS DISTINCT FROM 'true'
      OR c.result->>'claimId' IS DISTINCT FROM c.id::text
      OR l.amount IS DISTINCT FROM (c.result->>'amount')::integer
      OR l.balance_after IS DISTINCT FROM (c.result->>'balance')::integer
      OR l.created_at IS DISTINCT FROM c.created_at
      OR (c.result->>'claimedAt')::timestamptz IS DISTINCT FROM c.created_at
    UNION ALL SELECT 1 FROM wallet_ledger l WHERE l.reason='gem_reward' AND NOT EXISTS(
      SELECT 1 FROM gem_reward_claims c WHERE c.realm_id=l.realm_id AND c.account_id=l.account_id AND l.operation_key='gem-reward:'||c.request_key::text)
    LIMIT 1`)
  ).rowCount;
  if (invalid) throw new Error('Backup gem reward history does not reconcile.');
  const previous = new Map<string, string>();
  for (const row of (
    await tx.query(
      'SELECT realm_id,account_id,id,result,config_snapshot,created_at FROM gem_reward_claims ORDER BY realm_id,account_id,created_at,id',
    )
  ).rows) {
    try {
      const identity = `${row.realm_id}:${row.account_id}`,
        config = parseRealmConfig(row.config_snapshot);
      const expected = calculateGemReward(
        config,
        previous.get(identity) ?? null,
        row.result.balance - row.result.amount,
        row.created_at.getTime(),
      );
      const { ok, claimId, ...actual } = row.result;
      if (ok !== true || claimId !== row.id || !isDeepStrictEqual(actual, expected))
        throw new Error();
      previous.set(identity, row.created_at.toISOString());
    } catch {
      throw new Error('Backup gem reward receipt or cooldown is invalid.');
    }
  }
}
