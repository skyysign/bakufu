import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { GameError } from '../../core/src/index';
import { parseRealmConfig } from '../../config/src/index';
import { transaction, type Database, type Transaction } from './connection';

const emailSchema = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const passwordSchema = z
  .string()
  .min(12, 'Password must contain at least 12 characters.')
  .max(256, 'Password must contain no more than 256 characters.');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export type Account = {
  id: string;
  email: string | null;
  instanceAdmin: boolean;
  hasLocalPassword: boolean;
  passwordRevision: number;
};

export async function needsBootstrap(db: Database): Promise<boolean> {
  return !(await db.query('SELECT 1 FROM accounts WHERE instance_admin=true LIMIT 1')).rowCount;
}

export async function createSession(tx: Transaction, accountId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await tx.query('DELETE FROM sessions WHERE expires_at <= now()');
  await tx.query(
    "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [digest(token), accountId],
  );
  return token;
}

async function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}
export async function hashPassword(password: string): Promise<string> {
  passwordSchema.parse(password);
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [version, salt, key] = encoded.split(':');
  if (version !== 'scrypt-v1' || !salt || !key) return false;
  const actual = await derive(password, salt);
  const expected = Buffer.from(key, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export async function requireInstanceAdmin(tx: Transaction, accountId: string): Promise<void> {
  const row = (
    await tx.query('SELECT instance_admin FROM accounts WHERE id=$1', [z.uuid().parse(accountId)])
  ).rows[0];
  if (!row?.instance_admin)
    throw new GameError('FORBIDDEN', 'Instance administrator access is required.', 403);
}

export async function bootstrap(
  db: Database,
  emailInput: string,
  password: string,
): Promise<string> {
  const email = emailSchema.parse(emailInput);
  const hash = await hashPassword(password);
  return transaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(73103502)');
    if ((await tx.query('SELECT id FROM accounts WHERE instance_admin=true LIMIT 1')).rowCount)
      throw new GameError('ALREADY_BOOTSTRAPPED', 'An instance administrator already exists.');
    const id = randomUUID();
    await tx.query(
      'INSERT INTO accounts(id,email,password_hash,instance_admin) VALUES($1,$2,$3,true)',
      [id, email, hash],
    );
    await tx.query('DELETE FROM login_limits WHERE email_key=$1', [digest(email)]);
    return id;
  });
}

// Trusted local operator command, deliberately unavailable over HTTP.
export async function provisionPlayer(
  db: Database,
  realmId: string,
  emailInput: string,
  password: string,
): Promise<string> {
  z.uuid().parse(realmId);
  const email = emailSchema.parse(emailInput);
  const hash = await hashPassword(password);
  return transaction(db, async (tx) => {
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    const config = parseRealmConfig(realm.config);
    const existing = (await tx.query('SELECT id FROM accounts WHERE email=$1', [email])).rows[0];
    const id: string = existing?.id ?? randomUUID();
    if (!existing)
      await tx.query('INSERT INTO accounts(id,email,password_hash) VALUES($1,$2,$3)', [
        id,
        email,
        hash,
      ]);
    await addMembership(tx, realmId, id, 'player', config.startingGems);
    return id;
  });
}

export async function addMembership(
  tx: Transaction,
  realmId: string,
  accountId: string,
  role: 'admin' | 'player',
  startingGems: number,
) {
  const inserted = await tx.query(
    'INSERT INTO memberships(realm_id,account_id,role,balance) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING account_id',
    [realmId, accountId, role, startingGems],
  );
  if (inserted.rowCount)
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason) VALUES($1,$2,$3,'starting-grant',$4,$4,'starting_grant')",
      [realmId, randomUUID(), accountId, startingGems],
    );
  return inserted.rowCount === 1;
}

async function reserveAttempt(db: Database, key: string): Promise<boolean> {
  return transaction(db, async (tx) => {
    const row = (
      await tx.query(
        `INSERT INTO login_limits(email_key,attempts,window_start) VALUES($1,1,now())
      ON CONFLICT(email_key) DO UPDATE SET
      attempts=CASE WHEN login_limits.window_start < now()-interval '15 minutes' THEN 1 ELSE login_limits.attempts+1 END,
      window_start=CASE WHEN login_limits.window_start < now()-interval '15 minutes' THEN now() ELSE login_limits.window_start END
      RETURNING attempts`,
        [key],
      )
    ).rows[0];
    return row.attempts <= 8;
  });
}

export async function login(db: Database, emailInput: string, password: string): Promise<string> {
  const email = emailSchema.parse(emailInput);
  z.string().max(256).parse(password);
  if (await needsBootstrap(db))
    throw new GameError(
      'SETUP_REQUIRED',
      'No administrator account exists yet. Complete first-time setup before signing in.',
      503,
    );
  const emailKey = digest(email);
  // Reserve an attempt before expensive hashing; counters are shared by all web processes.
  const allowed = await reserveAttempt(db, emailKey);
  if (!allowed)
    throw new GameError('RATE_LIMITED', 'Too many login attempts. Try again in 15 minutes.', 429);
  const row = (await db.query('SELECT id,password_hash FROM accounts WHERE email=$1', [email]))
    .rows[0];
  const fallback = 'scrypt-v1:00000000000000000000000000000000:' + '00'.repeat(64);
  const verified = await verifyPassword(password, row?.password_hash ?? fallback);
  if (!row || !verified)
    throw new GameError('UNAUTHORIZED', 'Email or password is incorrect.', 401);
  return transaction(db, async (tx) => {
    const current = (
      await tx.query('SELECT password_hash FROM accounts WHERE id=$1 FOR UPDATE', [row.id])
    ).rows[0];
    if (!current || current.password_hash !== row.password_hash)
      throw new GameError('UNAUTHORIZED', 'Email or password is incorrect.', 401);
    await tx.query('DELETE FROM login_limits WHERE email_key=$1', [emailKey]);
    return createSession(tx, row.id);
  });
}

export async function authenticate(
  db: Database,
  token: string | undefined,
): Promise<Account | null> {
  if (!token || token.length > 100) return null;
  const row = (
    await db.query(
      `SELECT a.id,a.email,a.instance_admin,a.password_revision,(a.password_hash IS NOT NULL) AS has_local_password FROM sessions s JOIN accounts a ON a.id=s.account_id
    WHERE s.token_hash=$1 AND s.expires_at > now()`,
      [digest(token)],
    )
  ).rows[0];
  return row
    ? {
        id: row.id,
        email: row.email,
        instanceAdmin: row.instance_admin,
        hasLocalPassword: row.has_local_password,
        passwordRevision: row.password_revision,
      }
    : null;
}
export async function logout(db: Database, token: string | undefined) {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
}

// Requires the initiating session as well as the current local credential. No
// request payload/password fingerprint is persisted for retry recovery.
export async function changePassword(
  db: Database,
  actorId: string,
  token: string | undefined,
  expectedRevision: unknown,
  currentPassword: string,
  newPassword: string,
): Promise<{ changed: boolean; revision: number }> {
  if (!token || (await authenticate(db, token))?.id !== actorId)
    throw new GameError('UNAUTHORIZED', 'Sign in again before changing your password.', 401);
  const revision = z.number().int().min(0).max(2147483647).parse(expectedRevision);
  z.string().min(1).max(256).parse(currentPassword);
  passwordSchema.parse(newPassword);
  const limitKey = digest(`password-change:${actorId}`);
  if (!(await reserveAttempt(db, limitKey)))
    throw new GameError(
      'RATE_LIMITED',
      'Too many password-change attempts. Try again in 15 minutes.',
      429,
    );
  return transaction(db, async (tx) => {
    const account = (
      await tx.query(
        'SELECT password_hash,password_revision FROM accounts WHERE id=$1 FOR UPDATE',
        [actorId],
      )
    ).rows[0];
    const session = await tx.query(
      'SELECT 1 FROM sessions WHERE token_hash=$1 AND account_id=$2 AND expires_at>clock_timestamp() FOR UPDATE',
      [digest(token), actorId],
    );
    if (!account || !session.rowCount)
      throw new GameError('UNAUTHORIZED', 'Sign in again before changing your password.', 401);
    if (!account.password_hash)
      throw new GameError(
        'LOCAL_PASSWORD_UNAVAILABLE',
        'This account signs in through Discord and has no local password.',
      );
    if (revision !== account.password_revision) {
      if (
        revision < account.password_revision &&
        (await verifyPassword(newPassword, account.password_hash))
      ) {
        await tx.query('DELETE FROM login_limits WHERE email_key=$1', [limitKey]);
        return { changed: false, revision: account.password_revision };
      }
      throw new GameError(
        'STALE_CREDENTIALS',
        'Your password has changed since this form was opened. Reload and try again.',
        409,
      );
    }
    if (!(await verifyPassword(currentPassword, account.password_hash)))
      throw new GameError('BAD_CURRENT_PASSWORD', 'Your current password is incorrect.');
    if (currentPassword === newPassword) {
      await tx.query('DELETE FROM login_limits WHERE email_key=$1', [limitKey]);
      return { changed: false, revision };
    }
    if (revision === 2147483647)
      throw new GameError(
        'REVISION_LIMIT',
        'Password revision limit reached. Contact the instance operator.',
        409,
      );
    const hash = await hashPassword(newPassword);
    await tx.query(
      'UPDATE accounts SET password_hash=$2,password_revision=password_revision+1 WHERE id=$1',
      [actorId, hash],
    );
    await tx.query('DELETE FROM sessions WHERE account_id=$1 AND token_hash<>$2', [
      actorId,
      digest(token),
    ]);
    await tx.query('DELETE FROM login_limits WHERE email_key=$1', [limitKey]);
    return { changed: true, revision: revision + 1 };
  });
}
