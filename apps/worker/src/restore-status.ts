import { z } from 'zod';

export const restoreStatusSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    outcome: z.enum(['success', 'failed']),
    lastAttemptAt: z.iso.datetime(),
    lastSuccessAt: z.iso.datetime().nullable(),
    scheduledWeek: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    verifiedBackupCreatedAt: z.iso.datetime().nullable(),
    verifiedBackupSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .refine(
    (status) =>
      status.outcome !== 'success' ||
      (status.lastSuccessAt === status.lastAttemptAt &&
        status.verifiedBackupCreatedAt !== null &&
        status.verifiedBackupSha256 !== null),
    'Invalid successful restore receipt.',
  );
export type RestoreStatus = z.infer<typeof restoreStatusSchema>;
export interface RestoreStatusDestination {
  restoreStatus(): Promise<RestoreStatus | null>;
  writeRestoreStatus(status: RestoreStatus): Promise<void>;
}
export function restoreHealthy(status: RestoreStatus | null, now = new Date()): boolean {
  if (
    !status ||
    status.outcome !== 'success' ||
    !status.lastSuccessAt ||
    !status.verifiedBackupCreatedAt ||
    !status.verifiedBackupSha256
  )
    return false;
  const age = now.getTime() - new Date(status.lastSuccessAt).getTime();
  return age >= -300000 && age <= 8 * 24 * 60 * 60 * 1000;
}
