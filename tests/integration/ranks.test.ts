import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  disabledCollectorRanks,
  disabledGemRewards,
  disabledRankTracks,
  parseRealmConfig,
  type RealmConfig,
} from '../../packages/config/src/index';
import { defaultConfig, legacyRules } from '../support/prototype-config';
import {
  bootstrap,
  createRealm,
  provisionPlayer,
  openPack,
  getRealmView,
  recycleCard,
  setWishlistEntry,
  exportPlayer,
  previewRealmSettings,
  type Database,
} from '../../packages/db/src/index';
import { buyCollectorRank } from '../../packages/db/src/ranks';
import { transaction } from '../../packages/db/src/connection';
import { purchasedCollectorRank } from '../../packages/db/src/rank-state';
import { validateRankBackup } from '../../packages/db/src/rank-backup';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { installLegacySchema } from '../support/legacy';
import { startPostgres } from '../support/postgres';
let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('collector_ranks')).db;
  admin = await bootstrap(db, 'rank-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function realm(config: RealmConfig = defaultConfig) {
  const id = await createRealm(db, admin, 'Collector ranks', config);
  return {
    id,
    pack: (await getRealmView(db, admin, id)).packs.find((p) => p.name === 'All Characters')!.id,
  };
}
const rank = (realmId: string, actor = admin) =>
  transaction(db, (tx) => purchasedCollectorRank(tx, realmId, actor));
const buy = (id: string, target = 1, key = randomUUID(), actor = admin, revision?: number) =>
  buyCollectorRank(db, actor, id, target, key, revision);
describe('transactional collector ranks', () => {
  it('deduplicates concurrent retries, grants one rank and debits only its buyer', async () => {
    const r = await realm(),
      key = randomUUID(),
      results = await Promise.all(Array.from({ length: 5 }, () => buy(r.id, 1, key)));
    results.forEach((result) => expect(result).toEqual(results[0]));
    expect(results[0]).toMatchObject({ rank: 1, name: 'Bronze', charged: 25, balance: 75 });
    expect(await rank(r.id)).toBe(1);
    expect(
      (
        await db.query("SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND reason='rank_purchase'", [
          r.id,
        ])
      ).rowCount,
    ).toBe(1);
    const player = await provisionPlayer(db, r.id, `${randomUUID()}@example.test`, password);
    expect(await rank(r.id, player)).toBe(0);
    expect((await getRealmView(db, player, r.id)).balance).toBe(100);
    await expect(buy(r.id, 2, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await getRealmView(db, admin, r.id)).progression.totalXp).toBe(0);
  });
  it('serializes different keys for the same rank without double spending', async () => {
    const r = await realm(),
      outcomes = await Promise.allSettled([buy(r.id), buy(r.id)]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'RANK_CONFLICT' },
    });
    expect((await getRealmView(db, admin, r.id)).balance).toBe(75);
  });
  it('enforces membership before returning a receipt and keeps ranks realm-scoped', async () => {
    const r = await realm(),
      other = await realm(),
      key = randomUUID();
    await buy(r.id, 1, key);
    const outsider = await provisionPlayer(db, other.id, `${randomUUID()}@example.test`, password);
    await expect(buy(r.id, 1, key, outsider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await buy(other.id, 1, key)).toMatchObject({ rank: 1, balance: 75 });
    expect(await rank(other.id)).toBe(1);
    for (const target of [0, 0.5, 11]) await expect(buy(r.id, target)).rejects.toThrow();
  });
  it('rejects skipped ranks, disabled ladders, stale settings and insufficient gems without charge', async () => {
    const r = await realm(),
      disabled = await realm({ ...defaultConfig, ranks: disabledCollectorRanks }),
      poor = await realm({ ...defaultConfig, startingGems: 24 });
    await expect(buy(r.id, 2)).rejects.toMatchObject({ code: 'RANK_CONFLICT' });
    await expect(buy(disabled.id)).rejects.toMatchObject({ code: 'RANKS_DISABLED' });
    await expect(buy(poor.id)).rejects.toMatchObject({ code: 'INSUFFICIENT_GEMS' });
    const key = randomUUID();
    await expect(buy(r.id, 1, key, admin, 0)).rejects.toMatchObject({ code: 'SETTINGS_CHANGED' });
    const receipt = await buy(r.id, 1, key, admin, 1);
    expect(await buy(r.id, 1, key, admin, 0)).toEqual(receipt);
    expect((await getRealmView(db, admin, disabled.id)).balance).toBe(100);
    expect((await getRealmView(db, admin, poor.id)).balance).toBe(24);
  });
  it('rolls back ownership and gems on an injected ledger failure, then safely retries', async () => {
    const r = await realm(),
      key = randomUUID();
    await db.query(
      `CREATE FUNCTION deny_rank_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='rank_purchase' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$;CREATE TRIGGER deny_rank_fixture BEFORE INSERT ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION deny_rank_fixture();`,
    );
    try {
      await expect(buy(r.id, 1, key)).rejects.toThrow();
    } finally {
      await db.query(
        'DROP TRIGGER deny_rank_fixture ON wallet_ledger;DROP FUNCTION deny_rank_fixture();',
      );
    }
    expect(await rank(r.id)).toBe(0);
    expect((await getRealmView(db, admin, r.id)).balance).toBe(100);
    expect(await buy(r.id, 1, key)).toMatchObject({ balance: 75 });
  });
  it('serializes a rank purchase with a competing pack debit without overdraft', async () => {
    const r = await realm({ ...defaultConfig, startingGems: 30 }),
      results = await Promise.allSettled([
        buy(r.id),
        openPack(db, admin, r.id, r.pack, randomUUID()),
      ]);
    const view = await getRealmView(db, admin, r.id);
    expect(view.balance).toBeGreaterThanOrEqual(0);
    if (await rank(r.id)) {
      expect(view.balance).toBe(5);
      expect(view.cards).toHaveLength(0);
    } else {
      expect(view.balance).toBe(20);
      expect(view.cards).toHaveLength(1);
    }
    expect(
      results.filter(
        (result) => result.status === 'fulfilled' && (!('ok' in result.value) || result.value.ok),
      ),
    ).toHaveLength(1);
  });
  it('applies pack prices, recycling bonuses, wishlist slots and cooldown benefits to actual services', async () => {
    const config = { ...defaultConfig, startingGems: 1000, cooldownSeconds: 20 },
      r = await realm(config);
    for (let i = 1; i <= 5; i++) await buy(r.id, i);
    const view = await getRealmView(db, admin, r.id);
    expect(view).toMatchObject({ packPrice: 9, collectorRank: { rank: 5, name: 'Diamond' } });
    const opened = await openPack(db, admin, r.id, r.pack, randomUUID());
    expect(opened).toMatchObject({ ok: true, charged: 9 });
    if (!opened.ok) throw new Error('Fixture opening failed');
    const recycled = await recycleCard(db, admin, r.id, opened.cardIds[0], randomUUID());
    expect(recycled.credited).toBe(config.recycleRewards[opened.characters[0].tier] + 1);
    const second = await openPack(db, admin, r.id, r.pack, randomUUID());
    expect(second.ok).toBe(true);
    const catalog = (await getRealmView(db, admin, r.id)).catalog;
    for (const character of catalog.slice(0, 6))
      await setWishlistEntry(db, admin, r.id, character.id, true, randomUUID());
    await expect(
      setWishlistEntry(db, admin, r.id, catalog[6].id, true, randomUUID()),
    ).rejects.toMatchObject({ code: 'WISHLIST_FULL' });
    expect((await getRealmView(db, admin, r.id)).wishlist).toHaveLength(6);
  });
  it('protects purchased rank rules and occupied bonus wishlist slots in settings review', async () => {
    const r = await realm();
    await buy(r.id);
    const changed = {
      ...defaultConfig,
      ranks: {
        ...defaultConfig.ranks,
        levels: defaultConfig.ranks.levels.map((level, index) =>
          index === 0 ? { ...level, cost: level.cost + 1 } : level,
        ),
      },
    };
    const preview = await previewRealmSettings(db, admin, r.id, changed);
    expect(preview.impact.blockers.join(' ')).toMatch(/rank/i);
    const disabled = await previewRealmSettings(db, admin, r.id, {
      ...defaultConfig,
      ranks: { ...defaultConfig.ranks, enabled: false },
    });
    expect(disabled.impact.blockers.join(' ')).toMatch(/rank/i);
  });
  it('rejects a forged rank benefit receipt and leaves the fresh restore target empty', async () => {
    const r = await realm(),
      receipt = await buy(r.id),
      before = (
        await db.query('SELECT result FROM rank_purchases WHERE realm_id=$1 AND id=$2', [
          r.id,
          receipt.purchaseId,
        ])
      ).rows[0].result;
    const fresh = (await server.database('ranks_forged_restore')).db,
      key = randomBytes(24).toString('hex');
    try {
      await db.query(
        "UPDATE rank_purchases SET result=jsonb_set(result,'{benefits,packDiscount}','999'::jsonb) WHERE realm_id=$1 AND id=$2",
        [r.id, receipt.purchaseId],
      );
      const archive = await makeBackup(db, key);
      await expect(restoreBackup(fresh, archive, key)).rejects.toThrow(/rank/i);
      expect((await fresh.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
      expect((await fresh.query('SELECT 1 FROM rank_purchases')).rowCount).toBe(0);
    } finally {
      await db.query('UPDATE rank_purchases SET result=$3 WHERE realm_id=$1 AND id=$2', [
        r.id,
        receipt.purchaseId,
        before,
      ]);
      await fresh.end();
    }
  });
  it('migrates pre-rank realms and restores older snapshots with ranks disabled and progress intact', async () => {
    const legacy = (await server.database('rank_legacy', false)).db;
    const restored = (await server.database('rank_legacy_restored')).db;
    try {
      await installLegacySchema(legacy, 12);
      const actor = await bootstrap(legacy, 'legacy-ranks@example.test', password);
      const { ranks: _ranks, gemRewards: _gemRewards, ...currentRules } = defaultConfig;
      expect(_gemRewards).toEqual(defaultConfig.gemRewards);
      const previousRules = { ...legacyRules(currentRules), schemaVersion: 6 };
      const realmId = randomUUID();
      await legacy.query('INSERT INTO realms(id,name,config,created_by) VALUES($1,$2,$3,$4)', [
        realmId,
        'Preserved legacy realm',
        previousRules,
        actor,
      ]);
      await legacy.query(
        "INSERT INTO memberships(realm_id,account_id,role,balance) VALUES($1,$2,'admin',100)",
        [realmId, actor],
      );
      await legacy.query(
        "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason) VALUES($1,$2,$3,'starting-grant',100,100,'starting_grant')",
        [realmId, randomUUID(), actor],
      );
      const before = (
        await legacy.query('SELECT to_jsonb(m) AS row FROM memberships m WHERE realm_id=$1', [
          realmId,
        ])
      ).rows[0].row;
      const key = randomBytes(24).toString('hex'),
        archive = await makeBackup(legacy, key);
      await migrate(legacy);
      const rules = (await legacy.query('SELECT config FROM realms WHERE id=$1', [realmId])).rows[0]
        .config;
      expect(rules).toEqual({
        ...parseRealmConfig(previousRules),
        rankTracks: disabledRankTracks,
        ranks: disabledCollectorRanks,
        gemRewards: disabledGemRewards,
      });
      expect(
        (
          await legacy.query('SELECT to_jsonb(m) AS row FROM memberships m WHERE realm_id=$1', [
            realmId,
          ])
        ).rows[0].row,
      ).toEqual(before);
      expect((await legacy.query('SELECT 1 FROM rank_purchases')).rowCount).toBe(0);
      await expect(buyCollectorRank(legacy, actor, realmId, 1, randomUUID())).rejects.toMatchObject(
        { code: 'RANKS_DISABLED' },
      );
      await restoreBackup(restored, archive, key);
      await assertBackupRestored(restored, archive, key);
      expect(
        (await restored.query('SELECT config FROM realms WHERE id=$1', [realmId])).rows[0].config,
      ).toEqual(parseRealmConfig(previousRules));
      expect(
        (
          await restored.query('SELECT to_jsonb(m) AS row FROM memberships m WHERE realm_id=$1', [
            realmId,
          ])
        ).rows[0].row,
      ).toEqual(before);
      expect(_ranks.enabled).toBe(true);
    } finally {
      await legacy.end();
      await restored.end();
    }
  });
  it('recovers rank receipts, benefits and balances into a fresh encrypted database', async () => {
    const r = await realm(),
      key = randomUUID(),
      receipt = await buy(r.id, 1, key),
      archiveKey = randomBytes(24).toString('hex');
    await transaction(db, validateRankBackup);
    const archive = await makeBackup(db, archiveKey),
      fresh = (await server.database('ranks_restored')).db;
    try {
      await restoreBackup(fresh, archive, archiveKey);
      await assertBackupRestored(fresh, archive, archiveKey);
      expect(await buyCollectorRank(fresh, admin, r.id, 1, key)).toEqual(receipt);
      expect((await getRealmView(fresh, admin, r.id)).packPrice).toBe(9);
    } finally {
      await fresh.end();
    }
    const exported = await exportPlayer(db, admin, r.id);
    expect(JSON.stringify(exported)).toContain('Bronze');
  });
});
