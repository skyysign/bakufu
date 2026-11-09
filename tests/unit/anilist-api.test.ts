import { describe, expect, it, vi } from 'vitest';
import { aniListApiRequestSchema, fetchAniListApiStep } from '../../packages/importers/src/anilist';
import { mergeAniListCharacters } from '../../packages/importers/src/anilist-state';
import { parseCatalog } from '../../packages/importers/src/json';

const common = {
  provider: 'anilist-api',
  medium: 'anime',
  revision: 'original-fixture',
  providerConsent: true,
  termsConfirmed: true,
};
const work = { id: 930000001, title: 'Original AniList Academy', categories: ['Action'] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const page = {
  data: {
    Page: {
      pageInfo: { hasNextPage: true },
      media: [
        {
          id: work.id,
          title: { english: null, romaji: 'Original AniList Academy' },
          genres: ['Action', 'Fantasy'],
          tags: [
            { name: 'Shounen', category: 'Demographic' },
            { name: 'Male Protagonist', category: 'Cast-Main Cast' },
          ],
          seasonYear: 2019,
          startDate: { year: 2019 },
        },
        {
          id: work.id + 1,
          title: { english: 'Original Quiet Library', romaji: 'Shizuka Toshokan' },
          genres: ['Slice of Life'],
          tags: [],
          seasonYear: null,
          startDate: { year: 1998 },
        },
      ],
    },
  },
};
const cast = (count = 30) => ({
  data: {
    Media: {
      characters: {
        edges: Array.from({ length: count }, (_, index) => ({
          role: index === count - 1 ? 'MAIN' : 'SUPPORTING',
          node: {
            id: 940000001 + index,
            name: { full: `Original Courier ${index}`, userPreferred: `Original Courier ${index}` },
            favourites: index,
            image: {
              large: `https://s4.anilist.co/file/anilistcdn/character/large/b${940000001 + index}-original.png`,
            },
          },
        })),
      },
    },
  },
});

describe('AniList selected-series boundary', () => {
  it('lists one page of series with genres, real demographic tags and release era', async () => {
    const fetcher = vi.fn(async () => response(page));
    const result = await fetchAniListApiStep(
      { ...common, step: 'works', page: 1, query: 'Original' },
      fetcher,
    );
    expect(result).toEqual({
      kind: 'works',
      medium: 'anime',
      page: 1,
      hasNextPage: true,
      works: [
        {
          id: work.id,
          title: 'Original AniList Academy',
          categories: ['2010s', 'Action', 'Fantasy', 'Shounen'],
        },
        {
          id: work.id + 1,
          title: 'Original Quiet Library',
          categories: ['1990s', 'Slice of Life'],
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [address, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(address).toBe('https://graphql.anilist.co');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit' });
    const body = JSON.parse(String(options.body));
    expect(body.variables).toEqual({
      page: 1,
      type: 'ANIME',
      country: null,
      format: null,
      search: 'Original',
    });
    expect(body.query).toContain('isAdult:false');
  });
  it('filters manhwa, manhua, donghua and light novels and tags each work with its medium', async () => {
    const fetcher = vi.fn(async () =>
      response({
        data: {
          Page: {
            pageInfo: { hasNextPage: false },
            media: [
              { ...page.data.Page.media[0], type: 'MANGA', format: 'MANGA', countryOfOrigin: 'KR' },
              { ...page.data.Page.media[1], type: 'MANGA', format: 'NOVEL', countryOfOrigin: 'JP' },
            ],
          },
        },
      }),
    );
    const result = await fetchAniListApiStep(
      { ...common, medium: 'manhwa', step: 'works', page: 1 },
      fetcher,
    );
    if (result.kind !== 'works') throw new Error('Unexpected result.');
    expect(result.works.map((item) => item.categories)).toEqual([
      ['2010s', 'Action', 'Fantasy', 'Manhwa', 'Shounen'],
      ['1990s', 'Light Novel', 'Slice of Life'],
    ]);
    const variables = (medium: string) =>
      fetchAniListApiStep({ ...common, medium, step: 'works', page: 1 }, fetcher).then(() => {
        const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
        return JSON.parse(String(calls[calls.length - 1][1].body)).variables;
      });
    expect(await variables('manhwa')).toMatchObject({ type: 'MANGA', country: 'KR', format: null });
    expect(await variables('manhua')).toMatchObject({ type: 'MANGA', country: 'CN' });
    expect(await variables('donghua')).toMatchObject({ type: 'ANIME', country: 'CN' });
    expect(await variables('lightnovel')).toMatchObject({ type: 'MANGA', format: 'NOVEL' });
  });
  it('loads long casts 25 characters per request, up to 100 per series', async () => {
    const pages = [0, 1, 2].map((pageIndex) => ({
      data: {
        Media: {
          characters: {
            pageInfo: { hasNextPage: pageIndex < 2 },
            edges: Array.from({ length: 25 }, (_, index) => ({
              role: 'SUPPORTING',
              node: {
                id: 950000001 + pageIndex * 25 + index,
                name: { full: `Original Crew ${pageIndex * 25 + index}`, userPreferred: null },
                favourites: 1000 - (pageIndex * 25 + index),
              },
            })),
          },
        },
      },
    }));
    const fetcher = vi.fn(async (_url: string, options: RequestInit) =>
      response(pages[JSON.parse(String(options.body)).variables.page - 1]),
    );
    const result = await fetchAniListApiStep(
      { ...common, step: 'characters', work, perWork: 60 },
      fetcher as unknown as typeof fetch,
    );
    if (result.kind !== 'characters') throw new Error('Unexpected result.');
    expect(result.catalog.characters).toHaveLength(60);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const all = await fetchAniListApiStep(
      { ...common, step: 'characters', work, perWork: 100 },
      fetcher as unknown as typeof fetch,
    );
    // The cast ends after three pages: 75 characters, no fourth request.
    if (all.kind !== 'characters') throw new Error('Unexpected result.');
    expect(all.catalog.characters).toHaveLength(75);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('loads one chosen series: main cast first, bounded, artwork only with permission', async () => {
    const fetcher = vi.fn(async () => response(cast()));
    const plain = await fetchAniListApiStep(
      { ...common, step: 'characters', work, perWork: 10 },
      fetcher,
    );
    if (plain.kind !== 'characters') throw new Error('Unexpected result.');
    expect(plain.catalog.characters).toHaveLength(10);
    expect(plain.catalog.characters[0]).toMatchObject({
      sourceKey: 'anilist:940000030',
      name: 'Original Courier 29',
      series: work.title,
      categories: work.categories,
      popularity: 29,
    });
    expect(plain.catalog.characters.every((character) => !character.artwork)).toBe(true);
    const permitted = await fetchAniListApiStep(
      {
        ...common,
        step: 'characters',
        work,
        artworkPermission: 'Original artwork-reference fixture; no remote image request',
      },
      fetcher,
    );
    if (permitted.kind !== 'characters') throw new Error('Unexpected result.');
    expect(permitted.catalog.characters).toHaveLength(25);
    expect(permitted.catalog.characters[0].artwork).toMatchObject({
      sourceUrl: 'https://anilist.co/character/940000030',
    });
    expect(parseCatalog(permitted.catalog).characters[0].artwork).toEqual(
      permitted.catalog.characters[0].artwork,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('treats a missing series as empty and stops on rate limits without retries', async () => {
    const missing = await fetchAniListApiStep({ ...common, step: 'characters', work }, async () =>
      response({ errors: [{ message: 'Not Found.' }] }, 404),
    );
    expect(missing).toMatchObject({ kind: 'characters', catalog: { characters: [] } });
    const limited = vi.fn(async () => response({ errors: [] }, 429));
    await expect(
      fetchAniListApiStep({ ...common, step: 'works', page: 1 }, limited),
    ).rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED', status: 429 });
    expect(limited).toHaveBeenCalledTimes(1);
    await expect(
      fetchAniListApiStep({ ...common, step: 'works', page: 1 }, async () => {
        throw new Error('private-network-trace');
      }),
    ).rejects.toThrow('AniList is unavailable');
  });
  it('validates consent and bounds before any request', async () => {
    const fetcher = vi.fn(async () => response(page));
    for (const input of [
      { ...common, step: 'works', page: 51 },
      { ...common, step: 'works', page: 1, providerConsent: false },
      { ...common, step: 'works', page: 1, url: 'https://private.invalid' },
      { ...common, step: 'characters', work, perWork: 101 },
      { ...common, medium: 'webtoon', step: 'works', page: 1 },
    ])
      await expect(fetchAniListApiStep(input, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      aniListApiRequestSchema.safeParse({
        ...common,
        step: 'characters',
        work,
        artworkPermission: '',
      }).success,
    ).toBe(false);
  });
  it('merges series that share characters without duplicating identities', async () => {
    const first = await fetchAniListApiStep(
      { ...common, step: 'characters', work, perWork: 5 },
      async () => response(cast(5)),
    );
    const second = await fetchAniListApiStep(
      {
        ...common,
        step: 'characters',
        work: { ...work, id: work.id + 1, title: 'Original Sequel', categories: ['Drama'] },
        perWork: 5,
      },
      async () => response(cast(5)),
    );
    if (first.kind !== 'characters' || second.kind !== 'characters')
      throw new Error('Unexpected result.');
    const merged = mergeAniListCharacters(
      mergeAniListCharacters({ ...first.catalog, characters: [] }, first.catalog),
      second.catalog,
    );
    expect(merged.characters).toHaveLength(5);
    expect(merged.characters[0].categories).toEqual(['Action', 'Drama']);
    expect(merged.characters[0].series).toBe(work.title);
  });
});
