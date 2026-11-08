import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addRealmPacks,
  bootstrap,
  browseRealmCatalog,
  createRealm,
  getRealmView,
  listMarket,
  marketCommand,
  openPack,
  previewRealmCatalog,
  provisionPlayer,
  realmPackPlan,
  setWishlistEntry,
  type Database,
} from '../../packages/db/src/index';
import { defaultConfig } from '../../packages/config/src/index';
import { providerCharacterId } from '../../packages/importers/src/providers';
import { startPostgres } from '../support/postgres';
import { customCatalog } from '../support/catalog-fixture';

const demographics = ['Shounen', 'Seinen', 'Shoujo', 'Josei', null];
const genres = ['Action', 'Fantasy', 'Romance', 'Mystery', 'Comedy', 'Drama', 'Sports'];
const eras = ['1990s', '2010s', '2020s'];
// Original fictional roster shaped like a large provider import; no real data.
function providerCatalog(count: number) {
  return {
    schemaVersion: 1,
    source: 'mal',
    revision: 'original-scale-fixture',
    license: 'Original fictional provider-shaped fixture, MIT',
    characters: Array.from({ length: count }, (_, index) => ({
      id: providerCharacterId('mal', 900000000 + index),
      sourceKey: `mal:${900000000 + index}`,
      name: `Original Scale Courier ${String(index).padStart(5, '0')}`,
      series: `Original Series ${index % 250}`,
      categories: [
        ...(demographics[index % 5] ? [demographics[index % 5]!] : []),
        genres[index % 7],
        eras[index % 3],
      ],
      popularity: count - index,
      ...(index % 2
        ? {
            artwork: {
              url: `https://cdn.myanimelist.net/images/characters/1/original-${index}.jpg`,
              sourceUrl: `https://myanimelist.net/character/${900000000 + index}`,
              permission: 'Original fixture reference; never fetched',
            },
          }
        : {}),
    })),
  };
}
const config = { ...defaultConfig, startingGems: 500000, maximumCategoryPacks: 12 };

let server: Awaited<ReturnType<typeof startPostgres>>,
  db: Database,
  admin: string,
  player: string,
  realm: string;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('catalog_scale')).db;
  admin = await bootstrap(db, 'scale-admin@example.test', randomBytes(24).toString('hex'));
  const catalog = { data: providerCatalog(5000), rightsConfirmed: true };
  const preview = await previewRealmCatalog(db, admin, config, catalog);
  realm = await createRealm(db, admin, 'Original scale realm', config, catalog, preview.fingerprint);
  player = await provisionPlayer(
    db,
    realm,
    'scale-player@example.test',
    randomBytes(24).toString('hex'),
  );
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

describe('large provider rosters', () => {
  it('installs five thousand characters with demographic, genre and era packs', async () => {
    const stored = await db.query(
      "SELECT count(*)::int AS count,count(*) FILTER(WHERE provenance ? 'artwork')::int AS artwork FROM characters WHERE realm_id=$1",
      [realm],
    );
    expect(stored.rows[0]).toEqual({ count: 5000, artwork: 2500 });
    const packs = (
      await db.query('SELECT category FROM packs WHERE realm_id=$1', [realm])
    ).rows.map((row) => row.category);
    expect(packs).toEqual(expect.arrayContaining(['Shounen', 'Seinen', 'Shoujo', 'Josei', null]));
    expect(packs).toEqual(expect.arrayContaining(['Action', '2010s']));
    expect(packs.filter((category) => category !== null)).toHaveLength(12);
  });
  it('derives each pack pool in memory exactly like a real draw', async () => {
    const view = await getRealmView(db, admin, realm);
    expect(view.catalog).toHaveLength(5000);
    const action = view.packs.find((pack) => pack.category === 'Action')!;
    const actionCount = view.catalog.filter((character) =>
      character.categories.includes('Action'),
    ).length;
    expect(action.available).toBe(actionCount);
    const result = await openPack(db, admin, realm, action.id, randomUUID(), view.configRevision, 10);
    if (!result.ok) throw new Error('Opening failed.');
    expect(result.characters.every((character) => character.categories.includes('Action'))).toBe(
      true,
    );
    const after = await getRealmView(db, admin, realm);
    expect(after.packs.find((pack) => pack.id === action.id)!.available).toBe(
      actionCount - result.characters.length,
    );
    expect(
      after.packs.find((pack) => pack.category === null)!.available,
    ).toBe(5000 - result.characters.length);
  });
  it('keeps hand-made uploads at their original limit while allowing large provider rosters', async () => {
    const oversizedOriginal = {
      ...customCatalog,
      characters: Array.from({ length: 1001 }, (_, index) => ({
        ...customCatalog.characters[0],
        id: `c7000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        sourceKey: `workshop:large-${index}`,
      })),
    };
    await expect(
      previewRealmCatalog(db, admin, config, { data: oversizedOriginal, rightsConfirmed: true }),
    ).rejects.toMatchObject({ code: 'CATALOG_TOO_LARGE' });
    // Provider rosters may exceed the old 10,000 cap; previews echo a sample only.
    const larger = await previewRealmCatalog(db, admin, config, {
      data: providerCatalog(10001),
      rightsConfirmed: true,
    });
    expect(larger.characterCount).toBe(10001);
    expect(larger.characters).toHaveLength(300);
    expect(larger.artworkCount).toBe(5000);
    await expect(
      previewRealmCatalog(db, admin, config, { data: providerCatalog(100001), rightsConfirmed: true }),
    ).rejects.toThrow();
  });
});

describe('server-side catalog paging', () => {
  it('pages, filters and searches the realm catalog for members only', async () => {
    const first = await browseRealmCatalog(db, player, realm, { limit: 24 });
    expect(first.total).toBe(5000);
    expect(first.characters).toHaveLength(24);
    expect(first.characters[0].name).toBe('Original Scale Courier 00000');
    expect(first.characters[0].valuation.marketValue).toBeGreaterThan(0);
    const second = await browseRealmCatalog(db, player, realm, { limit: 24, offset: 24 });
    expect(second.characters[0].name).toBe('Original Scale Courier 00024');
    const search = await browseRealmCatalog(db, player, realm, { query: 'courier 01234' });
    expect(search.total).toBe(1);
    expect(search.characters[0].sourceKey).toBe('mal:900001234');
    const legendary = await browseRealmCatalog(db, player, realm, { tier: 'legendary' });
    expect(legendary.characters.every((character) => character.tier === 'legendary')).toBe(true);
    const claimed = await browseRealmCatalog(db, player, realm, { status: 'claimed', limit: 60 });
    expect(claimed.total).toBe(10);
    const mine = await browseRealmCatalog(db, admin, realm, { status: 'yours' });
    expect(mine.total).toBe(10);
    const view = await getRealmView(db, player, realm);
    const wish = first.characters.find((character) => character.status === 'available')!;
    await setWishlistEntry(db, player, realm, wish.id, true, randomUUID(), view.configRevision);
    const candidates = await browseRealmCatalog(db, player, realm, {
      query: wish.name,
      excludeWished: true,
    });
    expect(candidates.total).toBe(0);
    const stranger = await provisionPlayer(
      db,
      await createRealm(db, admin, 'Other realm', defaultConfig),
      'scale-stranger@example.test',
      randomBytes(24).toString('hex'),
    );
    await expect(browseRealmCatalog(db, stranger, realm)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('adding packs to an existing realm', () => {
  it('lets realm admins add category packs safely and retries idempotently', async () => {
    const plan = await realmPackPlan(db, admin, realm);
    const candidate = plan.candidates.find((entry) => entry.packId === null)!;
    expect(candidate).toBeDefined();
    await expect(realmPackPlan(db, player, realm)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      addRealmPacks(db, player, realm, {
        packs: [{ category: candidate.category, name: 'Player pack' }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const before = await getRealmView(db, admin, realm);
    const request = { packs: [{ category: candidate.category, name: `${candidate.category} Party` }] };
    const added = await addRealmPacks(db, admin, realm, request);
    expect(added.added).toHaveLength(1);
    expect(await addRealmPacks(db, admin, realm, request)).toMatchObject({
      added: [],
      alreadyPresent: 1,
    });
    await expect(
      addRealmPacks(db, admin, realm, {
        packs: [{ category: candidate.category, name: 'A different name' }],
      }),
    ).rejects.toMatchObject({ code: 'PACK_EXISTS' });
    await expect(
      addRealmPacks(db, admin, realm, { packs: [{ category: 'Not a category', name: 'Nope' }] }),
    ).rejects.toMatchObject({ code: 'PACK_PLAN_INVALID' });
    await expect(
      addRealmPacks(db, admin, realm, {
        packs: [{ category: plan.candidates.at(-1)!.category, name: 'All Characters' }],
      }),
    ).rejects.toMatchObject({ code: 'PACK_PLAN_INVALID' });
    const after = await getRealmView(db, admin, realm);
    expect(after.packs).toHaveLength(before.packs.length + 1);
    expect(after.balance).toBe(before.balance);
    expect(after.cards).toEqual(before.cards);
    const pack = after.packs.find((entry) => entry.id === added.added[0].id)!;
    const result = await openPack(db, player, realm, pack.id, randomUUID(), after.configRevision);
    if (!result.ok) throw new Error('New pack did not open.');
    expect(result.characters[0].categories).toContain(candidate.category);
  });
});

describe('market listings', () => {
  it('include the artwork reference and valuation the browser needs', async () => {
    const view = await getRealmView(db, admin, realm);
    const card = view.cards.find((entry) => entry.artwork) ?? view.cards[0];
    await marketCommand(
      db,
      admin,
      realm,
      { action: 'list', cardId: card.cardId, price: 99 },
      randomUUID(),
      view.configRevision,
    );
    const page = await listMarket(db, player, realm);
    const listing = page.listings.find((entry) => entry.cardId === card.cardId)!;
    expect(listing.valuation?.marketValue).toBe(view.characterValues[card.id].marketValue);
    expect(listing.categories).toEqual(card.categories);
    expect(listing.sourceKey).toBe(card.sourceKey);
    if (card.artwork) expect(listing.artwork).toEqual(card.artwork);
  });
});
