import { aniListMaxPerWork, aniListMedia, aniListMediumInfo, type AniListMedium } from './media';
import { z } from 'zod';
import { catalogSchema } from './json';
import {
  boundedJson,
  boundedProviderCategories,
  providerCharacterId,
  ProviderCatalogError,
  providerCatalogTimeoutMs,
} from './providers';
import { providerArtworkUrl } from './artwork';

/**
 * AniList series browser. AniList's terms prohibit mass collection, so this
 * adapter only ever (a) lists one page of series for an admin to choose from
 * and (b) loads the characters of one explicitly chosen series per request.
 * There is no automated "whole catalogue" sweep for AniList.
 */
export const aniListMaxPages = 50;
export const aniListCharactersPerWork = 25;
export { aniListMaxPerWork, aniListMedia, aniListMediumInfo, type AniListMedium } from './media';
/** The medium category a work gets from its type, country of origin and format. */
function mediumCategory(type: 'ANIME' | 'MANGA', country?: string | null, format?: string | null) {
  if (format === 'NOVEL') return 'Light Novel';
  if (type === 'ANIME') return country === 'CN' ? 'Donghua' : null;
  return country === 'KR' ? 'Manhwa' : country === 'CN' || country === 'TW' ? 'Manhua' : null;
}
export const aniListStepDelayMs = 2500;

const text = (max: number) => z.string().trim().min(1).max(max);
const identifier = z.number().int().positive().max(2147483647);
export const aniListWorkSchema = z.strictObject({
  id: identifier,
  title: text(100),
  categories: z.array(text(60)).max(20),
});
export type AniListWork = z.infer<typeof aniListWorkSchema>;
const shared = {
  provider: z.literal('anilist-api'),
  medium: z.enum(aniListMedia),
  revision: text(100),
  providerConsent: z.literal(true),
  termsConfirmed: z.literal(true),
};
export const aniListApiRequestSchema = z.discriminatedUnion('step', [
  z.strictObject({
    ...shared,
    step: z.literal('works'),
    page: z.number().int().min(1).max(aniListMaxPages),
    query: z.string().trim().max(100).optional(),
  }),
  z.strictObject({
    ...shared,
    step: z.literal('characters'),
    work: aniListWorkSchema,
    perWork: z.number().int().min(5).max(aniListMaxPerWork).optional(),
    artworkPermission: text(200).optional(),
  }),
]);
export type AniListApiRequest = z.infer<typeof aniListApiRequestSchema>;
export type AniListCatalog = z.infer<typeof catalogSchema>;
export type AniListApiResult =
  | {
      kind: 'works';
      medium: AniListMedium;
      works: AniListWork[];
      page: number;
      hasNextPage: boolean;
    }
  | {
      kind: 'characters';
      medium: AniListMedium;
      work: AniListWork;
      catalog: AniListCatalog;
    };

const worksQuery = `query Works($page:Int,$type:MediaType,$country:CountryCode,$format:MediaFormat,$search:String){Page(page:$page,perPage:20){pageInfo{hasNextPage} media(type:$type,countryOfOrigin:$country,format:$format,search:$search,sort:[POPULARITY_DESC],isAdult:false){id type format countryOfOrigin title{english romaji} genres tags{name category} seasonYear startDate{year}}}}`;
const charactersQuery = `query Characters($id:Int,$page:Int,$perPage:Int){Media(id:$id){id characters(page:$page,perPage:$perPage,sort:[ROLE,FAVOURITES_DESC]){pageInfo{hasNextPage} edges{role node{id name{full userPreferred} gender favourites image{large}}}}}}`;

const license =
  'AniList selected-series metadata; operator-confirmed permitted use; artwork rights separate';

async function graphql(query: string, variables: Record<string, unknown>, fetcher: typeof fetch) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), providerCatalogTimeoutMs);
  try {
    const response = await fetcher('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'CardEngine/0.1 (self-hosted selected-series importer)',
      },
      body: JSON.stringify({ query, variables }),
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 429)
      throw new ProviderCatalogError(
        'SOURCE_RATE_LIMITED',
        'AniList is rate limiting requests. Preparation paused; resume in a minute.',
        429,
      );
    if (response.status === 404) return null;
    if (!response.ok || response.redirected)
      throw new ProviderCatalogError(
        'SOURCE_UNAVAILABLE',
        'AniList is unavailable. Keep your selection and try again later.',
        502,
      );
    return await boundedJson(response);
  } catch (error) {
    if (error instanceof ProviderCatalogError) throw error;
    if (controller.signal.aborted)
      throw new ProviderCatalogError(
        'SOURCE_TIMEOUT',
        'AniList did not answer in time. Try again later.',
        504,
      );
    throw new ProviderCatalogError(
      'SOURCE_UNAVAILABLE',
      'AniList is unavailable or returned unsupported metadata. Preparation is paused.',
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}
function era(year: number | null | undefined) {
  return year && year >= 1900 && year <= 2100 ? `${Math.floor(year / 10) * 10}s` : null;
}

/** One request per call; the caller paces requests and owns the selection. */
export async function fetchAniListApiStep(
  input: unknown,
  fetcher: typeof fetch = fetch,
): Promise<AniListApiResult> {
  const request = aniListApiRequestSchema.parse(input);
  const info = aniListMediumInfo[request.medium];
  if (request.step === 'works') {
    const raw = await graphql(
      worksQuery,
      {
        page: request.page,
        type: info.type,
        country: info.country ?? null,
        format: info.format ?? null,
        search: request.query || null,
      },
      fetcher,
    );
    const parsed = z
      .object({
        data: z.object({
          Page: z.object({
            pageInfo: z.object({
              hasNextPage: z.boolean().nullable().optional(),
            }),
            media: z
              .array(
                z.object({
                  id: identifier,
                  type: z.enum(['ANIME', 'MANGA']).nullable().optional(),
                  format: z.string().max(40).nullable().optional(),
                  countryOfOrigin: z.string().max(10).nullable().optional(),
                  title: z.object({
                    english: z.string().nullable().optional(),
                    romaji: z.string().nullable().optional(),
                  }),
                  genres: z.array(text(60)).max(30).nullable().optional(),
                  tags: z
                    .array(
                      z.object({
                        name: text(60),
                        category: z.string().nullable().optional(),
                      }),
                    )
                    .max(200)
                    .nullable()
                    .optional(),
                  seasonYear: z.number().int().nullable().optional(),
                  startDate: z
                    .object({ year: z.number().int().nullable().optional() })
                    .nullable()
                    .optional(),
                }),
              )
              .max(20),
          }),
        }),
      })
      .safeParse(raw);
    if (!parsed.success)
      throw new ProviderCatalogError(
        'SOURCE_INVALID',
        'AniList returned an unsupported page.',
        502,
      );
    return {
      kind: 'works',
      medium: request.medium,
      page: request.page,
      hasNextPage: request.page < aniListMaxPages && !!parsed.data.data.Page.pageInfo.hasNextPage,
      works: parsed.data.data.Page.media
        .map((media) => {
          const title = (media.title.english || media.title.romaji || '').trim().slice(0, 100);
          const decade = era(media.seasonYear ?? media.startDate?.year);
          const kind = mediumCategory(media.type ?? info.type, media.countryOfOrigin, media.format);
          return {
            id: media.id,
            title,
            // Real demographic tags only; genres are never relabelled.
            categories: boundedProviderCategories([
              ...(media.genres ?? []),
              ...(media.tags ?? [])
                .filter((tag) => tag.category === 'Demographic')
                .map((tag) => tag.name),
              ...(decade ? [decade] : []),
              ...(kind ? [kind] : []),
            ]),
          };
        })
        .filter((work) => work.title),
    };
  }
  const perWork = request.perWork ?? aniListCharactersPerWork;
  const empty = {
    kind: 'characters' as const,
    medium: request.medium,
    work: request.work,
    catalog: {
      schemaVersion: 1 as const,
      source: 'anilist',
      revision: request.revision,
      license,
      characters: [],
    },
  };
  // AniList returns at most 25 characters per request, main cast first.
  const pageSize = Math.min(perWork, aniListCharactersPerWork);
  const edges: CharacterEdge[] = [];
  for (let page = 1; edges.length < perWork && page <= aniListMaxPerWork / pageSize; page++) {
    const raw = await graphql(
      charactersQuery,
      { id: request.work.id, page, perPage: pageSize },
      fetcher,
    );
    if (raw === null) break;
    const parsed = characterPageSchema.safeParse(raw);
    if (!parsed.success)
      throw new ProviderCatalogError(
        'SOURCE_INVALID',
        'AniList returned an unsupported character page.',
        502,
      );
    const cast = parsed.data.data.Media?.characters;
    edges.push(...(cast?.edges ?? []));
    if (!cast?.pageInfo?.hasNextPage) break;
  }
  const seen = new Set<number>();
  const characters = edges
    .filter((edge) => edge.node && (edge.node.name.userPreferred || edge.node.name.full))
    .sort(
      (a, b) =>
        Number(b.role === 'MAIN') - Number(a.role === 'MAIN') ||
        (b.node!.favourites ?? 0) - (a.node!.favourites ?? 0) ||
        a.node!.id - b.node!.id,
    )
    .filter((edge) => !seen.has(edge.node!.id) && !!seen.add(edge.node!.id))
    .slice(0, perWork)
    .map((edge) => characterEntry(edge, request.work, request.artworkPermission));
  if (!characters.length) return empty;
  return {
    ...empty,
    catalog: catalogSchema.parse({ ...empty.catalog, characters }),
  };
}

const characterPageSchema = z.object({
  data: z.object({
    Media: z
      .object({
        characters: z.object({
          pageInfo: z
            .object({ hasNextPage: z.boolean().nullable().optional() })
            .nullable()
            .optional(),
          edges: z
            .array(
              z.object({
                role: z.string().nullable().optional(),
                node: z
                  .object({
                    id: identifier,
                    name: z.object({
                      full: z.string().nullable().optional(),
                      userPreferred: z.string().nullable().optional(),
                    }),
                    gender: z.string().max(40).nullable().optional(),
                    favourites: z.number().int().nonnegative().nullable().optional(),
                    image: z
                      .object({ large: z.string().nullable().optional() })
                      .nullable()
                      .optional(),
                  })
                  .nullable(),
              }),
            )
            .max(50),
        }),
      })
      .nullable(),
  }),
});
type CharacterEdge = NonNullable<
  z.infer<typeof characterPageSchema>['data']['Media']
>['characters']['edges'][number];

function characterEntry(edge: CharacterEdge, work: AniListWork, artworkPermission?: string) {
  const node = edge.node!;
  const url = artworkPermission && providerArtworkUrl(node.image?.large);
  return {
    id: providerCharacterId('anilist', node.id),
    sourceKey: `anilist:${node.id}`,
    name: (node.name.userPreferred || node.name.full || '').trim().slice(0, 100),
    series: work.title,
    // AniList publishes gender; it becomes the Female/Male (Waifus/Husbandos) category.
    categories: [
      ...(/^female$/i.test(node.gender ?? '') ? ['Female'] : []),
      ...(/^male$/i.test(node.gender ?? '') ? ['Male'] : []),
      ...work.categories,
    ].slice(0, 20),
    popularity: node.favourites ?? null,
    ...(edge.role
      ? {
          role: edge.role === 'MAIN' ? ('main' as const) : ('supporting' as const),
        }
      : {}),
    ...(url
      ? {
          artwork: {
            url,
            sourceUrl: `https://anilist.co/character/${node.id}`,
            permission: artworkPermission,
          },
        }
      : {}),
  };
}
