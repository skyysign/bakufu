import { createReadinessDatabase, databaseReady } from '../../../packages/db/src/health';
import type { Database } from '../../../packages/db/src/connection';

const shared = globalThis as typeof globalThis & { cardEngineHealthDb?: Database };
export async function healthResponse(check: string): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (check === 'live') return Response.json({ ok: true }, { headers });
  if (check !== 'ready')
    return Response.json({ error: 'Route not found.' }, { status: 404, headers });
  let ready = false;
  try {
    if (process.env.DATABASE_URL) {
      const pool = (shared.cardEngineHealthDb ??= createReadinessDatabase(
        process.env.DATABASE_URL,
      ));
      ready = await databaseReady(pool);
    }
  } catch {
    /* Health never exposes connection details. */
  }
  return Response.json({ ok: ready }, { status: ready ? 200 : 503, headers });
}
