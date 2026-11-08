import { createHash } from 'node:crypto';
import { z } from 'zod';
import { catalogSchema } from './json';

const qidSchema = z
  .string()
  .trim()
  .regex(/^Q[1-9][0-9]{0,15}$/i, 'Use a Wikidata item ID such as Q123.')
  .transform((value) => value.toUpperCase());
const singleLine = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine(
      (value) =>
        Array.from(value).every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      'Use single-line text.',
    );
export const wikidataCatalogRequestSchema = z.strictObject({
  ids: z
    .array(qidSchema)
    .min(1)
    .max(25)
    .refine((ids) => new Set(ids).size === ids.length, 'Select each Wikidata item only once.'),
  series: singleLine(60),
  medium: z.enum(['anime', 'manga']),
  revision: singleLine(100),
});
export type WikidataCatalogRequest = z.infer<typeof wikidataCatalogRequestSchema>;
export class WikidataCatalogError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'WikidataCatalogError';
  }
}
export const wikidataCatalogMaximumBytes = 2 * 1024 * 1024;
export const wikidataCatalogTimeoutMs = 8000;

// Stable UUIDv5 namespace. Changing this constant would change installed IDs.
const characterNamespace = Buffer.from('f7f45b409f7d4a8992283bc700269276', 'hex');
export function wikidataCharacterId(id: string): string {
  const qid = qidSchema.parse(id).toLowerCase();
  const bytes = createHash('sha1')
    .update(characterNamespace)
    .update(`wikidata:character:${qid}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > wikidataCatalogMaximumBytes)
    throw new WikidataCatalogError(
      'SOURCE_TOO_LARGE',
      'The metadata response exceeds the 2 MiB limit.',
      502,
    );
  if (!response.body)
    throw new WikidataCatalogError(
      'SOURCE_INVALID',
      'Wikidata returned an empty metadata response.',
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
      if (size > wikidataCatalogMaximumBytes) {
        await reader.cancel();
        throw new WikidataCatalogError(
          'SOURCE_TOO_LARGE',
          'The metadata response exceeds the 2 MiB limit.',
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
    throw new WikidataCatalogError(
      'SOURCE_INVALID',
      'Wikidata returned an invalid metadata response.',
      502,
    );
  }
}

// Explicit, bounded selection only. Caller authorizes the operator and obtains
// opt-in before invoking this adapter. No search, pagination or image fetching.
// Series/medium are the operator's categorization, not an upstream assertion.
export async function fetchWikidataCatalog(
  input: WikidataCatalogRequest,
  fetcher: typeof fetch = fetch,
) {
  const request = wikidataCatalogRequestSchema.parse(input);
  const endpoint = new URL('https://www.wikidata.org/w/api.php');
  for (const [key, value] of Object.entries({
    action: 'wbgetentities',
    format: 'json',
    props: 'labels',
    languages: 'en',
    ids: request.ids.join('|'),
    maxlag: '5',
  }))
    endpoint.searchParams.set(key, value);
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), wikidataCatalogTimeoutMs);
  try {
    const response = await fetcher(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CardEngine/0.1 (self-hosted metadata-only collector engine)',
      },
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 429)
      throw new WikidataCatalogError(
        'SOURCE_RATE_LIMITED',
        'Wikidata is rate limiting requests. Wait before trying again.',
        429,
      );
    if (!response.ok || response.redirected)
      throw new WikidataCatalogError(
        'SOURCE_UNAVAILABLE',
        'Wikidata is unavailable. Try the same selected items later.',
        502,
      );
    const value = await boundedJson(response);
    const envelope = z
      .object({
        success: z.literal(1),
        entities: z.record(z.string(), z.unknown()),
      })
      .safeParse(value);
    if (!envelope.success)
      throw new WikidataCatalogError(
        'SOURCE_INVALID',
        'Wikidata could not return the selected metadata. Check the item IDs or try later.',
        502,
      );
    const characters = request.ids.map((id) => {
      const entity = z
        .object({
          id: z.literal(id),
          type: z.literal('item'),
          labels: z.object({
            en: z.object({ language: z.literal('en'), value: singleLine(100) }),
          }),
        })
        .safeParse(envelope.data.entities[id]);
      if (!entity.success)
        throw new WikidataCatalogError(
          'SOURCE_ITEM_UNAVAILABLE',
          'Each selected item must exist and have an English label. Review the selected Wikidata IDs.',
          400,
        );
      return {
        id: wikidataCharacterId(id),
        sourceKey: `wikidata:${id.toLowerCase()}`,
        name: entity.data.labels.en.value,
        series: request.series,
        categories: [request.medium === 'anime' ? 'Anime' : 'Manga', request.series],
        popularity: null,
      };
    });
    return catalogSchema.parse({
      schemaVersion: 1,
      source: 'wikidata',
      revision: request.revision,
      license: 'CC0 1.0; Wikidata structured metadata only; excludes artwork',
      characters,
    });
  } catch (error) {
    if (error instanceof WikidataCatalogError) throw error;
    if (controller.signal.aborted)
      throw new WikidataCatalogError(
        'SOURCE_TIMEOUT',
        'The Wikidata request timed out. Try the same selected items later.',
        504,
      );
    throw new WikidataCatalogError(
      'SOURCE_UNAVAILABLE',
      'The selected metadata could not be retrieved. Try again later.',
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}
