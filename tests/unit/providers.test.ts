import { describe, expect, it, vi } from 'vitest';
import {
  fetchSelectedProviderCatalog,
  normalizeAniListCatalog,
  normalizeJikanCatalog,
  providerCharacterId,
  providerCatalogMaximumBytes,
} from '../../packages/importers/src/providers';
const request = {
  provider: 'anilist',
  ids: [910000001, 910000002],
  medium: 'anime',
  revision: 'fixture-1',
  providerConsent: true,
  termsConfirmed: true,
};
const character = (id: number, name = 'Original Star Courier') => ({
  id,
  name: { full: name },
  favourites: id % 100,
  media: {
    nodes: [
      {
        type: 'ANIME',
        title: { english: 'The Paper Sea', romaji: 'Paper Sea' },
        genres: ['Action', 'Fantasy'],
      },
    ],
  },
  image: { large: 'https://private.invalid/art.png' },
  description: 'private-provider-description',
});
const envelope = {
  data: {
    Page: { characters: [character(910000001), character(910000002, 'Original Tide Reader')] },
  },
};
const metadata = {
  medium: 'anime' as const,
  revision: 'fixture-1',
  license: 'Operator-authorized original fixture metadata',
};
describe('selected provider pipeline', () => {
  it('normalizes AniList names, source cohort favourites and major categories while excluding artwork/descriptions', () => {
    const result = normalizeAniListCatalog(envelope, metadata);
    expect(result.characters[0]).toMatchObject({
      sourceKey: 'anilist:910000001',
      series: 'The Paper Sea',
      categories: ['Action', 'Fantasy'],
      popularity: 1,
    });
    expect(JSON.stringify(result)).not.toContain('private-provider');
    expect(JSON.stringify(result)).not.toContain('private.invalid');
    expect(result.characters[0].id).toBe(providerCharacterId('anilist', 910000001));
    expect(providerCharacterId('mal', 910000001)).not.toBe(result.characters[0].id);
  });
  it('makes one fixed-host exact-ID request with no paging loop or images', async () => {
    const stub = vi.fn(async () => new Response(JSON.stringify(envelope)));
    const result = await fetchSelectedProviderCatalog(request, stub);
    expect(stub).toHaveBeenCalledTimes(1);
    const [url, options] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graphql.anilist.co');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    const body = JSON.parse(String(options.body));
    expect(body.variables).toEqual({ ids: request.ids, type: 'ANIME' });
    expect(body.query).not.toMatch(/image|description|siteUrl/);
    expect(result.characters).toHaveLength(2);
  });
  it('requires explicit consent, terms and a bounded unique numeric selection before transport', async () => {
    const stub = vi.fn();
    for (const bad of [
      { ...request, providerConsent: false },
      { ...request, termsConfirmed: false },
      { ...request, ids: [] },
      { ...request, ids: Array.from({ length: 26 }, (_, i) => i + 1) },
      { ...request, ids: [1, 1] },
      { ...request, ids: ['http://private.invalid'] },
      { ...request, endpoint: 'https://private.invalid' },
    ])
      await expect(fetchSelectedProviderCatalog(bad, stub)).rejects.toThrow();
    expect(stub).not.toHaveBeenCalled();
  });
  it('rejects incomplete or extra remote character selections', async () => {
    for (const chars of [[character(910000001)], [character(910000001), character(910000003)]])
      await expect(
        fetchSelectedProviderCatalog(
          request,
          async () => new Response(JSON.stringify({ data: { Page: { characters: chars } } })),
        ),
      ).rejects.toMatchObject({ code: 'SOURCE_CHARACTER_UNAVAILABLE' });
  });
  it('rejects unknown media membership and duplicate source identities', () => {
    expect(() =>
      normalizeAniListCatalog(
        { data: { Page: { characters: [{ ...character(1), media: { nodes: [] } }] } } },
        metadata,
      ),
    ).toThrow('selected medium');
    expect(() =>
      normalizeAniListCatalog(
        { data: { Page: { characters: [character(1), character(1)] } } },
        metadata,
      ),
    ).toThrow('duplicate');
  });
  it('does not retry a provider rate limit or expose its response body', async () => {
    const stub = vi.fn(async () => new Response('private-upstream-error', { status: 429 }));
    await expect(fetchSelectedProviderCatalog(request, stub)).rejects.toMatchObject({
      code: 'SOURCE_RATE_LIMITED',
      status: 429,
    });
    expect(stub).toHaveBeenCalledTimes(1);
  });
  it('bounds declared and streamed response sizes and rejects invalid JSON safely', async () => {
    for (const response of [
      new Response('{}', {
        headers: { 'content-length': String(providerCatalogMaximumBytes + 1) },
      }),
      new Response('x'.repeat(providerCatalogMaximumBytes + 1)),
    ])
      await expect(
        fetchSelectedProviderCatalog(request, async () => response),
      ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' });
    await expect(
      fetchSelectedProviderCatalog(request, async () => new Response('private-invalid-json')),
    ).rejects.toMatchObject({ code: 'SOURCE_INVALID' });
  });
  it('supports authorized AniList response uploads without any network access', async () => {
    const stub = vi.fn();
    const result = await fetchSelectedProviderCatalog(
      {
        ...metadata,
        provider: 'anilist-json',
        providerConsent: true,
        termsConfirmed: true,
        data: envelope,
      },
      stub,
    );
    expect(result.source).toBe('anilist');
    expect(stub).not.toHaveBeenCalled();
  });
  it('normalizes a Jikan v4 response with stable MAL identity and operator categories without fetching images', async () => {
    const stub = vi.fn(),
      result = await fetchSelectedProviderCatalog(
        {
          ...metadata,
          provider: 'jikan',
          providerConsent: true,
          termsConfirmed: true,
          series: 'Original Jikan-shape fixture',
          categories: ['Fantasy', 'Adventure'],
          data: {
            data: [
              {
                mal_id: 910000001,
                name: 'Original Moss Captain',
                favorites: 12,
                images: { jpg: { image_url: 'https://private.invalid/art' } },
              },
            ],
          },
        },
        stub,
      );
    expect(result).toMatchObject({
      source: 'mal',
      characters: [
        {
          sourceKey: 'mal:910000001',
          name: 'Original Moss Captain',
          series: 'Original Jikan-shape fixture',
          categories: ['Adventure', 'Anime', 'Fantasy'],
          popularity: 12,
        },
      ],
    });
    expect(stub).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private.invalid');
  });
  it('rejects duplicate and malformed Jikan data rather than inventing identities', () => {
    for (const data of [
      { data: [] },
      {
        data: [
          { mal_id: 1, name: 'Original', favorites: 1 },
          { mal_id: 1, name: 'Other', favorites: 1 },
        ],
      },
      { data: [{ mal_id: '1', name: 'Original' }] },
    ])
      expect(() =>
        normalizeJikanCatalog(data, { ...metadata, series: 'Original', categories: [] }),
      ).toThrow();
  });
});
