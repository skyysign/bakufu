import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import {
  authenticate,
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  login,
  openPack,
  parsePlayerArchive,
  provisionPlayer,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>;
let db: Database;
let admin: string;
const password = randomBytes(24).toString('hex');
const email = 'operator@example.test';
async function realm(config = defaultConfig) {
  const id = await createRealm(db, admin, 'Test realm', config);
  const view = await getRealmView(db, admin, id);
  return { id, packs: view.packs, pack: view.packs.find((p) => p.name === 'All Characters')! };
}

beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('game_test')).db;
  admin = await bootstrap(db, email, password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

describe('real PostgreSQL transactional game services', () => {
  it('applies migrations twice, guards bootstrap, hashes sessions, and enforces membership/RBAC', async () => {
    await migrate(db);
    await expect(bootstrap(db, 'second@example.test', password)).rejects.toMatchObject({
      code: 'ALREADY_BOOTSTRAPPED',
    });
    const r = await realm();
    const player = await provisionPlayer(db, r.id, 'player@example.test', password);
    expect(await provisionPlayer(db, r.id, 'player@example.test', password)).toBe(player);
    expect(
      (
        await db.query('SELECT balance FROM memberships WHERE realm_id=$1 AND account_id=$2', [
          r.id,
          player,
        ])
      ).rows[0].balance,
    ).toBe(100);
    expect(
      (
        await db.query('SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND account_id=$2', [
          r.id,
          player,
        ])
      ).rowCount,
    ).toBe(1);
    await expect(createRealm(db, player, 'Unauthorized', defaultConfig)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(openPack(db, randomUUID(), r.id, r.pack.id, randomUUID())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(exportPlayer(db, randomUUID(), r.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const token = await login(db, email, password);
    expect((await authenticate(db, token))?.id).toBe(admin);
    expect(
      (await db.query('SELECT token_hash FROM sessions')).rows.map((r) => r.token_hash),
    ).not.toContain(token);
    expect(
      (await db.query('SELECT password_hash FROM accounts WHERE id=$1', [admin])).rows[0]
        .password_hash,
    ).not.toContain(password);
  });
  it('allows exactly one of two players to claim the final character', async () => {
    const r = await realm();
    const player = await provisionPlayer(db, r.id, 'racer@example.test', password);
    await db.query(
      'DELETE FROM characters WHERE realm_id=$1 AND id != (SELECT min(id::text)::uuid FROM characters WHERE realm_id=$1)',
      [r.id],
    );
    const results = await Promise.all([
      openPack(db, admin, r.id, r.pack.id, randomUUID()),
      openPack(db, player, r.id, r.pack.id, randomUUID()),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.find((x) => !x.ok)).toMatchObject({ code: 'EMPTY_POOL' });
    expect(
      (await db.query('SELECT count(*)::int AS n FROM cards WHERE realm_id=$1', [r.id])).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM wallet_ledger WHERE realm_id=$1 AND reason='pack_opening'",
          [r.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await db.query('SELECT sum(balance)::int AS n FROM memberships WHERE realm_id=$1', [r.id]))
        .rows[0].n,
    ).toBe(190);
  });
  it('replays simultaneous retries with one debit and rejects key reuse for a different pack', async () => {
    const r = await realm(),
      request = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => openPack(db, admin, r.id, r.pack.id, request)),
    );
    results.forEach((result) => expect(result).toEqual(results[0]));
    expect((await getRealmView(db, admin, r.id)).balance).toBe(90);
    expect((await getRealmView(db, admin, r.id)).cards).toHaveLength(1);
    await expect(openPack(db, admin, r.id, r.packs[0].id, request)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
  it('does not overspend when two independent requests use the final ten gems', async () => {
    const r = await realm({ ...defaultConfig, startingGems: 10 });
    const results = await Promise.all([
      openPack(db, admin, r.id, r.pack.id, randomUUID()),
      openPack(db, admin, r.id, r.pack.id, randomUUID()),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.find((x) => !x.ok)).toMatchObject({ code: 'INSUFFICIENT_GEMS' });
    expect((await getRealmView(db, admin, r.id)).balance).toBe(0);
  });
  it('claims the same stable character independently in two realms', async () => {
    const a = await realm(),
      b = await realm();
    for (const id of [a.id, b.id])
      await db.query('DELETE FROM characters WHERE realm_id=$1 AND source_key != $2', [
        id,
        'lantern-demo:ro',
      ]);
    await Promise.all([
      openPack(db, admin, a.id, a.pack.id, randomUUID()),
      openPack(db, admin, b.id, b.pack.id, randomUUID()),
    ]);
    const one = await getRealmView(db, admin, a.id),
      two = await getRealmView(db, admin, b.id);
    expect(one.cards[0].id).toBe(two.cards[0].id);
    expect(one.cards[0].cardId).not.toBe(two.cards[0].cardId);
  });
  it('persists empty failures without debit/cooldown and rejects unavailable full pack size', async () => {
    const r = await realm({ ...defaultConfig, packSize: 2, cooldownSeconds: 60 });
    await db.query('DELETE FROM characters WHERE realm_id=$1 AND source_key != $2', [
      r.id,
      'lantern-demo:ro',
    ]);
    const request = randomUUID(),
      result = await openPack(db, admin, r.id, r.pack.id, request);
    expect(result).toMatchObject({ ok: false, code: 'EMPTY_POOL' });
    expect(await openPack(db, admin, r.id, r.pack.id, request)).toEqual(result);
    const member = (
      await db.query('SELECT balance,last_opened_at FROM memberships WHERE realm_id=$1', [r.id])
    ).rows[0];
    expect(member).toEqual({ balance: 100, last_opened_at: null });
  });
  it('enforces configured cooldown without another debit', async () => {
    const r = await realm({ ...defaultConfig, cooldownSeconds: 60 });
    expect((await openPack(db, admin, r.id, r.pack.id, randomUUID())).ok).toBe(true);
    expect(await openPack(db, admin, r.id, r.pack.id, randomUUID())).toMatchObject({
      code: 'COOLDOWN',
    });
    expect((await getRealmView(db, admin, r.id)).balance).toBe(90);
  });
  it('rolls an interrupted opening back and safely retries it', async () => {
    const r = await realm(),
      request = randomUUID();
    await db.query(
      `CREATE FUNCTION test_abort_opening() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected rollback'; END $$`,
    );
    await db.query(
      "CREATE TRIGGER test_abort BEFORE INSERT ON wallet_ledger FOR EACH ROW WHEN (NEW.reason = 'pack_opening') EXECUTE FUNCTION test_abort_opening()",
    );
    try {
      await expect(openPack(db, admin, r.id, r.pack.id, request)).rejects.toThrow(
        'injected rollback',
      );
    } finally {
      await db.query('DROP TRIGGER test_abort ON wallet_ledger');
      await db.query('DROP FUNCTION test_abort_opening()');
    }
    const view = await getRealmView(db, admin, r.id);
    expect(view.balance).toBe(100);
    expect(view.cards).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM openings WHERE realm_id=$1', [r.id])).rowCount).toBe(0);
    expect((await openPack(db, admin, r.id, r.pack.id, request)).ok).toBe(true);
    expect((await getRealmView(db, admin, r.id)).balance).toBe(90);
  });
  it('enforces uniqueness and cross-realm foreign keys directly in PostgreSQL', async () => {
    const a = await realm(),
      b = await realm();
    await openPack(db, admin, a.id, a.pack.id, randomUUID());
    const c = (await db.query('SELECT * FROM cards WHERE realm_id=$1', [a.id])).rows[0];
    await expect(
      db.query(
        'INSERT INTO cards(realm_id,id,character_id,owner_id,request_key,acquired_at) SELECT realm_id,$1,character_id,owner_id,request_key,acquired_at FROM cards WHERE id=$2',
        [randomUUID(), c.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.query(
        'INSERT INTO cards(realm_id,id,character_id,owner_id,request_key) VALUES($1,$2,$3,$4,$5)',
        [b.id, randomUUID(), c.character_id, admin, c.request_key],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('round trips a private player archive and encrypted full recovery into a fresh database', async () => {
    const r = await realm(),
      requestKey = randomUUID();
    const receipt = await openPack(db, admin, r.id, r.pack.id, requestKey);
    const archive = await exportPlayer(db, admin, r.id);
    expect(parsePlayerArchive(JSON.parse(JSON.stringify(archive)))).toEqual(archive);
    expect(JSON.stringify(archive)).not.toMatch(/password|token|email|example\.test/);
    const passphrase = randomBytes(24).toString('hex');
    const backup = await makeBackup(db, passphrase);
    expect(backup).not.toContain(email);
    expect(backup).not.toContain('password_hash');
    const fresh = (await server.database('restored_test')).db;
    try {
      await expect(restoreBackup(fresh, backup, 'wrong-passphrase-value')).rejects.toThrow();
      const tampered = JSON.parse(backup);
      tampered.sha256 = '0'.repeat(64);
      await expect(restoreBackup(fresh, JSON.stringify(tampered), passphrase)).rejects.toThrow(
        'checksum',
      );
      await restoreBackup(fresh, backup, passphrase);
      expect(await openPack(fresh, admin, r.id, r.pack.id, requestKey)).toEqual(receipt);
      const restored = await exportPlayer(fresh, admin, r.id);
      expect({ ...restored, exportedAt: archive.exportedAt }).toEqual(archive);
      for (const table of [
        'accounts',
        'realms',
        'memberships',
        'characters',
        'packs',
        'openings',
        'cards',
        'recyclings',
        'wallet_ledger',
      ]) {
        const query = `SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t`;
        expect((await fresh.query(query)).rows).toEqual((await db.query(query)).rows);
      }
      expect((await fresh.query('SELECT 1 FROM sessions')).rowCount).toBe(0);
      expect((await authenticate(fresh, await login(fresh, email, password)))?.id).toBe(admin);
      await expect(restoreBackup(fresh, backup, passphrase)).rejects.toThrow('fresh, empty');
    } finally {
      await fresh.end();
    }
  });
  it('rejects an inconsistent ledger snapshot and rolls the entire restore back', async () => {
    const r = await realm();
    const passphrase = randomBytes(24).toString('hex');
    // Simulate operator-level source corruption, outside the gameplay services.
    await db.query('UPDATE memberships SET balance=balance+1 WHERE realm_id=$1 AND account_id=$2', [
      r.id,
      admin,
    ]);
    let backup: string;
    try {
      backup = await makeBackup(db, passphrase);
    } finally {
      await db.query(
        'UPDATE memberships SET balance=balance-1 WHERE realm_id=$1 AND account_id=$2',
        [r.id, admin],
      );
    }
    const fresh = (await server.database('invalid_ledger_test')).db;
    try {
      await expect(restoreBackup(fresh, backup!, passphrase)).rejects.toThrow('does not reconcile');
      expect((await fresh.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
      expect((await fresh.query('SELECT 1 FROM cards')).rowCount).toBe(0);
    } finally {
      await fresh.end();
    }
  });
});
