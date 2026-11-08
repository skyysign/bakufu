import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import type { S3Client } from '@aws-sdk/client-s3';
import { backupPolicy } from './config';
import { backupHealthy, backupPassphrase, fileDestination } from './destination';
import { remotePolicy, remoteFingerprint, storageCredentials } from './remote-config';
import { remoteHealthy } from './remote-status';
import { s3Client, s3Copies } from './s3-copy';
import { runRemoteCopy } from './remote-copy';
import { downloadRemote } from './remote-download';

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
let db: pg.Pool | undefined, client: S3Client | undefined;
try {
  const mode = process.argv[2],
    backup = backupPolicy(process.env),
    policy = remotePolicy(process.env),
    workspace = resolve('.');
  if (!['init', 'once', 'serve', 'status', 'fetch'].includes(mode))
    throw new Error('Invalid remote backup command.');
  const source = await fileDestination(backup, workspace);
  if (mode === 'status') {
    const healthy =
      backupHealthy(await source.status()) &&
      remoteHealthy(await source.remoteStatus(), remoteFingerprint(policy, backup.instanceId));
    console.log(
      healthy
        ? 'Offsite copy status: healthy.'
        : 'Offsite copy status: missing, failed, stale, or configured for another destination.',
    );
    if (!healthy) process.exitCode = 1;
  } else {
    client = s3Client(policy, await storageCredentials(policy, backup, workspace));
    const remote = s3Copies(client, policy, backup.instanceId);
    if (mode === 'init') {
      await remote.initialize();
      console.log(
        'Remote namespace initialized and conditional writes checked. No backup data uploaded.',
      );
    } else {
      const passphrase = await backupPassphrase(backup, workspace);
      if (mode === 'fetch') {
        await downloadRemote(
          remote,
          process.argv[3] ?? '',
          process.argv[4] ?? '',
          passphrase,
          workspace,
          backup.directory,
        );
        console.log(
          'Encrypted recovery file authenticated and written. Restore it only into a fresh database.',
        );
      } else {
        if (!process.env.DATABASE_URL)
          throw new Error('Missing source database for the capture lease.');
        db = new pg.Pool({
          connectionString: process.env.DATABASE_URL,
          max: 1,
          connectionTimeoutMillis: 10000,
          query_timeout: 125000,
          options: '-c statement_timeout=120000',
        });
        db.on('error', () => {});
        do {
          try {
            const result = await runRemoteCopy(
              db,
              source,
              remote,
              policy,
              backup.instanceId,
              passphrase,
              new Date(),
              mode === 'once',
            );
            if (mode === 'once' || result.outcome === 'copied')
              console.log(`Offsite copy: ${result.outcome}.`);
            if (mode === 'once' && result.outcome === 'busy') process.exitCode = 1;
          } catch {
            console.error(
              'Offsite copy failed. Check local capture health, key, remote initialization, storage access, and limits.',
            );
            if (mode === 'once') process.exitCode = 1;
          }
          if (mode !== 'serve') break;
          await delay(300000, undefined, { signal: controller.signal }).catch(() => {});
        } while (!controller.signal.aborted);
      }
    }
  }
} catch {
  console.error(
    'Offsite backup command failed. Check the private configuration, credential/key files, remote namespace, and new recovery path.',
  );
  process.exitCode = 1;
} finally {
  client?.destroy();
  await db?.end();
}
