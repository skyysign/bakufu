import { createHash } from 'node:crypto';
import type { Database } from '../../../packages/db/src/connection';
import { backupCreatedAt } from '../../../packages/db/src/backup';
import { backupHealthy, type BackupDestination } from './destination';
import { remoteFingerprint, type RemotePolicy } from './remote-config';
import { remoteHealthy, type RemoteStatus, type RemoteStatusDestination } from './remote-status';
import type { RemoteCopies } from './s3-copy';

export async function runRemoteCopy(
  db: Database,
  source: BackupDestination & RemoteStatusDestination,
  remote: RemoteCopies,
  policy: RemotePolicy,
  instanceId: string,
  passphrase: string,
  now = new Date(),
  force = false,
) {
  async function connectionFailure(): Promise<never> {
    const previous = await source.remoteStatus().catch(() => null);
    await source
      .writeRemoteStatus({
        schemaVersion: 1,
        outcome: 'failed',
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        latestCaptureAt: previous?.latestCaptureAt ?? null,
        sourceHash: previous?.sourceHash ?? null,
        destinationHash: previous?.destinationHash ?? null,
        verifiedGenerations: previous?.verifiedGenerations ?? 0,
      })
      .catch(() => {});
    throw new Error('Offsite backup copy failed.');
  }
  const tx = await db.connect().catch(connectionFailure);
  let locked = false,
    discard = false,
    previous: RemoteStatus | null = null;
  const onError = () => {
    discard = true;
  };
  tx.on('error', onError);
  try {
    // Same lease as capture: local retention cannot remove an input mid-copy.
    locked = (
      await tx.query('SELECT pg_try_advisory_lock(73103504) AS locked').catch(connectionFailure)
    ).rows[0].locked;
    if (!locked) return { outcome: 'busy' as const };
    try {
      previous = await source.remoteStatus();
      if (!backupHealthy(await source.status(), now))
        throw new Error('A successful recent local capture is required.');
      const names = await source.list();
      if (!names.length) throw new Error('No snapshots to copy.');
      const snapshots = [];
      let latest = 0;
      for (const name of names) {
        const content = await source.read(name);
        if (!content) throw new Error('Snapshot disappeared.');
        if (Buffer.byteLength(content) > policy.maxBytes)
          throw new Error('Snapshot exceeds the configured copy limit.');
        latest = Math.max(latest, new Date(backupCreatedAt(content, passphrase)).getTime());
        snapshots.push({ name, hash: createHash('sha256').update(content).digest('hex') });
      }
      snapshots.sort((a, b) => a.name.localeCompare(b.name));
      const sourceHash = createHash('sha256')
          .update(JSON.stringify(snapshots.map(({ name, hash }) => ({ name, hash }))))
          .digest('hex'),
        destinationHash = remoteFingerprint(policy, instanceId);
      const age = now.getTime() - latest;
      if (age < -300000 || age > 36 * 3600000)
        throw new Error('Latest local snapshot is not recent.');
      if (
        !force &&
        remoteHealthy(previous, destinationHash, now) &&
        previous!.sourceHash === sourceHash
      )
        return { outcome: 'current' as const };
      await remote.assertInitialized();
      for (const item of snapshots) {
        if (discard) throw new Error('Capture lease lost.');
        const content = await source.read(item.name);
        if (!content || createHash('sha256').update(content).digest('hex') !== item.hash)
          throw new Error('Local snapshot changed during copying.');
        await remote.copy(item.name, content);
      }
      if (discard) throw new Error('Capture lease lost.');
      const timestamp = now.toISOString();
      await source.writeRemoteStatus({
        schemaVersion: 1,
        outcome: 'success',
        lastAttemptAt: timestamp,
        lastSuccessAt: timestamp,
        latestCaptureAt: new Date(latest).toISOString(),
        sourceHash,
        destinationHash,
        verifiedGenerations: snapshots.length,
      });
      return { outcome: 'copied' as const };
    } catch {
      await source
        .writeRemoteStatus({
          schemaVersion: 1,
          outcome: 'failed',
          lastAttemptAt: now.toISOString(),
          lastSuccessAt: previous?.lastSuccessAt ?? null,
          latestCaptureAt: previous?.latestCaptureAt ?? null,
          sourceHash: previous?.sourceHash ?? null,
          destinationHash: previous?.destinationHash ?? null,
          verifiedGenerations: previous?.verifiedGenerations ?? 0,
        })
        .catch(() => {});
      throw new Error('Offsite backup copy failed.');
    }
  } finally {
    if (locked && !discard)
      try {
        await tx.query('SELECT pg_advisory_unlock(73103504)');
      } catch {
        discard = true;
      }
    tx.removeListener('error', onError);
    tx.release(discard);
  }
}
