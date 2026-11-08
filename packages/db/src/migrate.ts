import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { transaction, type Database } from './connection';

export async function migrate(db: Database): Promise<void> {
  const directory = new URL('../migrations/', import.meta.url);
  await transaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(73103501)');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = (
        await tx.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name])
      ).rows[0];
      if (previous) {
        if (previous.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
        name,
        checksum,
      ]);
    }
  });
}
