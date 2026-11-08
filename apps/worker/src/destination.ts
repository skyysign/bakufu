import { randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { inside, type BackupPolicy } from './config';
import { restoreStatusSchema, type RestoreStatusDestination } from './restore-status';
import { remoteStatusSchema, type RemoteStatusDestination } from './remote-status';

export const backupName = /^(daily|weekly)-\d{4}-\d{2}-\d{2}\.backup$/;
export const backupStatusSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(['success', 'failed']),
  lastAttemptAt: z.iso.datetime(),
  lastSuccessAt: z.iso.datetime().nullable(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dailyRetained: z.number().int().nonnegative(),
  weeklyRetained: z.number().int().nonnegative(),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;
// Other destination adapters must provide exclusive atomic publication and exact-name removal.
export interface BackupDestination {
  list(): Promise<string[]>;
  read(name: string): Promise<string | null>;
  publish(name: string, encrypted: string): Promise<boolean>;
  remove(name: string): Promise<void>;
  status(): Promise<BackupStatus | null>;
  writeStatus(status: BackupStatus): Promise<void>;
}
export async function fileDestination(
  policy: BackupPolicy,
  workspace: string,
  initialize = false,
): Promise<BackupDestination & RestoreStatusDestination & RemoteStatusDestination> {
  const root = await realpath(policy.directory);
  if (inside(await realpath(workspace), root) || !(await lstat(root)).isDirectory())
    throw new Error('Use a private destination outside the repository.');
  const directory = join(root, `card-engine-${policy.instanceId}`),
    marker = JSON.stringify({ schemaVersion: 1, instanceId: policy.instanceId });
  if (initialize)
    await mkdir(directory, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
  if ((await lstat(directory)).isSymbolicLink() || !(await lstat(directory)).isDirectory())
    throw new Error('Invalid backup directory.');
  const path = (name: string) => {
    if (
      !backupName.test(name) &&
      !['status.json', 'restore-status.json', 'remote-status.json', '.destination.json'].includes(
        name,
      )
    )
      throw new Error('Invalid backup name.');
    return join(directory, name);
  };
  async function read(name: string): Promise<string | null> {
    try {
      const stat = await lstat(path(name));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid backup file.');
      return await readFile(path(name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async function atomic(name: string, content: string, replace = false) {
    const temporary = join(directory, `.pending-${randomUUID()}`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      if (replace) await rename(temporary, path(name));
      else await link(temporary, path(name));
      return true;
    } catch (error) {
      if (!replace && (error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    } finally {
      await unlink(temporary).catch(() => {});
      if (process.platform !== 'win32') {
        const folder = await open(directory, 'r');
        try {
          await folder.sync();
        } finally {
          await folder.close();
        }
      }
    }
  }
  if (initialize) await atomic('.destination.json', marker);
  if ((await read('.destination.json')) !== marker)
    throw new Error('Initialize the intended backup destination first.');
  return {
    async list() {
      const names = (await readdir(directory)).filter((name) => backupName.test(name));
      for (const name of names)
        if (!(await lstat(path(name))).isFile()) throw new Error('Invalid backup file.');
      return names.sort();
    },
    read,
    publish: (name, content) => {
      if (!backupName.test(name)) throw new Error('Invalid backup name.');
      return atomic(name, content);
    },
    async remove(name) {
      if (!backupName.test(name)) throw new Error('Invalid backup name.');
      const stat = await lstat(path(name));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid backup file.');
      await unlink(path(name));
    },
    async status() {
      const content = await read('status.json');
      return content === null ? null : backupStatusSchema.parse(JSON.parse(content));
    },
    async writeStatus(status) {
      await atomic('status.json', JSON.stringify(backupStatusSchema.parse(status)), true);
    },
    async restoreStatus() {
      const content = await read('restore-status.json');
      return content === null ? null : restoreStatusSchema.parse(JSON.parse(content));
    },
    async writeRestoreStatus(status) {
      await atomic('restore-status.json', JSON.stringify(restoreStatusSchema.parse(status)), true);
    },
    async remoteStatus() {
      const content = await read('remote-status.json');
      return content === null ? null : remoteStatusSchema.parse(JSON.parse(content));
    },
    async writeRemoteStatus(status) {
      await atomic('remote-status.json', JSON.stringify(remoteStatusSchema.parse(status)), true);
    },
  };
}
export async function backupPassphrase(policy: BackupPolicy, workspace: string): Promise<string> {
  const file = await realpath(policy.passphraseFile),
    destination = await realpath(policy.directory),
    stat = await lstat(policy.passphraseFile);
  if (
    inside(await realpath(workspace), file) ||
    inside(destination, file) ||
    !stat.isFile() ||
    stat.isSymbolicLink()
  )
    throw new Error(
      'Use a separate private passphrase file outside the repository and backup destination.',
    );
  if (process.platform !== 'win32' && stat.mode & 0o077)
    throw new Error('Passphrase file permissions must be private.');
  return z
    .string()
    .min(16)
    .max(256)
    .parse((await readFile(file, 'utf8')).replace(/\r?\n$/, ''));
}
export function backupHealthy(status: BackupStatus | null, now = new Date()): boolean {
  if (!status || status.outcome !== 'success' || !status.lastSuccessAt) return false;
  const age = now.getTime() - new Date(status.lastSuccessAt).getTime();
  return age >= -300000 && age <= 36 * 60 * 60 * 1000;
}
