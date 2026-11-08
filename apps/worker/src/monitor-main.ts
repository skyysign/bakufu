import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { backupPolicy } from './config';
import { monitorPolicy, recipientHash, webhookSettings } from './monitor-config';
import { monitorStore, type MonitorStore } from './monitor-store';
import { readBackupChecks, runMonitor, webhookSender } from './monitor';

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
let store: MonitorStore | undefined;
try {
  const mode = process.argv[2],
    workspace = resolve('.');
  if (!['init', 'once', 'serve', 'status'].includes(mode)) throw new Error('Invalid command.');
  const backup = backupPolicy({ ...process.env, BACKUP_PASSPHRASE_FILE: resolve('unused-key') }),
    policy = monitorPolicy(process.env);
  if (mode === 'status') {
    store = await monitorStore(
      policy.stateDirectory,
      workspace,
      backup.directory,
      backup.instanceId,
      undefined,
      false,
      true,
    );
    const healthy = store.healthy(new Date());
    console.log(
      healthy ? 'Alert monitor: healthy.' : 'Alert monitor: stale observation or pending delivery.',
    );
    if (!healthy) process.exitCode = 1;
  } else {
    const settings = await webhookSettings(policy, backup, workspace);
    store = await monitorStore(
      policy.stateDirectory,
      workspace,
      backup.directory,
      backup.instanceId,
      recipientHash(settings),
      mode === 'init',
    );
    if (mode === 'init') console.log('Alert monitor initialized. No notification sent.');
    else
      do {
        try {
          const result = await runMonitor(
            store,
            await readBackupChecks(backup, policy, workspace),
            webhookSender(settings),
          );
          if (mode === 'once' || result.delivered || result.pending)
            console.log(
              result.pending
                ? 'Alert monitor: delivery pending.'
                : 'Alert monitor: observation complete.',
            );
          if (mode === 'once' && result.pending) process.exitCode = 1;
        } catch {
          console.error('Alert monitor could not record or deliver its observation.');
          if (mode === 'once') process.exitCode = 1;
        }
        if (mode !== 'serve') break;
        await delay(60000, undefined, { signal: controller.signal }).catch(() => {});
      } while (!controller.signal.aborted);
  }
} catch {
  console.error(
    'Alert monitor could not start. Check Node 22.13+, policy, initialized private state, and receiver file.',
  );
  process.exitCode = 1;
} finally {
  store?.close();
}
