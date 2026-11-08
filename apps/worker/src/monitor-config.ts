import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { inside, type BackupPolicy } from './config';
import { privateFile } from './private-files';

export const checkName = z.enum(['capture', 'restore', 'offsite']);
export const checkState = z.enum(['healthy', 'missing', 'failed', 'stale', 'unavailable']);
export const checksSchema = z.partialRecord(checkName, checkState);
export type Checks = Partial<Record<z.infer<typeof checkName>, z.infer<typeof checkState>>>;
export const monitorPolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    stateDirectory: z.string().min(1),
    webhookFile: z.string().min(1),
    checks: z.array(checkName).min(1).max(3),
  })
  .refine(
    (p) => p.checks.includes('capture') && new Set(p.checks).size === p.checks.length,
    'Select capture and only configured optional checks.',
  );
export type MonitorPolicy = z.infer<typeof monitorPolicySchema>;
export function monitorPolicy(env: NodeJS.ProcessEnv): MonitorPolicy {
  const policy = monitorPolicySchema.parse({
    schemaVersion: Number(env.BACKUP_ALERT_POLICY_VERSION ?? 1),
    stateDirectory: env.BACKUP_ALERT_STATE_DIRECTORY,
    webhookFile: env.BACKUP_ALERT_WEBHOOK_FILE,
    checks: (env.BACKUP_ALERT_CHECKS ?? 'capture').split(',').map((v) => v.trim()),
  });
  if (!isAbsolute(policy.stateDirectory) || !isAbsolute(policy.webhookFile))
    throw new Error('Use absolute private monitor paths.');
  return policy;
}
export const webhookSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    url: z.url(),
    token: z
      .string()
      .min(16)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
  })
  .refine((value) => {
    const url = new URL(value.url);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  }, 'Use a fixed HTTPS receiver without URL credentials, query, or fragment.');
export type WebhookSettings = z.infer<typeof webhookSchema>;
export async function webhookSettings(
  policy: MonitorPolicy,
  backup: BackupPolicy,
  workspace: string,
): Promise<WebhookSettings> {
  if (inside(await realpath(policy.stateDirectory), await realpath(policy.webhookFile)))
    throw new Error('Keep the private webhook file outside monitor state.');
  const capture = await realpath(backup.directory).catch(() => resolve(backup.directory));
  if (inside(capture, await realpath(policy.webhookFile)))
    throw new Error('Keep the private webhook file outside capture storage.');
  return webhookSchema.parse(
    JSON.parse(await privateFile(policy.webhookFile, workspace, policy.stateDirectory, 16384)),
  );
}
export const recipientHash = (settings: WebhookSettings) =>
  createHash('sha256').update(new URL(settings.url).href).digest('hex');
