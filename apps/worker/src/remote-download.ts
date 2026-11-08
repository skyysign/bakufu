import { randomUUID } from 'node:crypto';
import { isAbsolute, dirname, join } from 'node:path';
import { link, open, realpath, unlink } from 'node:fs/promises';
import { verifyBackup } from '../../../packages/db/src/backup';
import { inside } from './config';
import type { RemoteCopies } from './s3-copy';

export async function downloadRemote(
  remote: RemoteCopies,
  name: string,
  target: string,
  passphrase: string,
  workspace: string,
  captureDirectory: string,
) {
  if (!isAbsolute(target)) throw new Error('Use an absolute recovery path.');
  const parent = await realpath(dirname(target));
  if (inside(await realpath(workspace), parent) || inside(await realpath(captureDirectory), parent))
    throw new Error('Use a recovery directory outside the repository and capture directory.');
  await remote.assertInitialized();
  const archive = await remote.read(name);
  verifyBackup(archive, passphrase);
  const temporary = join(parent, `.pending-${randomUUID()}`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(archive, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, target);
    if (process.platform !== 'win32') {
      const folder = await open(parent, 'r');
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
    }
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}
