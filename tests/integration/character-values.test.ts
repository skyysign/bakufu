import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { defaultConfig } from '../../packages/config/src/index';
import {
  bootstrap,
  createRealm,
  getRealmView,
  openPack,
  previewRealmCatalog,
  provisionPlayer,
  recycleCard,
  setWishlistEntry,
  exportPlayer,
  parsePlayerArchive,
  previewCharacterPopularity,
  applyCharacterPopularity,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { generateScaleCatalog } from '../../packages/importers/src/index';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('character_values')).db;
  admin = await bootstrap(db, 'values-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function setup() {
  const catalog = generateScaleCatalog(),
    choice = { data: catalog, rightsConfirmed: true },
    config = { ...defaultConfig, startingGems: 50000 };
  const preview = await previewRealmCatalog(db, admin, config, choice),
    id = await createRealm(
      db,
      admin,
      'Original dynamic value fixture',
      config,
      choice,
      preview.fingerprint,
    );
  return { id, catalog };
}
describe('character values and preserved evidence', () => {
  it('stores source popularity and quotes different values within the same tier', async () => {
    const { id, catalog } = await setup(),
      view = await getRealmView(db, admin, id);
    expect(view.characterValues[catalog.characters[0].id].popularity).toBe(
      catalog.characters[0].popularity,
    );
    const common = view.catalog.filter((card) => card.tier === 'common');
    expect(
      new Set(common.map((card) => view.characterValues[card.id].marketValue)).size,
    ).toBeGreaterThan(1);
    expect(view.characterValues[common[0].id].recycleValue).toBe(
      view.characterValues[common[0].id].marketValue,
    );
  });
  it('counts other-member wishes, excludes the owner and never mixes realms', async () => {
    const { id } = await setup(),
      player = await provisionPlayer(db, id, 'values-player@example.test', password),
      initial = await getRealmView(db, admin, id);
    const opened = await openPack(db, admin, id, initial.packs[0].id, randomUUID());
    if (!opened.ok) throw new Error('Fixture failed.');
    const character = opened.characters[0],
      before = (await getRealmView(db, admin, id)).characterValues[character.id];
    await setWishlistEntry(db, admin, id, character.id, true, randomUUID());
    expect((await getRealmView(db, admin, id)).characterValues[character.id]).toEqual(before);
    await setWishlistEntry(db, player, id, character.id, true, randomUUID());
    const demand = (await getRealmView(db, admin, id)).characterValues[character.id];
    expect(demand.wishlistDemand).toBe(1);
    expect(demand.marketValue).toBeGreaterThan(before.marketValue);
    const other = await setup();
    expect(
      (await getRealmView(db, admin, other.id)).characterValues[character.id].wishlistDemand,
    ).toBe(0);
  });
  it('recycles once at the current quote, preserves past evidence after wishes change and restores fresh', async () => {
    const { id } = await setup(),
      player = await provisionPlayer(db, id, 'values-history@example.test', password),
      initial = await getRealmView(db, admin, id);
    const opened = await openPack(db, admin, id, initial.packs[0].id, randomUUID());
    if (!opened.ok) throw new Error('Fixture failed.');
    const card = opened.characters[0];
    await setWishlistEntry(db, player, id, card.id, true, randomUUID());
    const quote = (await getRealmView(db, admin, id)).characterValues[card.id],
      key = randomUUID();
    const [first, replay] = await Promise.all([
      recycleCard(db, admin, id, opened.cardIds[0], key),
      recycleCard(db, admin, id, opened.cardIds[0], key),
    ]);
    expect(replay).toEqual(first);
    expect(first.credited).toBe(quote.recycleValue);
    expect(first.valuation).toEqual(quote);
    await setWishlistEntry(db, player, id, card.id, false, randomUUID());
    expect(await recycleCard(db, admin, id, opened.cardIds[0], key)).toEqual(first);
    const archive = await exportPlayer(db, admin, id);
    expect(archive.schemaVersion).toBe(12);
    expect(parsePlayerArchive(archive)).toEqual(archive);
    expect(archive.recyclingValuations[0].quote).toEqual(quote);
    const encrypted = await makeBackup(db, password),
      fresh = (await server.database('values_restore')).db;
    try {
      await restoreBackup(fresh, encrypted, password);
      await assertBackupRestored(fresh, encrypted, password);
      expect(await recycleCard(fresh, admin, id, opened.cardIds[0], key)).toEqual(first);
    } finally {
      await fresh.end();
    }
  });
  it('backfills only matching missing popularity, rejects players/stale/conflicting evidence, and leaves cards/rules untouched', async () => {
    const { id, catalog } = await setup(),
      player = await provisionPlayer(db, id, 'values-backfill@example.test', password);
    await db.query('UPDATE characters SET popularity=NULL WHERE realm_id=$1', [id]);
    const before = await getRealmView(db, admin, id),
      preview = await previewCharacterPopularity(db, admin, id, catalog);
    expect(preview.changedCharacters).toBe(1000);
    await expect(previewCharacterPopularity(db, player, id, catalog)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const result = await applyCharacterPopularity(db, admin, id, catalog, preview.previewHash);
    expect(result.changedCharacters).toBe(1000);
    const after = await getRealmView(db, admin, id);
    expect(after.balance).toBe(before.balance);
    expect(after.config).toEqual(before.config);
    expect(after.catalog).toEqual(before.catalog);
    expect((await previewCharacterPopularity(db, admin, id, catalog)).changedCharacters).toBe(0);
    await expect(
      applyCharacterPopularity(db, admin, id, catalog, preview.previewHash),
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    const wrong = structuredClone(catalog);
    wrong.characters[0].popularity!++;
    await expect(previewCharacterPopularity(db, admin, id, wrong)).rejects.toMatchObject({
      code: 'POPULARITY_CONFLICT',
    });
  });
});
