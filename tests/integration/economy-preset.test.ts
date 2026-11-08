import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import {
  bootstrap,
  createRealm,
  getRealmView,
  openPack,
  previewRealmCatalog,
  provisionPlayer,
  recycleCard,
  type Database,
} from '../../packages/db/src/index';
import { previewEconomyPreset, applyEconomyPreset } from '../../packages/db/src/economy-preset';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { generateScaleCatalog } from '../../packages/importers/src/index';
import { startPostgres } from '../support/postgres';
import { defaultConfig } from '../support/prototype-config';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('economy_presets')).db;
  admin = await bootstrap(db, 'economy-original@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function realm() {
  const choice = {
    data: generateScaleCatalog(),
    rightsConfirmed: true,
  };
  const preview = await previewRealmCatalog(db, admin, defaultConfig, choice);
  return createRealm(
    db,
    admin,
    'Original economy fixture',
    defaultConfig,
    choice,
    preview.fingerprint,
  );
}
describe('reviewed economy rollout', () => {
  it('preserves every awarded tier, wallet and receipt, applies once, and recovers fresh', async () => {
    const id = await realm(),
      initial = await getRealmView(db, admin, id),
      topIds = initial.catalog
        .filter((character) => character.tier === 'rare')
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 2)
        .map((character) => character.id),
      pack = { id: randomUUID() };
    await db.query(
      "UPDATE characters SET categories=array_append(categories,'Original protected candidates') WHERE realm_id=$1 AND id=ANY($2::uuid[])",
      [id, topIds],
    );
    await db.query(
      "INSERT INTO packs(realm_id,id,name,category) VALUES($1,$2,'Original protected candidates','Original protected candidates')",
      [id, pack.id],
    );
    const first = await openPack(db, admin, id, pack.id, randomUUID());
    if (!first.ok) throw new Error('Original fixture did not open.');
    await recycleCard(db, admin, id, first.cardIds[0], randomUUID());
    const otherId = topIds.find((characterId) => characterId !== first.characters[0].id)!,
      secondPack = randomUUID();
    await db.query(
      "UPDATE characters SET categories=array_append(categories,'Original second candidate') WHERE realm_id=$1 AND id=$2",
      [id, otherId],
    );
    await db.query(
      "INSERT INTO packs(realm_id,id,name,category) VALUES($1,$2,'Original second candidate','Original second candidate')",
      [id, secondPack],
    );
    const second = await openPack(db, admin, id, secondPack, randomUUID());
    if (!second.ok) throw new Error('Second original fixture did not open.');
    const before = await getRealmView(db, admin, id),
      preview = await previewEconomyPreset(db, admin, id),
      key = randomUUID();
    expect(preview.protectedCharacters).toBe(2);
    expect(preview.tierCounts.legendary).toBeGreaterThan(0);
    const [result, replay] = await Promise.all([
      applyEconomyPreset(db, admin, id, key, preview.previewHash),
      applyEconomyPreset(db, admin, id, key, preview.previewHash),
    ]);
    expect(replay).toEqual(result);
    const after = await getRealmView(db, admin, id);
    expect(after.balance).toBe(before.balance);
    expect(after.lastOpening).toEqual(second);
    expect(after.catalog.find((c) => c.id === first.characters[0].id)?.tier).toBe(
      first.characters[0].tier,
    );
    expect(after.config.packPrice).toBe(200);
    expect(after.config.legacyPurchasesRetired).toBe(true);
    expect(
      (
        await db.query('SELECT count(*)::int AS count FROM economy_rebalances WHERE realm_id=$1', [
          id,
        ])
      ).rows[0].count,
    ).toBe(1);
    const passphrase = randomBytes(32).toString('hex'),
      archive = await makeBackup(db, passphrase),
      fresh = (await server.database('economy_recovery')).db;
    try {
      await restoreBackup(fresh, archive, passphrase);
      await assertBackupRestored(fresh, archive, passphrase);
      expect(await applyEconomyPreset(fresh, admin, id, key, preview.previewHash)).toEqual(result);
    } finally {
      await fresh.end();
    }
  });
  it('rejects players and stale previews without changing rules', async () => {
    const id = await realm(),
      player = await provisionPlayer(db, id, 'economy-player@example.test', password),
      preview = await previewEconomyPreset(db, admin, id);
    await expect(previewEconomyPreset(db, player, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      applyEconomyPreset(db, player, id, randomUUID(), preview.previewHash),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const pack = (await getRealmView(db, admin, id)).packs[0];
    await openPack(db, admin, id, pack.id, randomUUID());
    await expect(
      applyEconomyPreset(db, admin, id, randomUUID(), preview.previewHash),
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    expect((await getRealmView(db, admin, id)).config.packPrice).toBe(10);
  });
});
