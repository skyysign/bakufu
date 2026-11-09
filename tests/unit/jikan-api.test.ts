import { describe, expect, it, vi } from 'vitest';
import { fetchJikanApiStep, jikanApiRequestSchema } from '../../packages/importers/src/jikan';
import {
  applyJikanWorks,
  mergeJikanCharacters,
  migrateJikanSeed,
  newJikanSeed,
  nextJikanStep,
} from '../../packages/importers/src/jikan-state';
import { readableMalName } from '../../packages/importers/src/jikan';
import { parseCatalog } from '../../packages/importers/src/json';
import { providerArtworkUrl } from '../../packages/importers/src/artwork';

const common = {
  provider: 'jikan-api',
  medium: 'anime',
  revision: 'original-fixture',
  providerConsent: true,
  termsConfirmed: true,
};
const work = { id: 910000001, title: 'Original API Academy', categories: ['Action', 'Fantasy'] };
const characters = (offset = 0, count = 55) => ({
  data: Array.from({ length: count }, (_, index) => ({
    character: {
      mal_id: 910000001 + offset + index,
      name: `Original API Courier ${offset + index}`,
      images: {
        jpg: { image_url: `https://cdn.myanimelist.net/images/characters/1/original-${index}.jpg` },
      },
      biography: 'do-not-store-fixture-biography',
    },
    favorites: count - index,
    role: index === count - 1 ? 'Main' : 'Supporting',
    voice_actors: [{ person: { name: 'do-not-store-fixture-actor' } }],
  })),
});
const response = (body: unknown) => new Response(JSON.stringify(body));

describe('on-demand Jikan catalog boundary', () => {
  it('loads only one bounded SFW series page on the fixed host and preserves genres', async () => {
    const fetcher = vi.fn(async () =>
      response({
        data: [
          {
            mal_id: work.id,
            title: work.title,
            title_english: null,
            genres: [{ name: 'Action' }, { name: 'Fantasy' }],
          },
        ],
        pagination: { has_next_page: true },
      }),
    );
    const result = await fetchJikanApiStep(
      { ...common, step: 'works', page: 1, query: 'Original Courier' },
      fetcher,
    );
    expect(result).toEqual({
      kind: 'works',
      medium: 'anime',
      works: [work],
      page: 1,
      hasNextPage: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [address, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(address);
    expect(url.origin).toBe('https://api.tenrai.org');
    expect(url.pathname).toBe('/v1/anime');
    expect(url.searchParams.get('sfw')).toBe('true');
    expect(url.searchParams.get('q')).toBe('Original Courier');
    expect(options).toMatchObject({
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
  });
  it('retains supplied themes and demographics without inferring them from genres', async () => {
    const fetcher = vi.fn(async () =>
      response({
        data: [
          {
            mal_id: work.id,
            title: work.title,
            genres: [{ name: 'Action' }],
            themes: [{ name: 'Isekai' }, { name: 'Mecha' }],
            demographics: [{ name: 'Shounen' }],
          },
        ],
        pagination: { has_next_page: false },
      }),
    );
    const result = await fetchJikanApiStep({ ...common, step: 'works', page: 1 }, fetcher);
    expect(result).toMatchObject({
      kind: 'works',
      works: [{ categories: ['Action', 'Isekai', 'Mecha', 'Shounen'] }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const plain = await fetchJikanApiStep({ ...common, step: 'works', page: 1 }, async () =>
      response({
        data: [
          { mal_id: work.id, title: work.title, genres: [{ name: 'Action' }, { name: 'Fantasy' }] },
        ],
        pagination: { has_next_page: false },
      }),
    );
    expect(plain).toMatchObject({ kind: 'works', works: [{ categories: ['Action', 'Fantasy'] }] });
  });
  it('uses only the selected fixed service and rejects arbitrary transport hosts', async () => {
    const fetcher = vi.fn(async () => response({ data: [], pagination: { has_next_page: false } }));
    await fetchJikanApiStep({ ...common, service: 'jikan', step: 'works', page: 1 }, fetcher);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toContain(
      'https://api.jikan.moe/v4/anime?',
    );
    await expect(
      fetchJikanApiStep(
        { ...common, service: 'https://private.invalid', step: 'works', page: 1 },
        fetcher,
      ),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps demographic evidence when genres and merged works exceed the category limit', async () => {
    const genres = Array.from({ length: 30 }, (_, index) => ({
      name: `Genre ${String(index).padStart(2, '0')}`,
    }));
    const works = await fetchJikanApiStep({ ...common, step: 'works', page: 1 }, async () =>
      response({
        data: [{ mal_id: work.id, title: work.title, genres, demographics: [{ name: 'Shounen' }] }],
        pagination: { has_next_page: false },
      }),
    );
    if (works.kind !== 'works') throw new Error('Unexpected result.');
    expect(works.works[0].categories).toHaveLength(20);
    expect(works.works[0].categories).toContain('Shounen');
    let state = newJikanSeed('anime', 1);
    const first = await fetchJikanApiStep(
      {
        ...common,
        step: 'characters',
        work: { ...work, categories: genres.slice(0, 20).map((item) => item.name) },
      },
      async () => response(characters(0, 1)),
    );
    if (first.kind !== 'characters') throw new Error('Unexpected result.');
    state = mergeJikanCharacters(state, first);
    const second = await fetchJikanApiStep(
      {
        ...common,
        step: 'characters',
        work: { ...work, id: work.id + 1, categories: ['Shounen'] },
      },
      async () => response(characters(0, 1)),
    );
    if (second.kind !== 'characters') throw new Error('Unexpected result.');
    state = mergeJikanCharacters(state, second);
    expect(state.catalog.characters[0].categories).toHaveLength(20);
    expect(state.catalog.characters[0].categories).toContain('Shounen');
  });
  it('prioritizes mains, deduplicates and limits each series to fifty; artwork requires separate permission', async () => {
    const fetcher = vi.fn(async () => response(characters()));
    const without = await fetchJikanApiStep({ ...common, step: 'characters', work }, fetcher);
    if (without.kind !== 'characters') throw new Error('Unexpected result.');
    expect(without.catalog.characters).toHaveLength(50);
    expect(without.catalog.characters[0].name).toBe('Original API Courier 54');
    expect(without.catalog.characters.every((character) => !character.artwork)).toBe(true);
    expect(JSON.stringify(without)).not.toMatch(/biography|voice_actors|do-not-store/);
    const permitted = await fetchJikanApiStep(
      {
        ...common,
        step: 'characters',
        work,
        artworkPermission: 'Original artwork-reference fixture; no actual remote image request',
      },
      fetcher,
    );
    if (permitted.kind !== 'characters') throw new Error('Unexpected result.');
    expect(parseCatalog(permitted.catalog).characters[0].artwork).toEqual(
      permitted.catalog.characters[0].artwork,
    );
    expect(permitted.catalog.characters[0].artwork).toMatchObject({
      sourceUrl: 'https://myanimelist.net/character/910000055',
    });
    // Only two metadata requests, no URL from an image field was fetched.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects unsafe artwork references without treating API data as a license', () => {
    for (const unsafe of [
      'http://cdn.myanimelist.net/images/characters/1/a.jpg',
      'https://cdn.myanimelist.net.evil.invalid/images/characters/1/a.jpg',
      'https://user@cdn.myanimelist.net/images/characters/1/a.jpg',
      'https://127.0.0.1/a.jpg',
      'data:image/png;base64,xxx',
      'https://cdn.myanimelist.net/images/characters/a.svg',
    ])
      expect(providerArtworkUrl(unsafe)).toBeNull();
  });
  it('validates consent/page scope before fetching and stops rate limiting without retries', async () => {
    const fetcher = vi.fn(async () => new Response('private-upstream-trace', { status: 429 }));
    for (const input of [
      { ...common, step: 'works', page: 401 },
      { ...common, step: 'works', page: 1, providerConsent: false },
      { ...common, step: 'works', page: 1, url: 'https://private.invalid' },
    ])
      await expect(fetchJikanApiStep(input, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      fetchJikanApiStep({ ...common, step: 'works', page: 1 }, fetcher),
    ).rejects.toMatchObject({ code: 'SOURCE_RATE_LIMITED', status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      jikanApiRequestSchema.safeParse({
        ...common,
        step: 'characters',
        work,
        artworkPermission: '',
      }).success,
    ).toBe(false);
  });
  it('rejects oversized responses and sanitizes failures', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('private-upstream-body', {
          headers: { 'content-length': String(8 * 1024 * 1024 + 1) },
        }),
    );
    await expect(
      fetchJikanApiStep({ ...common, step: 'works', page: 1 }, fetcher),
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' });
    await expect(
      fetchJikanApiStep({ ...common, step: 'works', page: 1 }, async () => {
        throw new Error('private-network-trace');
      }),
    ).rejects.toThrow('Tenrai is unavailable');
  });
  it('prepares exactly one thousand original fixture identities with resume-safe merging and genre unions', async () => {
    let state = newJikanSeed('anime');
    for (let index = 0; index < 20; index++) {
      const result = await fetchJikanApiStep(
        {
          ...common,
          step: 'characters',
          work: { ...work, id: work.id + index, title: `Original API Academy ${index}` },
        },
        async () => response(characters(index * 50, 50)),
      );
      if (result.kind !== 'characters') throw new Error('Unexpected result.');
      state = mergeJikanCharacters(state, result);
      const saved = JSON.parse(JSON.stringify(state));
      expect(mergeJikanCharacters(saved, result).catalog).toEqual(state.catalog);
    }
    expect(state.catalog.characters).toHaveLength(1000);
    expect(new Set(state.catalog.characters.map((character) => character.id)).size).toBe(1000);
    expect(parseCatalog(state.catalog).characters).toHaveLength(1000);
    expect(() => newJikanSeed('anime', 100001)).toThrow();
    expect(newJikanSeed('anime', 100000).target).toBe(100000);
    expect(() => newJikanSeed('anime', 1000, 'tenrai', 4)).toThrow();
  });
  it('shows MAL names in reading order and keeps particles attached', () => {
    expect(readableMalName('Kaneki, Ken')).toBe('Ken Kaneki');
    expect(readableMalName('Monkey D., Luffy')).toBe('Monkey D. Luffy');
    expect(readableMalName('Levi')).toBe('Levi');
    expect(readableMalName('Lightning Max')).toBe('Lightning Max');
    expect(readableMalName('A, B, C')).toBe('A, B, C');
  });
  it('adds a release-era category and bounds characters per series', async () => {
    const works = await fetchJikanApiStep({ ...common, step: 'works', page: 1 }, async () =>
      response({
        data: [
          { mal_id: work.id, title: work.title, genres: [{ name: 'Action' }], year: 2016 },
          {
            mal_id: work.id + 1,
            title: 'Original Manga Academy',
            genres: [{ name: 'Drama' }],
            published: { prop: { from: { year: 1994 } } },
          },
          { mal_id: work.id + 2, title: 'Original Undated Academy', genres: [] },
        ],
        pagination: { has_next_page: true },
      }),
    );
    if (works.kind !== 'works') throw new Error('Unexpected result.');
    expect(works.works.map((item) => item.categories)).toEqual([
      ['2010s', 'Action'],
      ['1990s', 'Drama'],
      [],
    ]);
    const limited = await fetchJikanApiStep(
      { ...common, step: 'characters', work, perWork: 10 },
      async () => response(characters()),
    );
    if (limited.kind !== 'characters') throw new Error('Unexpected result.');
    expect(limited.catalog.characters).toHaveLength(10);
    expect(limited.medium).toBe('anime');
    for (const perWork of [4, 101])
      expect(
        jikanApiRequestSchema.safeParse({ ...common, step: 'characters', work, perWork }).success,
      ).toBe(false);
    // Long series: up to 100 characters per series.
    const long = await fetchJikanApiStep(
      { ...common, step: 'characters', work, perWork: 100 },
      async () => response(characters(0, 150)),
    );
    if (long.kind !== 'characters') throw new Error('Unexpected result.');
    expect(long.catalog.characters).toHaveLength(100);
  });
  it('walks manhwa, manhua, web anime, films and light novels with their MAL type', async () => {
    const requested: string[] = [];
    const fetcher = async (url: string | URL | Request) => {
      requested.push(String(url));
      return String(url).includes('/characters')
        ? response(characters(0, 3))
        : response({
            data: [{ mal_id: work.id, title: work.title, genres: [{ name: 'Action' }] }],
            pagination: { has_next_page: false },
          });
    };
    const expectations = [
      ['manhwa', '/manga?', 'type=manhwa', 'Manhwa'],
      ['manhua', '/manga?', 'type=manhua', 'Manhua'],
      ['lightnovel', '/manga?', 'type=lightnovel', 'Light Novel'],
      ['ona', '/anime?', 'type=ona', 'Web Anime'],
      ['movie', '/anime?', 'type=movie', 'Anime Film'],
    ] as const;
    for (const [medium, path, type, category] of expectations) {
      const result = await fetchJikanApiStep(
        { ...common, medium, step: 'works', page: 1 },
        fetcher,
      );
      if (result.kind !== 'works') throw new Error('Unexpected result.');
      expect(result.medium).toBe(medium);
      expect(result.works[0].categories).toContain(category);
      expect(requested.at(-1)).toContain(path);
      expect(requested.at(-1)).toContain(type);
    }
    // A manhwa's characters come from MyAnimeList's manga list (shared ID space).
    await fetchJikanApiStep({ ...common, medium: 'manhwa', step: 'characters', work }, fetcher);
    expect(requested.at(-1)).toContain(`/manga/${work.id}/characters`);
    // Plain TV anime and manga keep their categories unchanged.
    const tv = await fetchJikanApiStep({ ...common, step: 'works', page: 1 }, fetcher);
    if (tv.kind !== 'works') throw new Error('Unexpected result.');
    expect(tv.works[0].categories).toEqual(['Action']);
    expect(requested.at(-1)).toContain('type=tv');
  });
  it('walks popular anime and manga pages round-robin with separate ID namespaces', () => {
    let state = newJikanSeed('both', 4, 'tenrai', 5);
    expect(nextJikanStep(state)).toEqual({ step: 'works', medium: 'anime', page: 1 });
    state = applyJikanWorks(state, 'anime', {
      kind: 'works',
      works: [work],
      page: 1,
      hasNextPage: true,
    });
    expect(nextJikanStep(state)).toEqual({ step: 'characters', medium: 'anime', work });
    const catalog = (ids: number[]) => ({
      schemaVersion: 1 as const,
      source: 'mal',
      revision: 'original-fixture',
      license: 'Original fixture',
      characters: ids.map((id) => ({
        id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
        sourceKey: `mal:${id}`,
        name: `Original Courier ${id}`,
        series: work.title,
        categories: ['Action'],
        popularity: id,
      })),
    });
    state = mergeJikanCharacters(state, {
      kind: 'characters',
      medium: 'anime',
      work,
      catalog: catalog([1, 2]),
    });
    expect(nextJikanStep(state)).toEqual({ step: 'works', medium: 'manga', page: 1 });
    // The same numeric ID is a different manga series and is still queued.
    state = applyJikanWorks(state, 'manga', {
      kind: 'works',
      works: [work],
      page: 1,
      hasNextPage: false,
    });
    expect(nextJikanStep(state)).toEqual({ step: 'characters', medium: 'manga', work });
    state = mergeJikanCharacters(state, {
      kind: 'characters',
      medium: 'manga',
      work,
      catalog: catalog([2, 3, 4, 5]),
    });
    expect(state.catalog.characters.map((character) => character.sourceKey)).toEqual([
      'mal:1',
      'mal:2',
      'mal:3',
      'mal:4',
    ]);
    expect(state.completed).toEqual([`anime:${work.id}`, `manga:${work.id}`]);
    expect(nextJikanStep(state)).toBeNull();
  });
  it('resumes saved version 1 checkpoints', () => {
    const migrated = migrateJikanSeed({
      schemaVersion: 1,
      medium: 'manga',
      service: 'tenrai',
      revision: 'selected-api-1',
      target: 1000,
      page: 3,
      hasNextPage: true,
      queue: [work],
      completed: [work.id + 1],
      catalog: newJikanSeed('manga').catalog,
    });
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      media: ['manga'],
      cursors: { manga: { page: 3, hasNextPage: true } },
      completed: [`manga:${work.id + 1}`],
    });
    expect(nextJikanStep(migrated)).toEqual({ step: 'characters', medium: 'manga', work });
    expect(() => migrateJikanSeed({ schemaVersion: 9 })).toThrow();
  });
});
