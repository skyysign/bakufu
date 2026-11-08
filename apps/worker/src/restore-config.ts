import { z } from 'zod';

export const restorePolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  dayUtc: z.number().int().min(0).max(6),
  hourUtc: z.number().int().min(0).max(23),
  maxBackupAgeHours: z.number().int().min(1).max(168),
});
export type RestorePolicy = z.infer<typeof restorePolicySchema>;
export function restorePolicy(env: NodeJS.ProcessEnv): RestorePolicy {
  return restorePolicySchema.parse({
    schemaVersion: Number(env.RESTORE_CHECK_POLICY_VERSION ?? 1),
    dayUtc: Number(env.RESTORE_CHECK_DAY_UTC ?? 1),
    hourUtc: Number(env.RESTORE_CHECK_HOUR_UTC ?? 4),
    maxBackupAgeHours: Number(env.RESTORE_CHECK_MAX_BACKUP_AGE_HOURS ?? 36),
  });
}
export function restorePeriod(now: Date, policy: RestorePolicy): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid clock.');
  const due = new Date(now);
  due.setUTCHours(policy.hourUtc, 0, 0, 0);
  due.setUTCDate(due.getUTCDate() - ((due.getUTCDay() - policy.dayUtc + 7) % 7));
  if (due > now) due.setUTCDate(due.getUTCDate() - 7);
  return due.toISOString().slice(0, 10);
}
