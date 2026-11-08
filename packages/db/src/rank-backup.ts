import { isDeepStrictEqual } from 'node:util';
import { parseRealmConfig } from '../../config/src/index';
import { calculateRankPurchase } from '../../core/src/ranks';
import type { Transaction } from './connection';

// Runs only inside a fresh-database restore transaction. No credential/user fields
// are returned to callers if a receipt or ledger reconciliation fails.
export async function validateRankBackup(tx: Transaction): Promise<void> {
  const invalid = (
    await tx.query(`SELECT 1 FROM rank_purchases p
    LEFT JOIN wallet_ledger l ON l.realm_id=p.realm_id AND l.account_id=p.account_id AND l.operation_key='rank:'||p.request_key::text
    WHERE l.id IS NULL OR l.reason != 'rank_purchase'
      OR p.result->>'ok' IS DISTINCT FROM 'true'
      OR p.result->>'purchaseId' IS DISTINCT FROM p.id::text
      OR (p.result->>'rank')::integer IS DISTINCT FROM p.rank
      OR l.amount IS DISTINCT FROM -(p.result->>'charged')::integer
      OR l.balance_after IS DISTINCT FROM (p.result->>'balance')::integer
      OR l.created_at IS DISTINCT FROM p.created_at
      OR (p.result->>'purchasedAt')::timestamptz IS DISTINCT FROM p.created_at
    UNION ALL
    SELECT 1 FROM rank_purchases p JOIN realms r ON r.id=p.realm_id
      GROUP BY p.realm_id,p.account_id,r.config
      HAVING count(*) != max(p.rank) OR max(p.rank) > jsonb_array_length(r.config->'ranks'->'levels') OR r.config->'ranks'->>'enabled' IS DISTINCT FROM 'true'
    UNION ALL
    SELECT 1 FROM wallet_ledger l WHERE l.reason='rank_purchase' AND NOT EXISTS(
      SELECT 1 FROM rank_purchases p WHERE p.realm_id=l.realm_id AND p.account_id=l.account_id AND l.operation_key='rank:'||p.request_key::text)
    LIMIT 1`)
  ).rowCount;
  if (invalid) throw new Error('Backup collector rank history does not reconcile.');
  for (const row of (
    await tx.query(
      'SELECT p.id,p.rank,p.result,p.config_snapshot,r.config FROM rank_purchases p JOIN realms r ON r.id=p.realm_id',
    )
  ).rows) {
    try {
      const snapshot = parseRealmConfig(row.config_snapshot),
        current = parseRealmConfig(row.config);
      const expected = calculateRankPurchase(
        snapshot,
        row.rank - 1,
        row.rank,
        row.result.balance + row.result.charged,
      );
      const { purchaseId, purchasedAt, ok, ...actual } = row.result;
      if (
        !ok ||
        purchaseId !== row.id ||
        typeof purchasedAt !== 'string' ||
        !isDeepStrictEqual(actual, expected) ||
        !isDeepStrictEqual(snapshot.ranks.levels[row.rank - 1], current.ranks.levels[row.rank - 1])
      )
        throw new Error();
    } catch {
      throw new Error('Backup collector rank receipt is invalid.');
    }
  }
}
