import { createHash } from 'node:crypto';
import {
  assertBackupRestored,
  backupCreatedAt,
  restoreBackup,
} from '../../../packages/db/src/backup';
import { migrate } from '../../../packages/db/src/migrate';
import type { BackupDestination } from './destination';
import { restorePolicySchema, restorePeriod, type RestorePolicy } from './restore-config';
import type { RestoreStatus, RestoreStatusDestination } from './restore-status';
import { RestoreControl } from './restore-control';

export async function runRestoreCheck(
  control: RestoreControl,
  destination: BackupDestination & RestoreStatusDestination,
  instanceId: string,
  input: RestorePolicy,
  passphrase: string,
  now = new Date(),
  force = false,
) {
  const policy = restorePolicySchema.parse(input),
    scheduledWeek = restorePeriod(now, policy);
  async function connectionFailure(): Promise<never> {
    const previous = await destination.restoreStatus().catch(() => null);
    await destination
      .writeRestoreStatus({
        schemaVersion: 1,
        outcome: 'failed',
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        scheduledWeek,
        verifiedBackupCreatedAt: previous?.verifiedBackupCreatedAt ?? null,
        verifiedBackupSha256: previous?.verifiedBackupSha256 ?? null,
      })
      .catch(() => {});
    throw new Error('Restore check failed.');
  }
  const tx = await control.db.connect().catch(connectionFailure);
  let locked = false,
    discard = false;
  const onError = () => {
    discard = true;
  };
  tx.on('error', onError);
  let previous: RestoreStatus | null = null;
  try {
    locked = (
      await tx.query('SELECT pg_try_advisory_lock(73103505) AS locked').catch(connectionFailure)
    ).rows[0].locked;
    if (!locked) return { outcome: 'busy' as const, scheduledWeek };
    try {
      previous = await destination.restoreStatus();
      await control.validate(tx, instanceId);
      await control.cleanup(tx);
      if (
        previous?.lastSuccessAt &&
        new Date(previous.lastSuccessAt).getTime() - now.getTime() > 300000
      )
        throw new Error('Restore check clock moved backwards.');
      if (!force && previous?.outcome === 'success' && previous.scheduledWeek === scheduledWeek)
        return { outcome: 'current' as const, scheduledWeek };
      if (previous && previous.scheduledWeek > scheduledWeek)
        throw new Error('Restore check clock moved backwards.');
      const names = await destination.list(),
        name =
          names
            .filter((n) => n.startsWith('daily-'))
            .sort()
            .at(-1) ??
          names
            .filter((n) => n.startsWith('weekly-'))
            .sort()
            .at(-1);
      if (!name) throw new Error('No backup to restore.');
      const archive = await destination.read(name);
      if (!archive) throw new Error('Backup is unavailable.');
      const createdAt = backupCreatedAt(archive, passphrase),
        age = now.getTime() - new Date(createdAt).getTime();
      if (age < -300000 || age > policy.maxBackupAgeHours * 3600000)
        throw new Error('Backup is too old or from the future.');
      if (discard) throw new Error('Restore lease lost.');
      const job = await control.reserve(tx),
        target = control.target(job.name);
      try {
        if ((await target.query('SELECT current_database() AS name')).rows[0].name !== job.name)
          throw new Error('Restore target does not match reserved database.');
        await migrate(target);
        await restoreBackup(target, archive, passphrase);
        await assertBackupRestored(target, archive, passphrase);
      } finally {
        await target.end();
      }
      if (discard) throw new Error('Restore lease lost.');
      await control.cleanup(tx);
      const timestamp = now.toISOString();
      await destination.writeRestoreStatus({
        schemaVersion: 1,
        outcome: 'success',
        lastAttemptAt: timestamp,
        lastSuccessAt: timestamp,
        scheduledWeek,
        verifiedBackupCreatedAt: createdAt,
        verifiedBackupSha256: createHash('sha256').update(archive).digest('hex'),
      });
      return { outcome: 'verified' as const, scheduledWeek };
    } catch {
      // Only registry entries with exact owner/comment proofs can be removed.
      if (!discard)
        await control
          .validate(tx, instanceId)
          .then(() => control.cleanup(tx))
          .catch(() => {});
      await destination
        .writeRestoreStatus({
          schemaVersion: 1,
          outcome: 'failed',
          lastAttemptAt: now.toISOString(),
          lastSuccessAt: previous?.lastSuccessAt ?? null,
          scheduledWeek,
          verifiedBackupCreatedAt: previous?.verifiedBackupCreatedAt ?? null,
          verifiedBackupSha256: previous?.verifiedBackupSha256 ?? null,
        })
        .catch(() => {});
      throw new Error('Restore check failed.');
    }
  } finally {
    if (locked && !discard)
      try {
        await tx.query('SELECT pg_advisory_unlock(73103505)');
      } catch {
        discard = true;
      }
    tx.removeListener('error', onError);
    tx.release(discard);
  }
}
