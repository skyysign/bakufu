import { lstat, readFile, realpath } from 'node:fs/promises';
import { inside } from './config';

export async function privateFile(
  path: string,
  workspace: string,
  destination: string,
  maximumBytes: number,
): Promise<string> {
  const file = await realpath(path),
    root = await realpath(destination),
    stat = await lstat(path);
  if (
    inside(await realpath(workspace), file) ||
    inside(root, file) ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > maximumBytes
  )
    throw new Error('Use a separate private file outside the repository and backup destination.');
  if (process.platform !== 'win32' && stat.mode & 0o077)
    throw new Error('Private file permissions must be restricted.');
  const bytes = await readFile(file);
  if (bytes.length > maximumBytes) throw new Error('Private file is too large.');
  return bytes.toString('utf8');
}
