import { parseRealmConfig } from '../../config/src/index';
import { purchasedRankTrackLevels } from './rank-track-state';
import { rankTrackReceiptSchema, validateRankTrackHistory } from './rank-track-history';
import type { Transaction } from './connection';

export async function validateRankTrackBackup(tx: Transaction) {
  const rows = (
    await tx.query(
      'SELECT p.*,r.config FROM rank_track_purchases p JOIN realms r ON r.id=p.realm_id ORDER BY p.realm_id,p.account_id,p.created_at,p.id',
    )
  ).rows;
  const orphan = (
    await tx.query(
      "SELECT 1 FROM wallet_ledger l WHERE l.reason='rank_track_purchase' AND NOT EXISTS(SELECT 1 FROM rank_track_purchases p WHERE p.realm_id=l.realm_id AND p.account_id=l.account_id AND l.operation_key='rank-track:'||p.request_key::text) LIMIT 1",
    )
  ).rowCount;
  if (orphan) throw new Error('Backup collector rank progression wallet history is invalid.');
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.realm_id}:${row.account_id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    const first = group[0];
    try {
      const purchases = group.map((row) => {
        if (
          row.result.purchaseId !== row.id ||
          row.result.trackId !== row.track_id ||
          row.result.level !== row.level ||
          Date.parse(row.result.purchasedAt) !== row.created_at.getTime()
        )
          throw new Error();
        return rankTrackReceiptSchema.parse({
          ...row.result,
          requestKey: row.request_key,
          rules: parseRealmConfig(row.config_snapshot).rankTracks,
        });
      });
      const ledger = (
        await tx.query(
          'SELECT operation_key AS "operationKey",reason,amount,balance_after AS "balanceAfter",created_at FROM wallet_ledger WHERE realm_id=$1 AND account_id=$2',
          [first.realm_id, first.account_id],
        )
      ).rows.map(({ created_at, ...entry }) => ({ ...entry, createdAt: created_at.toISOString() }));
      validateRankTrackHistory(
        parseRealmConfig(first.config).rankTracks,
        await purchasedRankTrackLevels(tx, first.realm_id, first.account_id),
        purchases,
        ledger,
      );
      const exact = (
        await tx.query(
          `SELECT 1 FROM rank_track_purchases p LEFT JOIN wallet_ledger l ON l.realm_id=p.realm_id AND l.account_id=p.account_id AND l.operation_key='rank-track:'||p.request_key::text WHERE p.realm_id=$1 AND p.account_id=$2 AND (l.id IS NULL OR l.created_at IS DISTINCT FROM p.created_at OR (p.result->>'purchasedAt')::timestamptz IS DISTINCT FROM p.created_at) LIMIT 1`,
          [first.realm_id, first.account_id],
        )
      ).rowCount;
      if (exact) throw new Error();
    } catch {
      throw new Error('Backup collector rank progression does not reconcile.');
    }
  }
}
