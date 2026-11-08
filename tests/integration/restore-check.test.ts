import { defaultConfig } from '../support/prototype-config';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  createRealm,
  getRealmView,
  openPack,
  login,
  type Database,
} from '../../packages/db/src/index';
import {
  makeBackup,
  restoreBackup,
  assertBackupRestored,
  backupCreatedAt,
} from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { inside, type BackupPolicy } from '../../apps/worker/src/config';
import { fileDestination } from '../../apps/worker/src/destination';
import { restorePolicy } from '../../apps/worker/src/restore-config';
import { RestoreControl } from '../../apps/worker/src/restore-control';
import { runRestoreCheck } from '../../apps/worker/src/restore-check';
import { restoreHealthy } from '../../apps/worker/src/restore-status';
import { startPostgres } from '../support/postgres';
import { installLegacySchema, seedLegacyRealm } from '../support/legacy';

let sourceServer: Awaited<ReturnType<typeof startPostgres>>,
  checkServer: Awaited<ReturnType<typeof startPostgres>>,
  db: Database,
  control: RestoreControl,
  root: string,
  archive: string,
  sourceUrl: string,
  controlUrl: string,
  realm: string;
const passphrase = randomBytes(24).toString('hex'),
  password = randomBytes(24).toString('hex'),
  workspace = resolve('.'),
  policy = restorePolicy({}),
  execute = promisify(execFile);
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'card-engine-restore-test-'));
  sourceServer = await startPostgres();
  checkServer = await startPostgres();
  ({ db, url: sourceUrl } = await sourceServer.database('restore_source'));
  const admin = await bootstrap(db, 'restore-drill@example.test', password);
  realm = await createRealm(db, admin, 'Restore drill fixture', defaultConfig);
  await openPack(
    db,
    admin,
    realm,
    (await getRealmView(db, admin, realm)).packs[0].id,
    randomUUID(),
  );
  archive = await makeBackup(db, passphrase);
  const target = await checkServer.database('card_engine_restore_control', false);
  controlUrl = target.url;
  await target.db.end();
  control = new RestoreControl(controlUrl);
});
afterAll(async () => {
  await control?.close();
  await db?.end();
  await sourceServer?.stop();
  await checkServer?.stop();
  if (root && inside(tmpdir(), root) && root !== tmpdir())
    await rm(root, { recursive: true, force: true });
});
async function fixture(content = archive) {
  const directory = join(root, randomUUID()),
    key = join(root, `${randomUUID()}.key`);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(key, passphrase, { flag: 'wx', mode: 0o600 });
  const backup: BackupPolicy = {
    schemaVersion: 1,
    instanceId: 'fixture',
    directory,
    passphraseFile: key,
    hourUtc: 3,
    daily: 7,
    weekly: 4,
  };
  const destination = await fileDestination(backup, workspace, true);
  if (content) await destination.publish('daily-2026-11-04.backup', content);
  return { backup, destination };
}
async function noTemporaryDatabases() {
  expect(
    (await control.db.query("SELECT 1 FROM pg_database WHERE datname ~ '^card_engine_check_'"))
      .rowCount,
  ).toBe(0);
  expect((await control.db.query('SELECT 1 FROM card_engine_restore_jobs')).rowCount).toBe(0);
}
async function reserveFixture() {
  const tx = await control.db.connect();
  try {
    return await control.reserve(tx);
  } finally {
    tx.release();
  }
}
describe('automated fresh-database restore verification', () => {
  it('requires explicit pristine control initialization and binds it to one instance', async () => {
    const f = await fixture();
    await expect(
      runRestoreCheck(control, f.destination, 'fixture', policy, passphrase),
    ).rejects.toThrow('Restore check failed');
    await control.initialize('fixture');
    await control.initialize('fixture');
    await expect(control.initialize('different')).rejects.toThrow('initialization failed');
    expect(
      (await control.db.query("SELECT 1 FROM pg_tables WHERE schemaname='public'")).rowCount,
    ).toBe(2);
  });
  it('restores and compares all snapshot fields, removes its database, and publishes only generic proof', async () => {
    const f = await fixture(),
      sourceBefore = (await db.query('SELECT jsonb_agg(to_jsonb(m)) AS state FROM memberships m'))
        .rows;
    expect(
      await runRestoreCheck(control, f.destination, 'fixture', policy, passphrase),
    ).toMatchObject({ outcome: 'verified' });
    const status = await f.destination.restoreStatus();
    expect(restoreHealthy(status)).toBe(true);
    expect(status?.verifiedBackupSha256).toMatch(/^[a-f0-9]{64}$/);
    for (const secret of [
      passphrase,
      password,
      'restore-drill@example.test',
      sourceUrl,
      controlUrl,
      'card_engine_check_',
    ])
      expect(JSON.stringify(status)).not.toContain(secret);
    await noTemporaryDatabases();
    expect(
      (await db.query('SELECT jsonb_agg(to_jsonb(m)) AS state FROM memberships m')).rows,
    ).toEqual(sourceBefore);
    expect(await f.destination.status()).toBeNull();
  });
  it('deduplicates a scheduled week while allowing an explicit manual recheck', async () => {
    const f = await fixture();
    await runRestoreCheck(control, f.destination, 'fixture', policy, passphrase);
    const status = await f.destination.restoreStatus();
    expect(
      await runRestoreCheck(control, f.destination, 'fixture', policy, passphrase),
    ).toMatchObject({ outcome: 'current' });
    expect(await f.destination.restoreStatus()).toEqual(status);
    expect(
      await runRestoreCheck(
        control,
        f.destination,
        'fixture',
        policy,
        passphrase,
        new Date(),
        true,
      ),
    ).toMatchObject({ outcome: 'verified' });
    await noTemporaryDatabases();
  });
  it('excludes overlapping processes using the dedicated control lease', async () => {
    const f = await fixture(),
      tx = await control.db.connect();
    await tx.query('SELECT pg_advisory_lock(73103505)');
    try {
      expect(
        await runRestoreCheck(control, f.destination, 'fixture', policy, passphrase),
      ).toMatchObject({ outcome: 'busy' });
      expect(await f.destination.restoreStatus()).toBeNull();
    } finally {
      await tx.query('SELECT pg_advisory_unlock(73103505)');
      tx.release();
    }
  });
  it('fails on missing, corrupted, or unreadable backups before creating a database', async () => {
    for (const content of ['', 'not an encrypted backup']) {
      const f = await fixture(content);
      await expect(
        runRestoreCheck(control, f.destination, 'fixture', policy, passphrase),
      ).rejects.toThrow('Restore check failed');
      expect(restoreHealthy(await f.destination.restoreStatus())).toBe(false);
      await noTemporaryDatabases();
    }
    const f = await fixture(),
      failed = {
        ...f.destination,
        async read() {
          throw new Error('fixture private path');
        },
      };
    await expect(runRestoreCheck(control, failed, 'fixture', policy, passphrase)).rejects.toThrow(
      'Restore check failed',
    );
    expect(JSON.stringify(await f.destination.restoreStatus())).not.toContain('private path');
  });
  it('rejects wrong keys and preserves the last success while reporting the new failure', async () => {
    const f = await fixture();
    await runRestoreCheck(control, f.destination, 'fixture', policy, passphrase);
    const previous = await f.destination.restoreStatus();
    await expect(
      runRestoreCheck(
        control,
        f.destination,
        'fixture',
        policy,
        'another-fixture-passphrase',
        new Date(),
        true,
      ),
    ).rejects.toThrow('Restore check failed');
    const failed = await f.destination.restoreStatus();
    expect(failed).toMatchObject({
      outcome: 'failed',
      lastSuccessAt: previous!.lastSuccessAt,
      verifiedBackupSha256: previous!.verifiedBackupSha256,
    });
    expect(restoreHealthy(failed)).toBe(false);
    await noTemporaryDatabases();
  });
  it('requires a recent snapshot and rejects a snapshot from the future', async () => {
    for (const offset of [37 * 3600000, -301000]) {
      const f = await fixture();
      await expect(
        runRestoreCheck(
          control,
          f.destination,
          'fixture',
          policy,
          passphrase,
          new Date(new Date(backupCreatedAt(archive, passphrase)).getTime() + offset),
        ),
      ).rejects.toThrow();
      await noTemporaryDatabases();
    }
  });
  it('reports semantically inconsistent but authenticated data and cleans the failed restore', async () => {
    await db.query('UPDATE memberships SET balance=balance+1 WHERE realm_id=$1', [realm]);
    let invalid: string;
    try {
      invalid = await makeBackup(db, passphrase);
    } finally {
      await db.query('UPDATE memberships SET balance=balance-1 WHERE realm_id=$1', [realm]);
    }
    const f = await fixture(invalid!);
    await expect(
      runRestoreCheck(control, f.destination, 'fixture', policy, passphrase),
    ).rejects.toThrow('Restore check failed');
    expect(restoreHealthy(await f.destination.restoreStatus())).toBe(false);
    await noTemporaryDatabases();
  });
  it('cleans an interrupted owned database before skipping an already verified week', async () => {
    const f = await fixture();
    await runRestoreCheck(control, f.destination, 'fixture', policy, passphrase);
    const job = await reserveFixture(),
      target = control.target(job.name);
    expect(
      (
        await control.db.query(
          "SELECT has_database_privilege('pg_monitor',$1,'CONNECT') AS allowed",
          [job.name],
        )
      ).rows[0].allowed,
    ).toBe(false);
    try {
      await migrate(target);
      await restoreBackup(target, archive, passphrase);
    } finally {
      await target.end();
    }
    expect(
      (await control.db.query('SELECT 1 FROM pg_database WHERE datname=$1', [job.name])).rowCount,
    ).toBe(1);
    expect(
      await runRestoreCheck(control, f.destination, 'fixture', policy, passphrase),
    ).toMatchObject({ outcome: 'current' });
    await noTemporaryDatabases();
  });
  it('refuses to remove a registered database with a missing or changed ownership marker', async () => {
    const f = await fixture(),
      job = await reserveFixture();
    await control.db.query(`COMMENT ON DATABASE "${job.name}" IS 'operator fixture'`);
    try {
      await expect(
        runRestoreCheck(control, f.destination, 'fixture', policy, passphrase),
      ).rejects.toThrow();
      expect(
        (await control.db.query('SELECT 1 FROM pg_database WHERE datname=$1', [job.name])).rowCount,
      ).toBe(1);
    } finally {
      await control.db.query(
        `COMMENT ON DATABASE "${job.name}" IS 'card-engine-restore-check:${job.id}'`,
      );
    }
    await runRestoreCheck(control, f.destination, 'fixture', policy, passphrase);
    await noTemporaryDatabases();
  });
  it('never sweeps unregistered databases based on a matching name prefix', async () => {
    const f = await fixture(),
      name = `card_engine_check_${randomUUID().replaceAll('-', '')}`;
    await control.db.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    try {
      await runRestoreCheck(control, f.destination, 'fixture', policy, passphrase);
      expect(
        (await control.db.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount,
      ).toBe(1);
    } finally {
      await control.db.query(`DROP DATABASE "${name}"`);
    }
    await noTemporaryDatabases();
  });
  it('refuses a control database with unrelated objects and never migrates it into a game database', async () => {
    const f = await fixture();
    await control.db.query('CREATE TABLE unrelated_fixture(id integer)');
    try {
      await expect(control.initialize('fixture')).rejects.toThrow();
      await expect(
        runRestoreCheck(control, f.destination, 'fixture', policy, passphrase),
      ).rejects.toThrow();
      expect(
        (await control.db.query("SELECT to_regclass('public.accounts') AS name")).rows[0].name,
      ).toBeNull();
    } finally {
      await control.db.query('DROP TABLE unrelated_fixture');
    }
    await noTemporaryDatabases();
  });
  it('falls back to a retained weekly snapshot when no daily file is available', async () => {
    const f = await fixture('');
    await f.destination.publish('weekly-2026-11-02.backup', archive);
    await runRestoreCheck(control, f.destination, 'fixture', policy, passphrase);
    expect(restoreHealthy(await f.destination.restoreStatus())).toBe(true);
    await noTemporaryDatabases();
  });
  it('compares PostgreSQL timestamps independently of timezone and detects altered or transient rows', async () => {
    const target = (await sourceServer.database('restore_comparison')).db;
    try {
      await restoreBackup(target, archive, passphrase);
      await target.query("SET TIME ZONE 'Asia/Tokyo'");
      await assertBackupRestored(target, archive, passphrase);
      await target.query("UPDATE realms SET name='changed fixture' WHERE id=$1", [realm]);
      await expect(assertBackupRestored(target, archive, passphrase)).rejects.toThrow(
        'differs from backup',
      );
      await target.query("UPDATE realms SET name='Restore drill fixture' WHERE id=$1", [realm]);
      await login(target, 'restore-drill@example.test', password);
      await expect(assertBackupRestored(target, archive, passphrase)).rejects.toThrow('transient');
    } finally {
      await target.end();
    }
  });
  it('verifies migrated legacy fields without inventing comparisons for new IDs or XP baselines', async () => {
    const source = (await sourceServer.database('restore_legacy_source', false)).db,
      target = (await sourceServer.database('restore_legacy_target')).db;
    try {
      await installLegacySchema(source, 1);
      const admin = await bootstrap(source, 'legacy-drill@example.test', password);
      await seedLegacyRealm(source, admin);
      const old = await makeBackup(source, passphrase);
      await restoreBackup(target, old, passphrase);
      await assertBackupRestored(target, old, passphrase);
    } finally {
      await source.end();
      await target.end();
    }
  });
  it('runs the actual CLI using only the dedicated URL even when a game URL is also present', async () => {
    const f = await fixture(),
      entry = resolve('apps/worker/src/restore-main.ts'),
      env = {
        ...process.env,
        DATABASE_URL: sourceUrl,
        RESTORE_CHECK_DATABASE_URL: controlUrl,
        BACKUP_INSTANCE_ID: 'fixture',
        BACKUP_DIRECTORY: f.backup.directory,
        BACKUP_PASSPHRASE_FILE: f.backup.passphraseFile,
      };
    const cli = (mode: string) =>
      execute(process.execPath, ['--import', 'tsx', entry, mode], {
        cwd: workspace,
        env,
        windowsHide: true,
      });
    await expect(cli('status')).rejects.toMatchObject({ code: 1 });
    await cli('init');
    const result = await cli('once');
    expect(result.stdout).toContain('verified');
    for (const secret of [password, passphrase, sourceUrl, controlUrl])
      expect(result.stdout + result.stderr).not.toContain(secret);
    expect((await cli('status')).stdout).toContain('healthy');
    await noTemporaryDatabases();
  });
});
