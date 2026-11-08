import { z } from 'zod';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const remoteStatusSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    outcome: z.enum(['success', 'failed']),
    lastAttemptAt: z.iso.datetime(),
    lastSuccessAt: z.iso.datetime().nullable(),
    latestCaptureAt: z.iso.datetime().nullable(),
    sourceHash: hash.nullable(),
    destinationHash: hash.nullable(),
    verifiedGenerations: z.number().int().nonnegative(),
  })
  .refine(
    (p) =>
      p.outcome !== 'success' ||
      (p.lastAttemptAt === p.lastSuccessAt &&
        p.latestCaptureAt !== null &&
        p.sourceHash !== null &&
        p.destinationHash !== null &&
        p.verifiedGenerations > 0),
    'Invalid remote-copy proof.',
  );
export type RemoteStatus = z.infer<typeof remoteStatusSchema>;
export interface RemoteStatusDestination {
  remoteStatus(): Promise<RemoteStatus | null>;
  writeRemoteStatus(status: RemoteStatus): Promise<void>;
}
export function remoteHealthy(
  status: RemoteStatus | null,
  destinationHash: string,
  now = new Date(),
): boolean {
  if (
    !status ||
    status.outcome !== 'success' ||
    !status.lastSuccessAt ||
    !status.latestCaptureAt ||
    !status.sourceHash ||
    status.verifiedGenerations < 1 ||
    status.destinationHash !== destinationHash
  )
    return false;
  return [status.lastSuccessAt, status.latestCaptureAt].every((time) => {
    const age = now.getTime() - new Date(time).getTime();
    return age >= -300000 && age <= 36 * 3600000;
  });
}
