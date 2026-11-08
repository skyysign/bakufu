import type { Transaction } from './connection';

// Internal read helper: callers must authorize membership in their transaction.
export async function purchasedUpgradeRank(tx: Transaction, realmId: string, accountId: string) {
  return (
    await tx.query(
      "SELECT COALESCE(max(rank),0) AS rank FROM upgrade_purchases WHERE realm_id=$1 AND account_id=$2 AND upgrade_id='pack_discount'",
      [realmId, accountId],
    )
  ).rows[0].rank as number;
}
