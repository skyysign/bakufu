import pg from 'pg';
export type Database = pg.Pool;
export type Transaction = pg.PoolClient;
const discordPools = new WeakSet<Database>();

export function createDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 10000 });
  pool.on('error', () => {
    // PostgreSQL restarts invalidate idle clients. The pool removes them; query
    // failures still reach their caller. Never log connection strings or values.
  });
  return pool;
}

// Short synchronous Discord responses: PostgreSQL cancels slow work before the
// initial response deadline. Web and operator pools keep their existing limits.
export function createDiscordDatabase(connectionString: string): Database {
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 400,
    query_timeout: 1800,
    options: '-c lock_timeout=500 -c statement_timeout=1000 -c transaction_timeout=1500',
  });
  pool.on('error', () => {
    /* Pool removes failed idle clients; never log connection details. */
  });
  discordPools.add(pool);
  return pool;
}

export async function transaction<T>(
  db: Database,
  action: (tx: Transaction) => Promise<T>,
  repeatableRead = false,
): Promise<T> {
  const tx = await db.connect();
  let discard = false;
  let released = false;
  // Also bound a stalled network connection: server-side timeouts alone cannot
  // deliver an error over a broken connection. Destroying it preserves atomicity;
  // an uncertain commit is recovered using the same opening receipt key.
  const deadline = discordPools.has(db)
    ? setTimeout(() => {
        released = true;
        discard = true;
        tx.release(true);
      }, 1700)
    : undefined;
  try {
    await tx.query(repeatableRead ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    const value = await action(tx);
    await tx.query('COMMIT');
    return value;
  } catch (error) {
    if (!released)
      try {
        await tx.query('ROLLBACK');
      } catch {
        discard = true;
      }
    throw error;
  } finally {
    if (deadline) clearTimeout(deadline);
    if (!released) tx.release(discard);
  }
}
