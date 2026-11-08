import type { Transaction } from './connection';

// Internal helper: caller authorizes realm membership in the same transaction.
export async function purchasedCollectorRank(
  tx: Transaction,
  realmId: string,
  accountId: string,
): Promise<number> {
  return (
    await tx.query(
      'SELECT COALESCE(max(rank),0)::integer AS rank FROM rank_purchases WHERE realm_id=$1 AND account_id=$2',
      [realmId, accountId],
    )
  ).rows[0].rank;
}
