import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { backupPolicy } from './config';
import { backupPassphrase, fileDestination } from './destination';
import { restorePolicy } from './restore-config';
import { RestoreControl } from './restore-control';
import { runRestoreCheck } from './restore-check';
import { restoreHealthy } from './restore-status';

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
let control: RestoreControl | undefined;
try {
  const mode = process.argv[2],
    backup = backupPolicy(process.env),
    policy = restorePolicy(process.env),
    workspace = resolve('.');
  if (!['init', 'once', 'serve', 'status'].includes(mode)) throw new Error();
  const destination = await fileDestination(backup, workspace);
  if (mode === 'status') {
    const healthy = restoreHealthy(await destination.restoreStatus());
    console.log(
      healthy
        ? 'Restore check status: healthy.'
        : 'Restore check status: missing, failed, or older than eight days.',
    );
    if (!healthy) process.exitCode = 1;
  } else {
    if (!process.env.RESTORE_CHECK_DATABASE_URL) throw new Error();
    control = new RestoreControl(process.env.RESTORE_CHECK_DATABASE_URL);
    if (mode === 'init') {
      await control.initialize(backup.instanceId);
      console.log('Dedicated restore control initialized. No game database was changed.');
    } else {
      const passphrase = await backupPassphrase(backup, workspace);
      do {
        try {
          const result = await runRestoreCheck(
            control,
            destination,
            backup.instanceId,
            policy,
            passphrase,
            new Date(),
            mode === 'once',
          );
          if (mode === 'once' || result.outcome === 'verified')
            console.log(`Restore check: ${result.outcome} (${result.scheduledWeek}).`);
          if (mode === 'once' && result.outcome === 'busy') process.exitCode = 1;
        } catch {
          console.error(
            'Restore check failed. Check backup freshness/key, the dedicated restore service, permissions, and temporary database cleanup.',
          );
          if (mode === 'once') process.exitCode = 1;
        }
        if (mode !== 'serve') break;
        await delay(60000, undefined, { signal: controller.signal }).catch(() => {});
      } while (!controller.signal.aborted);
    }
  }
} catch {
  console.error(
    'Restore checker could not start. Check the initialized backup destination, private key, policy, and dedicated control URL.',
  );
  process.exitCode = 1;
} finally {
  await control?.close();
}
