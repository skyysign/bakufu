import { readFile, writeFile } from 'node:fs/promises';
import { createDatabase } from '../packages/db/src/connection';
import { makeBackup, restoreBackup } from '../packages/db/src/backup';
import { promptSecret, promptText } from './prompt';
import { backupFailureReason } from './backup-errors';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first.');
const db = createDatabase(process.env.DATABASE_URL);
try {
  const mode = process.argv[2];
  const path = process.argv[3];
  if (!path || !['backup', 'restore'].includes(mode))
    throw new Error('Use pnpm backup /absolute/off-repo/path.backup or pnpm restore /path.backup.');
  const passphrase = await promptSecret('Backup passphrase (16+ characters, hidden): ');
  if (passphrase.length < 16) throw new Error('Passphrase too short.');
  if (mode === 'backup') {
    if (passphrase !== (await promptSecret('Repeat passphrase: ')))
      throw new Error('Passphrases did not match.');
    await writeFile(path, await makeBackup(db, passphrase), { flag: 'wx', mode: 0o600 });
    console.log('Encrypted backup written. Copy it off-machine and test a restore.');
  } else {
    if ((await promptText('Restore into this empty database? Type RESTORE: ')) !== 'RESTORE')
      throw new Error('Cancelled.');
    await restoreBackup(db, await readFile(path, 'utf8'), passphrase);
    console.log('Restore complete. Previous sessions were not restored; log in again.');
  }
} catch (error) {
  console.error(backupFailureReason(error));
  process.exitCode = 1;
} finally {
  await db.end();
}
