import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  disabledCollectorRanks,
  disabledGemRewards,
  type RealmConfig,
} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { characterOdds } from '../../packages/core/src/index';
import {
  bootstrap,
  buyUpgrade,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  parsePlayerArchive,
  provisionPlayer,
  recycleCard,
  setWishlistEntry,
  addWishlistEntries,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { installLegacySchema, seedLegacyRealm, withoutTradeArchiveFields } from '../support/legacy';
import { startPostgres } from '../support/postgres';
let postgres: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  postgres = await startPostgres();
  db = (await postgres.database('wishlist_test')).db;
  admin = await bootstrap(db, 'wishlist@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await postgres?.stop();
});
async function realm(config: RealmConfig = defaultConfig, single = false) {
  const id = await createRealm(db, admin, 'Wishlist fixture', config);
  if (single)
    await db.query('DELETE FROM characters WHERE realm_id=$1 AND source_key != $2', [
      id,
      'lantern-demo:ro',
    ]);
  const view = await getRealmView(db, admin, id);
  return { id, view, packId: view.packs.find((p) => p.name === 'All Characters')!.id };
}
const change = (r: string, c: string, present = true, key = randomUUID(), actor = admin) =>
  setWishlistEntry(db, actor, r, c, present, key);
const open = (r: { id: string; packId: string }, key = randomUUID(), actor = admin) =>
  openPack(db, actor, r.id, r.packId, key);

describe('private realm wishlists and transactional targeting', () => {
  it('persists one wish on concurrent replay and reports the same weighted odds used by drawing', async () => {
    const r = await realm(),
      character = r.view.catalog.find((c) => c.tier === 'common')!,
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => change(r.id, character.id, true, key)),
    );
    results.forEach((result) => expect(result).toEqual(results[0]));
    expect(results[0]).toMatchObject({ changed: true, present: true, entryCount: 1, slots: 3 });
    const view = await getRealmView(db, admin, r.id),
      pack = view.packs.find((p) => p.id === r.packId)!;
    expect(view.wishlist[0]).toMatchObject({
      id: character.id,
      entryId: results[0].entryId,
      status: 'available',
    });
    expect(pack.wishlistOdds[character.id]).toBeCloseTo(
      characterOdds(view.catalog, view.config, [character.id])[character.id],
    );
    expect(pack.wishlistChance).toBe(pack.wishlistOdds[character.id]);
    expect(pack.odds).toEqual(r.view.packs.find((p) => p.id === r.packId)!.odds);
    expect(view.balance).toBe(100);
    expect(view.progression).toEqual(r.view.progression);
    expect(view.cards).toEqual([]);
    expect(
      (await db.query('SELECT last_opened_at FROM memberships WHERE realm_id=$1', [r.id])).rows[0]
        .last_opened_at,
    ).toBeNull();
  });
  it('adds several picked characters at once, all or nothing, and replays a retry', async () => {
    const r = await realm(),
      characters = r.view.catalog.slice(0, 4).map((character) => character.id),
      requestKey = randomUUID();
    const add = (ids: string[], key = randomUUID(), revision = r.view.configRevision) =>
      addWishlistEntries(db, admin, r.id, {
        characterIds: ids,
        requestKey: key,
        expectedRevision: revision,
      });
    // Three slots: four characters don't fit, and none of them is added.
    await expect(add(characters)).rejects.toMatchObject({ code: 'WISHLIST_FULL' });
    expect((await getRealmView(db, admin, r.id)).wishlist).toEqual([]);
    const result = await add(characters.slice(0, 3), requestKey);
    expect(result.added.map((item) => [item.characterId, item.changed])).toEqual(
      characters.slice(0, 3).map((id) => [id, true]),
    );
    expect(result.entryCount).toBe(3);
    expect((await getRealmView(db, admin, r.id)).wishlist.map((entry) => entry.id).sort()).toEqual(
      characters.slice(0, 3).sort(),
    );
    // Each wish has its own change receipt, like a single change.
    expect(
      (
        await db.query(
          'SELECT count(*)::integer AS count FROM wishlist_changes WHERE realm_id=$1',
          [r.id],
        )
      ).rows[0].count,
    ).toBe(3);
    expect(await add(characters.slice(0, 3), requestKey)).toEqual(result);
    await expect(add([characters[3], characters[0]], requestKey)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(
      add([characters[3]], randomUUID(), r.view.configRevision + 1),
    ).rejects.toMatchObject({
      code: 'SETTINGS_CHANGED',
    });
    for (const invalid of [[], [characters[0], characters[0]], [randomUUID()]])
      await expect(add(invalid)).rejects.toThrow();
  });
  it('serializes the final slot, no-ops repeated adds, and enforces character uniqueness', async () => {
    const r = await realm({ ...defaultConfig, wishlist: { slots: 1, weightMultiplier: 3 } });
    const results = await Promise.allSettled(
      r.view.catalog.slice(0, 3).map((c) => change(r.id, c.id)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected') expect(result.reason.code).toBe('WISHLIST_FULL');
    const entry = (await getRealmView(db, admin, r.id)).wishlist[0];
    expect(await change(r.id, entry.id)).toMatchObject({
      changed: false,
      entryId: entry.entryId,
      entryCount: 1,
    });
    await expect(
      db.query(
        'INSERT INTO wishlist_entries(realm_id,id,account_id,character_id) VALUES($1,$2,$3,$4)',
        [r.id, randomUUID(), admin, entry.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('replays old add/remove receipts without resurrecting or deleting later entries', async () => {
    const r = await realm(),
      id = r.view.catalog[0].id,
      addKey = randomUUID(),
      removeKey = randomUUID();
    const added = await change(r.id, id, true, addKey),
      removed = await change(r.id, id, false, removeKey);
    expect(await change(r.id, id, true, addKey)).toEqual(added);
    expect((await getRealmView(db, admin, r.id)).wishlist).toHaveLength(0);
    const readded = await change(r.id, id);
    expect(readded.entryId).not.toBe(added.entryId);
    expect(await change(r.id, id, false, removeKey)).toEqual(removed);
    expect((await getRealmView(db, admin, r.id)).wishlist[0].entryId).toBe(readded.entryId);
    await expect(change(r.id, id, false, addKey)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await change(r.id, id, false);
    expect(await change(r.id, id, false)).toMatchObject({
      changed: false,
      entryCount: 0,
      entryId: null,
    });
  });
  it('keeps lists private per player/realm and validates membership and realm characters', async () => {
    const a = await realm(),
      b = await realm(),
      id = a.view.catalog[0].id;
    const player = await provisionPlayer(db, a.id, 'private-wishes@example.test', password);
    await change(a.id, id);
    await change(a.id, id, true, randomUUID(), player);
    expect((await getRealmView(db, admin, b.id)).wishlist).toHaveLength(0);
    expect((await exportPlayer(db, player, a.id)).wishlist).toHaveLength(1);
    expect((await getRealmView(db, admin, a.id)).wishlist[0].entryId).not.toBe(
      (await getRealmView(db, player, a.id)).wishlist[0].entryId,
    );
    await expect(change(b.id, id, true, randomUUID(), player)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(change(a.id, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const unique = randomUUID();
    await db.query(
      "INSERT INTO characters(realm_id,id,source_key,name,series,categories,tier,provenance) SELECT $1,$2,'fixture:isolated',name,series,categories,tier,provenance FROM characters WHERE realm_id=$1 LIMIT 1",
      [b.id, unique],
    );
    await expect(change(a.id, unique)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createRealm(db, player, 'Forbidden', {
        ...defaultConfig,
        wishlist: { slots: 20, weightMultiplier: 10 },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('retains wishes for claimed cards, reactivates after recycling, and preserves XP anti-farming', async () => {
    const r = await realm(defaultConfig, true),
      id = r.view.catalog[0].id,
      key = randomUUID();
    await change(r.id, id);
    const first = await open(r, key);
    if (!first.ok) throw new Error('Fixture opening failed.');
    expect(first.wishlistSnapshot).toEqual({ characterIds: [id], weightMultiplier: 2 });
    const claimed = await getRealmView(db, admin, r.id);
    expect(claimed.wishlist[0].status).toBe('yours');
    expect(claimed.packs[0].wishlistChance).toBe(0);
    await recycleCard(db, admin, r.id, first.cardIds[0], randomUUID());
    expect(
      (await getRealmView(db, admin, r.id)).packs.find((pack) => pack.id === r.packId)!
        .wishlistChance,
    ).toBe(1);
    const next = await open(r);
    expect(next).toMatchObject({ ok: true, progression: { xpAwarded: 0, totalXp: 10 } });
    if (!next.ok) throw new Error('Fixture reclaim failed.');
    await recycleCard(db, admin, r.id, next.cardIds[0], randomUUID());
    const other = await provisionPlayer(db, r.id, 'claimed-wish@example.test', password);
    await open(r, randomUUID(), other);
    const unavailable = await getRealmView(db, admin, r.id);
    expect(unavailable.wishlist[0].status).toBe('claimed');
    expect(unavailable.packs[0].wishlistChance).toBe(0);
    await change(r.id, id, false);
    expect(await open(r, key)).toEqual(first);
  });
  it('does not bypass unique ownership in concurrent wished final-card openings', async () => {
    const r = await realm(defaultConfig, true),
      id = r.view.catalog[0].id;
    const other = await provisionPlayer(db, r.id, 'concurrent-wish@example.test', password);
    await change(r.id, id);
    await change(r.id, id, true, randomUUID(), other);
    const results = await Promise.all([open(r), open(r, randomUUID(), other)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      {
        ok: false,
        code: 'EMPTY_POOL',
        message:
          'Not enough unclaimed characters for a complete pack. No gems or cooldown were spent.',
      },
    ]);
    expect(
      (await db.query('SELECT balance FROM memberships WHERE realm_id=$1 ORDER BY balance', [r.id]))
        .rows,
    ).toEqual([{ balance: 90 }, { balance: 100 }]);
  });
  it('rolls back a late preference-write failure and safely retries both add and remove', async () => {
    const r = await realm(),
      id = r.view.catalog[0].id;
    async function failing(present: boolean) {
      const key = randomUUID();
      await db.query(
        "CREATE FUNCTION abort_wish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected wish failure'; END $$",
      );
      await db.query(
        'CREATE TRIGGER abort_wish BEFORE INSERT ON wishlist_changes FOR EACH ROW EXECUTE FUNCTION abort_wish()',
      );
      try {
        await expect(change(r.id, id, present, key)).rejects.toThrow('injected wish failure');
      } finally {
        await db.query('DROP TRIGGER abort_wish ON wishlist_changes');
        await db.query('DROP FUNCTION abort_wish()');
      }
      expect((await getRealmView(db, admin, r.id)).wishlist).toHaveLength(present ? 0 : 1);
      return change(r.id, id, present, key);
    }
    expect(await failing(true)).toMatchObject({ changed: true, entryCount: 1 });
    expect(await failing(false)).toMatchObject({ changed: true, entryCount: 0 });
    expect(
      (await db.query('SELECT 1 FROM wishlist_changes WHERE realm_id=$1', [r.id])).rowCount,
    ).toBe(2);
  });
  it('uses atomic wish snapshots during races and supports disabled/neutral and multi-card rules', async () => {
    const r = await realm({ ...defaultConfig, packSize: 3 }),
      id = r.view.catalog[0].id,
      key = randomUUID();
    const [, result] = await Promise.all([change(r.id, id), open(r, key)]);
    if (!result.ok) throw new Error('Fixture draw failed.');
    expect(result.cardIds).toHaveLength(3);
    expect(new Set(result.characters.map((c) => c.id)).size).toBe(3);
    expect([[], [id]]).toContainEqual(result.wishlistSnapshot?.characterIds);
    await change(r.id, id, false);
    expect(await open(r, key)).toEqual(result);
    const disabled = await realm({ ...defaultConfig, wishlist: { slots: 0, weightMultiplier: 2 } });
    await expect(change(disabled.id, disabled.view.catalog[0].id)).rejects.toMatchObject({
      code: 'WISHLIST_FULL',
    });
    const incomplete = await realm({ ...defaultConfig, packSize: 2 }, true);
    await change(incomplete.id, incomplete.view.catalog[0].id);
    expect(
      (await getRealmView(db, admin, incomplete.id)).packs.find(
        (pack) => pack.id === incomplete.packId,
      )!.wishlistChance,
    ).toBe(0);
    const neutral = await realm({ ...defaultConfig, wishlist: { slots: 1, weightMultiplier: 1 } });
    const target = neutral.view.catalog[0].id;
    await change(neutral.id, target);
    const pack = (await getRealmView(db, admin, neutral.id)).packs.find(
      (p) => p.id === neutral.packId,
    )!;
    expect(pack.wishlistOdds[target]).toBe(
      characterOdds(neutral.view.catalog, neutral.view.config)[target],
    );
  });
  it('round-trips personal entries, rules, snapshots, and stale change receipts through fresh restore', async () => {
    const r = await realm(),
      ids = r.view.catalog.slice(0, 2).map((c) => c.id);
    const previous = withoutTradeArchiveFields(await exportPlayer(db, admin, r.id)),
      { wishlistRules: _rules, ...v4 } = previous;
    expect(_rules).toEqual(defaultConfig.wishlist);
    expect(parsePlayerArchive({ ...v4, schemaVersion: 4 })).toEqual({ ...v4, schemaVersion: 4 });
    const key = randomUUID(),
      old = await change(r.id, ids[0], true, key);
    await change(r.id, ids[0], false);
    await change(r.id, ids[0]);
    await change(r.id, ids[1]);
    await open(r);
    const archive = await exportPlayer(db, admin, r.id);
    expect(archive.schemaVersion).toBe(12);
    expect(archive.wishlist).toHaveLength(2);
    expect(parsePlayerArchive(JSON.parse(JSON.stringify(archive)))).toEqual(archive);
    expect(JSON.stringify(archive)).not.toMatch(/password|token|email/);
    expect(() =>
      parsePlayerArchive({ ...archive, wishlist: [archive.wishlist[0], archive.wishlist[0]] }),
    ).toThrow('Wishlist');
    const passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase);
    const target = (await postgres.database('wishlist_restore')).db;
    try {
      await restoreBackup(target, backup, passphrase);
      const after = await exportPlayer(target, admin, r.id);
      expect({ ...after, exportedAt: archive.exportedAt }).toEqual(archive);
      expect(await setWishlistEntry(target, admin, r.id, ids[0], true, key)).toEqual(old);
      expect(
        (await getRealmView(target, admin, r.id)).wishlist.find((entry) => entry.id === ids[0])!
          .entryId,
      ).not.toBe(old.entryId);
      for (const table of ['wishlist_entries', 'wishlist_changes']) {
        const sql = `SELECT jsonb_agg(to_jsonb(t) ORDER BY realm_id,id) AS data FROM ${table} t`;
        expect((await target.query(sql)).rows).toEqual((await db.query(sql)).rows);
      }
    } finally {
      await target.end();
    }
  });
  it('migrates upgrade-era data and backups with empty lists while preserving purchases and progress', async () => {
    const source = (await postgres.database('before_wishlist', false)).db,
      target = (await postgres.database('legacy_wishlist_restore')).db;
    try {
      await installLegacySchema(source, 5);
      const actor = await bootstrap(source, 'before-wishes@example.test', password),
        old = await seedLegacyRealm(source, actor);
      await source.query('UPDATE memberships SET xp=20 WHERE realm_id=$1', [old.realmId]);
      await source.query(
        "INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version) VALUES($1,$2,$3,'migration_baseline',20,0)",
        [old.realmId, randomUUID(), actor],
      );
      const purchaseKey = randomUUID(),
        purchase = await buyUpgrade(source, actor, old.realmId, 'pack_discount', 1, purchaseKey);
      await source.query(
        "UPDATE upgrade_purchases SET config_snapshot=(config_snapshot-'wishlist')||'{\"schemaVersion\":4}'::jsonb",
      );
      const sql = `SELECT jsonb_build_object('members',(SELECT jsonb_agg(to_jsonb(t)-'trade_code') FROM memberships t),'cards',(SELECT jsonb_agg(to_jsonb(t)-'original_owner_id') FROM cards t),'xp',(SELECT jsonb_agg(to_jsonb(t)-'trade_id' ORDER BY id) FROM xp_ledger t),'purchases',(SELECT jsonb_agg(to_jsonb(t)) FROM upgrade_purchases t),'openings',(SELECT jsonb_agg(to_jsonb(t)) FROM openings t)) AS state`;
      const before = (await source.query(sql)).rows,
        passphrase = randomBytes(24).toString('hex'),
        backup = await makeBackup(source, passphrase);
      const expected = structuredClone(before);
      expected[0].state.openings = expected[0].state.openings.map((receipt: object) => ({
        ...receipt,
        pack_count: 1,
      }));
      await migrate(source);
      await migrate(source);
      expect((await source.query(sql)).rows).toEqual(expected);
      expect(await getRealmView(source, actor, old.realmId)).toMatchObject({
        balance: 80,
        packPrice: 9,
        wishlist: [],
        config: { ...defaultConfig, ranks: disabledCollectorRanks, gemRewards: disabledGemRewards },
      });
      await restoreBackup(target, backup, passphrase);
      expect((await target.query(sql)).rows).toEqual(expected);
      expect((await target.query('SELECT 1 FROM wishlist_entries')).rowCount).toBe(0);
      expect(await buyUpgrade(target, actor, old.realmId, 'pack_discount', 1, purchaseKey)).toEqual(
        purchase,
      );
      expect(await openPack(target, actor, old.realmId, old.packId, old.requestKey)).toEqual(
        old.result,
      );
    } finally {
      await source.end();
      await target.end();
    }
  });
  it('rejects over-capacity or inconsistent wishlist backups and rolls restores back', async () => {
    const r = await realm({ ...defaultConfig, wishlist: { slots: 1, weightMultiplier: 2 } }),
      ids = r.view.catalog.slice(0, 2).map((c) => c.id);
    await change(r.id, ids[0]);
    const extra = randomUUID(),
      passphrase = randomBytes(24).toString('hex');
    await db.query(
      'INSERT INTO wishlist_entries(realm_id,id,account_id,character_id) VALUES($1,$2,$3,$4)',
      [r.id, extra, admin, ids[1]],
    );
    let backup: string;
    try {
      backup = await makeBackup(db, passphrase);
    } finally {
      await db.query('DELETE FROM wishlist_entries WHERE realm_id=$1 AND id=$2', [r.id, extra]);
    }
    const target = (await postgres.database('invalid_wishlist_restore')).db;
    try {
      await expect(restoreBackup(target, backup!, passphrase)).rejects.toThrow(
        'Backup wishlist capacity is invalid.',
      );
      expect((await target.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
      await db.query(
        "UPDATE wishlist_changes SET result=jsonb_set(result,'{characterId}',to_jsonb($2::text)) WHERE realm_id=$1",
        [r.id, ids[1]],
      );
      try {
        backup = await makeBackup(db, passphrase);
      } finally {
        await db.query(
          "UPDATE wishlist_changes SET result=jsonb_set(result,'{characterId}',to_jsonb($2::text)) WHERE realm_id=$1",
          [r.id, ids[0]],
        );
      }
      await expect(restoreBackup(target, backup!, passphrase)).rejects.toThrow(
        'wishlist history is invalid',
      );
      expect((await target.query('SELECT 1 FROM wishlist_entries')).rowCount).toBe(0);
    } finally {
      await target.end();
    }
  });
});
