import type { Transaction } from './connection';

// Internal read helper; the enclosing service transaction authorizes membership.
export async function wishlistEntries(tx: Transaction, realmId: string, accountId: string) {
  return (
    await tx.query(
      'SELECT id,character_id,created_at FROM wishlist_entries WHERE realm_id=$1 AND account_id=$2 ORDER BY character_id',
      [realmId, accountId],
    )
  ).rows as { id: string; character_id: string; created_at: Date }[];
}
