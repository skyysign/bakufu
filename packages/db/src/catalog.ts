import { createHash } from 'node:crypto';
import { z } from 'zod';
import demo from '../../importers/fixtures/demo.v1.json';
import {
  catalogMetadataSchema,
  CatalogImportError,
  originalCatalogMaxBytes,
  originalCatalogMaxEntries,
  parseCatalog,
  parseCsvCatalog,
} from '../../importers/src/index';
import {
  defaultConfig,
  parseRealmConfig,
  legacyRealmConfigSnapshot,
  tiers,
  starterPackPlanSchema,
} from '../../config/src/index';
import {
  availableOdds,
  drawableCount,
  buildStarterPacks,
  starterPackCategories,
  GameError,
} from '../../core/src/index';
import { transaction, type Database } from './connection';
import { requireInstanceAdmin } from './auth';

export const catalogRequestBytes = originalCatalogMaxBytes;
/** Provider rosters (MyAnimeList/AniList metadata with artwork references) can
 * be far larger than hand-made uploads: up to 100,000 characters per realm.
 * This is a request-size and memory safeguard, not a roster policy; the admin
 * picks the roster size. A typical roster entry is about 0.4–0.6 KB. */
export const providerCatalogMaxEntries = 100_000;
export const providerCatalogRequestBytes = 100 * 1024 * 1024;
/** Characters echoed back by a preview; the full roster stays in the request. */
export const catalogPreviewSampleSize = 300;
const providerSources = new Set(['mal', 'anilist']);
const customSchema = z.union([
  z.strictObject({
    format: z.literal('json').optional(),
    data: z.unknown(),
    rightsConfirmed: z.literal(true),
  }),
  z.strictObject({
    format: z.literal('csv'),
    data: z.string(),
    metadata: catalogMetadataSchema,
    rightsConfirmed: z.literal(true),
  }),
]);

// A read-only preparation shared by preview and transactional installation.
export function prepareRealmCatalog(
  input: unknown = defaultConfig,
  custom?: unknown,
  packPlan?: unknown,
) {
  const config = parseRealmConfig(input),
    choice = custom === undefined ? null : customSchema.parse(custom);
  let parsed: ReturnType<typeof parseCatalog>;
  try {
    parsed =
      choice?.format === 'csv'
        ? parseCsvCatalog(choice.data, choice.metadata)
        : parseCatalog(choice ? choice.data : demo);
  } catch (error) {
    if (error instanceof CatalogImportError) throw new GameError('CATALOG_INVALID', error.message);
    throw error;
  }
  if (config.tierWeights.epic > 0 || config.tierWeights.legendary > 0)
    parsed = parseCatalog(parsed.catalog, true);
  const kind = !choice
    ? ('demo' as const)
    : choice.format === 'csv'
      ? ('original-csv' as const)
      : ('original-json' as const);
  const providerRoster =
    !!choice && choice.format !== 'csv' && providerSources.has(parsed.catalog.source);
  if (
    choice &&
    (parsed.characters.length >
      (providerRoster ? providerCatalogMaxEntries : originalCatalogMaxEntries) ||
      Buffer.byteLength(JSON.stringify(choice)) >
        (providerRoster ? providerCatalogRequestBytes : catalogRequestBytes))
  )
    throw new GameError(
      'CATALOG_TOO_LARGE',
      providerRoster
        ? 'Use at most 100,000 provider characters and a catalog request smaller than 100 MiB.'
        : 'Use at most 1,000 characters and a catalog request smaller than 2 MiB.',
    );
  const plan = packPlan === undefined ? undefined : starterPackPlanSchema.parse(packPlan);
  const packs = buildStarterPacks(parsed.characters, config, plan),
    packPreviews = packs.map((pack) => {
      const pool = parsed.characters.filter(
        (c) => pack.category === null || c.categories.includes(pack.category),
      );
      const available = drawableCount(pool, config);
      return {
        ...pack,
        poolSize: pool.length,
        drawable: available,
        openable: available >= config.packSize,
        odds: availableOdds(pool, config),
      };
    });
  if (!packPreviews.some((pack) => pack.openable))
    throw new GameError(
      'CATALOG_TOO_SMALL',
      'This catalog cannot supply a playable starter pack with these settings. Add characters or lower the pool minimum/cards per pack.',
    );
  const fingerprintFor = (rules: object) =>
    createHash('sha256')
      .update(
        JSON.stringify({
          config: rules,
          catalog: parsed.catalog,
          kind,
          ...(plan === undefined ? {} : { packPlan: plan }),
        }),
      )
      .digest('hex');
  const fingerprint = fingerprintFor(config);
  // Preserve immutable receipts from both pre-reward releases (config v6/v7).
  const legacyFingerprints: string[] = [];
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    (input.schemaVersion === 9 || input.schemaVersion === 10)
  ) {
    const { characterValues: _values, ...v10 } = config;
    void _values;
    if (input.schemaVersion === 10)
      legacyFingerprints.push(fingerprintFor({ ...v10, schemaVersion: 10 }));
    else {
      const { rankTracks: _tracks, legacyPurchasesRetired: _retired, ...v9 } = v10;
      void _tracks;
      void _retired;
      legacyFingerprints.push(fingerprintFor({ ...v9, schemaVersion: 9 }));
    }
  }
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    typeof input.schemaVersion === 'number' &&
    input.schemaVersion >= 1 &&
    input.schemaVersion <= 8
  ) {
    const legacy = legacyRealmConfigSnapshot(input);
    legacyFingerprints.push(fingerprintFor(legacy));
    const { gemRewards: _rewards, ...v7 } = legacy;
    void _rewards;
    if (input.schemaVersion <= 7)
      legacyFingerprints.push(fingerprintFor({ ...v7, schemaVersion: 7 }));
    if (input.schemaVersion <= 6) {
      const { ranks: _ranks, ...v6 } = v7;
      void _ranks;
      legacyFingerprints.push(fingerprintFor({ ...v6, schemaVersion: 6 }));
    }
  }
  return {
    config,
    parsed,
    packs,
    legacyFingerprints,
    preview: {
      fingerprint,
      kind,
      packMode: plan === undefined ? ('automatic' as const) : ('manual' as const),
      categoryOptions: starterPackCategories(parsed.characters),
      source: parsed.catalog.source,
      revision: parsed.catalog.revision,
      license: parsed.catalog.license,
      calculationVersion: parsed.calculationVersion,
      characterCount: parsed.characters.length,
      artworkCount: parsed.characters.filter((c) => 'artwork' in c && !!c.artwork).length,
      tiers: Object.fromEntries(
        tiers.map((tier) => [tier, parsed.characters.filter((c) => c.tier === tier).length]),
      ) as Record<(typeof tiers)[number], number>,
      packSize: config.packSize,
      packPrice: config.packPrice,
      packs: packPreviews,
      characters: parsed.characters,
    },
  };
}
export type CatalogPreview = ReturnType<typeof prepareRealmCatalog>['preview'];

export async function previewRealmCatalog(
  db: Database,
  actorId: string,
  config?: unknown,
  catalog?: unknown,
  packPlan?: unknown,
): Promise<CatalogPreview> {
  return transaction(db, async (tx) => {
    await requireInstanceAdmin(tx, actorId);
    const preview = prepareRealmCatalog(config, catalog, packPlan).preview;
    // Large rosters are not echoed back in full; the review shows a sample.
    return { ...preview, characters: preview.characters.slice(0, catalogPreviewSampleSize) };
  });
}
