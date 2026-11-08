import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { type RealmConfig } from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import {
  bootstrap,
  createRealm,
  getRealmView,
  openPack,
  previewRealmCatalog,
  provisionPlayer,
  exportPlayer,
  parsePlayerArchive,
  buyCollectorRank,
  buyUpgrade,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { generateScaleCatalog } from '../../packages/importers/src/scale';
import { installLegacySchema, seedLegacyRealm } from '../support/legacy';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, actor: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('pack_bundles')).db;
  actor = await bootstrap(db, 'bundles@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function realm(overrides: Partial<RealmConfig> = {}) {
  const config = { ...defaultConfig, startingGems: 1000, minimumPoolSize: 1, ...overrides },
    catalog = { data: generateScaleCatalog(100), rightsConfirmed: true },
    preview = await previewRealmCatalog(db, actor, config, catalog),
    id = await createRealm(
      db,
      actor,
      'Pack bundle original fixture',
      config,
      catalog,
      preview.fingerprint,
    ),
    view = await getRealmView(db, actor, id);
  return { id, pack: view.packs.find((pack) => pack.name === 'All Characters')! };
}
const open = (id: string, packId: string, count = 1, key = randomUUID(), owner = actor) =>
  openPack(db, owner, id, packId, key, undefined, count);
describe('atomic pack bundles', () => {
  it('keeps single receipts exact and awards five packs with one debit and correct multi-level XP', async () => {
    const r = await realm();
    const single = await open(r.id, r.pack.id);
    expect(single.ok).toBe(true);
    expect(single).not.toHaveProperty('packCount');
    const result = await open(r.id, r.pack.id, 5);
    expect(result).toMatchObject({
      ok: true,
      packCount: 5,
      cardsPerPack: 1,
      unitPrice: 10,
      charged: 50,
      balance: 940,
      progression: { xpAwarded: 50, totalXp: 60, level: 3, levelsGained: 2 },
    });
    if (!result.ok) throw new Error('Original bundle fixture did not open.');
    expect(result.characters).toHaveLength(5);
    expect(new Set(result.cardIds).size).toBe(5);
    expect((await getRealmView(db, actor, r.id)).cards).toHaveLength(6);
    expect(
      (
        await db.query("SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND reason='pack_opening'", [
          r.id,
        ])
      ).rowCount,
    ).toBe(2);
    const exported = await exportPlayer(db, actor, r.id);
    expect(parsePlayerArchive(exported)).toEqual(exported);
    expect(exported.xpLedger.filter((entry) => entry.reason === 'first_collection')).toHaveLength(
      6,
    );
  });
  it('supports ten five-card packs as fifty unique cards with one cooldown', async () => {
    const r = await realm({ packSize: 5, cooldownSeconds: 60 });
    const result = await open(r.id, r.pack.id, 10);
    expect(result).toMatchObject({
      ok: true,
      packCount: 10,
      cardsPerPack: 5,
      charged: 100,
      balance: 900,
      progression: { xpAwarded: 500, totalXp: 500, level: 5 },
    });
    if (!result.ok) throw new Error('Original fifty-card fixture did not open.');
    expect(result.characters).toHaveLength(50);
    expect(new Set(result.characters.map((character) => character.id)).size).toBe(50);
    expect(await open(r.id, r.pack.id)).toMatchObject({ ok: false, code: 'COOLDOWN' });
    expect((await getRealmView(db, actor, r.id)).balance).toBe(900);
  });
  it('prices every pack with the purchased collector and upgrade discounts', async () => {
    const r = await realm();
    await buyCollectorRank(db, actor, r.id, 1, randomUUID());
    expect(await open(r.id, r.pack.id, 5)).toMatchObject({
      ok: true,
      unitPrice: 9,
      charged: 45,
      balance: 930,
    });
    await buyUpgrade(db, actor, r.id, 'pack_discount', 1, randomUUID());
    expect(await open(r.id, r.pack.id, 5)).toMatchObject({
      ok: true,
      unitPrice: 8,
      charged: 40,
      balance: 880,
      packUpgradeRank: 1,
    });
  });
  it('deduplicates concurrent bundle retries and binds the key to pack count', async () => {
    const r = await realm(),
      key = randomUUID();
    const receipts = await Promise.all(
      Array.from({ length: 4 }, () => open(r.id, r.pack.id, 5, key)),
    );
    receipts.forEach((receipt) => expect(receipt).toEqual(receipts[0]));
    expect((await getRealmView(db, actor, r.id)).balance).toBe(950);
    expect((await getRealmView(db, actor, r.id)).cards).toHaveLength(5);
    await expect(open(r.id, r.pack.id, 10, key)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(open(r.id, r.pack.id, 1, key)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
  it('serializes competing bundles and never sells a partial bundle', async () => {
    const r = await realm(),
      other = await provisionPlayer(db, r.id, `${randomUUID()}@example.test`, password);
    await db.query(
      'DELETE FROM characters WHERE realm_id=$1 AND id NOT IN (SELECT id FROM characters WHERE realm_id=$1 ORDER BY id LIMIT 8)',
      [r.id],
    );
    const results = await Promise.all([
      open(r.id, r.pack.id, 5),
      open(r.id, r.pack.id, 5, randomUUID(), other),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ code: 'EMPTY_POOL' });
    expect((await db.query('SELECT 1 FROM cards WHERE realm_id=$1', [r.id])).rowCount).toBe(5);
    expect(
      (
        await db.query(
          'SELECT sum(balance)::integer AS balance FROM memberships WHERE realm_id=$1',
          [r.id],
        )
      ).rows[0].balance,
    ).toBe(1950);
  });
  it('fails without charge or cooldown for insufficient pool, balance, membership and invalid counts', async () => {
    const r = await realm({ startingGems: 49, cooldownSeconds: 60 }),
      key = randomUUID();
    expect(await open(r.id, r.pack.id, 5, key)).toMatchObject({ code: 'INSUFFICIENT_GEMS' });
    await expect(open(r.id, r.pack.id, 10, key)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(open(r.id, r.pack.id, 2)).rejects.toMatchObject({ code: 'INVALID_PACK_COUNT' });
    await expect(open(r.id, r.pack.id, 5, randomUUID(), randomUUID())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      (
        await db.query('SELECT balance,xp,last_opened_at FROM memberships WHERE realm_id=$1', [
          r.id,
        ])
      ).rows[0],
    ).toEqual({ balance: 49, xp: 0, last_opened_at: null });
    const empty = await realm();
    await db.query(
      'DELETE FROM characters WHERE realm_id=$1 AND id NOT IN (SELECT id FROM characters WHERE realm_id=$1 ORDER BY id LIMIT 9)',
      [empty.id],
    );
    expect(await open(empty.id, empty.pack.id, 10)).toMatchObject({ code: 'EMPTY_POOL' });
    expect((await getRealmView(db, actor, empty.id)).balance).toBe(1000);
  });
  it('rolls back every card, XP award and debit after an injected ledger failure', async () => {
    const r = await realm(),
      key = randomUUID();
    await db.query(
      "CREATE FUNCTION reject_bundle_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='pack_opening' THEN RAISE EXCEPTION 'bundle rollback fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_bundle_fixture BEFORE INSERT ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION reject_bundle_fixture();",
    );
    try {
      await expect(open(r.id, r.pack.id, 5, key)).rejects.toThrow('bundle rollback fixture');
    } finally {
      await db.query(
        'DROP TRIGGER reject_bundle_fixture ON wallet_ledger; DROP FUNCTION reject_bundle_fixture();',
      );
    }
    expect((await db.query('SELECT 1 FROM openings WHERE realm_id=$1', [r.id])).rowCount).toBe(0);
    expect((await getRealmView(db, actor, r.id)).cards).toHaveLength(0);
    expect((await getRealmView(db, actor, r.id)).progression.totalXp).toBe(0);
    expect((await open(r.id, r.pack.id, 5, key)).ok).toBe(true);
  });
  it('restores bundles and exact retries into a fresh database and rejects forged bundle prices', async () => {
    const source = (await server.database('bundle_backup')).db,
      fresh = (await server.database('bundle_fresh')).db,
      forged = (await server.database('bundle_forged')).db;
    try {
      const owner = await bootstrap(source, 'bundle-backup@example.test', password),
        id = await createRealm(source, owner, 'Bundle backup', defaultConfig),
        pack = (await getRealmView(source, owner, id)).packs.find(
          (item) => item.name === 'All Characters',
        )!,
        key = randomUUID(),
        receipt = await openPack(source, owner, id, pack.id, key, undefined, 5),
        backup = await makeBackup(source, password);
      await restoreBackup(fresh, backup, password);
      await assertBackupRestored(fresh, backup, password);
      expect(await openPack(fresh, owner, id, pack.id, key, undefined, 5)).toEqual(receipt);
      await expect(openPack(fresh, owner, id, pack.id, key)).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
      });
      await source.query(
        "UPDATE openings SET result=jsonb_set(result,'{unitPrice}','1') WHERE realm_id=$1",
        [id],
      );
      await expect(
        restoreBackup(forged, await makeBackup(source, password), password),
      ).rejects.toThrow('pack bundle');
      expect((await forged.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    } finally {
      await source.end();
      await fresh.end();
      await forged.end();
    }
  });
  it('migrates schema-0016 singles without rewriting receipts and restores pre-bundle backups', async () => {
    const source = (await server.database('bundle_legacy', false)).db,
      fresh = (await server.database('bundle_legacy_fresh')).db;
    try {
      await installLegacySchema(source, 16);
      const owner = await bootstrap(source, 'bundle-legacy@example.test', password),
        old = await seedLegacyRealm(source, owner),
        before = (await source.query('SELECT result FROM openings')).rows[0].result,
        backup = await makeBackup(source, password);
      await migrate(source);
      expect((await source.query('SELECT result,pack_count FROM openings')).rows[0]).toEqual({
        result: before,
        pack_count: 1,
      });
      expect(await openPack(source, owner, old.realmId, old.packId, old.requestKey)).toEqual(
        before,
      );
      await expect(
        openPack(source, owner, old.realmId, old.packId, old.requestKey, undefined, 5),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await restoreBackup(fresh, backup, password);
      await assertBackupRestored(fresh, backup, password);
      expect(await openPack(fresh, owner, old.realmId, old.packId, old.requestKey)).toEqual(before);
    } finally {
      await source.end();
      await fresh.end();
    }
  });
});
