import { describe, expect, it } from 'vitest';
import { remotePolicy, remoteFingerprint } from '../../apps/worker/src/remote-config';
import { remoteHealthy, type RemoteStatus } from '../../apps/worker/src/remote-status';
import { s3Copies } from '../../apps/worker/src/s3-copy';
import { fixtureRemote, s3Fixture } from '../support/s3-fixture';
import { resolve } from 'node:path';

describe('explicit encrypted S3 copy transport', () => {
  it('validates an HTTPS-only versioned destination and rejects redirects or unsafe object prefixes', () => {
    const env = {
      BACKUP_S3_ENDPOINT: fixtureRemote.endpoint,
      BACKUP_S3_REGION: fixtureRemote.region,
      BACKUP_S3_BUCKET: fixtureRemote.bucket,
      BACKUP_S3_PREFIX: fixtureRemote.prefix,
      BACKUP_S3_CREDENTIALS_FILE: resolve('/private/fixture.json'),
    };
    expect(remotePolicy(env)).toMatchObject({ schemaVersion: 1, maxBytes: 67108864 });
    for (const invalid of [
      { BACKUP_REMOTE_POLICY_VERSION: '2' },
      { BACKUP_S3_ENDPOINT: 'http://s3.fixture.test' },
      { BACKUP_S3_ENDPOINT: 'https://user:secret@s3.fixture.test' },
      { BACKUP_S3_ENDPOINT: 'https://s3.fixture.test/path' },
      { BACKUP_S3_PREFIX: '../escape' },
      { BACKUP_S3_PREFIX: '/other' },
      { BACKUP_S3_BUCKET: 'bad/name' },
      { BACKUP_S3_CREDENTIALS_FILE: 'relative' },
      { BACKUP_REMOTE_MAX_BYTES: '0' },
    ])
      expect(() => remotePolicy({ ...env, ...invalid })).toThrow();
  });
  it('uses signed conditional requests, checks SHA-256, and reads exact published bytes', async () => {
    const f = s3Fixture(),
      remote = s3Copies(f.client, fixtureRemote, 'fixture');
    try {
      await remote.initialize();
      await remote.copy('daily-2026-11-04.backup', 'fictional encrypted body');
      expect(await remote.read('daily-2026-11-04.backup')).toBe('fictional encrypted body');
      const put = f.requests.find((r) => r.key.endsWith('.backup') && r.method === 'PUT')!;
      expect(put.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      expect(put.headers['if-none-match']).toBe('*');
      expect(put.headers['x-amz-checksum-sha256']).toBeTruthy();
      expect(
        f.requests
          .filter((r) => r.method === 'PUT')
          .every((r) => !!r.headers['x-amz-checksum-sha256']),
      ).toBe(true);
      expect(f.requests.every((r) => ['GET', 'PUT'].includes(r.method))).toBe(true);
    } finally {
      f.client.destroy();
    }
  });
  it('rejects a provider that ignores conditional creation before uploading any snapshot', async () => {
    const f = s3Fixture();
    f.state.ignoreConditions = true;
    try {
      await expect(s3Copies(f.client, fixtureRemote, 'fixture').initialize()).rejects.toThrow(
        'Conditional writes',
      );
      expect([...f.objects.keys()].every((k) => k.includes('.conditional-probe-'))).toBe(true);
    } finally {
      f.client.destroy();
    }
  });
  it('never overwrites conflicting content and detects corrupt read-back independently of ETag', async () => {
    const f = s3Fixture(),
      remote = s3Copies(f.client, fixtureRemote, 'fixture');
    try {
      await remote.initialize();
      await remote.copy('daily-2026-11-04.backup', 'original');
      await expect(remote.copy('daily-2026-11-04.backup', 'replacement')).rejects.toThrow(
        'differs',
      );
      expect(f.objects.get(f.key('daily-2026-11-04.backup'))!.toString()).toBe('original');
      f.corruptReads.add(f.key('daily-2026-11-04.backup'));
      await expect(remote.copy('daily-2026-11-04.backup', 'original')).rejects.toThrow('differs');
    } finally {
      f.client.destroy();
    }
  });
  it('bounds download size and rejects traversal, access errors, or missing generations', async () => {
    const f = s3Fixture(),
      remote = s3Copies(f.client, { ...fixtureRemote, maxBytes: 1024 }, 'fixture');
    try {
      f.objects.set(f.key('daily-2026-11-04.backup'), Buffer.alloc(2048));
      await expect(remote.read('daily-2026-11-04.backup')).rejects.toThrow('limit');
      await expect(remote.read('../escape')).rejects.toThrow('Invalid');
      await expect(remote.read('daily-2026-11-03.backup')).rejects.toThrow();
      f.state.deny = true;
      await expect(remote.assertInitialized()).rejects.toThrow();
    } finally {
      f.client.destroy();
    }
  });
  it('makes health depend on both source freshness and destination identity without exposing addresses', () => {
    const now = new Date('2026-11-04T12:00:00Z'),
      target = remoteFingerprint(fixtureRemote, 'fixture'),
      status: RemoteStatus = {
        schemaVersion: 1,
        outcome: 'success',
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: now.toISOString(),
        latestCaptureAt: now.toISOString(),
        sourceHash: 'a'.repeat(64),
        destinationHash: target,
        verifiedGenerations: 2,
      };
    expect(remoteHealthy(status, target, now)).toBe(true);
    expect(remoteHealthy({ ...status, outcome: 'failed' }, target, now)).toBe(false);
    expect(
      remoteHealthy(
        status,
        remoteFingerprint({ ...fixtureRemote, bucket: 'other-bucket' }, 'fixture'),
        now,
      ),
    ).toBe(false);
    expect(remoteHealthy(status, target, new Date('2026-11-06T00:00:01Z'))).toBe(false);
    expect(JSON.stringify(status)).not.toContain('fixture.test');
  });
});
