import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  disabledCollectorRanks,
  disabledGemRewards,
  type RealmConfig,
} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import {
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  parsePlayerArchive,
  provisionPlayer,
  recycleCard,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { startPostgres } from '../support/postgres';
import { installLegacySchema, seedLegacyRealm } from '../support/legacy';

let postgres: Awaited<ReturnType<typeof startPostgres>>;
let db: Database;
let admin: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  postgres = await startPostgres();
  db = (await postgres.database('progression_test')).db;
  admin = await bootstrap(db, 'progression@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await postgres?.stop();
});
async function realm(config: RealmConfig = defaultConfig, single = false) {
  const id = await createRealm(db, admin, 'Progression realm', config);
  const packId = (await getRealmView(db, admin, id)).packs.find(
    (p) => p.name === 'All Characters',
  )!.id;
  if (single)
    await db.query('DELETE FROM characters WHERE realm_id=$1 AND source_key != $2', [
      id,
      'lantern-demo:ro',
    ]);
  return { id, packId };
}
async function claim(r: { id: string; packId: string }, actor = admin, key = randomUUID()) {
  const result = await openPack(db, actor, r.id, r.packId, key);
  if (!result.ok || !result.progression) throw new Error('Fixture opening failed.');
  return result;
}
async function retire(r: { id: string }, cardId: string, actor = admin) {
  return recycleCard(db, actor, r.id, cardId, randomUUID());
}

describe('transactional XP and first-collection protection', () => {
  it('awards XP once on success and replays concurrent retries without extra XP', async () => {
    const r = await realm(),
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => openPack(db, admin, r.id, r.packId, key)),
    );
    results.forEach((result) => expect(result).toEqual(results[0]));
    expect(results[0]).toMatchObject({
      ok: true,
      progression: { xpAwarded: 10, totalXp: 10, level: 1 },
    });
    const view = await getRealmView(db, admin, r.id);
    expect(view.balance).toBe(90);
    expect(view.progression).toMatchObject({ totalXp: 10, xpToNextLevel: 10 });
    expect((await db.query('SELECT 1 FROM xp_ledger WHERE realm_id=$1', [r.id])).rowCount).toBe(1);
    const entry = (await db.query('SELECT * FROM xp_ledger WHERE realm_id=$1', [r.id])).rows[0];
    await expect(
      db.query(
        'INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version,character_id,card_id,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          r.id,
          randomUUID(),
          admin,
          entry.reason,
          entry.amount,
          entry.policy_version,
          entry.character_id,
          entry.card_id,
          entry.request_key,
        ],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('does not award XP for recycling or re-claiming the same character', async () => {
    const r = await realm(defaultConfig, true);
    const first = await claim(r);
    await retire(r, first.cardIds[0]);
    expect((await getRealmView(db, admin, r.id)).progression.totalXp).toBe(10);
    const second = await claim(r);
    expect(second.characters[0].id).toBe(first.characters[0].id);
    expect(second.cardIds[0]).not.toBe(first.cardIds[0]);
    expect(second.progression).toMatchObject({ xpAwarded: 0, totalXp: 10 });
    await retire(r, second.cardIds[0]);
    const player = await provisionPlayer(db, r.id, 'another-collector@example.test', password);
    expect((await claim(r, player)).progression).toMatchObject({ xpAwarded: 10, totalXp: 10 });
    expect((await db.query('SELECT 1 FROM xp_ledger WHERE realm_id=$1', [r.id])).rowCount).toBe(2);
  });
  it('serializes independent openings and supports multi-card, multi-level awards', async () => {
    const r = await realm();
    await Promise.all([claim(r), claim(r)]);
    expect((await getRealmView(db, admin, r.id)).progression).toMatchObject({
      totalXp: 20,
      level: 2,
    });
    const custom = await realm({
      ...defaultConfig,
      packSize: 3,
      progression: { xpPerNewCharacter: 7, levelThresholds: [0, 7, 21] },
    });
    expect((await claim(custom)).progression).toMatchObject({
      xpAwarded: 21,
      totalXp: 21,
      level: 3,
      nextLevelAt: null,
    });
    expect((await getRealmView(db, admin, custom.id)).cards).toHaveLength(3);
  });
  it('keeps XP independent between realms and rejects nonmember writes', async () => {
    const a = await realm(defaultConfig, true),
      b = await realm(defaultConfig, true);
    await claim(a);
    await claim(b);
    expect((await getRealmView(db, admin, a.id)).progression.totalXp).toBe(10);
    expect((await getRealmView(db, admin, b.id)).progression.totalXp).toBe(10);
    await expect(openPack(db, randomUUID(), a.id, a.packId, randomUUID())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const player = await provisionPlayer(db, a.id, 'xp-player@example.test', password);
    await expect(
      createRealm(db, player, 'Forbidden', {
        ...defaultConfig,
        progression: { xpPerNewCharacter: 999, levelThresholds: [0] },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('awards nothing for empty, cooldown, and insufficient-funds failures', async () => {
    const poor = await realm({ ...defaultConfig, startingGems: 0 });
    expect(await openPack(db, admin, poor.id, poor.packId, randomUUID())).toMatchObject({
      code: 'INSUFFICIENT_GEMS',
    });
    expect((await getRealmView(db, admin, poor.id)).progression.totalXp).toBe(0);
    const cooldown = await realm({ ...defaultConfig, cooldownSeconds: 60 });
    await claim(cooldown);
    expect(await openPack(db, admin, cooldown.id, cooldown.packId, randomUUID())).toMatchObject({
      code: 'COOLDOWN',
    });
    expect((await getRealmView(db, admin, cooldown.id)).progression.totalXp).toBe(10);
    const empty = await realm(defaultConfig, true);
    await claim(empty);
    expect(await openPack(db, admin, empty.id, empty.packId, randomUUID())).toMatchObject({
      code: 'EMPTY_POOL',
    });
    expect((await db.query('SELECT 1 FROM xp_ledger WHERE realm_id=$1', [empty.id])).rowCount).toBe(
      1,
    );
  });
  it('records zero-XP first collections so policy changes cannot reward repeat claims', async () => {
    const r = await realm(
      { ...defaultConfig, progression: { xpPerNewCharacter: 0, levelThresholds: [0] } },
      true,
    );
    const first = await claim(r);
    expect(first.progression?.xpAwarded).toBe(0);
    await retire(r, first.cardIds[0]);
    // Operator-level fixture change; live configuration editing remains out of scope.
    await db.query(
      "UPDATE realms SET config=jsonb_set(config,'{progression,xpPerNewCharacter}','999') WHERE id=$1",
      [r.id],
    );
    expect((await claim(r)).progression).toMatchObject({ xpAwarded: 0, totalXp: 0, level: 1 });
    expect((await db.query('SELECT amount FROM xp_ledger WHERE realm_id=$1', [r.id])).rows).toEqual(
      [{ amount: 0 }],
    );
  });
  it('rolls XP, first-collection flags, card claims, and gems back on a late failure', async () => {
    const r = await realm(),
      key = randomUUID();
    await db.query(
      "CREATE FUNCTION test_abort_xp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected XP rollback'; END $$",
    );
    await db.query(
      "CREATE TRIGGER test_abort_xp BEFORE INSERT ON wallet_ledger FOR EACH ROW WHEN (NEW.reason='pack_opening') EXECUTE FUNCTION test_abort_xp()",
    );
    try {
      await expect(openPack(db, admin, r.id, r.packId, key)).rejects.toThrow(
        'injected XP rollback',
      );
    } finally {
      await db.query('DROP TRIGGER test_abort_xp ON wallet_ledger');
      await db.query('DROP FUNCTION test_abort_xp()');
    }
    expect(await getRealmView(db, admin, r.id)).toMatchObject({
      balance: 100,
      cards: [],
      progression: { totalXp: 0 },
    });
    expect((await db.query('SELECT 1 FROM xp_ledger WHERE realm_id=$1', [r.id])).rowCount).toBe(0);
    expect((await claim(r, admin, key)).progression).toMatchObject({ totalXp: 10, xpAwarded: 10 });
  });
  it('rejects XP overflow without claiming, charging, or consuming cooldown', async () => {
    const r = await realm();
    await db.query('UPDATE memberships SET xp=2147483647 WHERE realm_id=$1 AND account_id=$2', [
      r.id,
      admin,
    ]);
    await db.query(
      "INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version) VALUES($1,$2,$3,'migration_baseline',2147483647,0)",
      [r.id, randomUUID(), admin],
    );
    await expect(openPack(db, admin, r.id, r.packId, randomUUID())).rejects.toMatchObject({
      code: 'XP_LIMIT',
    });
    expect(await getRealmView(db, admin, r.id)).toMatchObject({
      balance: 100,
      cards: [],
      progression: { totalXp: 2147483647 },
    });
    expect(
      (await db.query('SELECT last_opened_at FROM memberships WHERE realm_id=$1', [r.id])).rows[0]
        .last_opened_at,
    ).toBeNull();
  });
  it('preserves legacy XP and remembers active/retired cards during migration and old-backup restore', async () => {
    const source = (await postgres.database('xp_legacy', false)).db;
    const restored = (await postgres.database('xp_legacy_restore')).db;
    try {
      await installLegacySchema(source, 3);
      const actor = await bootstrap(source, 'legacy-xp@example.test', password);
      const old = await seedLegacyRealm(source, actor);
      await recycleCard(source, actor, old.realmId, old.cardId, randomUUID());
      const secondKey = randomUUID(),
        secondCard = randomUUID();
      const secondOpening = {
        ...old.result,
        openingId: randomUUID(),
        cardIds: [secondCard],
        balance: 82,
      };
      const oldSettings = (
        await source.query('SELECT config FROM realms WHERE id=$1', [old.realmId])
      ).rows[0].config;
      await source.query(
        'INSERT INTO openings(realm_id,account_id,request_key,id,pack_id,result,config_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          old.realmId,
          actor,
          secondKey,
          secondOpening.openingId,
          old.packId,
          secondOpening,
          oldSettings,
        ],
      );
      await source.query(
        'INSERT INTO cards(realm_id,id,character_id,owner_id,request_key) VALUES($1,$2,$3,$4,$5)',
        [old.realmId, secondCard, old.character.id, actor, secondKey],
      );
      await source.query('UPDATE memberships SET balance=82 WHERE realm_id=$1', [old.realmId]);
      await source.query(
        "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason) VALUES($1,$2,$3,$4,-10,82,'pack_opening')",
        [old.realmId, randomUUID(), actor, secondKey],
      );
      await source.query('UPDATE memberships SET xp=17 WHERE realm_id=$1', [old.realmId]);
      const passphrase = randomBytes(24).toString('hex'),
        backup = await makeBackup(source, passphrase);
      const before = (
        await source.query(
          "SELECT jsonb_agg(to_jsonb(c)-'original_owner_id' ORDER BY id) AS data FROM cards c",
        )
      ).rows;
      await migrate(source);
      await migrate(source);
      expect(
        (
          await source.query(
            "SELECT jsonb_agg(to_jsonb(c)-'original_owner_id' ORDER BY id) AS data FROM cards c",
          )
        ).rows,
      ).toEqual(before);
      expect(await getRealmView(source, actor, old.realmId)).toMatchObject({
        balance: 82,
        progression: { totalXp: 17 },
        config: { ...defaultConfig, ranks: disabledCollectorRanks, gemRewards: disabledGemRewards },
      });
      expect(
        (await source.query('SELECT reason,amount FROM xp_ledger ORDER BY reason')).rows,
      ).toEqual([
        { reason: 'first_collection', amount: 0 },
        { reason: 'migration_baseline', amount: 17 },
      ]);
      await restoreBackup(restored, backup, passphrase);
      await recycleCard(restored, actor, old.realmId, secondCard, randomUUID());
      const reclaim = await openPack(restored, actor, old.realmId, old.packId, randomUUID());
      expect(reclaim).toMatchObject({ ok: true, progression: { xpAwarded: 0, totalXp: 17 } });
      expect(await openPack(restored, actor, old.realmId, old.packId, old.requestKey)).toEqual(
        old.result,
      );
    } finally {
      await source.end();
      await restored.end();
    }
  });
  it('exports and restores auditable XP, levels, and immutable opening receipts', async () => {
    const r = await realm(),
      first = await claim(r);
    await retire(r, first.cardIds[0]);
    await claim(r);
    const exported = await exportPlayer(db, admin, r.id);
    expect(exported.schemaVersion).toBe(12);
    expect(exported.xp).toBe(exported.xpLedger.reduce((sum, entry) => sum + entry.amount, 0));
    expect(parsePlayerArchive(JSON.parse(JSON.stringify(exported)))).toEqual(exported);
    expect(JSON.stringify(exported)).not.toMatch(/password|token|email|account_identities/);
    const passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase);
    const copy = (await postgres.database('xp_restore')).db;
    try {
      await restoreBackup(copy, backup, passphrase);
      const archive = await exportPlayer(copy, admin, r.id);
      expect({ ...archive, exportedAt: exported.exportedAt }).toEqual(exported);
      const query = 'SELECT jsonb_agg(to_jsonb(x) ORDER BY realm_id,id) AS data FROM xp_ledger x';
      expect((await copy.query(query)).rows).toEqual((await db.query(query)).rows);
      const previous = (
        await db.query('SELECT request_key FROM openings WHERE id=$1', [first.openingId])
      ).rows[0].request_key;
      expect(await openPack(copy, admin, r.id, r.packId, previous)).toEqual(first);
    } finally {
      await copy.end();
    }
    expect(() => parsePlayerArchive({ ...exported, xp: exported.xp + 1 })).toThrow('XP ledger');
    expect(() =>
      parsePlayerArchive({ ...exported, progression: { ...exported.progression, level: 99 } }),
    ).toThrow('Level does not match');
  });
  it('rejects corrupted XP totals and rolls an attempted restore back', async () => {
    const r = await realm();
    await claim(r);
    await db.query('UPDATE memberships SET xp=xp+1 WHERE realm_id=$1', [r.id]);
    const passphrase = randomBytes(24).toString('hex');
    let backup: string;
    try {
      backup = await makeBackup(db, passphrase);
    } finally {
      await db.query('UPDATE memberships SET xp=xp-1 WHERE realm_id=$1', [r.id]);
    }
    const target = (await postgres.database('invalid_xp_restore')).db;
    try {
      await expect(restoreBackup(target, backup!, passphrase)).rejects.toThrow(
        'XP history does not reconcile',
      );
      expect((await target.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    } finally {
      await target.end();
    }
  });
});
