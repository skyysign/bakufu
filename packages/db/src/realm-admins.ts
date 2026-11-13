import { z } from 'zod';
import { GameError } from '../../core/src/index';
import { transaction, type Database, type Transaction } from './connection';
import { requireMember } from './game';
import type { RealmMember } from './member-profiles';

export type RealmAdmin = RealmMember & {
  /** The realm's creator always stays an admin. */
  creator: boolean;
  /** The admin looking at the list. */
  self: boolean;
};
export type RealmAdminList = { admins: RealmAdmin[] };
export type RealmRoleChange = {
  tradeCode: string;
  role: 'admin' | 'player';
  /** False when the member already had this role. */
  changed: boolean;
  admins: RealmAdmin[];
};

const roleChangeSchema = z.strictObject({
  tradeCode: z.uuid(),
  role: z.enum(['admin', 'player']),
});

async function requireRealmAdmin(tx: Transaction, realmId: string, actorId: string) {
  if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
    throw new GameError('FORBIDDEN', 'Realm administrator access is required.', 403);
}

async function realmAdmins(tx: Transaction, realmId: string, actorId: string) {
  return (
    await tx.query(
      `SELECT m.trade_code AS "tradeCode",p.username,p.display_name AS "displayName",
        to_jsonb(p)->>'avatar_url' AS avatar_url,
        (m.account_id=r.created_by) AS creator,(m.account_id=$2) AS self
      FROM memberships m JOIN realms r ON r.id=m.realm_id
      LEFT JOIN discord_profiles p ON p.account_id=m.account_id
      WHERE m.realm_id=$1 AND m.role='admin'
      ORDER BY (m.account_id=r.created_by) DESC,lower(COALESCE(p.display_name,p.username,'')),m.trade_code`,
      [realmId, actorId],
    )
  ).rows.map(({ avatar_url, ...row }) => ({
    ...row,
    ...(avatar_url ? { avatarUrl: avatar_url } : {}),
  })) as RealmAdmin[];
}

/** The realm's admins, for its admins only. */
export async function listRealmAdmins(
  db: Database,
  actorId: string,
  realmId: string,
): Promise<RealmAdminList> {
  z.uuid().parse(actorId);
  z.uuid().parse(realmId);
  return transaction(
    db,
    async (tx) => {
      await requireRealmAdmin(tx, realmId, actorId);
      return { admins: await realmAdmins(tx, realmId, actorId) };
    },
    true,
  );
}

/**
 * Makes a realm member an admin or a player again. Only admins may change
 * roles; the realm's creator always stays an admin, so a realm never loses its
 * last one. Setting the role a member already has changes nothing, so a retried
 * request is harmless.
 */
export async function setRealmMemberRole(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<RealmRoleChange> {
  z.uuid().parse(actorId);
  z.uuid().parse(realmId);
  const { tradeCode, role } = roleChangeSchema.parse(input);
  return transaction(db, async (tx) => {
    // Role changes in one realm happen one at a time.
    const realm = (
      await tx.query('SELECT created_by FROM realms WHERE id=$1 FOR UPDATE', [realmId])
    ).rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    await requireRealmAdmin(tx, realmId, actorId);
    const target = (
      await tx.query(
        'SELECT account_id,role FROM memberships WHERE realm_id=$1 AND trade_code=$2 FOR UPDATE',
        [realmId, tradeCode],
      )
    ).rows[0] as { account_id: string; role: 'admin' | 'player' } | undefined;
    if (!target)
      throw new GameError('NOT_FOUND', 'No member of this realm has that trade ID.', 404);
    if (target.role === role)
      return { tradeCode, role, changed: false, admins: await realmAdmins(tx, realmId, actorId) };
    if (role === 'player') {
      if (target.account_id === realm.created_by)
        throw new GameError('REALM_CREATOR', 'The realm’s creator always stays an admin.', 409);
      const others = (
        await tx.query(
          "SELECT count(*)::int AS n FROM memberships WHERE realm_id=$1 AND role='admin' AND account_id!=$2",
          [realmId, target.account_id],
        )
      ).rows[0].n as number;
      if (!others) throw new GameError('LAST_ADMIN', 'A realm needs at least one admin.', 409);
    }
    await tx.query('UPDATE memberships SET role=$3 WHERE realm_id=$1 AND account_id=$2', [
      realmId,
      target.account_id,
      role,
    ]);
    return { tradeCode, role, changed: true, admins: await realmAdmins(tx, realmId, actorId) };
  });
}
