import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { privateFile } from './private-files';
import type { BackupPolicy } from './config';

export const remotePolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    endpoint: z.url(),
    region: z.string().regex(/^[a-z0-9-]{1,64}$/),
    bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    prefix: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/)
      .max(256),
    credentialsFile: z.string().min(1),
    maxBytes: z
      .number()
      .int()
      .min(1024)
      .max(512 * 1024 * 1024),
  })
  .refine((p) => {
    const url = new URL(p.endpoint);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '/' || url.pathname === '')
    );
  }, 'Use an HTTPS S3 endpoint without credentials, path, query, or fragment.');
export type RemotePolicy = z.infer<typeof remotePolicySchema>;
export function remotePolicy(env: NodeJS.ProcessEnv): RemotePolicy {
  const policy = remotePolicySchema.parse({
    schemaVersion: Number(env.BACKUP_REMOTE_POLICY_VERSION ?? 1),
    endpoint: env.BACKUP_S3_ENDPOINT,
    region: env.BACKUP_S3_REGION,
    bucket: env.BACKUP_S3_BUCKET,
    prefix: env.BACKUP_S3_PREFIX,
    credentialsFile: env.BACKUP_S3_CREDENTIALS_FILE,
    maxBytes: Number(env.BACKUP_REMOTE_MAX_BYTES ?? 64 * 1024 * 1024),
  });
  if (!isAbsolute(policy.credentialsFile))
    throw new Error('Use an absolute private credential path.');
  return policy;
}
export const storageCredentialsSchema = z.strictObject({
  accessKeyId: z.string().min(8).max(128),
  secretAccessKey: z.string().min(16).max(4096),
  sessionToken: z.string().min(1).max(16384).optional(),
});
export async function storageCredentials(
  remote: RemotePolicy,
  backup: BackupPolicy,
  workspace: string,
) {
  return storageCredentialsSchema.parse(
    JSON.parse(await privateFile(remote.credentialsFile, workspace, backup.directory, 32768)),
  );
}
export function remoteFingerprint(remote: RemotePolicy, instanceId: string) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: remote.schemaVersion,
        endpoint: new URL(remote.endpoint).href,
        region: remote.region,
        bucket: remote.bucket,
        prefix: remote.prefix,
        instanceId,
      }),
    )
    .digest('hex');
}
