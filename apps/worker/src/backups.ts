import type { Database } from '../../../packages/db/src/connection';
import { makeBackup, verifyBackup } from '../../../packages/db/src/backup';
import { backupPolicySchema, scheduledPeriod, type BackupPolicy } from './config';
import type { BackupDestination, BackupStatus } from './destination';

export async function runBackupJob(
  db: Database,
  destination: BackupDestination,
  input: BackupPolicy,
  passphrase: string,
  now = new Date(),
) {
  const policy = backupPolicySchema.parse(input),
    period = scheduledPeriod(now, policy.hourUtc);
  async function connectionFailure(): Promise<never> {
    const previous = await destination.status().catch(() => null);
    await destination
      .writeStatus({
        schemaVersion: 1,
        outcome: 'failed',
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        scheduledDate: period.day,
        dailyRetained: previous?.dailyRetained ?? 0,
        weeklyRetained: previous?.weeklyRetained ?? 0,
      })
      .catch(() => {});
    throw new Error('Scheduled backup failed.');
  }
  const connection = await db.connect().catch(connectionFailure);
  let locked = false,
    discard = false;
  connection.on('error', onError);
  function onError() {
    discard = true;
  }
  try {
    locked = (
      await connection
        .query('SELECT pg_try_advisory_lock(73103504) AS locked')
        .catch(connectionFailure)
    ).rows[0].locked;
    if (!locked) return { outcome: 'busy' as const, scheduledDate: period.day };
    const previous = await destination.status();
    try {
      const dailyName = `daily-${period.day}.backup`,
        weeklyName = `weekly-${period.week}.backup`;
      const existing = await destination.list();
      if (
        existing.some((name) => (name.startsWith('daily-') ? name > dailyName : name > weeklyName))
      )
        throw new Error('Backup clock moved backwards.');
      const newest = existing
        .filter((name) => name.startsWith('daily-'))
        .sort()
        .at(-1);
      // A replaced key must not silently prune backups made with the original passphrase.
      if (newest) verifyBackup((await destination.read(newest))!, passphrase);
      let daily = await destination.read(dailyName),
        created = false;
      if (daily === null) {
        daily = await makeBackup(db, passphrase);
        verifyBackup(daily, passphrase);
        if (discard) throw new Error('Backup lock lost.');
        created = await destination.publish(dailyName, daily);
        daily = (await destination.read(dailyName))!;
      }
      verifyBackup(daily, passphrase);
      let weekly = await destination.read(weeklyName);
      if (weekly === null) {
        if (discard) throw new Error('Backup lock lost.');
        created = (await destination.publish(weeklyName, daily)) || created;
        weekly = await destination.read(weeklyName);
      }
      verifyBackup(weekly!, passphrase);
      // Retention starts only after both current generations authenticate. Never touch unrelated files.
      const names = await destination.list();
      for (const [kind, limit] of [
        ['daily', policy.daily],
        ['weekly', policy.weekly],
      ] as const) {
        const ordered = names
          .filter((name) => name.startsWith(`${kind}-`))
          .sort()
          .reverse();
        for (const name of ordered.slice(limit)) {
          if (discard) throw new Error('Backup lock lost.');
          await destination.remove(name);
        }
      }
      if (discard) throw new Error('Backup lock lost.');
      const kept = await destination.list(),
        timestamp = now.toISOString();
      await destination.writeStatus({
        schemaVersion: 1,
        outcome: 'success',
        lastAttemptAt: timestamp,
        lastSuccessAt: timestamp,
        scheduledDate: period.day,
        dailyRetained: kept.filter((n) => n.startsWith('daily-')).length,
        weeklyRetained: kept.filter((n) => n.startsWith('weekly-')).length,
      });
      return {
        outcome: created ? ('created' as const) : ('current' as const),
        scheduledDate: period.day,
      };
    } catch {
      const failed: BackupStatus = {
        schemaVersion: 1,
        outcome: 'failed',
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        scheduledDate: period.day,
        dailyRetained: previous?.dailyRetained ?? 0,
        weeklyRetained: previous?.weeklyRetained ?? 0,
      };
      await destination.writeStatus(failed).catch(() => {});
      throw new Error('Scheduled backup failed.');
    }
  } finally {
    if (locked && !discard)
      try {
        await connection.query('SELECT pg_advisory_unlock(73103504)');
      } catch {
        discard = true;
      }
    connection.removeListener('error', onError);
    connection.release(discard);
  }
}
