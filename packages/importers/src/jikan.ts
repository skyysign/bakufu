import { jikanPacing } from './jikan-pacing';
import { z } from 'zod';
import { catalogSchema } from './json';
import { boundedProviderCategories, providerCharacterId, ProviderCatalogError } from './providers';
import { providerArtworkUrl } from './artwork';

const text = (max: number) => z.string().trim().min(1).max(max);
const identifier = z.number().int().positive().max(2147483647);
export const jikanWorkSchema = z.strictObject({
  id: identifier,
  title: text(100),
  categories: z.array(text(60)).max(20),
});
export type JikanWork = z.infer<typeof jikanWorkSchema>;
const shared = {
  provider: z.literal('jikan-api'),
  service: z.enum(['tenrai', 'jikan']).default('tenrai'),
  medium: z.enum(['anime', 'manga']),
  revision: text(100),
  providerConsent: z.literal(true),
  termsConfirmed: z.literal(true),
};
/** Deepest series page a preparation may request (25 popular series per page). */
export const jikanMaxPages = 400;
export const jikanApiRequestSchema = z.discriminatedUnion('step', [
  z.strictObject({
    ...shared,
    step: z.literal('works'),
    page: z.number().int().min(1).max(jikanMaxPages),
    query: z.string().trim().max(100).optional(),
  }),
  z.strictObject({
    ...shared,
    /** One character's profile, reduced to an inferred gender. */
    step: z.literal('profile'),
    characterId: identifier,
  }),
  z.strictObject({
    ...shared,
    step: z.literal('characters'),
    work: jikanWorkSchema,
    artworkPermission: text(200).optional(),
    /** Main characters first, then the most favourited supporting cast. */
    perWork: z.number().int().min(5).max(50).optional(),
  }),
]);
export type JikanApiRequest = z.infer<typeof jikanApiRequestSchema>;
export type JikanWorksResult = {
  kind: 'works';
  medium?: 'anime' | 'manga';
  works: JikanWork[];
  page: number;
  hasNextPage: boolean;
};
export type JikanCharactersResult = {
  kind: 'characters';
  medium?: 'anime' | 'manga';
  catalog: z.infer<typeof catalogSchema>;
  work: JikanWork;
};
export type CharacterGender = 'female' | 'male';
export type JikanProfileResult = {
  kind: 'profile';
  characterId: number;
  gender: CharacterGender | null;
};
export type JikanApiResult = JikanWorksResult | JikanCharactersResult | JikanProfileResult;

/**
 * MyAnimeList has no gender field; profiles only carry a free-text biography.
 * An explicit "Gender:"/"Sex:" line wins; otherwise pronouns must clearly agree
 * (at least three, two-to-one). Anything less certain stays unknown. Only the
 * result is kept; the biography itself is never stored.
 */
export function inferCharacterGender(about: string | null | undefined): CharacterGender | null {
  if (!about) return null;
  const explicit = /\b(?:gender|sex)\s*:\s*(female|male|woman|man|girl|boy)\b/i.exec(about);
  if (explicit) return /^(?:female|woman|girl)$/i.test(explicit[1]) ? 'female' : 'male';
  const female = (about.match(/\b(?:she|her|hers|herself)\b/gi) ?? []).length,
    male = (about.match(/\b(?:he|him|his|himself)\b/gi) ?? []).length;
  if (female + male < 3) return null;
  if (female >= male * 2 && female > male) return 'female';
  if (male >= female * 2 && male > female) return 'male';
  return null;
}
export { jikanPacing };
/** Spacing for the legacy Jikan API (the slower of the two services). */
export const jikanStepDelayMs = jikanPacing.jikan.delayMs;
export const jikanCharactersPerWork = 50;

/** MyAnimeList lists names as 'Family, Given'. Show the order fans use. */
export function readableMalName(name: string) {
  const parts = name.split(',').map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return name.trim();
  // Particles such as One Piece's 'D.' stay attached: 'Monkey D., Luffy'.
  return parts[0].endsWith('.') ? `${parts[0]} ${parts[1]}` : `${parts[1]} ${parts[0]}`;
}
/** Decade of a series' first release, as an era category such as '2010s'. */
function eraCategory(year: number | null | undefined) {
  return year && year >= 1900 && year <= 2100 ? `${Math.floor(year / 10) * 10}s` : null;
}
const yearProp = z
  .object({
    prop: z
      .object({
        from: z.object({ year: z.number().int().nullable().optional() }).optional(),
      })
      .optional(),
  })
  .nullable()
  .optional();

const serviceBases = {
  tenrai: 'https://api.tenrai.org/v1',
  jikan: 'https://api.jikan.moe/v4',
} as const;
async function requestJson(
  path: string,
  service: keyof typeof serviceBases,
  fetcher: typeof fetch,
): Promise<unknown> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000),
    label = service === 'tenrai' ? 'Tenrai' : 'Jikan';
  try {
    const response = await fetcher(`${serviceBases[service]}/${path}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CardEngine/0.1 (operator-selected character catalog)',
      },
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 429)
      throw new ProviderCatalogError(
        'SOURCE_RATE_LIMITED',
        `${label} is rate limiting this connection. Preparation paused; resume later.`,
        429,
      );
    if (!response.ok || response.redirected)
      throw new ProviderCatalogError(
        'SOURCE_UNAVAILABLE',
        `${label} could not return this page. Keep the prepared selection and try again later.`,
        502,
      );
    const maximum = 8 * 1024 * 1024;
    if (Number(response.headers.get('content-length') ?? 0) > maximum || !response.body)
      throw new ProviderCatalogError(
        'SOURCE_TOO_LARGE',
        'The Jikan response is too large or empty.',
        502,
      );
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          throw new ProviderCatalogError(
            'SOURCE_TOO_LARGE',
            'The Jikan response exceeds 8 MiB.',
            502,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof ProviderCatalogError) throw error;
    throw new ProviderCatalogError(
      'SOURCE_UNAVAILABLE',
      `${label} is unavailable or returned unsupported metadata. Preparation is paused.`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

// One request per call. A request cannot become a background crawler or a mirror.
export async function fetchJikanApiStep(
  input: unknown,
  fetcher: typeof fetch = fetch,
): Promise<JikanApiResult> {
  const request = jikanApiRequestSchema.parse(input);
  if (request.step === 'profile') {
    const raw = await requestJson(`characters/${request.characterId}`, request.service, fetcher);
    const parsed = z
      .object({
        data: z.object({
          mal_id: identifier,
          about: z.string().nullable().optional(),
        }),
      })
      .safeParse(raw);
    if (!parsed.success)
      throw new ProviderCatalogError(
        'SOURCE_INVALID',
        'Jikan returned an unsupported character profile.',
        502,
      );
    return {
      kind: 'profile',
      characterId: request.characterId,
      gender: inferCharacterGender(parsed.data.data.about),
    };
  }
  if (request.step === 'works') {
    const parameters = new URLSearchParams({
      page: String(request.page),
      limit: '25',
      sfw: 'true',
      order_by: 'members',
      sort: 'desc',
      type: request.medium === 'anime' ? 'tv' : 'manga',
    });
    if (request.query) parameters.set('q', request.query);
    const raw = await requestJson(`${request.medium}?${parameters}`, request.service, fetcher);
    const parsed = z
      .object({
        data: z
          .array(
            z.object({
              mal_id: identifier,
              title: text(300),
              title_english: z.string().nullable().optional(),
              genres: z
                .array(z.object({ name: text(60) }))
                .max(30)
                .optional(),
              themes: z
                .array(z.object({ name: text(60) }))
                .max(30)
                .optional(),
              demographics: z
                .array(z.object({ name: text(60) }))
                .max(30)
                .optional(),
              year: z.number().int().nullable().optional(),
              aired: yearProp,
              published: yearProp,
            }),
          )
          .max(25),
        pagination: z.object({ has_next_page: z.boolean() }),
      })
      .safeParse(raw);
    if (!parsed.success)
      throw new ProviderCatalogError(
        'SOURCE_INVALID',
        'Jikan returned an unsupported series page.',
        502,
      );
    return {
      kind: 'works',
      medium: request.medium,
      page: request.page,
      hasNextPage: request.page < jikanMaxPages && parsed.data.pagination.has_next_page,
      works: parsed.data.data.map((work) => {
        const era = eraCategory(
          work.year ?? work.aired?.prop?.from?.year ?? work.published?.prop?.from?.year,
        );
        return {
          id: work.mal_id,
          title: (work.title_english || work.title).slice(0, 100),
          categories: boundedProviderCategories([
            ...[...(work.genres ?? []), ...(work.themes ?? []), ...(work.demographics ?? [])].map(
              (category) => category.name,
            ),
            ...(era ? [era] : []),
          ]),
        };
      }),
    };
  }
  const raw = await requestJson(
    `${request.medium}/${request.work.id}/characters`,
    request.service,
    fetcher,
  );
  const parsed = z
    .object({
      data: z
        .array(
          z.object({
            character: z.object({
              mal_id: identifier,
              name: text(300),
              images: z
                .object({
                  jpg: z.object({ image_url: z.string().nullable().optional() }).optional(),
                })
                .optional(),
            }),
            favorites: z.number().int().nonnegative().nullable().optional(),
            role: z.string().optional(),
          }),
        )
        .max(10000),
    })
    .safeParse(raw);
  if (!parsed.success)
    throw new ProviderCatalogError(
      'SOURCE_INVALID',
      'Jikan returned an unsupported character page.',
      502,
    );
  const sorted = parsed.data.data.sort(
    (a, b) =>
      Number(b.role === 'Main') - Number(a.role === 'Main') ||
      (b.favorites ?? 0) - (a.favorites ?? 0) ||
      a.character.mal_id - b.character.mal_id,
  );
  const seen = new Set<number>();
  const characters = sorted
    .filter((entry) => !seen.has(entry.character.mal_id) && !!seen.add(entry.character.mal_id))
    .slice(0, request.perWork ?? jikanCharactersPerWork)
    .map((entry) => {
      const url =
        request.artworkPermission && providerArtworkUrl(entry.character.images?.jpg?.image_url);
      return {
        id: providerCharacterId('mal', entry.character.mal_id),
        sourceKey: `mal:${entry.character.mal_id}`,
        name: readableMalName(entry.character.name).slice(0, 100),
        series: request.work.title,
        categories: request.work.categories,
        popularity: entry.favorites ?? null,
        ...(entry.role
          ? {
              role: entry.role === 'Main' ? ('main' as const) : ('supporting' as const),
            }
          : {}),
        ...(url
          ? {
              artwork: {
                url,
                sourceUrl: `https://myanimelist.net/character/${entry.character.mal_id}`,
                permission: request.artworkPermission!,
              },
            }
          : {}),
      };
    });
  // Empty pages can be skipped by the bounded preparation loop.
  const catalog = characters.length
    ? catalogSchema.parse({
        schemaVersion: 1,
        source: 'mal',
        revision: request.revision,
        license: `${request.service === 'tenrai' ? 'Tenrai' : 'Jikan'} / MyAnimeList selected metadata; operator-confirmed permitted use; artwork rights separate`,
        characters,
      })
    : {
        schemaVersion: 1 as const,
        source: 'mal',
        revision: request.revision,
        license: `${request.service === 'tenrai' ? 'Tenrai' : 'Jikan'} / MyAnimeList selected metadata; operator-confirmed permitted use; artwork rights separate`,
        characters: [],
      };
  return {
    kind: 'characters',
    medium: request.medium,
    work: request.work,
    catalog,
  };
}
