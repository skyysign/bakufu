import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  disabledCollectorRanks,
  disabledGemRewards,
  parseRealmConfig,
  type RealmConfig,
} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import {
  applyRealmSettings,
  bootstrap,
  buyUpgrade,
  claimGems,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  previewRealmSettings,
  provisionPlayer,
  recycleCard,
  setWishlistEntry,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { installLegacySchema, seedLegacyRealm } from '../support/legacy';
import { startPostgres } from '../support/postgres';
let postgres: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
const unlocked: RealmConfig = {
  ...defaultConfig,
  upgrades: {
    packDiscount: defaultConfig.upgrades.packDiscount.map((rule) => ({
      ...rule,
      requiredLevel: 1,
    })),
  },
};
beforeAll(async () => {
  postgres = await startPostgres();
  db = (await postgres.database('settings_test')).db;
  admin = await bootstrap(db, 'settings@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await postgres?.stop();
});
async function realm(config: RealmConfig = defaultConfig) {
  const id = await createRealm(db, admin, 'Settings fixture', config),
    view = await getRealmView(db, admin, id);
  return { id, view, packId: view.packs.find((p) => p.name === 'All Characters')!.id };
}
const preview = (id: string, config: RealmConfig) => previewRealmSettings(db, admin, id, config);
const apply = (id: string, previewId: string, key = randomUUID()) =>
  applyRealmSettings(db, admin, id, previewId, key);
async function save(id: string, config: RealmConfig) {
  return apply(id, (await preview(id, config)).id);
}
async function open(r: { id: string; packId: string }, key = randomUUID(), revision?: number) {
  return openPack(db, admin, r.id, r.packId, key, revision);
}

describe('reviewed live realm settings', () => {
  it('previews impact without changing gameplay and exposes only aggregate player data', async () => {
    const r = await realm(),
      before = await exportPlayer(db, admin, r.id);
    const result = await preview(r.id, { ...defaultConfig, packPrice: 12, cooldownSeconds: 60 });
    expect(result).toMatchObject({
      revision: 1,
      impact: { players: 1, pricesUp: 1, blockers: [] },
    });
    expect(JSON.stringify(result)).not.toMatch(/accountId|password|email|lastOpenedAt/);
    expect(await getRealmView(db, admin, r.id)).toMatchObject({
      config: defaultConfig,
      configRevision: 1,
      balance: 100,
    });
    const after = await exportPlayer(db, admin, r.id);
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
    expect(
      (await db.query('SELECT 1 FROM realm_config_changes WHERE realm_id=$1', [r.id])).rowCount,
    ).toBe(0);
  });
  it('enforces realm-admin scope on preview and apply, including revoked roles', async () => {
    const a = await realm(),
      b = await realm(),
      player = await provisionPlayer(db, a.id, 'settings-player@example.test', password);
    await expect(
      previewRealmSettings(db, player, a.id, { ...defaultConfig, packPrice: 12 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.query("UPDATE memberships SET role='admin' WHERE realm_id=$1 AND account_id=$2", [
      a.id,
      player,
    ]);
    const own = await previewRealmSettings(db, player, a.id, { ...defaultConfig, packPrice: 12 });
    await expect(
      previewRealmSettings(db, player, b.id, { ...defaultConfig, packPrice: 12 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(apply(a.id, own.id)).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
    const key = randomUUID();
    await applyRealmSettings(db, player, a.id, own.id, key);
    await db.query("UPDATE memberships SET role='player' WHERE realm_id=$1 AND account_id=$2", [
      a.id,
      player,
    ]);
    await expect(applyRealmSettings(db, player, a.id, own.id, key)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('applies future rules while preserving balances, XP, claims and historical receipts', async () => {
    const r = await realm(),
      key = randomUUID(),
      first = await open(r, key);
    await open(r);
    const before = await getRealmView(db, admin, r.id);
    const proposed = {
      ...defaultConfig,
      packPrice: 12,
      startingGems: 15,
      progression: { xpPerNewCharacter: 7, levelThresholds: [0, 30, 60] },
    };
    expect(await save(r.id, proposed)).toMatchObject({ ok: true, revision: 2 });
    const after = await getRealmView(db, admin, r.id);
    expect(after.balance).toBe(before.balance);
    expect(after.cards).toEqual(before.cards);
    expect(after.progression.totalXp).toBe(20);
    expect(after.progression.level).toBe(1);
    expect(await open(r, key, 1)).toEqual(first);
    expect(await open(r, randomUUID(), 2)).toMatchObject({
      ok: true,
      charged: 12,
      progression: { totalXp: 27, xpAwarded: 7 },
    });
    const other = await provisionPlayer(db, r.id, 'new-grant@example.test', password);
    expect((await getRealmView(db, other, r.id)).balance).toBe(15);
  });
  it('deduplicates concurrent saves and replays receipts after expiry and later changes', async () => {
    const r = await realm(),
      p = await preview(r.id, { ...defaultConfig, packPrice: 12 }),
      key = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => apply(r.id, p.id, key)));
    results.forEach((result) => expect(result).toEqual(results[0]));
    expect(
      (await db.query('SELECT 1 FROM realm_config_changes WHERE realm_id=$1', [r.id])).rowCount,
    ).toBe(1);
    await db.query(
      "UPDATE realm_config_previews SET expires_at=now()-interval '1 second' WHERE realm_id=$1",
      [r.id],
    );
    expect(await apply(r.id, p.id, key)).toEqual(results[0]);
    const next = await preview(r.id, { ...defaultConfig, packPrice: 13 });
    await expect(apply(r.id, next.id, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await apply(r.id, next.id);
    expect(await apply(r.id, p.id, key)).toEqual(results[0]);
    expect((await getRealmView(db, admin, r.id)).configRevision).toBe(3);
  });
  it('rejects competing admin previews and repeated preview commits under new keys', async () => {
    const r = await realm(),
      a = await preview(r.id, { ...defaultConfig, packPrice: 11 }),
      b = await preview(r.id, { ...defaultConfig, packPrice: 12 });
    const results = await Promise.allSettled([apply(r.id, a.id), apply(r.id, b.id)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected') expect(result.reason.code).toBe('PREVIEW_STALE');
    const used = (
      await db.query('SELECT preview_id FROM realm_config_changes WHERE realm_id=$1', [r.id])
    ).rows[0].preview_id;
    await expect(apply(r.id, used)).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
  });
  it('invalidates previews after opening, recycling, purchases, gem claims, wishlist changes and new memberships', async () => {
    for (const operation of ['open', 'recycle', 'upgrade', 'gems', 'wishlist', 'membership']) {
      const r = await realm(unlocked);
      let cardId: string | undefined;
      if (operation === 'recycle') {
        const result = await open(r);
        if (!result.ok) throw new Error('Fixture draw failed.');
        cardId = result.cardIds[0];
      }
      const p = await preview(r.id, { ...unlocked, packPrice: 15 });
      if (operation === 'open') await open(r);
      if (operation === 'recycle') await recycleCard(db, admin, r.id, cardId!, randomUUID());
      if (operation === 'upgrade')
        await buyUpgrade(db, admin, r.id, 'pack_discount', 1, randomUUID());
      if (operation === 'gems') await claimGems(db, admin, r.id, randomUUID());
      if (operation === 'wishlist')
        await setWishlistEntry(db, admin, r.id, r.view.catalog[0].id, true, randomUUID());
      if (operation === 'membership')
        await provisionPlayer(db, r.id, 'joined-during-preview@example.test', password);
      await expect(apply(r.id, p.id)).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
      expect(await getRealmView(db, admin, r.id)).toMatchObject({
        configRevision: 1,
        config: unlocked,
      });
    }
  });
  it('blocks wishlist truncation and purchased rank edits but permits safe future rank changes', async () => {
    const r = await realm(unlocked);
    await setWishlistEntry(db, admin, r.id, r.view.catalog[0].id, true, randomUUID());
    await setWishlistEntry(db, admin, r.id, r.view.catalog[1].id, true, randomUUID());
    const reduced = { ...unlocked, wishlist: { slots: 1, weightMultiplier: 2 } },
      blocked = await preview(r.id, reduced);
    expect(blocked.impact.blockers.join()).toContain('2 wishes');
    await expect(apply(r.id, blocked.id)).rejects.toMatchObject({ code: 'SETTINGS_BLOCKED' });
    await setWishlistEntry(db, admin, r.id, r.view.catalog[1].id, false, randomUUID());
    await save(r.id, reduced);
    await buyUpgrade(db, admin, r.id, 'pack_discount', 1, randomUUID());
    const invalid = {
      ...reduced,
      upgrades: {
        packDiscount: [
          { ...unlocked.upgrades.packDiscount[0], cost: 11 },
          unlocked.upgrades.packDiscount[1],
        ],
      },
    };
    const p = await preview(r.id, invalid);
    expect(p.impact.blockers.join()).toContain('already purchased');
    await expect(apply(r.id, p.id)).rejects.toMatchObject({ code: 'SETTINGS_BLOCKED' });
    const safe = {
      ...reduced,
      upgrades: {
        packDiscount: [
          unlocked.upgrades.packDiscount[0],
          { ...unlocked.upgrades.packDiscount[1], cost: 15 },
        ],
      },
    };
    await save(r.id, safe);
    expect((await exportPlayer(db, admin, r.id)).upgrades[0].charged).toBe(10);
  });
  it('rejects invalid schemas, ownership changes, generation edits and unchanged drafts', async () => {
    const r = await realm();
    await expect(
      previewRealmSettings(db, admin, r.id, { ...defaultConfig, ownership: 'casual' }),
    ).rejects.toThrow();
    await expect(
      previewRealmSettings(db, admin, r.id, { ...defaultConfig, packPrice: -1 }),
    ).rejects.toThrow();
    for (const draft of [defaultConfig, { ...defaultConfig, maximumCategoryPacks: 1 }]) {
      const p = await preview(r.id, draft);
      await expect(apply(r.id, p.id)).rejects.toMatchObject({ code: 'SETTINGS_BLOCKED' });
    }
    expect((await getRealmView(db, admin, r.id)).packs.map((pack) => pack.id)).toEqual(
      r.view.packs.map((pack) => pack.id),
    );
  });
  it('requires fresh displayed revisions for new gameplay commands while replaying old receipts', async () => {
    const r = await realm(unlocked),
      key = randomUUID(),
      original = await open(r, key, 1);
    if (!original.ok) throw new Error('Fixture draw failed.');
    await save(r.id, {
      ...unlocked,
      packPrice: 50,
      recycleRewards: { ...defaultConfig.recycleRewards, common: 3, uncommon: 5, rare: 7 },
    });
    const before = await getRealmView(db, admin, r.id);
    await expect(open(r, randomUUID(), 1)).rejects.toMatchObject({ code: 'SETTINGS_CHANGED' });
    await expect(open(r, randomUUID(), 0)).rejects.toMatchObject({ code: 'SETTINGS_CHANGED' });
    await expect(
      recycleCard(db, admin, r.id, original.cardIds[0], randomUUID(), 1),
    ).rejects.toMatchObject({ code: 'SETTINGS_CHANGED' });
    await expect(
      buyUpgrade(db, admin, r.id, 'pack_discount', 1, randomUUID(), 1),
    ).rejects.toMatchObject({ code: 'SETTINGS_CHANGED' });
    await expect(
      setWishlistEntry(db, admin, r.id, r.view.catalog[0].id, true, randomUUID(), 1),
    ).rejects.toMatchObject({ code: 'SETTINGS_CHANGED' });
    expect(await open(r, key, 1)).toEqual(original);
    expect((await getRealmView(db, admin, r.id)).balance).toBe(before.balance);
    expect(await open(r, randomUUID(), 2)).toMatchObject({ ok: true, charged: 50 });
  });
  it('expires old previews and rolls a late apply failure back for an identical retry', async () => {
    const r = await realm(),
      p = await preview(r.id, { ...defaultConfig, packPrice: 12 });
    await db.query(
      "UPDATE realm_config_previews SET expires_at=now()-interval '1 second' WHERE id=$1",
      [p.id],
    );
    await expect(apply(r.id, p.id)).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
    const valid = await preview(r.id, { ...defaultConfig, packPrice: 12 }),
      key = randomUUID();
    await db.query(
      "CREATE FUNCTION abort_settings() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected settings failure'; END $$",
    );
    await db.query(
      'CREATE TRIGGER abort_settings BEFORE INSERT ON realm_config_changes FOR EACH ROW EXECUTE FUNCTION abort_settings()',
    );
    try {
      await expect(apply(r.id, valid.id, key)).rejects.toThrow('injected settings failure');
    } finally {
      await db.query('DROP TRIGGER abort_settings ON realm_config_changes');
      await db.query('DROP FUNCTION abort_settings()');
    }
    expect(await getRealmView(db, admin, r.id)).toMatchObject({
      configRevision: 1,
      config: defaultConfig,
    });
    expect(await apply(r.id, valid.id, key)).toMatchObject({ revision: 2 });
  });
  it('serializes apply against a stale player opening so no unexpected price is charged', async () => {
    const r = await realm(),
      p = await preview(r.id, { ...defaultConfig, packPrice: 12 });
    const results = await Promise.allSettled([apply(r.id, p.id), open(r, randomUUID(), 1)]);
    const view = await getRealmView(db, admin, r.id);
    if (results[0].status === 'fulfilled') {
      expect(results[1].status).toBe('rejected');
      expect(view).toMatchObject({ balance: 100, configRevision: 2 });
    } else {
      expect(results[1].status).toBe('fulfilled');
      expect(view).toMatchObject({ balance: 90, configRevision: 1 });
      expect(results[0].reason.code).toBe('PREVIEW_STALE');
    }
  });
  it('exports and restores revised rules and complete audit history with permanent purchases intact', async () => {
    const r = await realm();
    await open(r);
    await open(r);
    await buyUpgrade(db, admin, r.id, 'pack_discount', 1, randomUUID());
    await setWishlistEntry(db, admin, r.id, r.view.catalog[0].id, true, randomUUID());
    const rules = {
      ...defaultConfig,
      packPrice: 13,
      wishlist: { slots: 2, weightMultiplier: 3 },
      progression: { xpPerNewCharacter: 7, levelThresholds: [0, 30, 60] },
      upgrades: {
        packDiscount: [
          defaultConfig.upgrades.packDiscount[0],
          { ...defaultConfig.upgrades.packDiscount[1], cost: 15 },
        ],
      },
    };
    const p = await preview(r.id, rules),
      key = randomUUID(),
      result = await apply(r.id, p.id, key);
    const archive = await exportPlayer(db, admin, r.id);
    expect(archive).toMatchObject({
      schemaVersion: 12,
      xp: 20,
      progression: { level: 1 },
      basePackPrice: 13,
    });
    expect(archive.upgrades[0].charged).toBe(10);
    const passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase),
      target = (await postgres.database('settings_restore')).db;
    try {
      await restoreBackup(target, backup, passphrase);
      expect(await getRealmView(target, admin, r.id)).toMatchObject({
        configRevision: 2,
        packPrice: 12,
        upgrade: { rank: 1 },
      });
      const restored = await exportPlayer(target, admin, r.id);
      expect({ ...restored, exportedAt: archive.exportedAt }).toEqual(archive);
      expect((await target.query('SELECT 1 FROM realm_config_previews')).rowCount).toBe(0);
      expect(await applyRealmSettings(target, admin, r.id, p.id, key)).toEqual(result);
      const sql =
        'SELECT jsonb_agg(to_jsonb(c) ORDER BY realm_id,id) AS data FROM realm_config_changes c';
      expect((await target.query(sql)).rows).toEqual((await db.query(sql)).rows);
    } finally {
      await target.end();
    }
  });
  it('migrates wishlist-era databases/backups without modifying previous progress or rules', async () => {
    const source = (await postgres.database('before_settings', false)).db,
      target = (await postgres.database('old_settings_restore')).db;
    try {
      await installLegacySchema(source, 6);
      const actor = await bootstrap(source, 'before-settings@example.test', password),
        old = await seedLegacyRealm(source, actor);
      await setWishlistEntry(source, actor, old.realmId, old.character.id, true, randomUUID());
      const sql = `SELECT jsonb_build_object('realms',(SELECT jsonb_agg((to_jsonb(t)-'config_revision'-'config')||jsonb_build_object('config',t.config)) FROM realms t),'members',(SELECT jsonb_agg(to_jsonb(t)-'trade_code') FROM memberships t),'cards',(SELECT jsonb_agg(to_jsonb(t)-'original_owner_id') FROM cards t),'wishes',(SELECT jsonb_agg(to_jsonb(t)) FROM wishlist_entries t),'receipts',(SELECT jsonb_agg(to_jsonb(t)) FROM openings t)) AS state`;
      const before = (await source.query(sql)).rows,
        passphrase = randomBytes(24).toString('hex'),
        backup = await makeBackup(source, passphrase);
      const expected = structuredClone(before);
      for (const realm of expected[0].state.realms) realm.config = parseRealmConfig(realm.config);
      expected[0].state.receipts = expected[0].state.receipts.map((receipt: object) => ({
        ...receipt,
        pack_count: 1,
      }));
      await migrate(source);
      await migrate(source);
      expect((await source.query(sql)).rows).toEqual(expected);
      await restoreBackup(target, backup, passphrase);
      expect((await target.query(sql)).rows).toEqual(expected);
      expect(await getRealmView(target, actor, old.realmId)).toMatchObject({
        configRevision: 1,
        config: { ...defaultConfig, ranks: disabledCollectorRanks, gemRewards: disabledGemRewards },
        balance: 90,
      });
      expect((await target.query('SELECT 1 FROM realm_config_changes')).rowCount).toBe(0);
    } finally {
      await source.end();
      await target.end();
    }
  });
  it('rejects mismatched current rules or a broken audit chain and leaves restore targets empty', async () => {
    const r = await realm();
    await save(r.id, { ...defaultConfig, packPrice: 12 });
    await save(r.id, { ...defaultConfig, packPrice: 13 });
    const target = (await postgres.database('invalid_settings_restore')).db,
      passphrase = randomBytes(24).toString('hex');
    let backup: string;
    try {
      await db.query("UPDATE realms SET config=jsonb_set(config,'{packPrice}','14') WHERE id=$1", [
        r.id,
      ]);
      try {
        backup = await makeBackup(db, passphrase);
      } finally {
        await db.query(
          "UPDATE realms SET config=jsonb_set(config,'{packPrice}','13') WHERE id=$1",
          [r.id],
        );
      }
      await expect(restoreBackup(target, backup!, passphrase)).rejects.toThrow(
        'settings history does not reconcile',
      );
      expect((await target.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
      await db.query(
        "UPDATE realm_config_changes SET before_config=jsonb_set(before_config,'{packPrice}','999') WHERE realm_id=$1 AND to_revision=3",
        [r.id],
      );
      try {
        backup = await makeBackup(db, passphrase);
      } finally {
        await db.query(
          "UPDATE realm_config_changes SET before_config=jsonb_set(before_config,'{packPrice}','12') WHERE realm_id=$1 AND to_revision=3",
          [r.id],
        );
      }
      await expect(restoreBackup(target, backup!, passphrase)).rejects.toThrow(
        'settings history does not reconcile',
      );
      expect((await target.query('SELECT 1 FROM realm_config_changes')).rowCount).toBe(0);
    } finally {
      await target.end();
    }
  });
});
