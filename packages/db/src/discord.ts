import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { GameError } from '../../core/src/index';
import { parseRealmConfig } from '../../config/src/index';
import { addMembership, createSession } from './auth';
import { transaction, type Database, type Transaction } from './connection';
import { saveDiscordProfile, type DiscordNames } from './member-profiles';
import {
  admissionTargetSchema,
  verifyAdmissionPolicy,
  type AdmissionTarget,
  type VerifiedAdmission,
} from './admission';

export const discordIdSchema = z
  .string()
  .regex(/^[0-9]{17,20}$/, 'Enter a Discord user ID (17–20 digits), not a username.');
const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function beginDiscordFlow(db: Database, admission?: AdmissionTarget) {
  const state = randomBytes(32).toString('base64url');
  const browserToken = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  await transaction(db, async (tx) => {
    await tx.query('DELETE FROM oauth_flows WHERE expires_at <= now()');
    await tx.query(
      "INSERT INTO oauth_flows(state_hash,browser_hash,code_verifier,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
      [hash(state), hash(browserToken), verifier],
    );
    if (admission)
      await tx.query('UPDATE oauth_flows SET admission=$2 WHERE state_hash=$1', [
        hash(state),
        admissionTargetSchema.parse(admission),
      ]);
  });
  return {
    state,
    browserToken,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

export async function consumeDiscordFlowContext(db: Database, state: string, browserToken: string) {
  if (!nonceSchema.safeParse(state).success || !nonceSchema.safeParse(browserToken).success)
    throw new GameError(
      'OAUTH_STATE',
      'Discord sign-in expired or could not be verified. Please try again.',
      400,
    );
  const flow = (
    await db.query(
      "DELETE FROM oauth_flows WHERE state_hash=$1 AND browser_hash=$2 AND expires_at > now() RETURNING code_verifier,to_jsonb(oauth_flows)->'admission' AS admission",
      [hash(state), hash(browserToken)],
    )
  ).rows[0];
  if (!flow)
    throw new GameError(
      'OAUTH_STATE',
      'Discord sign-in expired or could not be verified. Please try again.',
      400,
    );
  return {
    verifier: flow.code_verifier as string,
    admission: flow.admission ? admissionTargetSchema.parse(flow.admission) : null,
  };
}
export async function consumeDiscordFlow(
  db: Database,
  state: string,
  browserToken: string,
): Promise<string> {
  return (await consumeDiscordFlowContext(db, state, browserToken)).verifier;
}

async function identityAccount(tx: Transaction, subject: string): Promise<string | undefined> {
  return (
    await tx.query(
      "SELECT account_id FROM account_identities WHERE provider='discord' AND subject=$1",
      [subject],
    )
  ).rows[0]?.account_id;
}
async function addIdentity(tx: Transaction, accountId: string, subject: string) {
  await tx.query(
    "INSERT INTO account_identities(provider,subject,account_id) VALUES('discord',$1,$2)",
    [subject, accountId],
  );
}

// Called only after the server has exchanged the OAuth code and verified /users/@me.
export async function loginDiscord(
  db: Database,
  subjectInput: string,
  bootstrapAdminId?: string,
  profile?: DiscordNames | null,
  admission?: VerifiedAdmission,
): Promise<string> {
  const subject = discordIdSchema.parse(subjectInput);
  return transaction(db, async (tx) => {
    // Shared with local bootstrap: two authentication methods cannot race to create admins.
    await tx.query('SELECT pg_advisory_xact_lock(73103502)');
    const joinConfig = admission ? await verifyAdmissionPolicy(tx, admission) : null;
    let accountId = await identityAccount(tx, subject);
    if (!accountId) {
      const alreadyBootstrapped = (
        await tx.query('SELECT 1 FROM accounts WHERE instance_admin=true LIMIT 1')
      ).rowCount;
      const bootstrapAllowed =
        !admission && !alreadyBootstrapped && !!bootstrapAdminId && subject === bootstrapAdminId;
      if (!bootstrapAllowed && !admission)
        throw new GameError(
          'DISCORD_NOT_INVITED',
          'This Discord account has not been invited. Ask your realm administrator for access.',
          403,
        );
      accountId = randomUUID();
      await tx.query('INSERT INTO accounts(id,instance_admin) VALUES($1,$2)', [
        accountId,
        bootstrapAllowed,
      ]);
      await addIdentity(tx, accountId, subject);
    }
    if (admission && joinConfig) {
      const inserted = await addMembership(
        tx,
        admission.realmId,
        accountId,
        'player',
        parseRealmConfig(joinConfig).startingGems,
      );
      if (inserted)
        await tx.query(
          "INSERT INTO realm_admissions(realm_id,account_id,id,method,policy_revision,guild_id,starting_gems,admitted_at) VALUES($1,$2,$3,'discord_server',$4,$5,$6,clock_timestamp())",
          [
            admission.realmId,
            accountId,
            randomUUID(),
            admission.revision,
            admission.guildId,
            parseRealmConfig(joinConfig).startingGems,
          ],
        );
    }
    if (profile) await saveDiscordProfile(tx, accountId, profile);
    return createSession(tx, accountId);
  });
}

export async function inviteDiscordPlayer(
  db: Database,
  actorId: string,
  realmId: string,
  subjectInput: string,
): Promise<string> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const subject = discordIdSchema.parse(subjectInput);
  return transaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(73103502)');
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    const member = (
      await tx.query('SELECT role FROM memberships WHERE realm_id=$1 AND account_id=$2', [
        realmId,
        actorId,
      ])
    ).rows[0];
    if (!realm || member?.role !== 'admin')
      throw new GameError('FORBIDDEN', 'Realm administrator access is required.', 403);
    let accountId = await identityAccount(tx, subject);
    if (!accountId) {
      accountId = randomUUID();
      await tx.query('INSERT INTO accounts(id) VALUES($1)', [accountId]);
      await addIdentity(tx, accountId, subject);
    }
    await addMembership(
      tx,
      realmId,
      accountId,
      'player',
      parseRealmConfig(realm.config).startingGems,
    );
    return accountId;
  });
}

// Trusted local operator command for an existing local account. Never merge by Discord email.
export async function linkDiscordAccount(
  db: Database,
  emailInput: string,
  subjectInput: string,
): Promise<void> {
  const email = z
    .email()
    .transform((value) => value.toLowerCase())
    .parse(emailInput);
  const subject = discordIdSchema.parse(subjectInput);
  await transaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(73103502)');
    const account = (await tx.query('SELECT id FROM accounts WHERE email=$1', [email])).rows[0];
    if (!account)
      throw new GameError('NOT_FOUND', 'Local account not found. Complete bootstrap first.', 404);
    const existing = await identityAccount(tx, subject);
    const current = (
      await tx.query(
        "SELECT subject FROM account_identities WHERE provider='discord' AND account_id=$1",
        [account.id],
      )
    ).rows[0];
    if ((existing && existing !== account.id) || (current && current.subject !== subject))
      throw new GameError(
        'IDENTITY_CONFLICT',
        'This account or Discord identity is already linked. No accounts were merged.',
        409,
      );
    if (!existing) await addIdentity(tx, account.id, subject);
  });
}
