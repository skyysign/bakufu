import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

export const backupPolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  instanceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  directory: z.string().min(1),
  passphraseFile: z.string().min(1),
  hourUtc: z.number().int().min(0).max(23),
  daily: z.number().int().min(1).max(366),
  weekly: z.number().int().min(1).max(260),
});
export type BackupPolicy = z.infer<typeof backupPolicySchema>;
export function inside(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
export function backupPolicy(env: NodeJS.ProcessEnv): BackupPolicy {
  const policy = backupPolicySchema.parse({
    schemaVersion: Number(env.BACKUP_POLICY_VERSION ?? 1),
    instanceId: env.BACKUP_INSTANCE_ID ?? 'main',
    directory: env.BACKUP_DIRECTORY,
    passphraseFile: env.BACKUP_PASSPHRASE_FILE,
    hourUtc: Number(env.BACKUP_HOUR_UTC ?? 3),
    daily: Number(env.BACKUP_RETAIN_DAILY ?? 7),
    weekly: Number(env.BACKUP_RETAIN_WEEKLY ?? 4),
  });
  if (![policy.directory, policy.passphraseFile].every(isAbsolute))
    throw new Error('Backup paths must be absolute.');
  return policy;
}
export function scheduledPeriod(now: Date, hourUtc: number) {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid clock.');
  const due = new Date(now);
  due.setUTCHours(hourUtc, 0, 0, 0);
  if (due > now) due.setUTCDate(due.getUTCDate() - 1);
  const day = due.toISOString().slice(0, 10);
  due.setUTCDate(due.getUTCDate() - ((due.getUTCDay() + 6) % 7));
  return { day, week: due.toISOString().slice(0, 10) };
}
