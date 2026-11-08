import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  createRealm,
  previewRealmCatalog,
  provisionPlayer,
  getRealmView,
  openPack,
  exportPlayer,
  type Database,
} from '../../packages/db/src/index';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { startPostgres } from '../support/postgres';
import { installLegacySchema, seedLegacyRealm } from '../support/legacy';
import { customChoice, csvChoice } from '../support/catalog-fixture';
import { manualPlan } from '../support/pack-plan-fixture';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string, player: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('realm_creation')).db;
  admin = await bootstrap(db, 'realm-creator@example.test', password);
  player = await provisionPlayer(
    db,
    await createRealm(db, admin, 'Role fixture', defaultConfig),
    'creation-player@example.test',
    password,
  );
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function create(key: string, catalog: unknown = customChoice, name = 'Retryable realm') {
  const preview = await previewRealmCatalog(db, admin, defaultConfig, catalog, manualPlan);
  return createRealm(db, admin, name, defaultConfig, catalog, preview.fingerprint, manualPlan, key);
}
describe('durable realm creation receipts', () => {
  it('serializes concurrent retries, normalizes UUID case, and grants once', async () => {
    const key = randomUUID(),
      results = await Promise.all([create(key), create(key.toUpperCase()), create(key)]);
    expect(new Set(results).size).toBe(1);
    const id = results[0];
    expect(
      (
        await db.query(
          'SELECT 1 FROM realm_creation_requests WHERE account_id=$1 AND request_key=$2',
          [admin, key],
        )
      ).rowCount,
    ).toBe(1);
    expect((await db.query('SELECT 1 FROM wallet_ledger WHERE realm_id=$1', [id])).rowCount).toBe(
      1,
    );
    expect((await getRealmView(db, admin, id)).balance).toBe(100);
  });
  it('replays after subsequent gameplay without re-importing or resetting progress', async () => {
    const key = randomUUID(),
      id = await create(key, csvChoice),
      view = await getRealmView(db, admin, id);
    await openPack(db, admin, id, view.packs[0].id, randomUUID());
    const before = await exportPlayer(db, admin, id);
    expect(await create(key, csvChoice)).toBe(id);
    const after = await exportPlayer(db, admin, id);
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  });
  it('rejects key reuse for changed names, config, catalog, format, or selected packs', async () => {
    const key = randomUUID();
    await create(key);
    await expect(create(key, customChoice, 'Different')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(create(key, csvChoice)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const preview = await previewRealmCatalog(db, admin, defaultConfig, customChoice, manualPlan);
    await expect(
      createRealm(
        db,
        admin,
        'Retryable realm',
        { ...defaultConfig, startingGems: 99 },
        customChoice,
        preview.fingerprint,
        manualPlan,
        key,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      createRealm(
        db,
        admin,
        'Retryable realm',
        defaultConfig,
        customChoice,
        preview.fingerprint,
        { schemaVersion: 1, categories: [] },
        key,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('requires authorization even for an existing receipt and validates HTTP-style required keys', async () => {
    const key = randomUUID();
    await create(key);
    await expect(
      createRealm(db, player, 'Denied', defaultConfig, customChoice, undefined, manualPlan, key),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createRealm(db, admin, 'Missing key', defaultConfig, undefined, undefined, undefined, null),
    ).rejects.toThrow();
  });
  it('rolls the receipt and every realm write back together and accepts retry after recovery', async () => {
    const key = randomUUID();
    const counts = async () =>
      (
        await db.query(
          `SELECT (SELECT count(*) FROM realms) AS realms,(SELECT count(*) FROM memberships) AS members,(SELECT count(*) FROM characters) AS characters,(SELECT count(*) FROM packs) AS packs,(SELECT count(*) FROM wallet_ledger) AS grants,(SELECT count(*) FROM realm_creation_requests) AS receipts`,
        )
      ).rows[0];
    const before = await counts();
    await db.query(
      `CREATE FUNCTION deny_creation_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER deny_creation_fixture BEFORE INSERT ON realm_creation_requests FOR EACH ROW EXECUTE FUNCTION deny_creation_fixture();`,
    );
    try {
      await expect(create(key)).rejects.toThrow();
    } finally {
      await db.query(
        'DROP TRIGGER deny_creation_fixture ON realm_creation_requests; DROP FUNCTION deny_creation_fixture();',
      );
    }
    expect(
      (await db.query('SELECT 1 FROM realm_creation_requests WHERE request_key=$1', [key]))
        .rowCount,
    ).toBe(0);
    expect(await counts()).toEqual(before);
    const id = await create(key);
    expect(await create(key)).toBe(id);
  });
  it('adds schema 0012 without altering legacy rows and restores a schema-0011 snapshot', async () => {
    const legacy = (await server.database('creation_legacy', false)).db,
      fresh = (await server.database('creation_legacy_restored')).db;
    try {
      await installLegacySchema(legacy, 11);
      const actor = await bootstrap(legacy, 'legacy-creator@example.test', password),
        id = (await seedLegacyRealm(legacy, actor)).realmId;
      const before = await exportPlayer(legacy, actor, id),
        key = randomBytes(24).toString('hex'),
        archive = await makeBackup(legacy, key);
      await migrate(legacy);
      expect((await legacy.query('SELECT 1 FROM realm_creation_requests')).rowCount).toBe(0);
      const after = await exportPlayer(legacy, actor, id);
      expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
      await restoreBackup(fresh, archive, key);
      await assertBackupRestored(fresh, archive, key);
      expect((await fresh.query('SELECT 1 FROM realm_creation_requests')).rowCount).toBe(0);
    } finally {
      await legacy.end();
      await fresh.end();
    }
  });
  it('preserves request keys and safe replay after encrypted fresh-database recovery', async () => {
    const key = randomUUID(),
      id = await create(key),
      passphrase = randomBytes(24).toString('hex'),
      archive = await makeBackup(db, passphrase),
      fresh = (await server.database('creation_recovered')).db;
    try {
      await restoreBackup(fresh, archive, passphrase);
      await assertBackupRestored(fresh, archive, passphrase);
      const preview = await previewRealmCatalog(
        fresh,
        admin,
        defaultConfig,
        customChoice,
        manualPlan,
      );
      expect(
        await createRealm(
          fresh,
          admin,
          'Retryable realm',
          defaultConfig,
          customChoice,
          preview.fingerprint,
          manualPlan,
          key,
        ),
      ).toBe(id);
      expect(
        (await fresh.query('SELECT 1 FROM realm_creation_requests WHERE request_key=$1', [key]))
          .rowCount,
      ).toBe(1);
    } finally {
      await fresh.end();
    }
  });
});
