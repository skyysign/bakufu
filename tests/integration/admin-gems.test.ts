import { defaultConfig } from '../support/prototype-config';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  bootstrap,
  createRealm,
  provisionPlayer,
  getRealmView,
  exportPlayer,
  parsePlayerArchive,
  type Database,
} from '../../packages/db/src/index';
import { grantAdminGems } from '../../packages/db/src/admin-gems';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex'),
  note = 'Original fixture gameplay testing';
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('admin_gems')).db;
  admin = await bootstrap(db, 'admin-gems@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
describe('audited operator gem credits', () => {
  it('credits the self wallet once under concurrent/case-insensitive retry and rejects changed proposals', async () => {
    const realm = await createRealm(db, admin, 'Original credit fixture', defaultConfig),
      key = randomUUID();
    const results = await Promise.all(
      [key, key.toUpperCase(), key].map((k) => grantAdminGems(db, admin, realm, k, 100000, note)),
    );
    results.forEach((result) => expect(result).toEqual(results[0]));
    expect(results[0]).toMatchObject({ amount: 100000, balance: 100100 });
    await expect(grantAdminGems(db, admin, realm, key, 2, note)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(grantAdminGems(db, admin, realm, key, 100000, 'Different')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(
      (await db.query('SELECT 1 FROM admin_gem_grants WHERE realm_id=$1', [realm])).rowCount,
    ).toBe(1);
    const archive = parsePlayerArchive(await exportPlayer(db, admin, realm));
    expect(archive.ledger.filter((entry) => entry.reason === 'admin_grant')).toHaveLength(1);
    expect((await getRealmView(db, admin, realm)).progression.totalXp).toBe(0);
  });
  it('rejects ordinary players, missing memberships and an overflowing wallet', async () => {
    const realm = await createRealm(db, admin, 'Credit authorization', defaultConfig);
    const player = await provisionPlayer(db, realm, `${randomUUID()}@example.test`, password);
    await expect(
      grantAdminGems(db, player, realm, randomUUID(), 100000, note),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.query('DELETE FROM wallet_ledger WHERE realm_id=$1 AND account_id=$2', [realm, admin]);
    await db.query('DELETE FROM memberships WHERE realm_id=$1 AND account_id=$2', [realm, admin]);
    await expect(
      grantAdminGems(db, admin, realm, randomUUID(), 100000, note),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const overflow = await createRealm(db, admin, 'Credit overflow', defaultConfig);
    await db.query('UPDATE memberships SET balance=2147483640 WHERE realm_id=$1', [overflow]);
    await expect(
      grantAdminGems(db, admin, overflow, randomUUID(), 100000, note),
    ).rejects.toMatchObject({ code: 'WALLET_LIMIT' });
    expect(
      (await db.query('SELECT 1 FROM admin_gem_grants WHERE realm_id=$1', [overflow])).rowCount,
    ).toBe(0);
  });
  it('rolls back both credit and receipt when the wallet journal fails', async () => {
    const realm = await createRealm(db, admin, 'Credit rollback', defaultConfig),
      key = randomUUID();
    await db.query(
      `CREATE FUNCTION reject_admin_credit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='admin_grant' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_admin_credit_fixture BEFORE INSERT ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION reject_admin_credit_fixture();`,
    );
    try {
      await expect(grantAdminGems(db, admin, realm, key, 100000, note)).rejects.toThrow();
    } finally {
      await db.query(
        'DROP TRIGGER reject_admin_credit_fixture ON wallet_ledger; DROP FUNCTION reject_admin_credit_fixture();',
      );
    }
    expect((await getRealmView(db, admin, realm)).balance).toBe(100);
    expect(
      (await db.query('SELECT 1 FROM admin_gem_grants WHERE realm_id=$1', [realm])).rowCount,
    ).toBe(0);
    expect(await grantAdminGems(db, admin, realm, key, 100000, note)).toMatchObject({
      balance: 100100,
    });
  });
  it('restores to a fresh database and preserves the original retry receipt', async () => {
    const source = (await server.database('admin_gems_backup')).db,
      fresh = (await server.database('admin_gems_restore')).db;
    try {
      const actor = await bootstrap(source, 'grant-backup@example.test', password),
        realm = await createRealm(source, actor, 'Credit recovery', defaultConfig),
        key = randomUUID();
      const receipt = await grantAdminGems(source, actor, realm, key, 100000, note),
        backup = await makeBackup(source, password);
      await restoreBackup(fresh, backup, password);
      await assertBackupRestored(fresh, backup, password);
      expect(await grantAdminGems(fresh, actor, realm, key, 100000, note)).toEqual(receipt);
      expect((await getRealmView(fresh, actor, realm)).balance).toBe(100100);
    } finally {
      await source.end();
      await fresh.end();
    }
  });
  it('rejects missing grants or forged receipt identities during fresh restore', async () => {
    const source = (await server.database('admin_gems_forged')).db,
      fresh = (await server.database('admin_gems_forged_restore')).db;
    try {
      const actor = await bootstrap(source, 'grant-forged@example.test', password),
        realm = await createRealm(source, actor, 'Forged credit', defaultConfig);
      await grantAdminGems(source, actor, realm, randomUUID(), 100000, note);
      await source.query(
        "UPDATE admin_gem_grants SET result=jsonb_set(result,'{grantId}',to_jsonb($2::text)) WHERE realm_id=$1",
        [realm, randomUUID()],
      );
      await expect(
        restoreBackup(fresh, await makeBackup(source, password), password),
      ).rejects.toThrow('admin gem grant');
      expect((await fresh.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
      await source.query('DELETE FROM admin_gem_grants WHERE realm_id=$1', [realm]);
      await expect(
        restoreBackup(fresh, await makeBackup(source, password), password),
      ).rejects.toThrow('admin gem grant');
    } finally {
      await source.end();
      await fresh.end();
    }
  });
});
