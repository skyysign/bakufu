import type { Transaction } from './connection';

/**
 * The member who holds a character's card, for "Owned by …" labels. Only realm
 * members see it, like the player directory: the realm trade ID (which also
 * opens their profile) and cached Discord names, never an email.
 */
export type CardOwner = { tradeCode: string; displayName: string | null; username: string | null };
export type CharacterHolder = { mine: boolean; owner: CardOwner | null };

/**
 * Current holders of the given characters' active cards in one realm, keyed by
 * character ID. Characters without an active card are absent. `owner` stays
 * null for the viewer's own cards and for a holder who is no longer a member.
 */
export async function characterHolders(
  tx: Transaction,
  realmId: string,
  viewerId: string,
  characterIds: readonly string[],
): Promise<Map<string, CharacterHolder>> {
  const ids = [...new Set(characterIds)];
  if (!ids.length) return new Map();
  const rows = (
    await tx.query(
      `SELECT c.character_id,c.owner_id=$2 AS mine,m.trade_code,p.display_name,p.username
      FROM cards c
      LEFT JOIN memberships m ON m.realm_id=c.realm_id AND m.account_id=c.owner_id
      LEFT JOIN discord_profiles p ON p.account_id=c.owner_id
      WHERE c.realm_id=$1 AND c.recycled_at IS NULL AND c.character_id=ANY($3::uuid[])`,
      [realmId, viewerId, ids],
    )
  ).rows as {
    character_id: string;
    mine: boolean;
    trade_code: string | null;
    display_name: string | null;
    username: string | null;
  }[];
  return new Map(
    rows.map((row) => [
      row.character_id,
      {
        mine: row.mine,
        owner:
          row.mine || !row.trade_code
            ? null
            : {
                tradeCode: row.trade_code,
                displayName: row.display_name ?? null,
                username: row.username ?? null,
              },
      },
    ]),
  );
}
