import { defaultConfig } from '../support/prototype-config';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  type Database,
} from '../../packages/db/src/index';
import { restoreBackup, verifyBackup } from '../../packages/db/src/backup';
import { backupPolicy, inside, type BackupPolicy } from '../../apps/worker/src/config';
import {
  backupHealthy,
  backupPassphrase,
  fileDestination,
  type BackupDestination,
} from '../../apps/worker/src/destination';
import { runBackupJob } from '../../apps/worker/src/backups';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>,
  db: Database,
  url: string,
  root: string,
  admin: string,
  realm: string;
const password = randomBytes(24).toString('hex'),
  workspace = resolve('.'),
  runProcess = promisify(execFile),
  now = new Date('2026-11-04T12:00:00Z');
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'card-engine-backups-'));
  server = await startPostgres();
  ({ db, url } = await server.database('backup_worker'));
  admin = await bootstrap(db, 'backup-worker@example.test', password);
  realm = await createRealm(db, admin, 'Scheduled recovery fixture', defaultConfig);
  await openPack(
    db,
    admin,
    realm,
    (await getRealmView(db, admin, realm)).packs[0].id,
    randomUUID(),
  );
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
  if (root && inside(tmpdir(), root) && root !== tmpdir())
    await rm(root, { recursive: true, force: true });
});
async function fixture(initialize = true) {
  const directory = join(root, randomUUID());
  await mkdir(directory, { mode: 0o700 });
  const passphraseFile = join(root, `${randomUUID()}.key`);
  await writeFile(passphraseFile, password, { mode: 0o600, flag: 'wx' });
  const policy: BackupPolicy = {
    schemaVersion: 1,
    instanceId: 'fixture',
    directory,
    passphraseFile,
    hourUtc: 3,
    daily: 2,
    weekly: 2,
  };
  const destination = initialize ? await fileDestination(policy, workspace, true) : undefined;
  return { policy, destination: destination!, folder: join(directory, 'card-engine-fixture') };
}
describe('independent encrypted scheduled backup job', () => {
  it('requires explicit initialization of an external destination and keeps initialization idempotent', async () => {
    const f = await fixture(false);
    await expect(fileDestination(f.policy, workspace)).rejects.toThrow();
    await fileDestination(f.policy, workspace, true);
    await fileDestination(f.policy, workspace, true);
    await expect(
      fileDestination({ ...f.policy, directory: workspace }, workspace, true),
    ).rejects.toThrow('outside');
  });
  it('publishes authenticated daily/weekly encrypted snapshots with private permissions and safe status', async () => {
    const f = await fixture();
    expect(await backupPassphrase(f.policy, workspace)).toBe(password);
    expect(await runBackupJob(db, f.destination, f.policy, password, now)).toMatchObject({
      outcome: 'created',
      scheduledDate: '2026-11-04',
    });
    expect(await f.destination.list()).toEqual([
      'daily-2026-11-04.backup',
      'weekly-2026-11-02.backup',
    ]);
    const archive = (await f.destination.read('daily-2026-11-04.backup'))!;
    verifyBackup(archive, password);
    expect(archive).not.toContain('backup-worker@example.test');
    expect(archive).not.toContain(password);
    if (process.platform !== 'win32')
      expect((await stat(join(f.folder, 'daily-2026-11-04.backup'))).mode & 0o077).toBe(0);
    expect(backupHealthy(await f.destination.status(), now)).toBe(true);
    expect(JSON.stringify(await f.destination.status())).not.toContain('account');
  });
  it('reuses exact encrypted bytes after a restart and never overwrites an existing generation', async () => {
    const f = await fixture();
    await runBackupJob(db, f.destination, f.policy, password, now);
    const before = await f.destination.read('daily-2026-11-04.backup');
    expect(
      await runBackupJob(db, await fileDestination(f.policy, workspace), f.policy, password, now),
    ).toMatchObject({ outcome: 'current' });
    expect(await f.destination.read('daily-2026-11-04.backup')).toBe(before);
    expect(await f.destination.publish('daily-2026-11-04.backup', 'do not overwrite')).toBe(false);
    expect(await f.destination.read('daily-2026-11-04.backup')).toBe(before);
  });
  it('excludes a concurrent job using a database session lock without duplicate snapshots', async () => {
    const f = await fixture();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve;
      });
    const destination: BackupDestination = {
      ...f.destination,
      async publish(name, content) {
        entered();
        await gate;
        return f.destination.publish(name, content);
      },
    };
    const first = runBackupJob(db, destination, f.policy, password, now);
    await started;
    try {
      expect(await runBackupJob(db, f.destination, f.policy, password, now)).toMatchObject({
        outcome: 'busy',
      });
    } finally {
      release();
    }
    await first;
    expect((await f.destination.list()).length).toBe(2);
  });
  it('catches up only the latest due day and retains configured daily/weekly generations', async () => {
    const f = await fixture();
    for (const day of ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-16'])
      await runBackupJob(db, f.destination, f.policy, password, new Date(`${day}T12:00:00Z`));
    expect(await f.destination.list()).toEqual([
      'daily-2026-10-15.backup',
      'daily-2026-10-16.backup',
      'weekly-2026-10-05.backup',
      'weekly-2026-10-12.backup',
    ]);
    const status = await f.destination.status();
    expect(status).toMatchObject({
      dailyRetained: 2,
      weeklyRetained: 2,
      scheduledDate: '2026-10-16',
    });
  });
  it('keeps older backups on a partial failure and finishes the same generation on retry', async () => {
    const f = await fixture();
    await runBackupJob(db, f.destination, f.policy, password, new Date('2026-10-01T12:00:00Z'));
    const before = await f.destination.list(),
      lastSuccess = (await f.destination.status())!.lastSuccessAt;
    const failing: BackupDestination = {
      ...f.destination,
      async publish(name, content) {
        if (name.startsWith('weekly-')) throw new Error('fixture disk full with private text');
        return f.destination.publish(name, content);
      },
    };
    await expect(
      runBackupJob(db, failing, { ...f.policy, daily: 1, weekly: 1 }, password, now),
    ).rejects.toThrow('Scheduled backup failed.');
    for (const name of before) expect(await f.destination.read(name)).not.toBeNull();
    expect(await f.destination.status()).toMatchObject({
      outcome: 'failed',
      lastSuccessAt: lastSuccess,
    });
    expect(JSON.stringify(await f.destination.status())).not.toContain('private text');
    const daily = await f.destination.read('daily-2026-11-04.backup');
    await runBackupJob(db, f.destination, { ...f.policy, daily: 1, weekly: 1 }, password, now);
    expect(await f.destination.read('daily-2026-11-04.backup')).toBe(daily);
    expect((await f.destination.list()).length).toBe(2);
  });
  it('rejects a changed passphrase before creating or pruning any generation', async () => {
    const f = await fixture();
    await runBackupJob(db, f.destination, f.policy, password, now);
    const names = await f.destination.list();
    await expect(
      runBackupJob(
        db,
        f.destination,
        f.policy,
        'another-fixture-passphrase',
        new Date('2026-11-05T12:00:00Z'),
      ),
    ).rejects.toThrow('Scheduled backup failed');
    expect(await f.destination.list()).toEqual(names);
    expect(backupHealthy(await f.destination.status(), now)).toBe(false);
  });
  it('fails closed for corrupt or future generations without overwriting or deleting them', async () => {
    const f = await fixture();
    await runBackupJob(db, f.destination, f.policy, password, now);
    const names = await f.destination.list();
    await expect(
      runBackupJob(db, f.destination, f.policy, password, new Date('2026-11-03T12:00:00Z')),
    ).rejects.toThrow();
    expect(await f.destination.list()).toEqual(names);
    await writeFile(join(f.folder, 'daily-2026-11-04.backup'), 'corrupt fixture');
    await expect(runBackupJob(db, f.destination, f.policy, password, now)).rejects.toThrow();
    expect(await f.destination.read('daily-2026-11-04.backup')).toBe('corrupt fixture');
    expect(await f.destination.list()).toEqual(names);
  });
  it('does not touch unrelated files and rejects path traversal or symlink candidates', async () => {
    const f = await fixture();
    await writeFile(join(f.folder, 'operator-notes.txt'), 'keep');
    await writeFile(join(f.folder, '.pending-fixture'), 'keep');
    await runBackupJob(db, f.destination, f.policy, password, now);
    expect(await readFile(join(f.folder, 'operator-notes.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(f.folder, '.pending-fixture'), 'utf8')).toBe('keep');
    expect(() => f.destination.publish('../escape.backup', 'x')).toThrow();
    await expect(f.destination.remove('../escape.backup')).rejects.toThrow();
    // Windows symlinks require elevation or Developer Mode; directory links can always be tested there.
    const alias = join(root, `${randomUUID()}-alias`);
    await symlink(f.folder, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliasPolicy = { ...f.policy, directory: root, instanceId: 'alias' };
    const aliasNamespace = join(root, 'card-engine-alias');
    await symlink(f.folder, aliasNamespace, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(fileDestination(aliasPolicy, workspace)).rejects.toThrow(
      'Invalid backup directory',
    );
  });
  it('keeps passphrase files separate from backups and rejects public POSIX permissions', async () => {
    const f = await fixture(),
      insideKey = join(f.policy.directory, 'key');
    await writeFile(insideKey, password, { mode: 0o600 });
    await expect(
      backupPassphrase({ ...f.policy, passphraseFile: insideKey }, workspace),
    ).rejects.toThrow('separate private');
    if (process.platform !== 'win32') {
      const publicKey = join(root, `${randomUUID()}.key`);
      await writeFile(publicKey, password, { mode: 0o644 });
      await expect(
        backupPassphrase({ ...f.policy, passphraseFile: publicKey }, workspace),
      ).rejects.toThrow('permissions');
    }
  });
  it('restores a scheduled snapshot into a fresh database with the same stable player progress', async () => {
    const f = await fixture(),
      before = await exportPlayer(db, admin, realm);
    await runBackupJob(db, f.destination, f.policy, password, now);
    const target = (await server.database('scheduled_restore')).db;
    try {
      await restoreBackup(target, (await f.destination.read('daily-2026-11-04.backup'))!, password);
      const after = await exportPlayer(target, admin, realm);
      expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
      expect((await target.query('SELECT 1 FROM sessions')).rowCount).toBe(0);
    } finally {
      await target.end();
    }
  });
  it('runs the real noninteractive CLI and reports failed/missing status without printing secrets', async () => {
    const f = await fixture(false),
      env = {
        ...process.env,
        DATABASE_URL: url,
        BACKUP_DIRECTORY: f.policy.directory,
        BACKUP_PASSPHRASE_FILE: f.policy.passphraseFile,
        BACKUP_INSTANCE_ID: f.policy.instanceId,
        BACKUP_RETAIN_DAILY: '2',
        BACKUP_RETAIN_WEEKLY: '2',
      },
      entry = resolve('apps/worker/src/main.ts');
    const cli = (mode: string) =>
      runProcess(process.execPath, ['--import', 'tsx', entry, mode], {
        cwd: workspace,
        env,
        windowsHide: true,
      });
    await cli('init');
    await expect(cli('status')).rejects.toMatchObject({ code: 1 });
    const result = await cli('once');
    expect(result.stdout).toContain('created');
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(result.stdout + result.stderr).not.toContain(url);
    expect((await cli('status')).stdout).toContain('healthy');
    expect((await cli('once')).stdout).toContain('current');
    await writeFile(f.policy.passphraseFile, 'wrong-fixture-password');
    await expect(cli('once')).rejects.toMatchObject({ code: 1 });
    await expect(cli('status')).rejects.toMatchObject({ code: 1 });
    expect(backupPolicy(env).schemaVersion).toBe(1);
  });
});
