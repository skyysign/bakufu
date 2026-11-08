import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  previewRealmCatalog,
  parsePlayerArchive,
  transaction,
} from '../../packages/db/src/index';
import { parseRealmConfig } from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { buildStarterPacks } from '../../packages/core/src/index';
import { parseCatalog, parseCsvCatalog } from '../../packages/importers/src/index';
import demo from '../../packages/importers/fixtures/demo.v1.json';
import { migrate } from '../../packages/db/src/migrate';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { installLegacySchema, legacyConfig } from '../support/legacy';
import { customChoice, csvChoice } from '../support/catalog-fixture';
import { manualPlan } from '../support/pack-plan-fixture';
import { startPostgres } from '../support/postgres';

// Independent pre-v7 normalized config in the exact v6 schema field order.
// Do not derive this fixture or its digests from prepareRealmCatalog.
const configV6 = {
  schemaVersion: 6,
  ownership: 'unique',
  packPrice: 10,
  packSize: 1,
  startingGems: 100,
  cooldownSeconds: 0,
  minimumPoolSize: 2,
  maximumCategoryPacks: 10,
  tierWeights: { common: 70, uncommon: 25, rare: 5 },
  emptyTierPolicy: 'renormalize',
  partialPackPolicy: 'reject',
  recycleRewards: { common: 2, uncommon: 4, rare: 6 },
  progression: { xpPerNewCharacter: 10, levelThresholds: [0, 20, 40, 70, 100] },
  upgrades: {
    packDiscount: [
      { cost: 10, requiredLevel: 2, discount: 1 },
      { cost: 20, requiredLevel: 3, discount: 2 },
    ],
  },
  wishlist: { slots: 3, weightMultiplier: 2 },
  trading: {
    enabled: true,
    maxCardsPerSide: 5,
    maxGemsPerSide: 1000000,
    maxPendingPerPlayer: 10,
    expiresAfterMinutes: 1440,
  },
};
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let server: Awaited<ReturnType<typeof startPostgres>>,
  sequence = 0;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
});
afterAll(async () => {
  await server?.stop();
});
async function oldCreation(mode: 'json' | 'csv' | 'demo' = 'json', reviewed = true) {
  const db = (
    await server.database(`creation_compat_${String.fromCharCode(97 + sequence++)}`, false)
  ).db;
  await installLegacySchema(db, 13);
  const actor = await bootstrap(db, 'creation-compat@example.test', password),
    realm = randomUUID(),
    key = randomUUID(),
    name = 'Retained original creation';
  const choice = mode === 'json' ? customChoice : mode === 'csv' ? csvChoice : undefined;
  const parsed =
    mode === 'csv'
      ? parseCsvCatalog(csvChoice.data, csvChoice.metadata)
      : parseCatalog(choice ? customChoice.data : demo);
  const kind = mode === 'demo' ? 'demo' : mode === 'csv' ? 'original-csv' : 'original-json',
    plan = mode === 'demo' ? undefined : manualPlan;
  const preview = sha({
    config: configV6,
    catalog: parsed.catalog,
    kind,
    ...(plan === undefined ? {} : { packPlan: plan }),
  });
  const expectedPreview = reviewed ? preview : undefined;
  const fingerprint = sha({
    schemaVersion: 1,
    name,
    preview,
    expectedPreview: expectedPreview ?? null,
  });
  const packs = buildStarterPacks(parsed.characters, parseRealmConfig(configV6), plan);
  await transaction(db, async (tx) => {
    await tx.query('INSERT INTO realms(id,name,config,created_by) VALUES($1,$2,$3,$4)', [
      realm,
      name,
      configV6,
      actor,
    ]);
    await tx.query(
      "INSERT INTO memberships(realm_id,account_id,role,balance) VALUES($1,$2,'admin',100)",
      [realm, actor],
    );
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason) VALUES($1,$2,$3,'starting-grant',100,100,'starting_grant')",
      [realm, randomUUID(), actor],
    );
    for (const character of parsed.characters)
      await tx.query(
        'INSERT INTO characters(realm_id,id,source_key,name,series,categories,tier,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          realm,
          character.id,
          character.sourceKey,
          character.name,
          character.series,
          character.categories,
          character.tier,
          {
            source: parsed.catalog.source,
            revision: parsed.catalog.revision,
            license: parsed.catalog.license,
            calculationVersion: parsed.calculationVersion,
            calculatedAt: new Date().toISOString(),
            ...(mode === 'demo' ? {} : { importKind: `${kind}-v1`, rightsConfirmed: true }),
          },
        ],
      );
    for (const pack of packs)
      await tx.query('INSERT INTO packs(realm_id,id,name,category) VALUES($1,$2,$3,$4)', [
        realm,
        randomUUID(),
        pack.name,
        pack.category,
      ]);
    await tx.query(
      'INSERT INTO realm_creation_requests(account_id,request_key,realm_id,fingerprint) VALUES($1,$2,$3,$4)',
      [actor, key, realm, fingerprint],
    );
  });
  const receipt = async (target = db) =>
    (
      await target.query(
        'SELECT to_jsonb(r) AS row FROM realm_creation_requests r WHERE account_id=$1 AND request_key=$2',
        [actor, key],
      )
    ).rows[0].row;
  const replay = (target = db, input: unknown = configV6) =>
    createRealm(target, actor, name, input, choice, expectedPreview, plan, key);
  return {
    db,
    actor,
    realm,
    key,
    name,
    choice,
    plan,
    preview,
    expectedPreview,
    fingerprint,
    receipt,
    replay,
  };
}

describe('pre-rank creation receipt compatibility', () => {
  it('replays a genuine schema-0013 JSON creation after migration and later gameplay without rewriting its receipt', async () => {
    const f = await oldCreation(),
      receipt = await f.receipt();
    try {
      await migrate(f.db);
      expect(await f.replay()).toBe(f.realm);
      const view = await getRealmView(f.db, f.actor, f.realm);
      expect(await openPack(f.db, f.actor, f.realm, view.packs[0].id, randomUUID())).toMatchObject({
        ok: true,
        charged: 10,
      });
      const before = await exportPlayer(f.db, f.actor, f.realm);
      const v8: Record<string, unknown> = { ...before, schemaVersion: 8 };
      for (const field of [
        'collectorRank',
        'rankRules',
        'rankPurchases',
        'marketListings',
        'gemRewardRules',
        'gemRewardClaims',
        'rankTrackRules',
        'rankTrackLevels',
        'rankTrackPurchases',
        'characterValueRules',
        'characterValues',
        'recyclingValuations',
        'rankTrackRules',
        'rankTrackLevels',
        'rankTrackPurchases',
        'characterValueRules',
        'characterValues',
        'recyclingValuations',
      ])
        delete v8[field];
      expect(parsePlayerArchive(v8)).toEqual(v8);
      const v9: Record<string, unknown> = { ...before, schemaVersion: 9 };
      for (const field of [
        'rankTrackRules',
        'rankTrackLevels',
        'rankTrackPurchases',
        'characterValueRules',
        'characterValues',
        'recyclingValuations',
      ])
        delete v9[field];
      delete v9.gemRewardRules;
      delete v9.gemRewardClaims;
      expect(parsePlayerArchive(v9)).toEqual(v9);
      expect(await f.replay()).toBe(f.realm);
      const after = await exportPlayer(f.db, f.actor, f.realm);
      expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
      expect(await f.receipt()).toEqual(receipt);
      expect(
        (
          await f.db.query(
            "SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND reason='starting_grant'",
            [f.realm],
          )
        ).rowCount,
      ).toBe(1);
    } finally {
      await f.db.end();
    }
  });
  it('revalidates legacy digests and rejects edited old proposals and unreviewed rank benefits', async () => {
    const f = await oldCreation();
    try {
      await migrate(f.db);
      await expect(f.replay(f.db, { ...configV6, packPrice: 11 })).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
      });
      for (const proposal of [
        { name: f.name + ' changed', config: configV6, catalog: f.choice, plan: f.plan },
        {
          name: f.name,
          config: configV6,
          catalog: { ...customChoice, data: { ...customChoice.data, revision: 'changed' } },
          plan: f.plan,
        },
        {
          name: f.name,
          config: configV6,
          catalog: f.choice,
          plan: { schemaVersion: 1, categories: [] },
        },
        { name: f.name, config: defaultConfig, catalog: f.choice, plan: f.plan },
      ])
        await expect(
          createRealm(
            f.db,
            f.actor,
            proposal.name,
            proposal.config,
            proposal.catalog,
            f.expectedPreview,
            proposal.plan,
            f.key,
          ),
        ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await expect(
        createRealm(
          f.db,
          f.actor,
          f.name,
          { ...configV6, packPrice: 11 },
          f.choice,
          f.expectedPreview,
          f.plan,
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
      await expect(
        createRealm(
          f.db,
          f.actor,
          f.name,
          defaultConfig,
          f.choice,
          f.expectedPreview,
          f.plan,
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'CATALOG_PREVIEW_CHANGED' });
      expect(await f.replay()).toBe(f.realm);
      expect((await f.db.query('SELECT 1 FROM realms')).rowCount).toBe(1);
    } finally {
      await f.db.end();
    }
  });
  it('recovers reviewed CSV and normalized v1 requests using the original v6 digest', async () => {
    const f = await oldCreation('csv'),
      old = await oldCreation('json');
    try {
      await migrate(f.db);
      await migrate(old.db);
      expect(await f.replay()).toBe(f.realm);
      // Before v7, old v1 input normalized to this same complete v6 config.
      expect(await old.replay(old.db, legacyConfig)).toBe(old.realm);
      const preview = await previewRealmCatalog(f.db, f.actor, configV6, f.choice, f.plan);
      expect(preview.fingerprint).not.toBe(f.preview);
      expect(preview).not.toHaveProperty('legacyFingerprint');
      const key = randomUUID(),
        newId = await createRealm(
          f.db,
          f.actor,
          'Current reviewed legacy input',
          configV6,
          f.choice,
          preview.fingerprint,
          f.plan,
          key,
        );
      expect(
        await createRealm(
          f.db,
          f.actor,
          'Current reviewed legacy input',
          configV6,
          f.choice,
          preview.fingerprint,
          f.plan,
          key,
        ),
      ).toBe(newId);
    } finally {
      await f.db.end();
      await old.db.end();
    }
  });
  it('preserves old keyed demo calls without a preview and current keyed demo retries', async () => {
    const f = await oldCreation('demo', false),
      before = await f.receipt();
    try {
      await migrate(f.db);
      expect(await f.replay()).toBe(f.realm);
      expect(await f.receipt()).toEqual(before);
      await expect(f.replay(f.db, { ...configV6, startingGems: 99 })).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
      });
      const key = randomUUID(),
        id = await createRealm(
          f.db,
          f.actor,
          'New unreviewed legacy demo',
          configV6,
          undefined,
          undefined,
          undefined,
          key,
        );
      expect(
        await createRealm(
          f.db,
          f.actor,
          'New unreviewed legacy demo',
          configV6,
          undefined,
          undefined,
          undefined,
          key,
        ),
      ).toBe(id);
    } finally {
      await f.db.end();
    }
  });
  it('restores a schema-0013 encrypted snapshot and retains exact pre-v7 creation replay', async () => {
    const f = await oldCreation('csv'),
      receipt = await f.receipt(),
      key = randomBytes(24).toString('hex'),
      fresh = (await server.database('creation_compat_restored')).db;
    try {
      const archive = await makeBackup(f.db, key);
      await restoreBackup(fresh, archive, key);
      await assertBackupRestored(fresh, archive, key);
      expect(await f.replay(fresh)).toBe(f.realm);
      expect(await f.receipt(fresh)).toEqual(receipt);
      const secondKey = randomBytes(24).toString('hex'),
        current = await makeBackup(fresh, secondKey),
        second = (await server.database('creation_compat_restored_again')).db;
      try {
        await restoreBackup(second, current, secondKey);
        await assertBackupRestored(second, current, secondKey);
        expect(await f.replay(second)).toBe(f.realm);
        expect(await f.receipt(second)).toEqual(receipt);
      } finally {
        await second.end();
      }
    } finally {
      await f.db.end();
      await fresh.end();
    }
  });
});
