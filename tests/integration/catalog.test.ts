import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  previewRealmCatalog,
  provisionPlayer,
  type Database,
} from '../../packages/db/src/index';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { assertBackupRestored, makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';
import { customCatalog, customChoice, csvChoice, csvMetadata } from '../support/catalog-fixture';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string, player: string;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('custom_catalog')).db;
  admin = await bootstrap(db, 'catalog-admin@example.test', randomBytes(24).toString('hex'));
  const realm = await createRealm(db, admin, 'Role test realm', defaultConfig);
  player = await provisionPlayer(
    db,
    realm,
    'catalog-player@example.test',
    randomBytes(24).toString('hex'),
  );
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
const count = async () => (await db.query('SELECT count(*)::int AS n FROM realms')).rows[0].n;
async function createCsv(name = 'Original CSV workshop') {
  const preview = await previewRealmCatalog(db, admin, defaultConfig, csvChoice);
  const id = await createRealm(db, admin, name, defaultConfig, csvChoice, preview.fingerprint);
  return { id, preview, view: await getRealmView(db, admin, id) };
}
async function create(name = 'Original workshop') {
  const preview = await previewRealmCatalog(db, admin, defaultConfig, customChoice);
  const id = await createRealm(db, admin, name, defaultConfig, customChoice, preview.fingerprint);
  return { id, preview, view: await getRealmView(db, admin, id) };
}
describe('transactional custom catalog installation', () => {
  it('authorizes preview and creation in services for instance admins only', async () => {
    const before = await count();
    await expect(
      previewRealmCatalog(db, player, defaultConfig, customChoice),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createRealm(db, player, 'Forbidden', defaultConfig, customChoice, 'a'.repeat(64)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await count()).toBe(before);
  });
  it('requires a matching preview and rights attestation before any realm is installed', async () => {
    const before = await count(),
      preview = await previewRealmCatalog(db, admin, defaultConfig, customChoice);
    await expect(
      createRealm(db, admin, 'Missing preview', defaultConfig, customChoice),
    ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
    await expect(
      createRealm(
        db,
        admin,
        'Changed settings',
        { ...defaultConfig, startingGems: 101 },
        customChoice,
        preview.fingerprint,
      ),
    ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
    await expect(
      createRealm(
        db,
        admin,
        'Missing rights',
        defaultConfig,
        { data: customCatalog },
        preview.fingerprint,
      ),
    ).rejects.toThrow();
    expect(await count()).toBe(before);
  });
  it('installs exactly the reviewed packs, original UUIDs, source keys, tiers, and provenance', async () => {
    const f = await create();
    expect(f.view.packs.map((p) => p.name).sort()).toEqual(
      f.preview.packs.map((p) => p.name).sort(),
    );
    expect(f.view.catalog.map((c) => c.id).sort()).toEqual(
      customCatalog.characters.map((c) => c.id).sort(),
    );
    const rows = (
      await db.query('SELECT source_key,provenance FROM characters WHERE realm_id=$1', [f.id])
    ).rows;
    expect(rows).toHaveLength(4);
    for (const row of rows)
      expect(row.provenance).toMatchObject({
        source: 'workshop',
        revision: 'original-1',
        license: customCatalog.license,
        rightsConfirmed: true,
        importKind: 'original-json-v1',
        calculationVersion: 'source-percentile-v1',
      });
    expect(f.view.balance).toBe(defaultConfig.startingGems);
  });
  it('keeps custom ownership and immutable catalogs isolated between realms', async () => {
    const a = await create('Workshop A'),
      b = await create('Workshop B');
    const draw = async (f: typeof a) =>
      openPack(
        db,
        admin,
        f.id,
        f.view.packs.find((p) => p.name === 'All Characters')!.id,
        randomUUID(),
      );
    const results = await Promise.all([draw(a), draw(b)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await getRealmView(db, admin, a.id)).cards).toHaveLength(1);
    expect((await getRealmView(db, admin, b.id)).cards).toHaveLength(1);
    const before = await count();
    await expect(
      createRealm(
        db,
        admin,
        'Bad replacement',
        defaultConfig,
        { ...customChoice, data: { ...customCatalog, characters: [] } },
        a.preview.fingerprint,
      ),
    ).rejects.toThrow();
    expect(await count()).toBe(before);
    expect((await getRealmView(db, admin, a.id)).catalog).toHaveLength(4);
  });
  it('rolls back realm, membership, and character writes after a mid-install database failure', async () => {
    const before = await count(),
      preview = await previewRealmCatalog(db, admin, defaultConfig, customChoice);
    await db.query(
      `CREATE FUNCTION deny_catalog_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_key='workshop:reed' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER deny_catalog_fixture BEFORE INSERT ON characters FOR EACH ROW EXECUTE FUNCTION deny_catalog_fixture();`,
    );
    try {
      await expect(
        createRealm(db, admin, 'Aborted', defaultConfig, customChoice, preview.fingerprint),
      ).rejects.toThrow();
    } finally {
      await db.query(
        'DROP TRIGGER deny_catalog_fixture ON characters; DROP FUNCTION deny_catalog_fixture();',
      );
    }
    expect(await count()).toBe(before);
    expect((await db.query('SELECT 1 FROM realms WHERE name=$1', ['Aborted'])).rowCount).toBe(0);
  });
  it('preserves custom content and player progress through a fresh-database encrypted restore', async () => {
    const f = await create('Recovered workshop');
    await openPack(
      db,
      admin,
      f.id,
      f.view.packs.find((p) => p.name === 'All Characters')!.id,
      randomUUID(),
    );
    const archive = await exportPlayer(db, admin, f.id),
      passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase),
      fresh = (await server.database('custom_catalog_restored')).db;
    try {
      await restoreBackup(fresh, backup, passphrase);
      await assertBackupRestored(fresh, backup, passphrase);
      const restored = await exportPlayer(fresh, admin, f.id);
      expect({ ...restored, exportedAt: archive.exportedAt }).toEqual(archive);
      expect(
        (
          await fresh.query(
            'SELECT id,source_key,tier,provenance FROM characters WHERE realm_id=$1 ORDER BY id',
            [f.id],
          )
        ).rows,
      ).toEqual(
        (
          await db.query(
            'SELECT id,source_key,tier,provenance FROM characters WHERE realm_id=$1 ORDER BY id',
            [f.id],
          )
        ).rows,
      );
    } finally {
      await fresh.end();
    }
  });
});

describe('original CSV realm creation', () => {
  it('authorizes CSV preview/installation and rejects invalid files or missing rights without writes', async () => {
    const before = await count();
    await expect(previewRealmCatalog(db, player, defaultConfig, csvChoice)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      createRealm(db, player, 'Forbidden CSV', defaultConfig, csvChoice, 'a'.repeat(64)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createRealm(
        db,
        admin,
        'Bad CSV',
        defaultConfig,
        { ...csvChoice, data: 'id,name\nprivate-test-value' },
        'a'.repeat(64),
      ),
    ).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
    await expect(
      previewRealmCatalog(db, admin, defaultConfig, { ...csvChoice, rightsConfirmed: false }),
    ).rejects.toThrow();
    expect(await count()).toBe(before);
  });
  it('installs reviewed CSV assignments and provenance in an isolated playable realm', async () => {
    const csv = await createCsv(),
      json = await create('Equivalent JSON workshop');
    const query =
      'SELECT id,source_key,name,series,categories,tier FROM characters WHERE realm_id=$1 ORDER BY id';
    expect((await db.query(query, [csv.id])).rows).toEqual((await db.query(query, [json.id])).rows);
    expect(csv.view.packs.map((p) => p.name).sort()).toEqual(
      json.view.packs.map((p) => p.name).sort(),
    );
    const provenance = (
      await db.query('SELECT provenance FROM characters WHERE realm_id=$1', [csv.id])
    ).rows;
    for (const row of provenance)
      expect(row.provenance).toMatchObject({
        source: csvMetadata.source,
        revision: csvMetadata.revision,
        license: csvMetadata.license,
        importKind: 'original-csv-v1',
        rightsConfirmed: true,
        calculationVersion: 'source-percentile-v1',
      });
    const pack = csv.view.packs.find((p) => p.name === 'All Characters')!,
      key = randomUUID();
    const opened = await openPack(db, admin, csv.id, pack.id, key);
    expect(opened).toMatchObject({ ok: true, charged: defaultConfig.packPrice });
    expect(await openPack(db, admin, csv.id, pack.id, key)).toEqual(opened);
    expect((await getRealmView(db, admin, json.id)).cards).toHaveLength(0);
    expect((await getRealmView(db, admin, json.id)).balance).toBe(defaultConfig.startingGems);
  });
  it('rejects stale CSV content, metadata, settings, and format reviews', async () => {
    const before = await count(),
      preview = await previewRealmCatalog(db, admin, defaultConfig, csvChoice);
    for (const changed of [
      { ...csvChoice, data: csvChoice.data.replace(',Vale,', ',Changed Vale,') },
      { ...csvChoice, metadata: { ...csvMetadata, revision: 'changed-2' } },
      { ...csvChoice, metadata: { ...csvMetadata, license: 'Changed permission' } },
      customChoice,
    ])
      await expect(
        createRealm(db, admin, 'Stale CSV review', defaultConfig, changed, preview.fingerprint),
      ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
    await expect(
      createRealm(
        db,
        admin,
        'Changed CSV settings',
        { ...defaultConfig, startingGems: 99 },
        csvChoice,
        preview.fingerprint,
      ),
    ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
    expect(await count()).toBe(before);
  });
  it('rolls back the complete CSV install after a database write fails', async () => {
    const before = await count(),
      preview = await previewRealmCatalog(db, admin, defaultConfig, csvChoice);
    await db.query(
      `CREATE FUNCTION deny_csv_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_key='workshop:reed' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER deny_csv_fixture BEFORE INSERT ON characters FOR EACH ROW EXECUTE FUNCTION deny_csv_fixture();`,
    );
    try {
      await expect(
        createRealm(db, admin, 'Aborted CSV', defaultConfig, csvChoice, preview.fingerprint),
      ).rejects.toThrow();
    } finally {
      await db.query(
        'DROP TRIGGER deny_csv_fixture ON characters; DROP FUNCTION deny_csv_fixture();',
      );
    }
    expect(await count()).toBe(before);
    expect((await db.query('SELECT 1 FROM realms WHERE name=$1', ['Aborted CSV'])).rowCount).toBe(
      0,
    );
  });
  it('restores CSV identities, provenance, and progress into a fresh database', async () => {
    const csv = await createCsv('Recovered CSV workshop'),
      pack = csv.view.packs.find((p) => p.name === 'All Characters')!;
    await openPack(db, admin, csv.id, pack.id, randomUUID());
    const archive = await exportPlayer(db, admin, csv.id),
      passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase),
      fresh = (await server.database('csv_restored')).db;
    try {
      await restoreBackup(fresh, backup, passphrase);
      await assertBackupRestored(fresh, backup, passphrase);
      const restored = await exportPlayer(fresh, admin, csv.id);
      expect({ ...restored, exportedAt: archive.exportedAt }).toEqual(archive);
      const query =
        'SELECT id,source_key,tier,provenance FROM characters WHERE realm_id=$1 ORDER BY id';
      expect((await fresh.query(query, [csv.id])).rows).toEqual(
        (await db.query(query, [csv.id])).rows,
      );
    } finally {
      await fresh.end();
    }
  });
});
