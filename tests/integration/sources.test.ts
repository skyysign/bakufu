import { defaultConfig } from '../support/prototype-config';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  bootstrap,
  createRealm,
  provisionPlayer,
  previewRealmCatalog,
  getRealmView,
  openPack,
  exportPlayer,
  type Database,
} from '../../packages/db/src/index';
import { fetchProviderCatalog } from '../../packages/db/src/sources';
import { generateScaleCatalog } from '../../packages/importers/src/scale';
import { majorCatalogCategories } from '../../packages/importers/src/providers';
import { jikanPacing } from '../../packages/importers/src/jikan';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';
let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string, player: string;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('sources')).db;
  const password = randomBytes(24).toString('hex');
  admin = await bootstrap(db, 'sources-admin@example.test', password);
  player = await provisionPlayer(
    db,
    await createRealm(db, admin, 'Source fixture', defaultConfig),
    'sources-player@example.test',
    password,
  );
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
const providerInput = {
  provider: 'anilist',
  ids: [910000001, 910000002],
  medium: 'anime',
  revision: 'selected-1',
  providerConsent: true,
  termsConfirmed: true,
};
const providerResponse = {
  data: {
    Page: {
      characters: [910000001, 910000002].map((id, index) => ({
        id,
        name: { full: `Original Provider Courier ${index + 1}` },
        favourites: 40 - index,
        media: {
          nodes: [
            {
              type: 'ANIME',
              title: { english: 'The Original Lantern Academy', romaji: null },
              genres: ['Action', 'Fantasy'],
            },
          ],
        },
        image: { large: 'https://private.invalid/unlicensed.png' },
      })),
    },
  },
};
const providerFetcher = () => vi.fn(async () => new Response(JSON.stringify(providerResponse)));
describe('provider adapter authorization and original scale installation', () => {
  it('retains permitted artwork references through real installation, opening, personal export and encrypted fresh recovery', async () => {
    await db.query('DELETE FROM login_limits');
    const prepared = await fetchProviderCatalog(
      db,
      admin,
      {
        provider: 'jikan-api',
        medium: 'anime',
        revision: 'original-artwork-fixture',
        providerConsent: true,
        termsConfirmed: true,
        step: 'characters',
        work: {
          id: 910000001,
          title: 'Original API Lantern Academy',
          categories: ['Action', 'Fantasy'],
        },
        artworkPermission: 'Original fixture references; automated tests never fetch these URLs',
      },
      async () =>
        new Response(
          JSON.stringify({
            data: [910000001, 910000002].map((id) => ({
              character: {
                mal_id: id,
                name: `Original Artwork Courier ${id}`,
                images: {
                  jpg: {
                    image_url: `https://cdn.myanimelist.net/images/characters/1/original-${id}.jpg`,
                  },
                },
              },
              favorites: id % 100,
              role: 'Main',
            })),
          }),
        ),
    );
    if (!('kind' in prepared) || prepared.kind !== 'characters')
      throw new Error('Expected a character page.');
    const choice = { data: prepared.catalog, rightsConfirmed: true },
      preview = await previewRealmCatalog(db, admin, defaultConfig, choice),
      realm = await createRealm(
        db,
        admin,
        'Original artwork reference fixture',
        defaultConfig,
        choice,
        preview.fingerprint,
      ),
      before = await getRealmView(db, admin, realm),
      key = randomUUID(),
      result = await openPack(
        db,
        admin,
        realm,
        before.packs.find((pack) => pack.name === 'All Characters')!.id,
        key,
      );
    if (!result.ok) throw new Error('Fixture opening failed.');
    expect(result.characters[0].artwork).toEqual(
      prepared.catalog.characters.find((character) => character.id === result.characters[0].id)!
        .artwork,
    );
    const archive = await exportPlayer(db, admin, realm);
    expect(archive.cards[0].artwork).toEqual(result.characters[0].artwork);
    const passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase),
      fresh = (await server.database('provider_artwork_restore')).db;
    try {
      await restoreBackup(fresh, backup, passphrase);
      await assertBackupRestored(fresh, backup, passphrase);
      const recovered = await getRealmView(fresh, admin, realm);
      expect(recovered.catalog).toEqual((await getRealmView(db, admin, realm)).catalog);
      expect(recovered.cards[0].artwork).toEqual(result.characters[0].artwork);
      const after = await exportPlayer(fresh, admin, realm);
      expect({ ...after, exportedAt: archive.exportedAt }).toEqual(archive);
      expect(
        await openPack(
          fresh,
          admin,
          realm,
          before.packs.find((pack) => pack.name === 'All Characters')!.id,
          key,
        ),
      ).toEqual(result);
    } finally {
      await fresh.end();
    }
    const unsafe = (await server.database('provider_unsafe_artwork_restore')).db;
    try {
      const artwork = result.characters[0].artwork!;
      for (const target of ['character', 'opening'] as const) {
        const forged = { ...artwork, sourceUrl: 'javascript:invalid-original-fixture' };
        try {
          if (target === 'character')
            await db.query(
              "UPDATE characters SET provenance=jsonb_set(provenance,'{artwork}',$3::jsonb) WHERE realm_id=$1 AND id=$2",
              [realm, result.characters[0].id, forged],
            );
          else {
            const receipt = structuredClone(result);
            receipt.characters[0].artwork = forged;
            await db.query('UPDATE openings SET result=$3 WHERE realm_id=$1 AND request_key=$2', [
              realm,
              key,
              receipt,
            ]);
          }
          await expect(
            restoreBackup(unsafe, await makeBackup(db, passphrase), passphrase),
          ).rejects.toThrow('artwork references');
          expect((await unsafe.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
        } finally {
          await db.query(
            "UPDATE characters SET provenance=jsonb_set(provenance,'{artwork}',$3::jsonb) WHERE realm_id=$1 AND id=$2",
            [realm, result.characters[0].id, artwork],
          );
          await db.query('UPDATE openings SET result=$3 WHERE realm_id=$1 AND request_key=$2', [
            realm,
            key,
            result,
          ]);
        }
      }
    } finally {
      await unsafe.end();
    }
  });
  it('authorizes each on-demand Jikan page and shares a per-service instance budget', async () => {
    await db.query('DELETE FROM login_limits');
    const request = {
        provider: 'jikan-api',
        medium: 'anime',
        revision: 'fixture-1',
        providerConsent: true,
        termsConfirmed: true,
        step: 'works',
        page: 1,
      },
      stub = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                { mal_id: 910000001, title: 'Original API Academy', genres: [{ name: 'Action' }] },
              ],
              pagination: { has_next_page: true },
            }),
          ),
      );
    await expect(fetchProviderCatalog(db, player, request, stub)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(stub).not.toHaveBeenCalled();
    // Tenrai (the default service) allows 120/minute; the instance budget stays below.
    for (let index = 0; index < jikanPacing.tenrai.perMinute; index++)
      expect(await fetchProviderCatalog(db, admin, request, stub)).toMatchObject({
        kind: 'works',
        works: [{ id: 910000001 }],
      });
    await expect(fetchProviderCatalog(db, admin, request, stub)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    expect(stub).toHaveBeenCalledTimes(jikanPacing.tenrai.perMinute);
    // The legacy Jikan API has its own, lower budget.
    const legacy = { ...request, service: 'jikan' };
    for (let index = 0; index < jikanPacing.jikan.perMinute; index++)
      await fetchProviderCatalog(db, admin, legacy, stub);
    await expect(fetchProviderCatalog(db, admin, legacy, stub)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await db.query("UPDATE login_limits SET window_start=now()-interval '2 minutes'");
    expect(await fetchProviderCatalog(db, admin, request, stub)).toMatchObject({ kind: 'works' });
  });
  it('does not contact a provider before operator permission and explicit opt-in', async () => {
    const stub = providerFetcher();
    await expect(fetchProviderCatalog(db, player, providerInput, stub)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    for (const selected of [
      { ...providerInput, termsConfirmed: false },
      { ...providerInput, providerConsent: false },
      { ...providerInput, ids: [1, 1] },
    ])
      await expect(fetchProviderCatalog(db, admin, selected, stub)).rejects.toThrow();
    expect(stub).not.toHaveBeenCalled();
  });
  it('prepares selected AniList genre/favourite metadata for the ordinary reviewed realm installation', async () => {
    await db.query('DELETE FROM login_limits');
    const stub = providerFetcher(),
      catalog = await fetchProviderCatalog(db, admin, providerInput, stub),
      choice = { data: catalog, rightsConfirmed: true },
      preview = await previewRealmCatalog(db, admin, defaultConfig, choice);
    expect(preview.source).toBe('anilist');
    expect(preview.packs.map((pack) => pack.name)).toEqual(['All Characters']);
    const realm = await createRealm(
        db,
        admin,
        'Selected provider fixture',
        defaultConfig,
        choice,
        preview.fingerprint,
      ),
      view = await getRealmView(db, admin, realm);
    expect(view.catalog.map((character) => character.sourceKey).sort()).toEqual([
      'anilist:910000001',
      'anilist:910000002',
    ]);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(view.catalog)).not.toContain('private.invalid');
    const installed = (
      await db.query('SELECT provenance FROM characters WHERE realm_id=$1', [realm])
    ).rows;
    expect(installed).toHaveLength(2);
    installed.forEach(({ provenance }) =>
      expect(provenance).toMatchObject({
        source: 'anilist',
        importKind: 'anilist-metadata-v1',
        revision: providerInput.revision,
        rightsConfirmed: true,
      }),
    );
  });
  it('accepts authorized Jikan upload normalization without network access and keeps its source cohort separate', async () => {
    await db.query('DELETE FROM login_limits');
    const stub = providerFetcher(),
      catalog = await fetchProviderCatalog(
        db,
        admin,
        {
          provider: 'jikan',
          medium: 'manga',
          revision: 'permitted-1',
          providerConsent: true,
          termsConfirmed: true,
          series: 'The Original Paper Sea',
          categories: ['Adventure'],
          license: 'Original shape fixture, MIT',
          data: {
            data: [
              {
                mal_id: 910000001,
                name: 'Original Manga Wanderer',
                favorites: 20,
                images: { jpg: { image_url: 'https://private.invalid/image' } },
              },
            ],
          },
        },
        stub,
      );
    if ('kind' in catalog) throw new Error('Expected a normalized uploaded catalog.');
    expect(catalog.source).toBe('mal');
    expect(catalog.characters[0].sourceKey).toBe('mal:910000001');
    expect(stub).not.toHaveBeenCalled();
  });
  it('shares a persistent operator preparation limit and returns safe upstream errors', async () => {
    await db.query('DELETE FROM login_limits');
    const stub = providerFetcher();
    for (let i = 0; i < 6; i++) await fetchProviderCatalog(db, admin, providerInput, stub);
    await expect(fetchProviderCatalog(db, admin, providerInput, stub)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    expect(stub).toHaveBeenCalledTimes(6);
    await db.query("UPDATE login_limits SET window_start=now()-interval '2 minutes'");
    await expect(
      fetchProviderCatalog(
        db,
        admin,
        providerInput,
        async () => new Response('private-provider-error', { status: 503 }),
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE', status: 502 });
  });
  it('installs one thousand original characters, opens transactionally and preserves the complete catalog through fresh encrypted recovery', async () => {
    const choice = { format: 'json', data: generateScaleCatalog(), rightsConfirmed: true },
      preview = await previewRealmCatalog(db, admin, defaultConfig, choice);
    expect(preview.characterCount).toBe(1000);
    expect(preview.packs).toHaveLength(11);
    for (const pack of preview.packs.filter((item) => item.category !== null))
      expect(majorCatalogCategories).toContain(pack.category);
    const realm = await createRealm(
        db,
        admin,
        'Original 1000-character scale fixture',
        defaultConfig,
        choice,
        preview.fingerprint,
      ),
      before = await getRealmView(db, admin, realm);
    expect(before.catalog).toHaveLength(1000);
    const all = before.packs.find((pack) => pack.name === 'All Characters')!,
      requestKey = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => openPack(db, admin, realm, all.id, requestKey)),
    );
    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0]).toMatchObject({ ok: true, charged: 10, balance: 90 });
    expect((await getRealmView(db, admin, realm)).cards).toHaveLength(1);
    const archive = await exportPlayer(db, admin, realm),
      passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase),
      fresh = (await server.database('provider_scale_restore')).db;
    try {
      await restoreBackup(fresh, backup, passphrase);
      await assertBackupRestored(fresh, backup, passphrase);
      const recovered = await getRealmView(fresh, admin, realm);
      expect(recovered.catalog).toEqual((await getRealmView(db, admin, realm)).catalog);
      const after = await exportPlayer(fresh, admin, realm);
      expect({ ...after, exportedAt: archive.exportedAt }).toEqual(archive);
      expect(await openPack(fresh, admin, realm, all.id, requestKey)).toEqual(results[0]);
    } finally {
      await fresh.end();
    }
  });
});
