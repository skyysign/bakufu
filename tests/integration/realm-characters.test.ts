import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addRealmCharacters,
  addRealmPacks,
  openPack,
  realmGenderGaps,
  realmPackPlan,
  retireRealmPack,
  setRealmCharacterGenders,
  additionTier,
  bootstrap,
  browseRealmCatalog,
  checkRealmCharacters,
  createRealm,
  getRealmView,
  previewRealmCatalog,
  provisionPlayer,
  realmCharacterSummary,
  type Database,
} from '../../packages/db/src/index';
import { defaultConfig } from '../../packages/config/src/index';
import { providerCharacterId } from '../../packages/importers/src/providers';
import { startPostgres } from '../support/postgres';

// Original fictional provider-shaped roster: no real names or provider data.
function entry(index: number, popularity: number | null, categories = ['Action', '2010s']) {
  return {
    id: providerCharacterId('mal', 910000000 + index),
    sourceKey: `mal:${910000000 + index}`,
    name: `Original Lantern Courier ${index}`,
    series: `Original Series ${index % 7}`,
    categories,
    popularity,
  };
}
const roster = {
  schemaVersion: 1,
  source: 'mal',
  revision: 'original-addition-fixture',
  license: 'Original fictional provider-shaped fixture, MIT',
  characters: Array.from({ length: 1000 }, (_, index) =>
    entry(index, 1000 - index, ['Action', index % 2 ? 'Fantasy' : 'Mystery', '2010s']),
  ),
};
const config = { ...defaultConfig, startingGems: 50000 };

let server: Awaited<ReturnType<typeof startPostgres>>,
  db: Database,
  admin: string,
  player: string,
  realm: string,
  demoRealm: string;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('realm_characters')).db;
  admin = await bootstrap(db, 'addition-admin@example.test', randomBytes(24).toString('hex'));
  const catalog = { data: roster, rightsConfirmed: true };
  const preview = await previewRealmCatalog(db, admin, config, catalog);
  realm = await createRealm(db, admin, 'Original addition realm', config, catalog, preview.fingerprint);
  demoRealm = await createRealm(db, admin, 'Original demo realm', config);
  player = await provisionPlayer(db, realm, 'addition-player@example.test', randomBytes(24).toString('hex'));
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

describe('adding missing characters to an existing realm', () => {
  it('previews large rosters with a sample, the full count and artwork totals', async () => {
    const preview = await previewRealmCatalog(db, admin, config, {
      data: roster,
      rightsConfirmed: true,
    });
    expect(preview.characterCount).toBe(1000);
    expect(preview.characters).toHaveLength(300);
    expect(preview.artworkCount).toBe(0);
  });

  it('ranks a new character inside the saved popularity cohort like realm creation', () => {
    const cohort = Array.from({ length: 1000 }, (_, index) => 1000 - index);
    expect(additionTier(5000, cohort, true)).toBe('legendary');
    expect(additionTier(990, cohort, true)).toBe('epic');
    expect(additionTier(950, cohort, true)).toBe('rare');
    expect(additionTier(800, cohort, true)).toBe('uncommon');
    expect(additionTier(10, cohort, true)).toBe('common');
    expect(additionTier(null, cohort, true)).toBe('common');
    expect(additionTier(5000, [], true)).toBe('common');
    expect(additionTier(5000, cohort, false)).toBe('rare');
  });

  it('reports which looked-up characters are present and the rarity new ones get', async () => {
    expect(await realmCharacterSummary(db, admin, realm)).toEqual({
      characterCount: 1000,
      source: 'mal',
      canAdd: true,
      reason: null,
      artworkCount: 0,
      artworkPermission: null,
      // The fixture's seven series predate medium categories.
      seriesCount: 7,
      untaggedSeries: 7,
    });
    const check = await checkRealmCharacters(db, admin, realm, {
      characters: [
        { sourceKey: roster.characters[0].sourceKey, popularity: 1000 },
        { sourceKey: 'mal:920000001', popularity: 2000 },
        { sourceKey: 'mal:920000002', popularity: 1 },
      ],
    });
    expect(check.results).toEqual([
      { sourceKey: roster.characters[0].sourceKey, present: true, tier: 'legendary' },
      { sourceKey: 'mal:920000001', present: false, tier: 'legendary' },
      { sourceKey: 'mal:920000002', present: false, tier: 'common' },
    ]);
  });

  it('adds new rows only, joins matching packs and is safe to retry', async () => {
    const before = await getRealmView(db, admin, realm);
    const artwork = {
      url: 'https://cdn.myanimelist.net/images/characters/1/original-addition.jpg',
      sourceUrl: 'https://myanimelist.net/character/910005001',
      permission: 'Original fixture reference; never fetched',
    };
    const additions = [
      { ...entry(5001, 2000, ['Action', 'Fantasy', 'Isekai']), artwork },
      entry(5002, 3, ['Mystery']),
      roster.characters[1],
    ];
    const result = await addRealmCharacters(db, admin, realm, {
      characters: additions,
      rightsConfirmed: true,
    });
    expect(result).toEqual({
      ok: true,
      added: [
        {
          id: additions[0].id,
          sourceKey: additions[0].sourceKey,
          name: additions[0].name,
          series: additions[0].series,
          tier: 'legendary',
        },
        {
          id: additions[1].id,
          sourceKey: additions[1].sourceKey,
          name: additions[1].name,
          series: additions[1].series,
          tier: 'common',
        },
      ],
      alreadyPresent: 1,
      newCategories: ['Isekai'],
    });
    const saved = (
      await db.query(
        `SELECT source_key,tier,categories,popularity,provenance FROM characters
        WHERE realm_id=$1 AND source_key=ANY($2::text[]) ORDER BY source_key`,
        [realm, [additions[0].sourceKey, additions[1].sourceKey]],
      )
    ).rows;
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      tier: 'legendary',
      categories: ['Action', 'Fantasy', 'Isekai'],
      popularity: '2000',
      provenance: {
        source: 'mal',
        revision: 'original-addition-fixture',
        importKind: 'mal-addition-v1',
        rightsConfirmed: true,
        artwork,
      },
    });
    const after = await getRealmView(db, admin, realm);
    expect(after.catalog).toHaveLength(before.catalog.length + 2);
    expect(after.configRevision).toBe(before.configRevision);
    const fantasy = after.packs.find((pack) => pack.category === 'Fantasy')!;
    expect(fantasy.available).toBe(
      before.packs.find((pack) => pack.id === fantasy.id)!.available + 1,
    );
    const found = await browseRealmCatalog(db, player, realm, { query: 'Courier 5001' });
    expect(found.characters.map((character) => character.id)).toEqual([additions[0].id]);
    // A retry of the same request reports the characters instead of duplicating them.
    const retry = await addRealmCharacters(db, admin, realm, {
      characters: additions,
      rightsConfirmed: true,
    });
    expect(retry).toMatchObject({ added: [], alreadyPresent: 3 });
    expect((await getRealmView(db, admin, realm)).catalog).toHaveLength(after.catalog.length);
  });

  it('rejects other sources, ID collisions, players, plain realm admins and fixed catalogs', async () => {
    await expect(
      addRealmCharacters(db, admin, realm, {
        characters: [{ ...entry(6001, 5), sourceKey: 'anilist:6001' }],
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
    await expect(
      addRealmCharacters(db, admin, realm, {
        characters: [{ ...entry(6002, 5), id: roster.characters[3].id }],
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
    await expect(
      addRealmCharacters(db, admin, realm, { characters: [entry(6003, 5)] }),
    ).rejects.toThrow();
    await expect(
      addRealmCharacters(db, player, realm, { characters: [entry(6004, 5)], rightsConfirmed: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A realm administrator without instance rights cannot change the catalog.
    await db.query("UPDATE memberships SET role='admin' WHERE realm_id=$1 AND account_id=$2", [
      realm,
      player,
    ]);
    await expect(realmCharacterSummary(db, player, realm)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await db.query("UPDATE memberships SET role='player' WHERE realm_id=$1 AND account_id=$2", [
      realm,
      player,
    ]);
    const demo = await realmCharacterSummary(db, admin, demoRealm);
    expect(demo).toMatchObject({ canAdd: false, source: 'lantern-demo' });
    await expect(
      addRealmCharacters(db, admin, demoRealm, {
        characters: [{ ...entry(6005, 5), sourceKey: 'lantern-demo:addition' }],
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_FIXED' });
    const unchanged = await db.query(
      "SELECT count(*)::int AS count FROM characters WHERE realm_id=$1 AND source_key LIKE 'mal:91000600%'",
      [realm],
    );
    expect(unchanged.rows[0].count).toBe(0);
  });
});

describe('waifus, husbandos and removable packs', () => {
  it('records detected genders, then builds, removes and restores a Waifus pack', async () => {
    const gaps = await realmGenderGaps(db, admin, realm);
    expect(gaps).toMatchObject({ canFetch: true, female: 0, male: 0 });
    expect(gaps.pending[0]).toBe('mal:910005001'); // most popular first
    const genders = {
      genders: [
        { sourceKey: roster.characters[0].sourceKey, gender: 'female' },
        { sourceKey: roster.characters[3].sourceKey, gender: 'female' },
        { sourceKey: roster.characters[1].sourceKey, gender: 'male' },
        { sourceKey: roster.characters[2].sourceKey, gender: null },
      ],
      rightsConfirmed: true,
    };
    expect(await setRealmCharacterGenders(db, admin, realm, genders)).toEqual({
      updated: 4,
      female: 2,
      male: 1,
    });
    expect((await setRealmCharacterGenders(db, admin, realm, genders)).updated).toBe(0);
    const after = await realmGenderGaps(db, admin, realm);
    expect(after.pending).not.toContain(roster.characters[2].sourceKey);
    expect(after.pending).toHaveLength(gaps.pending.length - 4);
    await expect(setRealmCharacterGenders(db, player, realm, genders)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const added = await addRealmPacks(db, admin, realm, {
      packs: [{ category: 'Female', name: 'Waifus' }],
    });
    const waifus = added.added[0];
    const view = await getRealmView(db, player, realm);
    expect(view.packs.find((pack) => pack.id === waifus.id)?.available).toBe(2);
    // Only All Characters is mandatory: category packs can be removed and restored.
    const all = view.packs.find((pack) => pack.category === null)!;
    await expect(retireRealmPack(db, admin, realm, all.id)).rejects.toMatchObject({
      code: 'PACK_REQUIRED',
    });
    await expect(retireRealmPack(db, player, realm, waifus.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await retireRealmPack(db, admin, realm, waifus.id)).toEqual({
      ok: true,
      retired: { id: waifus.id, name: 'Waifus' },
    });
    const hidden = await getRealmView(db, player, realm);
    expect(hidden.packs.some((pack) => pack.id === waifus.id)).toBe(false);
    expect((await realmPackPlan(db, admin, realm)).packs.some((pack) => pack.id === waifus.id)).toBe(false);
    await expect(
      openPack(db, player, realm, waifus.id, randomUUID(), hidden.configRevision),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const restored = await addRealmPacks(db, admin, realm, {
      packs: [{ category: 'Female', name: 'Waifus' }],
    });
    expect(restored.added[0].id).toBe(waifus.id);
    expect((await getRealmView(db, player, realm)).packs.some((pack) => pack.id === waifus.id)).toBe(true);
  });
});
