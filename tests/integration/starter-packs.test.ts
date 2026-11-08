import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  bootstrap,
  createRealm,
  previewRealmCatalog,
  provisionPlayer,
  getRealmView,
  openPack,
  recycleCard,
  exportPlayer,
  type Database,
} from '../../packages/db/src/index';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';
import { customChoice, csvChoice, customCatalog } from '../support/catalog-fixture';
import { manualPlan, overlapChoice } from '../support/pack-plan-fixture';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string, player: string;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('starter_packs')).db;
  admin = await bootstrap(db, 'packs-admin@example.test', randomBytes(24).toString('hex'));
  const realm = await createRealm(db, admin, 'Role fixture', defaultConfig);
  player = await provisionPlayer(
    db,
    realm,
    'packs-player@example.test',
    randomBytes(24).toString('hex'),
  );
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function counts() {
  return (
    await db.query(
      `SELECT (SELECT count(*) FROM realms) AS realms,(SELECT count(*) FROM memberships) AS memberships,(SELECT count(*) FROM characters) AS characters,(SELECT count(*) FROM packs) AS packs,(SELECT count(*) FROM wallet_ledger) AS ledger`,
    )
  ).rows[0];
}
async function create(
  config = defaultConfig,
  catalog: unknown = customChoice,
  plan: unknown = manualPlan,
) {
  const preview = await previewRealmCatalog(db, admin, config, catalog, plan);
  const id = await createRealm(
    db,
    admin,
    'Reviewed starter packs',
    config,
    catalog,
    preview.fingerprint,
    plan,
  );
  const packs = (
    await db.query<{ id: string; name: string; category: string | null }>(
      'SELECT id,name,category FROM packs WHERE realm_id=$1 ORDER BY name',
      [id],
    )
  ).rows;
  return { id, preview, view: await getRealmView(db, admin, id), packs };
}
describe('transactional reviewed starter packs', () => {
  it('authorizes manual preview and creation in services before reading the plan', async () => {
    const before = await counts();
    await expect(
      previewRealmCatalog(db, player, defaultConfig, customChoice, manualPlan),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createRealm(db, player, 'Denied', defaultConfig, undefined, 'a'.repeat(64), manualPlan),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await counts()).toEqual(before);
  });
  it('installs exactly the reviewed names and category filters for JSON and CSV catalogs', async () => {
    for (const catalog of [customChoice, csvChoice]) {
      const f = await create(defaultConfig, catalog);
      expect(
        f.packs
          .map((p) => ({ name: p.name, category: p.category }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ).toEqual(
        [...manualPlan.categories, { name: 'All Characters', category: null }].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      for (const pack of f.view.packs)
        expect(pack.available).toBe(f.preview.packs.find((p) => p.name === pack.name)!.drawable);
    }
  });
  it('requires matching selection/name/config/catalog reviews, including manual demo installs', async () => {
    const before = await counts(),
      preview = await previewRealmCatalog(db, admin, defaultConfig, customChoice, manualPlan);
    await expect(
      createRealm(db, admin, 'Unreviewed', defaultConfig, customChoice, undefined, manualPlan),
    ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
    for (const plan of [
      undefined,
      { ...manualPlan, categories: [] },
      { ...manualPlan, categories: [{ ...manualPlan.categories[0], name: 'Changed' }] },
    ])
      await expect(
        createRealm(
          db,
          admin,
          'Stale plan',
          defaultConfig,
          customChoice,
          preview.fingerprint,
          plan,
        ),
      ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
    await expect(
      createRealm(
        db,
        admin,
        'Stale config',
        { ...defaultConfig, minimumPoolSize: 1 },
        customChoice,
        preview.fingerprint,
        manualPlan,
      ),
    ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
    await expect(
      createRealm(
        db,
        admin,
        'Stale catalog',
        defaultConfig,
        { ...customChoice, data: { ...customCatalog, revision: 'changed' } },
        preview.fingerprint,
        manualPlan,
      ),
    ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
    const emptyPlan = { schemaVersion: 1, categories: [] };
    await expect(
      createRealm(db, admin, 'Unreviewed demo', defaultConfig, undefined, undefined, emptyPlan),
    ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
    expect(await counts()).toEqual(before);
    const demoReview = await previewRealmCatalog(db, admin, defaultConfig, undefined, emptyPlan);
    const demoId = await createRealm(
      db,
      admin,
      'Manual demo',
      defaultConfig,
      undefined,
      demoReview.fingerprint,
      emptyPlan,
    );
    const demo = await getRealmView(db, admin, demoId);
    expect(demo.packs).toHaveLength(1);
    expect(demo.catalog).toHaveLength(12);
  });
  it('rejects missing/duplicate/undersized categories and quota violations without creating rows', async () => {
    const before = await counts();
    for (const plan of [
      { schemaVersion: 1, categories: [{ category: 'missing', name: 'Missing' }] },
      { schemaVersion: 1, categories: [manualPlan.categories[0], manualPlan.categories[0]] },
    ])
      await expect(
        createRealm(db, admin, 'Invalid', defaultConfig, customChoice, 'a'.repeat(64), plan),
      ).rejects.toThrow();
    await expect(
      createRealm(
        db,
        admin,
        'Too small',
        { ...defaultConfig, minimumPoolSize: 3 },
        customChoice,
        'a'.repeat(64),
        manualPlan,
      ),
    ).rejects.toMatchObject({ code: 'PACK_PLAN_INVALID' });
    await expect(
      createRealm(
        db,
        admin,
        'Over quota',
        { ...defaultConfig, maximumCategoryPacks: 1 },
        customChoice,
        'a'.repeat(64),
        manualPlan,
      ),
    ).rejects.toMatchObject({ code: 'PACK_PLAN_INVALID' });
    expect(await counts()).toEqual(before);
  });
  it('rolls back the realm, grant, catalog, and first pack when a later pack insert fails', async () => {
    const before = await counts(),
      preview = await previewRealmCatalog(db, admin, defaultConfig, customChoice, manualPlan);
    await db.query(
      `CREATE FUNCTION deny_pack_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='Wind Notes' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER deny_pack_fixture BEFORE INSERT ON packs FOR EACH ROW EXECUTE FUNCTION deny_pack_fixture();`,
    );
    try {
      await expect(
        createRealm(
          db,
          admin,
          'Aborted packs',
          defaultConfig,
          customChoice,
          preview.fingerprint,
          manualPlan,
        ),
      ).rejects.toThrow();
    } finally {
      await db.query('DROP TRIGGER deny_pack_fixture ON packs; DROP FUNCTION deny_pack_fixture();');
    }
    expect(await counts()).toEqual(before);
  });
  it('keeps one active claim across concurrent differently named overlapping packs and safe retries', async () => {
    const f = await create({ ...defaultConfig, minimumPoolSize: 1 }, overlapChoice),
      keys = [randomUUID(), randomUUID()];
    const packs = f.packs.filter((p) => p.category !== null);
    const results = await Promise.all(
      packs.map((pack, i) => openPack(db, admin, f.id, pack.id, keys[i])),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: 'EMPTY_POOL', message: expect.any(String) },
    ]);
    const winner = results.findIndex((result) => result.ok);
    expect(await openPack(db, admin, f.id, packs[winner].id, keys[winner])).toEqual(
      results[winner],
    );
    const after = await getRealmView(db, admin, f.id);
    expect(after.cards).toHaveLength(1);
    expect(after.balance).toBe(defaultConfig.startingGems - defaultConfig.packPrice);
  });
  it('preserves realm isolation and recycling releases the character for another selected pack once', async () => {
    const config = { ...defaultConfig, minimumPoolSize: 1 },
      a = await create(config, overlapChoice),
      b = await create(config, overlapChoice);
    const pack = (f: typeof a) => f.packs.find((p) => p.category === 'paper makers')!;
    const [first, second] = await Promise.all([
      openPack(db, admin, a.id, pack(a).id, randomUUID()),
      openPack(db, admin, b.id, pack(b).id, randomUUID()),
    ]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Expected both independent realm claims.');
    expect(first.characters[0].id).toBe(second.characters[0].id);
    const key = randomUUID(),
      recycled = await recycleCard(db, admin, a.id, first.cardIds[0], key);
    expect(await recycleCard(db, admin, a.id, first.cardIds[0], key)).toEqual(recycled);
    const other = a.packs.find((p) => p.category === 'wind walkers')!;
    expect(await openPack(db, admin, a.id, other.id, randomUUID())).toMatchObject({ ok: true });
    expect((await getRealmView(db, admin, a.id)).cards).toHaveLength(1);
    expect((await getRealmView(db, admin, b.id)).cards[0].cardId).toBe(second.cardIds[0]);
  });
  it('rejects an unfillable category pack without spending or awarding progress', async () => {
    const f = await create({ ...defaultConfig, packSize: 3 }),
      selected = f.view.packs.find((p) => p.name === 'Paper Trail')!;
    expect(await openPack(db, admin, f.id, selected.id, randomUUID())).toMatchObject({
      ok: false,
      code: 'EMPTY_POOL',
    });
    const after = await getRealmView(db, admin, f.id);
    expect(after.balance).toBe(defaultConfig.startingGems);
    expect(after.cards).toHaveLength(0);
    expect(after.progression.totalXp).toBe(0);
    expect(
      await openPack(db, admin, f.id, f.packs.find((p) => p.category === null)!.id, randomUUID()),
    ).toMatchObject({ ok: true });
  });
  it('restores custom pack IDs/names/filters and player progress into a fresh database', async () => {
    const f = await create(defaultConfig, csvChoice),
      pack = f.view.packs.find((p) => p.name === 'Paper Trail')!,
      key = randomUUID();
    const receipt = await openPack(db, admin, f.id, pack.id, key),
      archive = await exportPlayer(db, admin, f.id),
      passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase),
      fresh = (await server.database('starter_packs_restored')).db;
    try {
      await restoreBackup(fresh, backup, passphrase);
      await assertBackupRestored(fresh, backup, passphrase);
      const restored = await exportPlayer(fresh, admin, f.id);
      expect({ ...restored, exportedAt: archive.exportedAt }).toEqual(archive);
      const query = 'SELECT id,name,category FROM packs WHERE realm_id=$1 ORDER BY id';
      expect((await fresh.query(query, [f.id])).rows).toEqual((await db.query(query, [f.id])).rows);
      expect(await openPack(fresh, admin, f.id, pack.id, key)).toEqual(receipt);
    } finally {
      await fresh.end();
    }
  });
});
