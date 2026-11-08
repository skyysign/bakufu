import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../packages/db/src/connection';
import { createReadinessDatabase, databaseReady } from '../../packages/db/src/health';
import { migrationNames } from '../../packages/db/src/schema-version';
import { healthResponse } from '../../apps/web/lib/health';
import { startPostgres, freePort } from '../support/postgres';
import { installLegacySchema } from '../support/legacy';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, health: Database, url: string;
const shared = globalThis as typeof globalThis & { cardEngineHealthDb?: Database };
beforeAll(async () => {
  server = await startPostgres();
  ({ db, url } = await server.database('health_fixture'));
  health = createReadinessDatabase(url);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await shared.cardEngineHealthDb?.end();
  delete shared.cardEngineHealthDb;
  await health?.end();
  await db?.end();
  await server?.stop();
});
describe('anonymous bounded deployment health', () => {
  it('keeps the shared release manifest synchronized with real SQL migrations', async () => {
    const names = (await readdir(new URL('../../packages/db/migrations/', import.meta.url)))
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(names).toEqual([...migrationNames]);
  });
  it('reports an empty fully migrated instance ready without requiring bootstrap or reading players', async () => {
    expect(await databaseReady(health)).toBe(true);
    expect((await db.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM memberships')).rowCount).toBe(0);
  });
  it('rejects missing, older, or unexpected migration names and recovers after repair', async () => {
    const fresh = (await server.database('health_empty', false)).db,
      old = (await server.database('health_old', false)).db;
    try {
      expect(await databaseReady(fresh)).toBe(false);
      await installLegacySchema(old, 10);
      expect(await databaseReady(old)).toBe(false);
    } finally {
      await fresh.end();
      await old.end();
    }
    await db.query(
      "INSERT INTO schema_migrations(name,checksum) VALUES('9999_fixture.sql','fixture')",
    );
    try {
      expect(await databaseReady(health)).toBe(false);
    } finally {
      await db.query("DELETE FROM schema_migrations WHERE name='9999_fixture.sql'");
    }
    expect(await databaseReady(health)).toBe(true);
  });
  it('fails closed for a database role without schema read permission', async () => {
    const password = randomBytes(24).toString('hex');
    await db.query(`CREATE ROLE health_fixture_reader LOGIN PASSWORD '${password}'`);
    const target = new URL(url);
    target.username = 'health_fixture_reader';
    target.password = password;
    const restricted = createReadinessDatabase(target.href);
    try {
      expect(await databaseReady(restricted)).toBe(false);
    } finally {
      await restricted.end();
      await db.query('DROP ROLE health_fixture_reader');
    }
  });
  it('bounds a blocked migration-table query and recovers on the next probe', async () => {
    const locker = await db.connect();
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE');
    const start = Date.now();
    try {
      expect(await databaseReady(health)).toBe(false);
      expect(Date.now() - start).toBeLessThan(1800);
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
    expect(await databaseReady(health)).toBe(true);
  });
  it('shares one pending query for concurrent probes instead of filling a queue', async () => {
    const held = await health.connect(),
      checks = Array.from({ length: 50 }, () => databaseReady(health));
    try {
      await delay(20);
      expect(health.waitingCount).toBe(1);
    } finally {
      held.release();
    }
    expect(await Promise.all(checks)).toEqual(Array(50).fill(true));
    expect(health.waitingCount).toBe(0);
  });
  it('returns false promptly for an unavailable database without leaking its URL', async () => {
    const target = new URL(url);
    target.port = String(await freePort());
    const unavailable = createReadinessDatabase(target.href),
      start = Date.now();
    try {
      expect(await databaseReady(unavailable)).toBe(false);
      expect(Date.now() - start).toBeLessThan(1800);
    } finally {
      await unavailable.end();
    }
  });
  it('keeps liveness independent and HTTP responses minimal, uncached, and anonymous', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const live = await healthResponse('live'),
      notReady = await healthResponse('ready');
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ ok: true });
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({ ok: false });
    expect(notReady.headers.get('Cache-Control')).toContain('no-store');
    vi.stubEnv('DATABASE_URL', url);
    const ready = await healthResponse('ready');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true });
    expect((await healthResponse('other')).status).toBe(404);
  });
});
