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
  buyUpgrade,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  parsePlayerArchive,
  provisionPlayer,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { startPostgres } from '../support/postgres';
import { installLegacySchema, seedLegacyRealm, withoutTradeArchiveFields } from '../support/legacy';

let postgres: Awaited<ReturnType<typeof startPostgres>>;
let db: Database;
let admin: string;
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
  db = (await postgres.database('upgrades_test')).db;
  admin = await bootstrap(db, 'upgrades@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await postgres?.stop();
});
async function realm(config: RealmConfig = defaultConfig) {
  const id = await createRealm(db, admin, 'Upgrade fixture', config);
  const packId = (await getRealmView(db, admin, id)).packs.find(
    (pack) => pack.name === 'All Characters',
  )!.id;
  return { id, packId };
}
const buy = (id: string, rank = 1, key = randomUUID(), actor = admin) =>
  buyUpgrade(db, actor, id, 'pack_discount', rank, key);
const open = (r: { id: string; packId: string }, key = randomUUID()) =>
  openPack(db, admin, r.id, r.packId, key);

describe('transactional upgrade purchases and effective pack prices', () => {
  it('requires earned levels and changes only the buyer wallet and future prices', async () => {
    const r = await realm();
    await expect(buy(r.id)).rejects.toMatchObject({ code: 'LEVEL_REQUIRED' });
    expect(await getRealmView(db, admin, r.id)).toMatchObject({
      balance: 100,
      packPrice: 10,
      upgrade: { rank: 0 },
    });
    await open(r);
    await open(r);
    const before = await getRealmView(db, admin, r.id);
    const cooldown = (
      await db.query('SELECT last_opened_at FROM memberships WHERE realm_id=$1', [r.id])
    ).rows;
    const receipt = await buy(r.id);
    expect(receipt).toMatchObject({ rank: 1, charged: 10, balance: 70, packPrice: 9, level: 2 });
    const after = await getRealmView(db, admin, r.id);
    expect(after.progression).toEqual(before.progression);
    expect(after.cards).toEqual(before.cards);
    expect(
      (await db.query('SELECT last_opened_at FROM memberships WHERE realm_id=$1', [r.id])).rows,
    ).toEqual(cooldown);
    const player = await provisionPlayer(db, r.id, 'unupgraded-player@example.test', password);
    expect((await getRealmView(db, player, r.id)).packPrice).toBe(10);
    expect(await open(r)).toMatchObject({ ok: true, charged: 9, balance: 61, packUpgradeRank: 1 });
  });
  it('deduplicates concurrent same-key purchases and enforces unique rank ownership in PostgreSQL', async () => {
    const r = await realm(unlocked),
      key = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => buy(r.id, 1, key)));
    results.forEach((result) => expect(result).toEqual(results[0]));
    expect(await getRealmView(db, admin, r.id)).toMatchObject({
      balance: 90,
      upgrade: { rank: 1 },
    });
    expect(
      (
        await db.query(
          "SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND reason='upgrade_purchase'",
          [r.id],
        )
      ).rowCount,
    ).toBe(1);
    const row = (await db.query('SELECT * FROM upgrade_purchases WHERE realm_id=$1', [r.id]))
      .rows[0];
    await expect(
      db.query(
        'INSERT INTO upgrade_purchases(realm_id,id,account_id,request_key,upgrade_id,rank,result,config_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          r.id,
          randomUUID(),
          admin,
          randomUUID(),
          row.upgrade_id,
          row.rank,
          row.result,
          row.config_snapshot,
        ],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('does not auto-buy the next rank for competing keys and retains old receipts after further purchases', async () => {
    const r = await realm(unlocked),
      key = randomUUID();
    const results = await Promise.allSettled([
      buy(r.id, 1, key),
      ...Array.from({ length: 5 }, () => buy(r.id)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getRealmView(db, admin, r.id)).upgrade.rank).toBe(1);
    for (const result of results)
      if (result.status === 'rejected') expect(result.reason.code).toBe('UPGRADE_CONFLICT');
    const first = (
      await db.query('SELECT request_key,result FROM upgrade_purchases WHERE realm_id=$1', [r.id])
    ).rows[0];
    await expect(buy(r.id, 2, first.request_key)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(await buy(r.id, 2)).toMatchObject({ rank: 2, charged: 20, balance: 70, packPrice: 8 });
    expect(await buy(r.id, 1, first.request_key)).toEqual(first.result);
    await expect(buy(r.id, 2)).rejects.toMatchObject({ code: 'UPGRADE_MAXED' });
    expect((await getRealmView(db, admin, r.id)).balance).toBe(70);
  });
  it('serializes a purchase against opening with the final gems', async () => {
    const r = await realm({ ...unlocked, startingGems: 10 });
    await Promise.allSettled([buy(r.id), open(r)]);
    const view = await getRealmView(db, admin, r.id);
    expect(view.balance).toBe(0);
    expect(view.cards.length + view.upgrade.rank).toBe(1);
    expect(
      (
        await db.query(
          "SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND reason IN ('upgrade_purchase','pack_opening')",
          [r.id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it('rolls rank, receipt, wallet, and ledger back on a late failure and permits a safe retry', async () => {
    const r = await realm(unlocked),
      key = randomUUID();
    await db.query(
      "CREATE FUNCTION abort_upgrade() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected purchase failure'; END $$",
    );
    await db.query(
      "CREATE TRIGGER abort_upgrade BEFORE INSERT ON wallet_ledger FOR EACH ROW WHEN (NEW.reason='upgrade_purchase') EXECUTE FUNCTION abort_upgrade()",
    );
    try {
      await expect(buy(r.id, 1, key)).rejects.toThrow('injected purchase failure');
    } finally {
      await db.query('DROP TRIGGER abort_upgrade ON wallet_ledger');
      await db.query('DROP FUNCTION abort_upgrade()');
    }
    expect(await getRealmView(db, admin, r.id)).toMatchObject({
      balance: 100,
      upgrade: { rank: 0 },
      progression: { totalXp: 0 },
    });
    expect(
      (await db.query('SELECT 1 FROM upgrade_purchases WHERE realm_id=$1', [r.id])).rowCount,
    ).toBe(0);
    expect(await buy(r.id, 1, key)).toMatchObject({ rank: 1, balance: 90 });
  });
  it('keeps upgrades realm/player scoped and rejects nonmember writes and insufficient funds', async () => {
    const a = await realm(unlocked),
      b = await realm(unlocked);
    await buy(a.id);
    expect((await getRealmView(db, admin, b.id)).upgrade.rank).toBe(0);
    const player = await provisionPlayer(db, a.id, 'upgrade-buyer@example.test', password);
    await expect(buy(b.id, 1, randomUUID(), player)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await buy(a.id, 1, randomUUID(), player)).toMatchObject({ rank: 1, balance: 90 });
    const poor = await realm({ ...unlocked, startingGems: 9 });
    await expect(buy(poor.id)).rejects.toMatchObject({ code: 'INSUFFICIENT_GEMS' });
    expect(await getRealmView(db, admin, poor.id)).toMatchObject({
      balance: 9,
      upgrade: { rank: 0 },
    });
    await expect(createRealm(db, player, 'Forbidden', unlocked)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('supports disabled upgrades, zero-cost ranks, and truthful zero-price openings', async () => {
    const disabled = await realm({ ...unlocked, upgrades: { packDiscount: [] } });
    await expect(buy(disabled.id)).rejects.toMatchObject({ code: 'UPGRADE_MAXED' });
    const free = await realm({
      ...unlocked,
      startingGems: 0,
      upgrades: { packDiscount: [{ cost: 0, requiredLevel: 1, discount: 20 }] },
    });
    expect(await buy(free.id)).toMatchObject({ charged: 0, balance: 0, packPrice: 0 });
    expect(await open(free)).toMatchObject({
      ok: true,
      charged: 0,
      balance: 0,
      packUpgradeRank: 1,
    });
  });
  it('keeps pack size, availability rejection, XP, and cooldown rules authoritative after upgrading', async () => {
    const r = await realm({ ...unlocked, packSize: 2, cooldownSeconds: 60 });
    await buy(r.id);
    const opened = await open(r);
    expect(opened).toMatchObject({ ok: true, charged: 9, progression: { xpAwarded: 20 } });
    if (!opened.ok) throw new Error('Fixture draw failed.');
    expect(opened.cardIds).toHaveLength(2);
    expect(await open(r)).toMatchObject({ ok: false, code: 'COOLDOWN' });
    const empty = await realm({ ...unlocked, packSize: 2 });
    await db.query('DELETE FROM characters WHERE realm_id=$1 AND source_key != $2', [
      empty.id,
      'lantern-demo:ro',
    ]);
    await buy(empty.id);
    expect(await open(empty)).toMatchObject({ ok: false, code: 'EMPTY_POOL' });
    expect(await getRealmView(db, admin, empty.id)).toMatchObject({
      balance: 90,
      cards: [],
      progression: { totalXp: 0 },
    });
  });
  it('replays historical pack prices after upgrades without changing current state', async () => {
    const r = await realm(unlocked),
      firstKey = randomUUID(),
      secondKey = randomUUID();
    const original = await open(r, firstKey);
    await buy(r.id);
    const discounted = await open(r, secondKey);
    await buy(r.id, 2);
    expect(await open(r, firstKey)).toEqual(original);
    expect(await open(r, secondKey)).toEqual(discounted);
    expect((await getRealmView(db, admin, r.id)).balance).toBe(51);
    expect(await open(r)).toMatchObject({ ok: true, charged: 8, balance: 43 });
  });
  it('round-trips purchase IDs, rules, ranks, receipts, and discounts through archives and fresh restore', async () => {
    const r = await realm(unlocked);
    const before = withoutTradeArchiveFields(await exportPlayer(db, admin, r.id));
    const { basePackPrice: _price, upgradeRules: _rules, wishlistRules: _wishlist, ...v3 } = before;
    expect(_wishlist).toEqual(defaultConfig.wishlist);
    expect(_price).toBe(10);
    expect(_rules).toEqual(unlocked.upgrades);
    expect(parsePlayerArchive({ ...v3, schemaVersion: 3 })).toEqual({ ...v3, schemaVersion: 3 });
    const key = randomUUID(),
      first = await buy(r.id, 1, key);
    await buy(r.id, 2);
    await open(r);
    const archive = await exportPlayer(db, admin, r.id);
    expect(archive.schemaVersion).toBe(12);
    expect(archive.upgrades).toHaveLength(2);
    expect(parsePlayerArchive(JSON.parse(JSON.stringify(archive)))).toEqual(archive);
    expect(JSON.stringify(archive)).not.toMatch(/password|email|token/);
    expect(() => parsePlayerArchive({ ...archive, upgrades: [archive.upgrades[1]] })).toThrow(
      'Upgrade history',
    );
    const passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase);
    const target = (await postgres.database('upgrades_restore')).db;
    try {
      await restoreBackup(target, backup, passphrase);
      expect(await getRealmView(target, admin, r.id)).toMatchObject({
        balance: 62,
        packPrice: 8,
        upgrade: { rank: 2 },
      });
      expect(await buyUpgrade(target, admin, r.id, 'pack_discount', 1, key)).toEqual(first);
      const after = await exportPlayer(target, admin, r.id);
      expect({ ...after, exportedAt: archive.exportedAt }).toEqual(archive);
      const sql =
        'SELECT jsonb_agg(to_jsonb(u) ORDER BY realm_id,id) AS data FROM upgrade_purchases u';
      expect((await target.query(sql)).rows).toEqual((await db.query(sql)).rows);
    } finally {
      await target.end();
    }
  });
  it('upgrades progression-era databases and backups without changing previous state or granting purchases', async () => {
    const source = (await postgres.database('before_upgrades', false)).db;
    const target = (await postgres.database('old_upgrades_restore')).db;
    try {
      await installLegacySchema(source, 4);
      const actor = await bootstrap(source, 'before-upgrades@example.test', password);
      const old = await seedLegacyRealm(source, actor);
      await source.query('UPDATE memberships SET xp=30 WHERE realm_id=$1', [old.realmId]);
      await source.query(
        "INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version) VALUES($1,$2,$3,'migration_baseline',30,0)",
        [old.realmId, randomUUID(), actor],
      );
      const sql = `SELECT jsonb_build_object('members',(SELECT jsonb_agg(to_jsonb(m)-'trade_code') FROM memberships m),'cards',(SELECT jsonb_agg(to_jsonb(c)-'original_owner_id') FROM cards c),'xp',(SELECT jsonb_agg(to_jsonb(x)-'trade_id' ORDER BY id) FROM xp_ledger x),'receipts',(SELECT jsonb_agg(to_jsonb(o)) FROM openings o)) AS state`;
      const before = (await source.query(sql)).rows;
      const expected = structuredClone(before);
      expected[0].state.receipts = expected[0].state.receipts.map((receipt: object) => ({
        ...receipt,
        pack_count: 1,
      }));
      const passphrase = randomBytes(24).toString('hex'),
        backup = await makeBackup(source, passphrase);
      await migrate(source);
      await migrate(source);
      expect((await source.query(sql)).rows).toEqual(expected);
      expect(await getRealmView(source, actor, old.realmId)).toMatchObject({
        balance: 90,
        packPrice: 10,
        upgrade: { rank: 0 },
        progression: { totalXp: 30 },
        config: { ...defaultConfig, ranks: disabledCollectorRanks, gemRewards: disabledGemRewards },
      });
      await restoreBackup(target, backup, passphrase);
      expect((await target.query(sql)).rows).toEqual(expected);
      expect((await target.query('SELECT 1 FROM upgrade_purchases')).rowCount).toBe(0);
      expect(await openPack(target, actor, old.realmId, old.packId, old.requestKey)).toEqual(
        old.result,
      );
      expect(
        await buyUpgrade(target, actor, old.realmId, 'pack_discount', 1, randomUUID()),
      ).toMatchObject({ balance: 80, packPrice: 9 });
    } finally {
      await source.end();
      await target.end();
    }
  });
  it('rejects inconsistent purchase history and atomically rolls restores back', async () => {
    const r = await realm(unlocked);
    await buy(r.id);
    await buy(r.id, 2);
    const target = (await postgres.database('invalid_upgrades_restore')).db;
    const passphrase = randomBytes(24).toString('hex');
    try {
      await db.query(
        "UPDATE upgrade_purchases SET result=jsonb_set(result,'{charged}','999') WHERE realm_id=$1 AND rank=1",
        [r.id],
      );
      let backup: string;
      try {
        backup = await makeBackup(db, passphrase);
      } finally {
        await db.query(
          "UPDATE upgrade_purchases SET result=jsonb_set(result,'{charged}','10') WHERE realm_id=$1 AND rank=1",
          [r.id],
        );
      }
      await expect(restoreBackup(target, backup!, passphrase)).rejects.toThrow(
        'upgrade history does not reconcile',
      );
      expect((await target.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
      // A missing earlier rank must not become a free grant on recovery.
      const row = (
        await db.query('DELETE FROM upgrade_purchases WHERE realm_id=$1 AND rank=1 RETURNING *', [
          r.id,
        ])
      ).rows[0];
      try {
        backup = await makeBackup(db, passphrase);
      } finally {
        await db.query(
          'INSERT INTO upgrade_purchases SELECT * FROM jsonb_populate_record(NULL::upgrade_purchases,$1::jsonb)',
          [JSON.stringify(row)],
        );
      }
      await expect(restoreBackup(target, backup!, passphrase)).rejects.toThrow(
        'upgrade history does not reconcile',
      );
      expect((await target.query('SELECT 1 FROM upgrade_purchases')).rowCount).toBe(0);
      expect((await target.query('SELECT 1 FROM wallet_ledger')).rowCount).toBe(0);
    } finally {
      await target.end();
    }
  });
});
