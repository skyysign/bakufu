import { describe, expect, it } from 'vitest';
import { restorePolicy, restorePeriod } from '../../apps/worker/src/restore-config';
import { restoreControlUrl } from '../../apps/worker/src/restore-control';
import {
  restoreHealthy,
  restoreStatusSchema,
  type RestoreStatus,
} from '../../apps/worker/src/restore-status';

describe('automated restore policy', () => {
  it('defaults to weekly Monday 04:00 UTC with fresh backups and rejects invalid policy versions/limits', () => {
    expect(restorePolicy({})).toEqual({
      schemaVersion: 1,
      dayUtc: 1,
      hourUtc: 4,
      maxBackupAgeHours: 36,
    });
    for (const invalid of [
      { RESTORE_CHECK_POLICY_VERSION: '2' },
      { RESTORE_CHECK_DAY_UTC: '7' },
      { RESTORE_CHECK_HOUR_UTC: '24' },
      { RESTORE_CHECK_MAX_BACKUP_AGE_HOURS: '0' },
      { RESTORE_CHECK_MAX_BACKUP_AGE_HOURS: '169' },
    ])
      expect(() => restorePolicy(invalid)).toThrow();
  });
  it('selects the last due weekly boundary including before-hour, Sunday, leap year, and timezone cases', () => {
    const policy = restorePolicy({});
    expect(restorePeriod(new Date('2026-11-02T03:59:59Z'), policy)).toBe('2026-10-26');
    expect(restorePeriod(new Date('2026-11-02T04:00:00Z'), policy)).toBe('2026-11-02');
    expect(restorePeriod(new Date('2027-01-01T06:00:00+02:00'), policy)).toBe('2026-12-28');
    expect(restorePeriod(new Date('2028-03-01T12:00:00Z'), policy)).toBe('2028-02-28');
    expect(restorePeriod(new Date('2026-11-01T04:00:00Z'), { ...policy, dayUtc: 0 })).toBe(
      '2026-11-01',
    );
  });
  it('rejects game database URLs and query options that could override the generated target', () => {
    expect(
      restoreControlUrl(
        'postgresql://fixture@localhost/card_engine_restore_control?sslmode=require',
      ).pathname,
    ).toBe('/card_engine_restore_control');
    for (const value of [
      'postgresql://fixture@localhost/card_engine',
      'https://localhost/card_engine_restore_control',
      'postgresql://fixture@localhost/card_engine_restore_control?database=card_engine',
      'postgresql://fixture@localhost/card_engine_restore_control?host=other',
      'postgresql://fixture@localhost/card_engine_restore_control#fragment',
    ])
      expect(() => restoreControlUrl(value)).toThrow();
  });
  it('requires recent successful recovery rather than a successful backup capture', () => {
    const now = new Date('2026-11-04T12:00:00Z'),
      status: RestoreStatus = {
        schemaVersion: 1,
        outcome: 'success',
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: now.toISOString(),
        scheduledWeek: '2026-11-02',
        verifiedBackupCreatedAt: now.toISOString(),
        verifiedBackupSha256: 'a'.repeat(64),
      };
    expect(restoreHealthy(status, now)).toBe(true);
    expect(restoreHealthy(null, now)).toBe(false);
    expect(restoreHealthy({ ...status, outcome: 'failed' }, now)).toBe(false);
    expect(restoreHealthy({ ...status, lastSuccessAt: null }, now)).toBe(false);
    expect(restoreHealthy({ ...status, verifiedBackupSha256: null }, now)).toBe(false);
    expect(() => restoreStatusSchema.parse({ ...status, verifiedBackupSha256: null })).toThrow();
    expect(restoreHealthy(status, new Date('2026-11-12T12:00:01Z'))).toBe(false);
    expect(restoreHealthy(status, new Date('2026-11-04T11:54:59Z'))).toBe(false);
  });
});
