import { chmod, copyFile, lstat, mkdtemp } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

// Compose mounts the source read-only. Docker Desktop's synthetic Linux modes
// cannot express Windows ACLs; stage the key privately on the dedicated tmpfs.
try {
  const verification = process.argv[2]?.startsWith('verify-');
  const remote = process.argv[2]?.startsWith('remote-');
  const monitoring = process.argv[2]?.startsWith('monitor-');
  if (verification) process.argv[2] = process.argv[2].slice('verify-'.length);
  if (remote) process.argv[2] = process.argv[2].slice('remote-'.length);
  if (monitoring) process.argv[2] = process.argv[2].slice('monitor-'.length);
  async function stage(source: string, maximum: number) {
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error();
    const directory = await mkdtemp('/run/backup-key/worker-'),
      target = join(directory, 'secret');
    await chmod(directory, 0o700);
    await copyFile(source, target, constants.COPYFILE_EXCL);
    await chmod(target, 0o600);
    return target;
  }
  if (!monitoring && ['once', 'serve', 'fetch'].includes(process.argv[2]))
    process.env.BACKUP_PASSPHRASE_FILE = await stage('/run/secrets/backup_passphrase', 1026);
  if (remote && process.argv[2] !== 'status')
    process.env.BACKUP_S3_CREDENTIALS_FILE = await stage(
      '/run/secrets/backup_s3_credentials',
      32768,
    );
  if (monitoring && process.argv[2] !== 'status')
    process.env.BACKUP_ALERT_WEBHOOK_FILE = await stage(
      '/run/secrets/backup_alert_receiver',
      16384,
    );
  if (monitoring) await import('./monitor-main');
  else if (remote) await import('./remote-main');
  else if (verification) await import('./restore-main');
  else await import('./main');
} catch {
  console.error(
    'Backup container could not prepare its private key. Check the read-only secret mount and private tmpfs.',
  );
  process.exitCode = 1;
}
