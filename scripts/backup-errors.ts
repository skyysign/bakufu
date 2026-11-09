/**
 * A short reason for a failed `pnpm backup` / `pnpm restore`. Only fixed
 * messages and error codes are printed, never raw error text, so connection
 * strings, passphrases and data can't leak into the terminal or logs.
 */
export function backupFailureReason(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  const message = error instanceof Error ? error.message : '';
  if (message === 'Passphrase too short.')
    return 'The passphrase needs at least 16 characters (at most 256).';
  if (message === 'Passphrases did not match.')
    return 'The two passphrases did not match. Run the command again.';
  if (message === 'Cancelled.') return 'Cancelled.';
  if (message.startsWith('Use pnpm backup ')) return message;
  if (message === 'A terminal is required for hidden password entry.')
    return 'Run this in an interactive terminal (for example PowerShell) so you can type the passphrase.';
  if (code === 'EEXIST') return 'That backup file already exists. Choose a new file name.';
  if (['EACCES', 'EPERM', 'EROFS', 'ENOENT', 'EISDIR'].includes(code))
    return 'The backup file could not be written or read. Check that the folder exists and is shared with Docker (the --volume part of the command).';
  if (code === '42P01' || message.startsWith('Unsupported backup schema'))
    return 'The database has no Bakufu tables yet, or its version does not match this image. Set it up or update it with `pnpm db:migrate` using this image first.';
  if (code === '28P01' || code === '28000')
    return 'The database refused the login. Check the user name and password in DATABASE_URL.';
  if (code === '53100')
    return 'The database is full (its storage limit is reached). Free space or raise the limit, then try again.';
  if (code === '53300')
    return 'The database has too many open connections right now. Wait a minute and try again.';
  if (code.startsWith('53'))
    return 'The database refused the work because a resource limit was reached. On Neon this usually means a monthly limit (network transfer or compute) is used up and the database is paused: check Usage on the project Overview page (docs/deployment/vercel-neon.md).';
  if (code === '3D000')
    return 'That database does not exist. Check the database name at the end of DATABASE_URL.';
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(code))
    return 'Could not reach the database. Check the host in DATABASE_URL and your internet connection.';
  if (message === 'Restore requires a fresh, empty database.')
    return 'The restore target is not empty. Restore only into a new, empty database.';
  if (message === 'Backup checksum mismatch.')
    return 'The backup file is damaged (checksum mismatch).';
  if (message.includes('unable to authenticate data'))
    return 'Wrong passphrase, or the backup file is damaged.';
  return `Backup operation failed${code ? ` (code ${code})` : ''}. Check the arguments, passphrase, schema version, file permissions, and that a restore target is empty.`;
}
