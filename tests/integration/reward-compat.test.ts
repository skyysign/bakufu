import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  bootstrap,
  createRealm,
  getRealmView,
  openPack,
  transaction,
  exportPlayer,
  type Database,
} from '../../packages/db/src/index';
import { addMembership } from '../../packages/db/src/auth';
import { parseRealmConfig } from '../../packages/config/src/index';
import { defaultConfig, legacyRules } from '../support/prototype-config';
import { parseCatalog } from '../../packages/importers/src/index';
import { buildStarterPacks } from '../../packages/core/src/index';
import demo from '../../packages/importers/fixtures/demo.v1.json';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { installLegacySchema } from '../support/legacy';
import { startPostgres } from '../support/postgres';
let server: Awaited<ReturnType<typeof startPostgres>>,
  source: Database,
  fresh: Database,
  actor: string,
  realm: string,
  archive: string;
const key = randomUUID(),
  password = randomBytes(24).toString('hex'),
  passphrase = randomBytes(24).toString('hex'),
  name = 'Pre-reward realm';
// Reproduce the prior config-v7 serialization independently of the preview implementation.
const { gemRewards: futureRules, ...olderRules } = defaultConfig;
void futureRules;
const config = { ...legacyRules(olderRules), schemaVersion: 7 };
const parsed = parseCatalog(demo);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const preview = sha({ config, catalog: parsed.catalog, kind: 'demo' });
const fingerprint = sha({ schemaVersion: 1, name, preview, expectedPreview: preview });
beforeAll(async () => {
  server = await startPostgres();
  source = (await server.database('reward_compat_source', false)).db;
  fresh = (await server.database('reward_compat_fresh')).db;
  await installLegacySchema(source, 15);
  actor = await bootstrap(source, 'reward-compat@example.test', password);
  realm = randomUUID();
  await transaction(source, async (tx) => {
    await tx.query('INSERT INTO realms(id,name,config,created_by) VALUES($1,$2,$3,$4)', [
      realm,
      name,
      config,
      actor,
    ]);
    await addMembership(tx, realm, actor, 'admin', config.startingGems);
    for (const c of parsed.characters)
      await tx.query(
        'INSERT INTO characters(realm_id,id,source_key,name,series,categories,tier,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          realm,
          c.id,
          c.sourceKey,
          c.name,
          c.series,
          c.categories,
          c.tier,
          {
            source: parsed.catalog.source,
            revision: parsed.catalog.revision,
            license: parsed.catalog.license,
            calculationVersion: parsed.calculationVersion,
            calculatedAt: new Date().toISOString(),
          },
        ],
      );
    for (const p of buildStarterPacks(parsed.characters, parseRealmConfig(config)))
      await tx.query('INSERT INTO packs(realm_id,id,name,category) VALUES($1,$2,$3,$4)', [
        realm,
        randomUUID(),
        p.name,
        p.category,
      ]);
    await tx.query(
      'INSERT INTO realm_creation_requests(account_id,request_key,realm_id,fingerprint) VALUES($1,$2,$3,$4)',
      [actor, key, realm, fingerprint],
    );
  });
  archive = await makeBackup(source, passphrase);
});
afterAll(async () => {
  await source?.end();
  await fresh?.end();
  await server?.stop();
});
const replay = (db: Database, input: unknown = config) =>
  createRealm(db, actor, name, input, undefined, preview, undefined, key);
describe('pre-reward release compatibility', () => {
  it('replays the exact v7 creation receipt after migration and later gameplay without changing it', async () => {
    const before = (
      await source.query('SELECT to_jsonb(r) AS receipt FROM realm_creation_requests r')
    ).rows[0].receipt;
    await migrate(source);
    expect(await replay(source)).toBe(realm);
    const view = await getRealmView(source, actor, realm);
    expect(view.gemReward.enabled).toBe(false);
    await openPack(source, actor, realm, view.packs[0].id, randomUUID());
    const player = await exportPlayer(source, actor, realm);
    expect(await replay(source)).toBe(realm);
    const after = await exportPlayer(source, actor, realm);
    expect({ ...after, exportedAt: player.exportedAt }).toEqual(player);
    expect(
      (await source.query('SELECT to_jsonb(r) AS receipt FROM realm_creation_requests r')).rows[0]
        .receipt,
    ).toEqual(before);
    await expect(replay(source, { ...config, packPrice: 11 })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
  it('restores the authentic schema-0015 snapshot and preserves replay without granting timed gems', async () => {
    await restoreBackup(fresh, archive, passphrase);
    await assertBackupRestored(fresh, archive, passphrase);
    expect(await replay(fresh)).toBe(realm);
    const view = await getRealmView(fresh, actor, realm);
    expect(view.balance).toBe(100);
    expect(view.gemReward.enabled).toBe(false);
    expect((await fresh.query('SELECT 1 FROM gem_reward_claims')).rowCount).toBe(0);
  });
});
