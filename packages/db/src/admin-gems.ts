import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { GameError } from '../../core/src/index';
import { requireInstanceAdmin } from './auth';
import { requireMember } from './game';
import { transaction, type Database, type Transaction } from './connection';

const receiptSchema = z.strictObject({
  ok: z.literal(true),
  grantId: z.uuid(),
  amount: z.number().int().min(1).max(1_000_000),
  balance: z.number().int().min(0).max(2_147_483_647),
  grantedAt: z.iso.datetime(),
});
export type AdminGemGrant = z.infer<typeof receiptSchema>;

// Operator-only, self-wallet testing credit. No public gameplay endpoint.
export async function grantAdminGems(
  db: Database,
  actorId: string,
  realmId: string,
  requestKey: string,
  amountInput: number,
  noteInput: string,
): Promise<AdminGemGrant> {
  const uuid = z.uuid().transform((value) => value.toLowerCase()),
    actor = uuid.parse(actorId),
    realm = uuid.parse(realmId),
    key = uuid.parse(requestKey),
    amount = z.number().int().min(1).max(1_000_000).parse(amountInput),
    note = z.string().trim().min(1).max(200).parse(noteInput);
  return transaction(db, async (tx) => {
    await requireInstanceAdmin(tx, actor);
    if (!(await tx.query('SELECT id FROM realms WHERE id=$1 FOR UPDATE', [realm])).rowCount)
      throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    const member = await requireMember(tx, realm, actor),
      previous = (
        await tx.query(
          'SELECT result,note FROM admin_gem_grants WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
          [realm, actor, key],
        )
      ).rows[0];
    if (previous) {
      if (previous.result.amount !== amount || previous.note !== note)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This grant key has a different proposal.',
          409,
        );
      return receiptSchema.parse(previous.result);
    }
    if (member.balance > 2_147_483_647 - amount)
      throw new GameError('WALLET_LIMIT', 'The wallet cannot hold this grant.', 409);
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date,
      result: AdminGemGrant = {
        ok: true,
        grantId: randomUUID(),
        amount,
        balance: member.balance + amount,
        grantedAt: now.toISOString(),
      };
    await tx.query(
      'INSERT INTO admin_gem_grants(realm_id,id,account_id,request_key,result,note,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [realm, result.grantId, actor, key, result, note, now],
    );
    await tx.query('UPDATE memberships SET balance=$3 WHERE realm_id=$1 AND account_id=$2', [
      realm,
      actor,
      result.balance,
    ]);
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'admin_grant',$7)",
      [realm, randomUUID(), actor, `admin-grant:${key}`, amount, result.balance, now],
    );
    return result;
  });
}

export async function validateAdminGemGrants(tx: Transaction): Promise<void> {
  const invalid = (
    await tx.query(`SELECT 1 FROM admin_gem_grants g
      LEFT JOIN wallet_ledger l ON l.realm_id=g.realm_id AND l.account_id=g.account_id AND l.operation_key='admin-grant:'||g.request_key::text
      WHERE l.id IS NULL OR l.reason!='admin_grant'
        OR l.amount IS DISTINCT FROM (g.result->>'amount')::integer
        OR l.balance_after IS DISTINCT FROM (g.result->>'balance')::integer
        OR l.created_at IS DISTINCT FROM g.created_at
      UNION ALL SELECT 1 FROM wallet_ledger l WHERE l.reason='admin_grant' AND NOT EXISTS(
        SELECT 1 FROM admin_gem_grants g WHERE g.realm_id=l.realm_id AND g.account_id=l.account_id AND l.operation_key='admin-grant:'||g.request_key::text)
      LIMIT 1`)
  ).rowCount;
  if (invalid) throw new Error('Backup admin gem grant history does not reconcile.');
  for (const row of (await tx.query('SELECT id,result,created_at FROM admin_gem_grants')).rows) {
    const result = receiptSchema.safeParse(row.result);
    if (
      !result.success ||
      result.data.grantId !== row.id ||
      result.data.grantedAt !== row.created_at.toISOString() ||
      result.data.balance < result.data.amount
    )
      throw new Error('Backup admin gem grant receipt is invalid.');
  }
}
