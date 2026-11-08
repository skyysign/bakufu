import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  createRealm,
  getRealmView,
  linkDiscordAccount,
  openPack,
  previewRealmCatalog,
  setDiscordGuild,
  type Database,
} from '../../packages/db/src/index';
import { discordGameplay } from '../../packages/db/src/discord-interactions';
import { defaultConfig } from '../support/prototype-config';
import { customCatalog } from '../support/catalog-fixture';
import { startPostgres } from '../support/postgres';
import { normalizeJikanCatalog } from '../../packages/importers/src/providers';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const subject = '100000000000000001',
  application = '900000000000000001';
const choice = {
  rightsConfirmed: true,
  data: {
    ...customCatalog,
    characters: customCatalog.characters.map((character, index) => ({
      ...character,
      categories: [index < 2 ? 'Action' : 'Sci-Fi'],
    })),
  },
};
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('pack_themes')).db;
  admin = await bootstrap(db, 'pack-theme-admin@example.test', randomBytes(24).toString('hex'));
  await linkDiscordAccount(db, 'pack-theme-admin@example.test', subject);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function setup() {
  const preview = await previewRealmCatalog(db, admin, defaultConfig, choice);
  const realm = await createRealm(
    db,
    admin,
    'Original edition fixture',
    defaultConfig,
    choice,
    preview.fingerprint,
  );
  const packs = (
    await db.query('SELECT id,name,category FROM packs WHERE realm_id=$1 ORDER BY id', [realm])
  ).rows;
  return { realm, packs };
}
describe('current themed pack presentation preserves stored gameplay', () => {
  it('creates real demographic pools with separate eligibility and keeps realm-wide ownership', async () => {
    const catalog = normalizeJikanCatalog(
      {
        data: Array.from({ length: 4 }, (_, index) => ({
          mal_id: 910000001 + index,
          name: `Original Demographic Courier ${index}`,
          favorites: 4 - index,
        })),
      },
      {
        medium: 'anime',
        revision: 'original-demographic-1',
        license: 'Original shape fixture, MIT',
        series: 'Original Demographic Academy',
        categories: ['Action'],
      },
    );
    catalog.characters = catalog.characters.map((character, index) => ({
      ...character,
      categories: [...character.categories, index < 2 ? 'Shounen' : 'Seinen'],
    }));
    const choice = { rightsConfirmed: true, data: catalog };
    const preview = await previewRealmCatalog(db, admin, defaultConfig, choice);
    expect(preview.packs.map((pack) => [pack.name, pack.poolSize])).toEqual([
      ['Seinen', 2],
      ['Shōnen', 2],
      ['All Characters', 4],
    ]);
    const realm = await createRealm(
      db,
      admin,
      'Original demographic fixture',
      defaultConfig,
      choice,
      preview.fingerprint,
    );
    const view = await getRealmView(db, admin, realm);
    expect(view.packGrouping).toEqual({ mode: 'demographics', missingDemographics: false });
    const pack = view.packs.find((pack) => pack.category === 'Shounen')!;
    const result = await openPack(db, admin, realm, pack.id, randomUUID());
    if (!result.ok) throw new Error('Original demographic fixture did not open.');
    expect(result.characters.every((character) => character.categories.includes('Shounen'))).toBe(
      true,
    );
    const after = await getRealmView(db, admin, realm);
    expect(after.packs.find((pack) => pack.category === 'Shounen')?.available).toBe(1);
    expect(after.packs.find((pack) => pack.category === 'Seinen')?.available).toBe(2);
    expect(after.packs.find((pack) => pack.category === null)?.available).toBe(3);
  });
  it('keeps saved anime genre packs visible without rewriting saved packs, cards or receipts', async () => {
    const catalog = normalizeJikanCatalog(
      {
        data: Array.from({ length: 4 }, (_, index) => ({
          mal_id: 920000001 + index,
          name: `Original Legacy Courier ${index}`,
          favorites: 4 - index,
        })),
      },
      {
        medium: 'anime',
        revision: 'original-legacy-demographic-1',
        license: 'Original shape fixture, MIT',
        series: 'Original Legacy Academy',
        categories: ['Action'],
      },
    );
    const choice = { rightsConfirmed: true, data: catalog };
    const preview = await previewRealmCatalog(db, admin, defaultConfig, choice);
    expect(preview.packs.map((pack) => pack.name)).toEqual(['All Characters']);
    const realm = await createRealm(
      db,
      admin,
      'Original legacy demographic fixture',
      defaultConfig,
      choice,
      preview.fingerprint,
    );
    const legacy = randomUUID(),
      custom = randomUUID();
    await db.query(
      'INSERT INTO packs(realm_id,id,name,category) VALUES($1,$2,$3,$4),($1,$5,$6,$4)',
      [realm, legacy, 'Battle Arena', 'Action', custom, 'Original Academy Favorites'],
    );
    const receipt = await openPack(db, admin, realm, legacy, randomUUID());
    expect(receipt.ok).toBe(true);
    const saved = await Promise.all(
      ['packs', 'cards', 'openings'].map(
        async (table) =>
          (await db.query(`SELECT * FROM ${table} WHERE realm_id=$1 ORDER BY id`, [realm])).rows,
      ),
    );
    const view = await getRealmView(db, admin, realm);
    expect(view.packGrouping).toEqual({ mode: 'demographics', missingDemographics: true });
    expect(view.packs.map((pack) => pack.name).sort()).toEqual([
      'All Characters',
      'Battle Arena',
      'Original Academy Favorites',
    ]);
    expect(view.lastOpening).toEqual(receipt);
    expect(view.cards).toHaveLength(1);
    expect(view.balance).toBe(90);
    const after = await Promise.all(
      ['packs', 'cards', 'openings'].map(
        async (table) =>
          (await db.query(`SELECT * FROM ${table} WHERE realm_id=$1 ORDER BY id`, [realm])).rows,
      ),
    );
    expect(after).toEqual(saved);
  });
  it('installs themed defaults and maps old defaults without changing IDs, pools or saved openings', async () => {
    const { realm, packs } = await setup();
    expect(packs.find((pack) => pack.category === 'Action')?.name).toBe('Battle Arena');
    expect(packs.find((pack) => pack.category === 'Sci-Fi')?.name).toBe('Future City');
    await db.query('UPDATE packs SET name=category WHERE realm_id=$1 AND category IS NOT NULL', [
      realm,
    ]);
    const action = packs.find((pack) => pack.category === 'Action')!;
    expect(await openPack(db, admin, realm, action.id, randomUUID(), 1)).toMatchObject({
      ok: true,
      charged: 10,
    });
    const savedPacks = (
      await db.query('SELECT * FROM packs WHERE realm_id=$1 ORDER BY id', [realm])
    ).rows;
    const savedOpenings = (
      await db.query('SELECT * FROM openings WHERE realm_id=$1 ORDER BY id', [realm])
    ).rows;
    const view = await getRealmView(db, admin, realm);
    expect(view.packs.find((pack) => pack.id === action.id)).toMatchObject({
      name: 'Battle Arena',
      category: 'Action',
      available: 1,
    });
    expect(view.packs.find((pack) => pack.category === 'Sci-Fi')?.name).toBe('Future City');
    expect(view.balance).toBe(90);
    expect(
      (await db.query('SELECT * FROM packs WHERE realm_id=$1 ORDER BY id', [realm])).rows,
    ).toEqual(savedPacks);
    expect(
      (await db.query('SELECT * FROM openings WHERE realm_id=$1 ORDER BY id', [realm])).rows,
    ).toEqual(savedOpenings);
    await db.query('UPDATE packs SET name=$3 WHERE realm_id=$1 AND id=$2', [
      realm,
      action.id,
      'My Original Favorites',
    ]);
    expect(
      (await getRealmView(db, admin, realm)).packs.find((pack) => pack.id === action.id)?.name,
    ).toBe('My Original Favorites');
  });
  it('accepts current and saved Discord names, while ambiguous custom names never choose a winner', async () => {
    const { realm, packs } = await setup(),
      guildId = '600000000000000001';
    await db.query('UPDATE packs SET name=category WHERE realm_id=$1 AND category IS NOT NULL', [
      realm,
    ]);
    await setDiscordGuild(db, admin, realm, guildId);
    const listed = await discordGameplay(db, application, {
      kind: 'packs',
      id: '700000000000000001',
      guildId,
      subject,
    });
    expect(listed).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining('Battle Arena') },
    });
    for (const [index, pack] of [
      'Action',
      'Battle Arena',
      packs.find((pack) => pack.category === 'Action')!.id,
    ].entries()) {
      const quote = await discordGameplay(db, application, {
        kind: 'quote',
        id: String(700000000000000010n + BigInt(index)),
        guildId,
        subject,
        pack,
      });
      expect(quote).toMatchObject({
        type: 4,
        data: { content: expect.stringContaining('Battle Arena'), components: expect.any(Array) },
      });
    }
    expect((await getRealmView(db, admin, realm)).balance).toBe(100);
    expect((await db.query('SELECT 1 FROM openings WHERE realm_id=$1', [realm])).rowCount).toBe(0);
    await db.query(
      "UPDATE packs SET name='My Favorites' WHERE realm_id=$1 AND category IS NOT NULL",
      [realm],
    );
    await expect(
      discordGameplay(db, application, {
        kind: 'quote',
        id: '700000000000000020',
        guildId,
        subject,
        pack: 'My Favorites',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PACK' });
  });
});
