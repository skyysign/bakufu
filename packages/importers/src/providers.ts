import { createHash } from 'node:crypto';
import { z } from 'zod';
import { catalogSchema } from './json';
import { boundedProviderCategories } from './provider-categories';
export { boundedProviderCategories } from './provider-categories';

const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        Array.from(value).every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      'Use single-line text.',
    );
const mediumSchema = z.enum(['anime', 'manga']);
const common = {
  medium: mediumSchema,
  revision: line(100),
  providerConsent: z.literal(true),
  termsConfirmed: z.literal(true),
};
export const providerCatalogRequestSchema = z.discriminatedUnion('provider', [
  z.strictObject({
    ...common,
    provider: z.literal('anilist'),
    ids: z
      .array(z.number().int().min(1).max(2147483647))
      .min(1)
      .max(25)
      .refine((ids) => new Set(ids).size === ids.length, 'Select each character ID once.'),
  }),
  z.strictObject({
    ...common,
    provider: z.literal('anilist-json'),
    data: z.unknown(),
    license: line(200),
  }),
  z.strictObject({
    ...common,
    provider: z.literal('jikan'),
    data: z.unknown(),
    series: line(100),
    categories: z.array(line(60)).max(10).default([]),
    license: line(200),
  }),
]);
export type ProviderCatalogRequest = z.infer<typeof providerCatalogRequestSchema>;
export class ProviderCatalogError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ProviderCatalogError';
  }
}
export const providerCatalogMaximumBytes = 2 * 1024 * 1024;
export const providerCatalogTimeoutMs = 8000;
export const majorCatalogCategories = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Fantasy',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
] as const;
// Shared provider boundary: source-qualified IDs, never a URL or a downloaded image.
export function providerCharacterId(
  source: 'anilist' | 'mal' | 'scale-demo',
  id: string | number,
): string {
  const bytes = createHash('sha1')
    .update(Buffer.from('91d84adc21ea4d6bba537cd3f77be180', 'hex'))
    .update(`${source}:character:${id}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const idSchema = z.number().int().min(1).max(2147483647);
const popularitySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional();
const aniListCharacterSchema = z.object({
  id: idSchema,
  name: z.object({ full: line(100) }),
  favourites: popularitySchema,
  media: z.object({
    nodes: z
      .array(
        z.object({
          type: z.enum(['ANIME', 'MANGA']),
          title: z.object({
            english: line(100).nullable().optional(),
            romaji: line(100).nullable().optional(),
          }),
          genres: z.array(line(60)).max(20).nullable().optional(),
        }),
      )
      .max(5),
  }),
});
const aniListEnvelope = z.object({
  data: z.object({
    Page: z.object({
      characters: z.array(aniListCharacterSchema).min(1).max(1000),
    }),
  }),
});
export function normalizeAniListCatalog(
  data: unknown,
  options: { medium: 'anime' | 'manga'; revision: string; license: string },
) {
  const parsed = aniListEnvelope.safeParse(data);
  if (!parsed.success)
    throw new ProviderCatalogError(
      'SOURCE_INVALID',
      'The AniList response does not match the supported character metadata format.',
    );
  const characters = parsed.data.data.Page.characters.map((character) => {
    const media = character.media.nodes.filter(
      (item) => item.type === options.medium.toUpperCase(),
    );
    const title = media[0]?.title.english ?? media[0]?.title.romaji;
    if (!title)
      throw new ProviderCatalogError(
        'SOURCE_CHARACTER_UNAVAILABLE',
        'Each selected character must have a named work in the selected medium.',
      );
    return {
      id: providerCharacterId('anilist', character.id),
      sourceKey: `anilist:${character.id}`,
      name: character.name.full,
      series: title,
      categories: boundedProviderCategories(media.flatMap((item) => item.genres ?? [])),
      popularity: character.favourites ?? null,
    };
  });
  try {
    return catalogSchema.parse({
      schemaVersion: 1,
      source: 'anilist',
      revision: options.revision,
      license: options.license,
      characters,
    });
  } catch {
    throw new ProviderCatalogError(
      'SOURCE_INVALID',
      'The source has duplicate IDs or unsupported catalog values.',
    );
  }
}
export function normalizeJikanCatalog(
  data: unknown,
  options: {
    medium: 'anime' | 'manga';
    revision: string;
    license: string;
    series: string;
    categories: string[];
  },
) {
  const envelope = z
    .object({
      data: z.union([z.array(z.unknown()).min(1).max(1000), z.record(z.string(), z.unknown())]),
    })
    .safeParse(data);
  if (!envelope.success)
    throw new ProviderCatalogError(
      'SOURCE_INVALID',
      'Upload a Jikan v4 character response with a data object or array.',
    );
  const raw = Array.isArray(envelope.data.data) ? envelope.data.data : [envelope.data.data];
  const parsed = z
    .array(
      z.object({
        mal_id: idSchema,
        name: line(100),
        favorites: popularitySchema,
      }),
    )
    .safeParse(raw);
  if (!parsed.success)
    throw new ProviderCatalogError(
      'SOURCE_INVALID',
      'The Jikan response does not match the supported character metadata format.',
    );
  try {
    return catalogSchema.parse({
      schemaVersion: 1,
      source: 'mal',
      revision: options.revision,
      license: options.license,
      characters: parsed.data.map((character) => ({
        id: providerCharacterId('mal', character.mal_id),
        sourceKey: `mal:${character.mal_id}`,
        name: character.name,
        series: options.series,
        categories: boundedProviderCategories([
          options.medium === 'anime' ? 'Anime' : 'Manga',
          ...options.categories,
        ]),
        popularity: character.favorites ?? null,
      })),
    });
  } catch {
    throw new ProviderCatalogError(
      'SOURCE_INVALID',
      'The source has duplicate IDs or unsupported catalog values.',
    );
  }
}
export const catalogProviders = [
  {
    id: 'anilist',
    name: 'AniList',
    source: 'anilist',
    live: true,
    terms: 'https://docs.anilist.co/guide/terms-of-use',
    maximumSelected: 25,
  },
  {
    id: 'jikan',
    name: 'Jikan / MyAnimeList JSON',
    source: 'mal',
    live: false,
    terms: 'https://jikan.moe/terms',
    maximumSelected: 1000,
  },
] as const;
// One exact-ID request, no pagination, search sweep, images, descriptions or user data.
const aniListQuery = `query SelectedCharacters($ids:[Int],$type:MediaType){Page(page:1,perPage:25){characters(id_in:$ids){id name{full} favourites media(page:1,perPage:5,type:$type,sort:POPULARITY_DESC){nodes{type title{english romaji} genres}}}}}`;
export async function boundedJson(response: Response) {
  if (Number(response.headers.get('content-length') ?? 0) > providerCatalogMaximumBytes)
    throw new ProviderCatalogError('SOURCE_TOO_LARGE', 'The metadata response exceeds 2 MiB.', 502);
  if (!response.body)
    throw new ProviderCatalogError('SOURCE_INVALID', 'The source returned an empty response.', 502);
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > providerCatalogMaximumBytes) {
        await reader.cancel();
        throw new ProviderCatalogError(
          'SOURCE_TOO_LARGE',
          'The metadata response exceeds 2 MiB.',
          502,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new ProviderCatalogError(
      'SOURCE_INVALID',
      'The source returned invalid JSON metadata.',
      502,
    );
  }
}
export async function fetchSelectedProviderCatalog(input: unknown, fetcher: typeof fetch = fetch) {
  const request = providerCatalogRequestSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(request)) > providerCatalogMaximumBytes)
    throw new ProviderCatalogError(
      'SOURCE_TOO_LARGE',
      'Use a source selection smaller than 2 MiB.',
    );
  if (request.provider === 'jikan') return normalizeJikanCatalog(request.data, request);
  if (request.provider === 'anilist-json') return normalizeAniListCatalog(request.data, request);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), providerCatalogTimeoutMs);
  try {
    const response = await fetcher('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'CardEngine/0.1 (self-hosted selected metadata importer)',
      },
      body: JSON.stringify({
        query: aniListQuery,
        variables: { ids: request.ids, type: request.medium.toUpperCase() },
      }),
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 429)
      throw new ProviderCatalogError(
        'SOURCE_RATE_LIMITED',
        'AniList is rate limiting requests. Wait before trying again.',
        429,
      );
    if (!response.ok || response.redirected)
      throw new ProviderCatalogError(
        'SOURCE_UNAVAILABLE',
        'AniList is unavailable. Try the same selection later.',
        502,
      );
    const data = await boundedJson(response),
      catalog = normalizeAniListCatalog(data, {
        ...request,
        license: 'AniList selected metadata; operator-confirmed permitted use; excludes artwork',
      });
    const selected = new Set(request.ids.map((id) => `anilist:${id}`));
    if (
      catalog.characters.length !== selected.size ||
      catalog.characters.some((character) => !selected.has(character.sourceKey))
    )
      throw new ProviderCatalogError(
        'SOURCE_CHARACTER_UNAVAILABLE',
        'AniList did not return every selected character. Check the IDs and medium.',
      );
    return catalog;
  } catch (error) {
    if (error instanceof ProviderCatalogError) throw error;
    if (controller.signal.aborted)
      throw new ProviderCatalogError(
        'SOURCE_TIMEOUT',
        'The selected metadata request timed out. Try again later.',
        504,
      );
    throw new ProviderCatalogError(
      'SOURCE_UNAVAILABLE',
      'The selected metadata could not be retrieved. Try again later.',
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}
