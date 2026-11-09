import { describe, expect, it } from 'vitest';
import { backupFailureReason } from '../../scripts/backup-errors';

const withCode = (code: string, message = 'details that must not be printed') =>
  Object.assign(new Error(message), { code });

describe('backup command failure reasons', () => {
  it('names the problem without printing raw error text', () => {
    const secret = 'postgresql://owner:hunter2-secret@db.example.test/neondb';
    expect(backupFailureReason(withCode('42P01', secret))).toMatch(/no Bakufu tables yet/);
    expect(backupFailureReason(withCode('28P01', secret))).toMatch(/refused the login/);
    expect(backupFailureReason(withCode('ENOTFOUND', secret))).toMatch(/Could not reach/);
    expect(backupFailureReason(withCode('EEXIST', secret))).toMatch(/already exists/);
    expect(backupFailureReason(withCode('EACCES', secret))).toMatch(/shared with Docker/);
    expect(backupFailureReason(withCode('XX000', secret))).toBe(
      'Backup operation failed (code XX000). Check the arguments, passphrase, schema version, file permissions, and that a restore target is empty.',
    );
    for (const code of ['42P01', '28P01', 'ENOTFOUND', 'EEXIST', 'EACCES', 'XX000'])
      expect(backupFailureReason(withCode(code, secret))).not.toContain('hunter2');
  });
  it('explains passphrase and schema problems', () => {
    expect(backupFailureReason(new Error('Passphrase too short.'))).toMatch(/at least 16/);
    expect(backupFailureReason(new Error('Passphrases did not match.'))).toMatch(/did not match/);
    expect(
      backupFailureReason(new Error('Unsupported backup schema. Use the matching source release.')),
    ).toMatch(/db:migrate/);
    expect(
      backupFailureReason(new Error('Unsupported state or unable to authenticate data')),
    ).toMatch(/Wrong passphrase/);
    expect(backupFailureReason('not an error')).toMatch(/^Backup operation failed\./);
  });
});
