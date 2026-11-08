import { defaultConfig } from '../support/prototype-config';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  type Database,
} from '../../packages/db/src/index';
import { restoreBackup } from '../../packages/db/src/backup';
import { inside, type BackupPolicy } from '../../apps/worker/src/config';
import { fileDestination } from '../../apps/worker/src/destination';
import { runBackupJob } from '../../apps/worker/src/backups';
import { runRemoteCopy } from '../../apps/worker/src/remote-copy';
import { downloadRemote } from '../../apps/worker/src/remote-download';
import { remoteFingerprint, storageCredentials } from '../../apps/worker/src/remote-config';
import { remoteHealthy } from '../../apps/worker/src/remote-status';
import { s3Copies } from '../../apps/worker/src/s3-copy';
import { fixtureCredentials, fixtureRemote, s3Fixture } from '../support/s3-fixture';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>,
  db: Database,
  root: string,
  admin: string,
  realm: string;
const password = randomBytes(24).toString('hex'),
  workspace = resolve('.');
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'card-engine-offsite-'));
  server = await startPostgres();
  db = (await server.database('offsite_source')).db;
  admin = await bootstrap(db, 'offsite-fixture@example.test', password);
  realm = await createRealm(db, admin, 'Offsite fixture', defaultConfig);
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
async function fixture(capture = true) {
  const directory = join(root, randomUUID());
  await mkdir(directory, { mode: 0o700 });
  const passphraseFile = join(root, `${randomUUID()}.key`),
    credentialsFile = join(root, `${randomUUID()}.json`);
  await writeFile(passphraseFile, password, { flag: 'wx', mode: 0o600 });
  await writeFile(credentialsFile, JSON.stringify(fixtureCredentials), { flag: 'wx', mode: 0o600 });
  const backup: BackupPolicy = {
      schemaVersion: 1,
      instanceId: 'fixture',
      directory,
      passphraseFile,
      hourUtc: 3,
      daily: 7,
      weekly: 4,
    },
    policy = { ...fixtureRemote, credentialsFile },
    source = await fileDestination(backup, workspace, true),
    api = s3Fixture(),
    remote = s3Copies(api.client, policy, 'fixture');
  if (capture) await runBackupJob(db, source, backup, password);
  await remote.initialize();
  return { backup, policy, source, api, remote };
}
describe('encrypted offsite copies and fresh recovery', () => {
  it('copies all retained generations and records separate generic proof without changing local capture status', async () => {
    const f = await fixture();
    try {
      const capture = await f.source.status();
      expect(await runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password)).toEqual({
        outcome: 'copied',
      });
      expect(await f.source.status()).toEqual(capture);
      const proof = await f.source.remoteStatus();
      expect(remoteHealthy(proof, remoteFingerprint(f.policy, 'fixture'))).toBe(true);
      expect(proof?.verifiedGenerations).toBe(2);
      for (const secret of [
        password,
        fixtureCredentials.secretAccessKey,
        'offsite-fixture@example.test',
        f.policy.bucket,
        f.policy.endpoint,
      ])
        expect(JSON.stringify(proof)).not.toContain(secret);
      for (const name of await f.source.list())
        expect(await f.remote.read(name)).toBe(await f.source.read(name));
    } finally {
      f.api.client.destroy();
    }
  });
  it('does no cloud request for an unchanged proven source and preserves the original proof time', async () => {
    const f = await fixture();
    try {
      await runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password);
      const count = f.api.requests.length,
        proof = await f.source.remoteStatus();
      expect(await runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password)).toEqual({
        outcome: 'current',
      });
      expect(f.api.requests.length).toBe(count);
      expect(await f.source.remoteStatus()).toEqual(proof);
      expect(
        await runRemoteCopy(
          db,
          f.source,
          f.remote,
          f.policy,
          'fixture',
          password,
          new Date(),
          true,
        ),
      ).toEqual({ outcome: 'copied' });
      expect(f.api.requests.length).toBeGreaterThan(count);
    } finally {
      f.api.client.destroy();
    }
  });
  it('shares capture locking so concurrent retention or copying cannot race its inputs', async () => {
    const f = await fixture(),
      tx = await db.connect();
    await tx.query('SELECT pg_advisory_lock(73103504)');
    try {
      expect(await runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password)).toEqual({
        outcome: 'busy',
      });
      expect(await f.source.remoteStatus()).toBeNull();
    } finally {
      await tx.query('SELECT pg_advisory_unlock(73103504)');
      tx.release();
      f.api.client.destroy();
    }
  });
  it('retries a remote commit whose response was lost without overwriting or duplicating generations', async () => {
    const f = await fixture();
    try {
      f.api.state.losePutResponseOnce = true;
      await expect(
        runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password),
      ).rejects.toThrow('Offsite backup copy failed');
      const committed = [...f.api.objects.entries()].filter(([key]) => key.endsWith('.backup'));
      expect(committed.length).toBe(1);
      await runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password);
      for (const [key, bytes] of committed) expect(f.api.objects.get(key)).toEqual(bytes);
      expect([...f.api.objects.keys()].filter((k) => k.endsWith('.backup')).length).toBe(2);
    } finally {
      f.api.client.destroy();
    }
  });
  it('fails on conflicting or corrupt remote bytes without deleting local or remote snapshots', async () => {
    const f = await fixture();
    try {
      const name = (await f.source.list())[0];
      f.api.objects.set(f.api.key(name), Buffer.from('preexisting fixture'));
      const before = await f.source.read(name);
      await expect(
        runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password),
      ).rejects.toThrow();
      expect(f.api.objects.get(f.api.key(name))!.toString()).toBe('preexisting fixture');
      expect(await f.source.read(name)).toBe(before);
      expect(f.api.requests.every((r) => r.method !== 'DELETE')).toBe(true);
      expect((await f.source.remoteStatus())?.outcome).toBe('failed');
    } finally {
      f.api.client.destroy();
    }
  });
  it('requires healthy capture and a correct decryption key before uploading backup data', async () => {
    const f = await fixture(false);
    try {
      await expect(
        runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password),
      ).rejects.toThrow();
      await runBackupJob(db, f.source, f.backup, password);
      await expect(
        runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', 'incorrect-fixture-passphrase'),
      ).rejects.toThrow();
      expect([...f.api.objects.keys()].filter((k) => k.endsWith('.backup'))).toEqual([]);
    } finally {
      f.api.client.destroy();
    }
  });
  it('retains last success on failure and rejects stale proofs or changed destinations', async () => {
    const f = await fixture();
    try {
      await runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password);
      const previous = await f.source.remoteStatus();
      f.api.state.deny = true;
      await expect(
        runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password, new Date(), true),
      ).rejects.toThrow();
      expect(await f.source.remoteStatus()).toMatchObject({
        outcome: 'failed',
        lastSuccessAt: previous!.lastSuccessAt,
      });
      expect(
        remoteHealthy(
          previous,
          remoteFingerprint({ ...f.policy, bucket: 'changed-bucket' }, 'fixture'),
        ),
      ).toBe(false);
      expect(
        remoteHealthy(
          previous,
          remoteFingerprint(f.policy, 'fixture'),
          new Date(Date.now() + 37 * 3600000),
        ),
      ).toBe(false);
    } finally {
      f.api.client.destroy();
    }
  });
  it('loads only a bounded private credential file outside the source repository and capture directory', async () => {
    const f = await fixture();
    try {
      expect(await storageCredentials(f.policy, f.backup, workspace)).toEqual(fixtureCredentials);
      const wrong = join(f.backup.directory, 'credentials.json');
      await writeFile(wrong, JSON.stringify(fixtureCredentials), { mode: 0o600 });
      await expect(
        storageCredentials({ ...f.policy, credentialsFile: wrong }, f.backup, workspace),
      ).rejects.toThrow('separate private');
      await writeFile(
        f.policy.credentialsFile,
        JSON.stringify({ ...fixtureCredentials, unexpected: 'not allowed' }),
      );
      await expect(storageCredentials(f.policy, f.backup, workspace)).rejects.toThrow();
    } finally {
      f.api.client.destroy();
    }
  });
  it('downloads authenticated ciphertext and restores stable player progress into a fresh database', async () => {
    const f = await fixture(),
      target = (await server.database('offsite_recovered')).db;
    try {
      const before = await exportPlayer(db, admin, realm);
      await runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password);
      const name = (await f.source.list())[0],
        recovered = join(root, `${randomUUID()}.backup`);
      await downloadRemote(f.remote, name, recovered, password, workspace, f.backup.directory);
      expect(await readFile(recovered, 'utf8')).toBe(await f.source.read(name));
      await restoreBackup(target, await readFile(recovered, 'utf8'), password);
      const after = await exportPlayer(target, admin, realm);
      expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
      expect((await target.query('SELECT 1 FROM sessions')).rowCount).toBe(0);
    } finally {
      await target.end();
      f.api.client.destroy();
    }
  });
  it('refuses to overwrite recovery files or write into the repository/capture directory, and rejects a bad key', async () => {
    const f = await fixture();
    try {
      await runRemoteCopy(db, f.source, f.remote, f.policy, 'fixture', password);
      const name = (await f.source.list())[0],
        target = join(root, `${randomUUID()}.backup`);
      await writeFile(target, 'keep this fixture');
      await expect(
        downloadRemote(f.remote, name, target, password, workspace, f.backup.directory),
      ).rejects.toThrow();
      expect(await readFile(target, 'utf8')).toBe('keep this fixture');
      await expect(
        downloadRemote(
          f.remote,
          name,
          join(workspace, 'unsafe-fixture.backup'),
          password,
          workspace,
          f.backup.directory,
        ),
      ).rejects.toThrow('outside');
      await expect(
        downloadRemote(
          f.remote,
          name,
          join(f.backup.directory, 'unsafe.backup'),
          password,
          workspace,
          f.backup.directory,
        ),
      ).rejects.toThrow('outside');
      await expect(
        downloadRemote(
          f.remote,
          name,
          join(root, `${randomUUID()}.backup`),
          'wrong-fixture-passphrase',
          workspace,
          f.backup.directory,
        ),
      ).rejects.toThrow();
    } finally {
      f.api.client.destroy();
    }
  });
});
