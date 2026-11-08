import { defaultConfig } from '../support/prototype-config';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  provisionPlayer,
  createRealm,
  login,
  authenticate,
  changePassword,
  exportPlayer,
  transaction,
  type Database,
} from '../../packages/db/src/index';
import { createSession } from '../../packages/db/src/auth';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { installLegacySchema } from '../support/legacy';
import { startPostgres } from '../support/postgres';
let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string, realm: string;
const secret = () => randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('password_changes')).db;
  admin = await bootstrap(db, 'password-admin@example.test', secret());
  realm = await createRealm(db, admin, 'Password fixture', defaultConfig);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function fixture() {
  const email = `${randomUUID()}@example.test`,
    old = secret(),
    next = secret();
  const id = await provisionPlayer(db, realm, email, old),
    token = await login(db, email, old);
  return { id, email, old, next, token };
}
const session = (id: string) => transaction(db, (tx) => createSession(tx, id));
const state = async (id: string) =>
  (await db.query('SELECT password_hash,password_revision FROM accounts WHERE id=$1', [id]))
    .rows[0];
describe('local password changes', () => {
  it('updates salted credentials, keeps the initiating session, revokes others and preserves player data', async () => {
    const f = await fixture(),
      other = await session(f.id),
      before = await exportPlayer(db, f.id, realm);
    expect(await changePassword(db, f.id, f.token, 0, f.old, f.next)).toEqual({
      changed: true,
      revision: 1,
    });
    expect(await authenticate(db, f.token)).toMatchObject({
      id: f.id,
      hasLocalPassword: true,
      passwordRevision: 1,
    });
    expect(await authenticate(db, other)).toBeNull();
    await expect(login(db, f.email, f.old)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await authenticate(db, await login(db, f.email, f.next)))?.id).toBe(f.id);
    const row = await state(f.id);
    expect(row.password_hash).toMatch(/^scrypt-v1:/);
    expect(row.password_hash).not.toContain(f.next);
    const after = await exportPlayer(db, f.id, realm);
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('password');
  });
  it('requires the correct current password even when the supplied new one is already current', async () => {
    const f = await fixture(),
      before = await state(f.id);
    await expect(changePassword(db, f.id, f.token, 0, secret(), f.old)).rejects.toMatchObject({
      code: 'BAD_CURRENT_PASSWORD',
    });
    expect(await state(f.id)).toEqual(before);
    const other = await session(f.id);
    expect(await changePassword(db, f.id, f.token, 0, f.old, f.old)).toEqual({
      changed: false,
      revision: 0,
    });
    expect((await authenticate(db, other))?.id).toBe(f.id);
  });
  it('validates session ownership, expiry, password lengths and revision before changing data', async () => {
    const f = await fixture(),
      another = await fixture(),
      before = await state(f.id);
    for (const token of [undefined, secret(), another.token])
      await expect(changePassword(db, f.id, token, 0, f.old, f.next)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    for (const next of ['short', 'x'.repeat(257)])
      await expect(changePassword(db, f.id, f.token, 0, f.old, next)).rejects.toThrow();
    for (const revision of [-1, 0.5, '0', 2147483648])
      await expect(changePassword(db, f.id, f.token, revision, f.old, f.next)).rejects.toThrow();
    await db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE account_id=$1", [
      f.id,
    ]);
    await expect(changePassword(db, f.id, f.token, 0, f.old, f.next)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(await state(f.id)).toEqual(before);
  });
  it('recovers a committed lost response without rehashing or revoking later sessions', async () => {
    const f = await fixture();
    await changePassword(db, f.id, f.token, 0, f.old, f.next);
    const before = await state(f.id),
      later = await login(db, f.email, f.next);
    expect(await changePassword(db, f.id, f.token, 0, f.old, f.next)).toEqual({
      changed: false,
      revision: 1,
    });
    expect(await state(f.id)).toEqual(before);
    expect((await authenticate(db, later))?.id).toBe(f.id);
  });
  it('rejects stale changes and prevents old payloads resetting a reused password', async () => {
    const f = await fixture();
    await changePassword(db, f.id, f.token, 0, f.old, f.next);
    await expect(changePassword(db, f.id, f.token, 0, f.old, secret())).rejects.toMatchObject({
      code: 'STALE_CREDENTIALS',
    });
    await changePassword(db, f.id, f.token, 1, f.next, f.old);
    const before = await state(f.id);
    await expect(changePassword(db, f.id, f.token, 0, f.old, f.next)).rejects.toMatchObject({
      code: 'STALE_CREDENTIALS',
    });
    expect(await state(f.id)).toEqual(before);
  });
  it('serializes competing changes with the same revision', async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([
      changePassword(db, f.id, f.token, 0, f.old, f.next),
      changePassword(db, f.id, f.token, 0, f.old, secret()),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'STALE_CREDENTIALS' },
    });
    expect((await state(f.id)).password_revision).toBe(1);
  });
  it('throttles failed verification independently for each account and normal login', async () => {
    const f = await fixture(),
      other = await fixture();
    for (let i = 0; i < 8; i++)
      await expect(changePassword(db, f.id, f.token, 0, secret(), f.next)).rejects.toMatchObject({
        code: 'BAD_CURRENT_PASSWORD',
      });
    await expect(changePassword(db, f.id, f.token, 0, f.old, f.next)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect((await authenticate(db, await login(db, f.email, f.old)))?.id).toBe(f.id);
    await changePassword(db, other.id, other.token, 0, other.old, other.next);
    await db.query("UPDATE login_limits SET window_start=now()-interval '16 minutes'");
    expect(await changePassword(db, f.id, f.token, 0, f.old, f.next)).toEqual({
      changed: true,
      revision: 1,
    });
  });
  it('rejects Discord-only accounts and preserves a linked identity on local changes', async () => {
    const f = await fixture();
    await db.query(
      "INSERT INTO account_identities(provider,subject,account_id) VALUES('discord','710000000000000001',$1)",
      [f.id],
    );
    await changePassword(db, f.id, f.token, 0, f.old, f.next);
    expect(
      (await db.query('SELECT 1 FROM account_identities WHERE account_id=$1', [f.id])).rowCount,
    ).toBe(1);
    await db.query('UPDATE accounts SET email=NULL,password_hash=NULL WHERE id=$1', [f.id]);
    expect(await authenticate(db, f.token)).toMatchObject({ hasLocalPassword: false });
    await expect(changePassword(db, f.id, f.token, 1, f.next, secret())).rejects.toMatchObject({
      code: 'LOCAL_PASSWORD_UNAVAILABLE',
    });
  });
  it('does not issue an old-password session after a concurrent change commits', async () => {
    const f = await fixture();
    let connections = 0,
      reached = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const proxy = {
      query: db.query.bind(db),
      connect: async () => {
        if (++connections === 2) {
          reached = true;
          await gate;
        }
        return db.connect();
      },
    } as unknown as Database;
    const pending = login(proxy, f.email, f.old);
    // Attach rejection handling before opening the gate.
    const outcome = pending.then(
      () => ({ code: 'UNEXPECTED_SUCCESS' }),
      (error) => error,
    );
    try {
      await expect.poll(() => reached, { timeout: 10000 }).toBe(true);
      await changePassword(db, f.id, f.token, 0, f.old, f.next);
    } finally {
      release();
    }
    expect(await outcome).toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await db.query('SELECT 1 FROM sessions WHERE account_id=$1', [f.id])).rowCount).toBe(1);
  });
  it('migrates schema-0012 archives and preserves new revisions through fresh encrypted recovery', async () => {
    const legacy = (await server.database('password_legacy', false)).db,
      fresh = (await server.database('password_legacy_restore')).db,
      recovered = (await server.database('password_current_restore')).db;
    try {
      await installLegacySchema(legacy, 12);
      const old = secret(),
        email = 'password-legacy@example.test',
        actor = await bootstrap(legacy, email, old);
      const before = (await legacy.query('SELECT to_jsonb(a) AS row FROM accounts a')).rows[0].row,
        key = secret(),
        archive = await makeBackup(legacy, key);
      await migrate(legacy);
      expect(
        (await legacy.query("SELECT to_jsonb(a)-'password_revision' AS row FROM accounts a"))
          .rows[0].row,
      ).toEqual(before);
      await restoreBackup(fresh, archive, key);
      await assertBackupRestored(fresh, archive, key);
      const token = await login(fresh, email, old);
      expect(await authenticate(fresh, token)).toMatchObject({ passwordRevision: 0 });
      const next = secret();
      await changePassword(fresh, actor, token, 0, old, next);
      const currentArchive = await makeBackup(fresh, key);
      await restoreBackup(recovered, currentArchive, key);
      await assertBackupRestored(recovered, currentArchive, key);
      expect(await authenticate(recovered, token)).toBeNull();
      expect(await authenticate(recovered, await login(recovered, email, next))).toMatchObject({
        passwordRevision: 1,
      });
    } finally {
      await legacy.end();
      await fresh.end();
      await recovered.end();
    }
  });
});
