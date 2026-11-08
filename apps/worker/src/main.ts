import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { backupPolicy } from './config';
import { backupHealthy, backupPassphrase, fileDestination } from './destination';
import { runBackupJob } from './backups';

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
let db: pg.Pool | undefined;
try {
  const mode = process.argv[2],
    policy = backupPolicy(process.env),
    workspace = resolve('.');
  if (!['init', 'once', 'serve', 'status'].includes(mode))
    throw new Error('Invalid backup command.');
  const destination = await fileDestination(policy, workspace, mode === 'init');
  if (mode === 'init')
    console.log(
      'Backup destination initialized. Keep the passphrase separately and test a fresh restore.',
    );
  else if (mode === 'status') {
    const healthy = backupHealthy(await destination.status());
    console.log(
      healthy
        ? 'Backup status: healthy.'
        : 'Backup status: missing, failed, or older than 36 hours.',
    );
    if (!healthy) process.exitCode = 1;
  } else {
    if (!process.env.DATABASE_URL) throw new Error('Missing database.');
    const passphrase = await backupPassphrase(policy, workspace);
    db = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 10000,
      query_timeout: 125000,
      options: '-c statement_timeout=120000',
    });
    db.on('error', () => {
      console.error('Backup database connection failed.');
    });
    do {
      try {
        const result = await runBackupJob(db, destination, policy, passphrase);
        if (mode === 'once' || result.outcome === 'created')
          console.log(`Backup job: ${result.outcome} (${result.scheduledDate}).`);
        if (mode === 'once' && result.outcome === 'busy') process.exitCode = 1;
      } catch {
        console.error(
          'Backup job failed. Check destination, private passphrase file, database access, and available space.',
        );
        if (mode === 'once') process.exitCode = 1;
      }
      if (mode !== 'serve') break;
      await delay(60000, undefined, { signal: controller.signal }).catch(() => {});
    } while (!controller.signal.aborted);
  }
} catch {
  console.error(
    'Backup worker could not start. Check policy version, absolute private paths, destination initialization, and file permissions.',
  );
  process.exitCode = 1;
} finally {
  await db?.end();
}
