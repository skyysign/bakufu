import { z } from 'zod';
import { backupHealthy, fileDestination } from './destination';
import { restoreHealthy } from './restore-status';
import { remoteHealthy } from './remote-status';
import type { BackupPolicy } from './config';
import {
  checkName,
  checkState,
  type Checks,
  type MonitorPolicy,
  type WebhookSettings,
} from './monitor-config';
import type { MonitorStore } from './monitor-store';

export const alertEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  monitorId: z.uuid(),
  sequence: z.number().int().positive(),
  type: z.enum(['backup.failure', 'backup.recovered']),
  observedAt: z.iso.datetime(),
  checks: z.partialRecord(checkName, checkState),
});
export type AlertEvent = z.infer<typeof alertEventSchema>;
export async function readBackupChecks(
  backup: BackupPolicy,
  policy: MonitorPolicy,
  workspace: string,
  now = new Date(),
): Promise<Checks> {
  const result: Checks = {};
  try {
    const source = await fileDestination(backup, workspace);
    for (const check of policy.checks) {
      try {
        const status =
          check === 'capture'
            ? await source.status()
            : check === 'restore'
              ? await source.restoreStatus()
              : await source.remoteStatus();
        if (!status) result[check] = 'missing';
        else if (status.outcome === 'failed') result[check] = 'failed';
        else {
          const healthy =
            check === 'capture'
              ? backupHealthy(status as Awaited<ReturnType<typeof source.status>>, now)
              : check === 'restore'
                ? restoreHealthy(status as Awaited<ReturnType<typeof source.restoreStatus>>, now)
                : remoteHealthy(
                    status as Awaited<ReturnType<typeof source.remoteStatus>>,
                    (status as { destinationHash: string }).destinationHash,
                    now,
                  );
          result[check] = healthy ? 'healthy' : 'stale';
        }
      } catch {
        result[check] = 'unavailable';
      }
    }
  } catch {
    for (const check of policy.checks) result[check] = 'unavailable';
  }
  return result;
}
export function webhookSender(settings: WebhookSettings, fetcher: typeof fetch = fetch) {
  return async (event: AlertEvent) => {
    const response = await fetcher(settings.url, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': event.id,
        ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
      },
      body: JSON.stringify(alertEventSchema.parse(event)),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Alert delivery failed.');
  };
}
export async function runMonitor(
  store: MonitorStore,
  checks: Checks,
  send: (event: AlertEvent) => Promise<void>,
  now = new Date(),
) {
  store.observe(checks, now);
  const claim = store.claim(now);
  if (!claim) return { delivered: false, pending: store.pending() };
  try {
    await send(claim.event);
    store.acknowledge(claim.event.id, claim.token, new Date());
    return { delivered: true, pending: store.pending() };
  } catch {
    store.release(claim.event.id, claim.token);
    return { delivered: false, pending: store.pending() };
  }
}
