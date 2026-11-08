import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { backupPolicy, inside, scheduledPeriod } from '../../apps/worker/src/config';
import { backupHealthy, type BackupStatus } from '../../apps/worker/src/destination';

describe('scheduled backup policy', () => {
  const paths = {
    BACKUP_DIRECTORY: resolve('/private/backups'),
    BACKUP_PASSPHRASE_FILE: resolve('/private/key'),
  };
  it('uses a versioned daily/weekly default and rejects unsupported or unsafe policies', () => {
    expect(backupPolicy(paths)).toMatchObject({
      schemaVersion: 1,
      hourUtc: 3,
      daily: 7,
      weekly: 4,
      instanceId: 'main',
    });
    for (const invalid of [
      { BACKUP_POLICY_VERSION: '2' },
      { BACKUP_HOUR_UTC: '24' },
      { BACKUP_RETAIN_DAILY: '0' },
      { BACKUP_RETAIN_WEEKLY: '261' },
      { BACKUP_INSTANCE_ID: '../other' },
      { BACKUP_DIRECTORY: 'relative' },
      { BACKUP_PASSPHRASE_FILE: '' },
    ])
      expect(() => backupPolicy({ ...paths, ...invalid })).toThrow();
  });
  it('uses the last due UTC day and Monday week across time zones and year boundaries', () => {
    expect(scheduledPeriod(new Date('2026-11-04T02:59:59Z'), 3)).toEqual({
      day: '2026-11-03',
      week: '2026-11-02',
    });
    expect(scheduledPeriod(new Date('2026-11-04T03:00:00Z'), 3)).toEqual({
      day: '2026-11-04',
      week: '2026-11-02',
    });
    expect(scheduledPeriod(new Date('2027-01-01T05:00:00+02:00'), 3)).toEqual({
      day: '2027-01-01',
      week: '2026-12-28',
    });
    expect(scheduledPeriod(new Date('2028-03-01T01:00:00Z'), 3).day).toBe('2028-02-29');
  });
  it('bounds path checks to complete components', () => {
    expect(inside(resolve('/app'), resolve('/app/private'))).toBe(true);
    expect(inside(resolve('/app'), resolve('/application'))).toBe(false);
    expect(inside(resolve('/app'), resolve('/outside'))).toBe(false);
  });
  it('marks failed, missing, stale, or implausibly future status unhealthy', () => {
    const now = new Date('2026-11-04T12:00:00Z'),
      status: BackupStatus = {
        schemaVersion: 1,
        outcome: 'success',
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: now.toISOString(),
        scheduledDate: '2026-11-04',
        dailyRetained: 1,
        weeklyRetained: 1,
      };
    expect(backupHealthy(status, now)).toBe(true);
    expect(backupHealthy(null, now)).toBe(false);
    expect(backupHealthy({ ...status, outcome: 'failed' }, now)).toBe(false);
    expect(backupHealthy({ ...status, lastSuccessAt: null }, now)).toBe(false);
    expect(backupHealthy(status, new Date('2026-11-06T00:00:01Z'))).toBe(false);
    expect(backupHealthy(status, new Date('2026-11-04T11:54:59Z'))).toBe(false);
  });
});
