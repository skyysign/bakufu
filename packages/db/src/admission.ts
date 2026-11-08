import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { GameError } from '../../core/src/index';
import { transaction, type Database, type Transaction } from './connection';
import { requireMember } from './game';

const snowflake = z.string().regex(/^[0-9]{17,20}$/);
export const admissionPolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    revision: z.number().int().min(0).max(2147483647),
    mode: z.enum(['invite_only', 'discord_server']),
    guildId: snowflake.nullable(),
    joinCode: z.uuid().nullable(),
  })
  .refine(
    (p) =>
      p.mode === 'invite_only'
        ? p.guildId === null && p.joinCode === null
        : p.guildId !== null && p.joinCode !== null,
    'Invalid admission policy.',
  );
export type AdmissionPolicy = z.infer<typeof admissionPolicySchema>;
export const defaultAdmission: AdmissionPolicy = {
  schemaVersion: 1,
  revision: 0,
  mode: 'invite_only',
  guildId: null,
  joinCode: null,
};
export const admissionTargetSchema = z.strictObject({
  realmId: z.uuid(),
  joinCode: z.uuid(),
  revision: z.number().int().positive(),
  guildId: snowflake,
});
export type AdmissionTarget = z.infer<typeof admissionTargetSchema>;
export const verifiedAdmissionSchema = admissionTargetSchema.extend({
  verifiedAt: z.number().int().nonnegative(),
});
export type VerifiedAdmission = z.infer<typeof verifiedAdmissionSchema>;
export const playerAdmissionSchema = z.strictObject({
  admissionId: z.uuid(),
  method: z.literal('discord_server'),
  policyRevision: z.number().int().positive(),
  guildId: snowflake,
  startingGems: z.number().int().min(0).max(1000000),
  admittedAt: z.iso.datetime(),
});
export async function admissionPolicy(tx: Transaction, realmId: string): Promise<AdmissionPolicy> {
  const row = (
    await tx.query('SELECT * FROM realm_admission_policies WHERE realm_id=$1', [realmId])
  ).rows[0];
  return row
    ? admissionPolicySchema.parse({
        schemaVersion: row.schema_version,
        revision: row.revision,
        mode: row.mode,
        guildId: row.guild_id,
        joinCode: row.join_code,
      })
    : { ...defaultAdmission };
}
export async function publicJoinTarget(db: Database, code: string) {
  z.uuid().parse(code);
  const row = (
    await db.query(
      `SELECT p.realm_id,p.revision,p.guild_id,r.name FROM realm_admission_policies p JOIN realms r ON r.id=p.realm_id JOIN discord_guild_realms b ON b.realm_id=p.realm_id AND b.guild_id=p.guild_id WHERE p.join_code=$1 AND p.mode='discord_server'`,
      [code],
    )
  ).rows[0];
  if (!row)
    throw new GameError(
      'JOIN_UNAVAILABLE',
      'This join link is unavailable. Ask the realm administrator for a current link or invitation.',
      404,
    );
  return {
    name: row.name as string,
    realmId: row.realm_id as string,
    joinCode: code,
    revision: row.revision as number,
    guildId: row.guild_id as string,
  };
}
export async function configureAdmission(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
  expectedRevision: number,
  requestKey: string,
) {
  [actorId, realmId, requestKey].forEach((v) => z.uuid().parse(v));
  const command = z
    .discriminatedUnion('mode', [
      z.strictObject({ mode: z.literal('invite_only') }),
      z.strictObject({ mode: z.literal('discord_server'), guildId: snowflake }),
    ])
    .parse(input);
  z.number().int().min(0).max(2147483646).parse(expectedRevision);
  const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  return transaction(db, async (tx) => {
    if (!(await tx.query('SELECT 1 FROM realms WHERE id=$1 FOR UPDATE', [realmId])).rowCount)
      throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
      throw new GameError('FORBIDDEN', 'Realm administrator access is required.', 403);
    const prior = (
      await tx.query(
        'SELECT fingerprint,result FROM realm_admission_changes WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, requestKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This request key was used for another admission setting.',
          409,
        );
      return prior.result as { ok: true; policy: AdmissionPolicy };
    }
    const before = await admissionPolicy(tx, realmId);
    if (before.revision !== expectedRevision)
      throw new GameError(
        'ADMISSION_CHANGED',
        'Joining settings changed. Refresh and review them again.',
        409,
      );
    if (
      command.mode === 'discord_server' &&
      !(
        await tx.query('SELECT 1 FROM discord_guild_realms WHERE realm_id=$1 AND guild_id=$2', [
          realmId,
          command.guildId,
        ])
      ).rowCount
    )
      throw new GameError('GUILD_NOT_LINKED', 'Link this Discord server to the realm first.', 409);
    const policy: AdmissionPolicy = {
      schemaVersion: 1,
      revision: before.revision + 1,
      mode: command.mode,
      guildId: command.mode === 'discord_server' ? command.guildId : null,
      joinCode:
        command.mode === 'discord_server'
          ? before.mode === 'discord_server' && before.guildId === command.guildId
            ? before.joinCode
            : randomUUID()
          : null,
    };
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date,
      result = { ok: true as const, policy };
    await tx.query(
      `INSERT INTO realm_admission_policies(realm_id,schema_version,revision,mode,guild_id,join_code,updated_by,updated_at) VALUES($1,1,$2,$3,$4,$5,$6,$7) ON CONFLICT(realm_id) DO UPDATE SET revision=EXCLUDED.revision,mode=EXCLUDED.mode,guild_id=EXCLUDED.guild_id,join_code=EXCLUDED.join_code,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,
      [realmId, policy.revision, policy.mode, policy.guildId, policy.joinCode, actorId, now],
    );
    await tx.query(
      'INSERT INTO realm_admission_changes(realm_id,id,account_id,request_key,fingerprint,from_revision,to_revision,before_policy,after_policy,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        realmId,
        randomUUID(),
        actorId,
        requestKey,
        fingerprint,
        before.revision,
        policy.revision,
        before,
        policy,
        result,
        now,
      ],
    );
    return result;
  });
}
export async function verifyAdmissionPolicy(tx: Transaction, input: VerifiedAdmission) {
  const proof = verifiedAdmissionSchema.parse(input);
  const realm = (
    await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [proof.realmId])
  ).rows[0];
  if (Math.abs(Date.now() - proof.verifiedAt) > 60000)
    throw new GameError(
      'JOIN_UNVERIFIED',
      'The membership check expired. Open the join link again.',
      403,
    );
  const policy = await admissionPolicy(tx, proof.realmId);
  if (
    !realm ||
    policy.mode !== 'discord_server' ||
    policy.revision !== proof.revision ||
    policy.joinCode !== proof.joinCode ||
    policy.guildId !== proof.guildId ||
    !(
      await tx.query('SELECT 1 FROM discord_guild_realms WHERE realm_id=$1 AND guild_id=$2', [
        proof.realmId,
        proof.guildId,
      ])
    ).rowCount
  )
    throw new GameError(
      'JOIN_UNAVAILABLE',
      'Joining settings changed. Ask for a current join link and try again.',
      403,
    );
  return realm.config;
}
export async function ownRealmAdmission(tx: Transaction, realmId: string, accountId: string) {
  const row = (
    await tx.query(
      'SELECT id,method,policy_revision,guild_id,starting_gems,admitted_at FROM realm_admissions WHERE realm_id=$1 AND account_id=$2',
      [realmId, accountId],
    )
  ).rows[0];
  return row
    ? playerAdmissionSchema.parse({
        admissionId: row.id,
        method: row.method,
        policyRevision: row.policy_revision,
        guildId: row.guild_id,
        startingGems: row.starting_gems,
        admittedAt: row.admitted_at.toISOString(),
      })
    : null;
}
