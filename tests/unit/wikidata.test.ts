import { describe, expect, it, vi } from 'vitest';
import {
  fetchWikidataCatalog,
  wikidataCatalogRequestSchema,
  wikidataCharacterId,
  wikidataCatalogMaximumBytes,
  wikidataCatalogTimeoutMs,
  WikidataCatalogError,
  parseCatalog,
} from '../../packages/importers/src/index';
import { wikidataFixture, wikidataRequest } from '../support/wikidata-fixture';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const fetchFixture = () => vi.fn<typeof fetch>().mockResolvedValue(json(wikidataFixture));
describe('explicit Wikidata anime/manga metadata adapter', () => {
  it('requests only selected English labels through a fixed endpoint with bounded safe options', async () => {
    const fetcher = fetchFixture(),
      catalog = await fetchWikidataCatalog(wikidataRequest, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [input, init] = fetcher.mock.calls[0],
      url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://www.wikidata.org/w/api.php');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: 'wbgetentities',
      format: 'json',
      props: 'labels',
      languages: 'en',
      ids: wikidataRequest.ids.join('|'),
      maxlag: '5',
    });
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(catalog).toMatchObject({
      schemaVersion: 1,
      source: 'wikidata',
      revision: 'original-fixture-1',
      characters: [
        {
          sourceKey: 'wikidata:q910000001',
          name: 'Vale of the Paper Sea',
          series: 'Paper Sea',
          categories: ['Anime', 'Paper Sea'],
          popularity: null,
        },
        { name: 'Mira the Windkeeper' },
      ],
    });
    expect(catalog.license).toContain('CC0');
    expect(JSON.stringify(catalog)).not.toContain('not-imported');
    expect(parseCatalog(catalog).characters.every((character) => character.tier === 'common')).toBe(
      true,
    );
  });
  it('keeps canonical UUIDs stable across order, ID case, medium and revision changes', async () => {
    const first = await fetchWikidataCatalog(wikidataRequest, fetchFixture());
    const second = await fetchWikidataCatalog(
      {
        ...wikidataRequest,
        ids: [...wikidataRequest.ids].reverse().map((id) => id.toLowerCase()),
        medium: 'manga',
        revision: 'second',
      },
      fetchFixture(),
    );
    expect(second.characters[0].id).toBe(first.characters[1].id);
    expect(second.characters[1].id).toBe(first.characters[0].id);
    expect(second.characters[0].categories).toEqual(['Manga', 'Paper Sea']);
    expect(wikidataCharacterId('Q910000001')).toBe(wikidataCharacterId('q910000001'));
    expect(wikidataCharacterId('Q910000001')).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
  });
  it('rejects bulk, duplicate, URL, malformed and arbitrary input before making a request', async () => {
    const fetcher = fetchFixture();
    const invalid = [
      { ...wikidataRequest, ids: [] },
      { ...wikidataRequest, ids: Array.from({ length: 26 }, (_, i) => `Q${i + 1}`) },
      { ...wikidataRequest, ids: ['Q1', 'q1'] },
      { ...wikidataRequest, ids: ['https://example.test'] },
      { ...wikidataRequest, ids: ['P123'] },
      { ...wikidataRequest, ids: ['Q0'] },
      { ...wikidataRequest, series: 'x'.repeat(61) },
      { ...wikidataRequest, revision: 'bad\nrevision' },
      { ...wikidataRequest, medium: 'game' },
      { ...wikidataRequest, url: 'https://other.example.test' },
    ];
    for (const value of invalid)
      await expect(
        fetchWikidataCatalog(value as typeof wikidataRequest, fetcher),
      ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(wikidataCatalogRequestSchema.parse({ ...wikidataRequest, ids: [' q1 '] }).ids).toEqual([
      'Q1',
    ]);
  });
  it('rejects missing, redirected, mismatched, unlabeled and unrequested records instead of importing partial data', async () => {
    for (const entity of [
      { id: 'Q910000001', missing: '' },
      { ...wikidataFixture.entities.Q910000001, id: 'Q1' },
      { ...wikidataFixture.entities.Q910000001, type: 'property' },
      { ...wikidataFixture.entities.Q910000001, labels: {} },
      {
        ...wikidataFixture.entities.Q910000001,
        labels: { en: { language: 'en', value: 'x'.repeat(101) } },
      },
    ]) {
      await expect(
        fetchWikidataCatalog(
          wikidataRequest,
          vi.fn<typeof fetch>().mockResolvedValue(
            json({
              ...wikidataFixture,
              entities: { ...wikidataFixture.entities, Q910000001: entity },
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: 'SOURCE_ITEM_UNAVAILABLE' });
    }
    await expect(
      fetchWikidataCatalog(
        wikidataRequest,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            json({ success: 1, entities: { Q5: wikidataFixture.entities.Q910000001 } }),
          ),
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_ITEM_UNAVAILABLE' });
  });
  it('handles rate limits, API errors and malformed responses without retrying or exposing provider bodies', async () => {
    for (const response of [
      json({ private: 'provider-private-fixture' }, 429),
      json({ private: 'provider-private-fixture' }, 503),
      json({ error: { code: 'maxlag', info: 'provider-private-fixture' } }),
      new Response('provider-private-fixture'),
      new Response(new Uint8Array([255, 254])),
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      let failure: unknown;
      try {
        await fetchWikidataCatalog(wikidataRequest, fetcher);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(WikidataCatalogError);
      expect(String(failure)).not.toContain('provider-private-fixture');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    await expect(
      fetchWikidataCatalog(
        wikidataRequest,
        vi.fn<typeof fetch>().mockRejectedValue(new Error('private-connection-detail')),
      ),
    ).rejects.not.toThrow('private-connection-detail');
  });
  it('rejects oversized declared or streaming responses and cancels the reader', async () => {
    const declared = new Response('{}', {
      headers: { 'Content-Length': String(wikidataCatalogMaximumBytes + 1) },
    });
    await expect(
      fetchWikidataCatalog(wikidataRequest, vi.fn<typeof fetch>().mockResolvedValue(declared)),
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' });
    const cancel = vi.fn(),
      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(wikidataCatalogMaximumBytes));
          controller.enqueue(new Uint8Array(1));
        },
        cancel,
      });
    await expect(
      fetchWikidataCatalog(
        wikidataRequest,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('aborts a stalled provider request after eight seconds with a sanitized timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new Error('private-timeout-detail')),
              { once: true },
            );
          }),
      );
      const pending = fetchWikidataCatalog(wikidataRequest, fetcher),
        assertion = expect(pending).rejects.toMatchObject({ code: 'SOURCE_TIMEOUT', status: 504 });
      await vi.advanceTimersByTimeAsync(wikidataCatalogTimeoutMs);
      await assertion;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
