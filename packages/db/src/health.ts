import pg from 'pg';
import type { Database } from './connection';
import { migrationNames } from './schema-version';

export function createReadinessDatabase(connectionString: string): Database {
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 500,
    query_timeout: 1000,
    options: '-c statement_timeout=500 -c lock_timeout=250',
  });
  pool.on('error', () => {});
  return pool;
}
const pending = new WeakMap<Database, Promise<boolean>>();
export function databaseReady(db: Database): Promise<boolean> {
  const active = pending.get(db);
  if (active) return active;
  const check = (async () => {
    try {
      const rows = (await db.query('SELECT name FROM schema_migrations ORDER BY name')).rows;
      return (
        rows.length === migrationNames.length &&
        rows.every((row, index) => row.name === migrationNames[index])
      );
    } catch {
      return false;
    }
  })();
  pending.set(db, check);
  void check.finally(() => {
    pending.delete(db);
  });
  return check;
}
