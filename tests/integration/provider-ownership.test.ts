import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
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
import {
  normalizeAniListCatalog,
  normalizeJikanCatalog,
} from '../../packages/importers/src/providers';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('provider_ownership')).db;
  admin = await bootstrap(db, 'provider-ownership@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

// Original labels in provider-shaped fixtures. Normalizers run without any
// network request and produce the exact same canonical identities as adapters.
function originalCatalog(source: 'anilist' | 'mal', count: number) {
  const options = {
    medium: 'anime' as const,
    revision: 'original-ownership-fixture-1',
    license: 'Original shape fixture, MIT; no provider records or artwork',
  };
  const characters = Array.from({ length: count }, (_, index) => ({
    id: 910000001 + index,
    name: `Original Ownership Courier ${index + 1}`,
    favourites: count - index,
  }));
  const catalog =
    source === 'anilist'
      ? normalizeAniListCatalog(
          {
            data: {
              Page: {
                characters: characters.map((character) => ({
                  ...character,
                  name: { full: character.name },
                  media: {
                    nodes: [
                      {
                        type: 'ANIME',
                        title: { english: 'Original Ownership Academy' },
                        genres: ['Action', 'Fantasy'],
                      },
                    ],
                  },
                })),
              },
            },
          },
          options,
        )
      : normalizeJikanCatalog(
          {
            data: characters.map((character) => ({
              mal_id: character.id,
              name: character.name,
              favorites: character.favourites,
            })),
          },
          { ...options, series: 'Original Ownership Academy', categories: ['Action', 'Fantasy'] },
        );
  return {
    ...catalog,
    characters: catalog.characters.map((character) => ({
      ...character,
      // Explicit original-fixture demographic evidence; never inferred from Action.
      categories: [...character.categories, 'Shounen'],
    })),
  };
}

async function install(source: 'anilist' | 'mal', count: number, packSize = 1) {
  const config = { ...defaultConfig, minimumPoolSize: 1, startingGems: 1000, packSize };
  const choice = { data: originalCatalog(source, count), rightsConfirmed: true };
  const preview = await previewRealmCatalog(db, admin, config, choice);
  const id = await createRealm(
    db,
    admin,
    'Original provider ownership fixture',
    config,
    choice,
    preview.fingerprint,
  );
  return { id, view: await getRealmView(db, admin, id) };
}

describe('provider identities share realm ownership and spotlight eligibility', () => {
  it.each(['anilist', 'mal'] as const)(
    'protects %s across concurrent overlapping packs, retries, realms and recycling',
    async (source) => {
      const first = await install(source, 1),
        otherRealm = await install(source, 1),
        racer = await provisionPlayer(
          db,
          first.id,
          `provider-racer-${source}@example.test`,
          password,
        ),
        all = first.view.packs.find((pack) => pack.name === 'All Characters')!,
        category = first.view.packs.find((pack) => pack.category === 'Shounen')!,
        keys = [randomUUID(), randomUUID()];
      const expected = first.view.catalog[0];
      expect(expected.sourceKey).toBe(`${source}:910000001`);
      expect(first.view.featuredCharacters.map((character) => character.id)).toEqual([expected.id]);
      expect(all.spotlights.map((character) => character.id)).toEqual([expected.id]);
      const results = await Promise.all([
        openPack(db, admin, first.id, all.id, keys[0]),
        openPack(db, racer, first.id, category.id, keys[1]),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, code: 'EMPTY_POOL' });
      const winningIndex = results.findIndex((result) => result.ok),
        winner = winningIndex === 0 ? admin : racer,
        winningPack = winningIndex === 0 ? all : category,
        receipt = results[winningIndex];
      if (!receipt.ok) throw new Error('Original provider ownership fixture did not open.');
      expect(await openPack(db, winner, first.id, winningPack.id, keys[winningIndex])).toEqual(
        receipt,
      );
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM wallet_ledger WHERE realm_id=$1 AND reason='pack_opening'",
            [first.id],
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (
          await db.query('SELECT sum(balance)::int AS total FROM memberships WHERE realm_id=$1', [
            first.id,
          ])
        ).rows[0].total,
      ).toBe(1990);
      await expect(
        db.query(
          'INSERT INTO cards(realm_id,id,character_id,owner_id,request_key) VALUES($1,$2,$3,$4,$5)',
          [first.id, randomUUID(), expected.id, winner, keys[winningIndex]],
        ),
      ).rejects.toMatchObject({ code: '23505', constraint: 'cards_active_character' });
      const depleted = await getRealmView(db, admin, first.id);
      expect(depleted.featuredCharacters).toEqual([]);
      expect(
        depleted.packs.every((pack) => pack.available === 0 && pack.spotlights.length === 0),
      ).toBe(true);
      const independent = await openPack(
        db,
        admin,
        otherRealm.id,
        otherRealm.view.packs.find((pack) => pack.name === 'All Characters')!.id,
        randomUUID(),
      );
      if (!independent.ok) throw new Error('Original second realm fixture did not open.');
      expect(independent.characters[0].id).toBe(receipt.characters[0].id);
      expect(independent.cardIds[0]).not.toBe(receipt.cardIds[0]);
      await recycleCard(db, winner, first.id, receipt.cardIds[0], randomUUID());
      const released = await getRealmView(db, winner, first.id);
      expect(released.featuredCharacters.map((character) => character.id)).toEqual([expected.id]);
      expect(
        released.packs.every((pack) => pack.available === 1 && pack.spotlights.length === 1),
      ).toBe(true);
    },
  );

  it.each(['anilist', 'mal'] as const)(
    'draws %s bundles without duplicates and never charges for a depleted overlapping pack',
    async (source) => {
      const realm = await install(source, 20, 2),
        all = realm.view.packs.find((pack) => pack.name === 'All Characters')!,
        category = realm.view.packs.find((pack) => pack.category === 'Shounen')!;
      expect(realm.view.featuredCharacters).toHaveLength(5);
      expect(all.spotlights).toHaveLength(3);
      const receipt = await openPack(db, admin, realm.id, all.id, randomUUID(), undefined, 10);
      if (!receipt.ok) throw new Error('Original provider bundle fixture did not open.');
      expect(receipt).toMatchObject({ charged: 100, packCount: 10, cardsPerPack: 2, balance: 900 });
      expect(receipt.characters).toHaveLength(20);
      expect(new Set(receipt.characters.map((character) => character.id)).size).toBe(20);
      expect(await openPack(db, admin, realm.id, category.id, randomUUID())).toMatchObject({
        ok: false,
        code: 'EMPTY_POOL',
      });
      const after = await getRealmView(db, admin, realm.id);
      expect(after.balance).toBe(900);
      expect(after.cards).toHaveLength(20);
      expect(after.featuredCharacters).toEqual([]);
      expect(after.packs.every((pack) => pack.spotlights.length === 0)).toBe(true);
    },
  );
});
