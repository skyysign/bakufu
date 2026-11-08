import { z } from 'zod';
import type { Character } from '../../core/src/index';
import { providerArtworkSchema } from './artwork';

export const catalogEntrySchema = z.strictObject({
  id: z.uuid(),
  sourceKey: z
    .string()
    .max(160)
    .regex(/^[a-z0-9-]+:[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(100),
  series: z.string().trim().min(1).max(100),
  categories: z.array(z.string().trim().min(1).max(60)).max(20),
  popularity: z.number().int().min(0).nullable(),
  /** Provider cast role in the character's series (main cast or supporting). */
  role: z.enum(['main', 'supporting']).optional(),
  artwork: providerArtworkSchema.optional(),
});
/** Largest catalog the validator accepts (provider rosters). Hand-made
 * uploads keep their own, lower limit in the realm creation service. */
export const catalogMaxEntries = 100_000;
export const catalogMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z
    .string()
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  revision: z.string().min(1).max(100),
  license: z.string().min(1).max(200),
});
export const catalogSchema = z
  .strictObject({
    ...catalogMetadataSchema.shape,
    characters: z.array(catalogEntrySchema).min(1).max(catalogMaxEntries),
  })
  .superRefine((catalog, ctx) => {
    for (const field of ['id', 'sourceKey'] as const) {
      if (new Set(catalog.characters.map((c) => c[field])).size !== catalog.characters.length)
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate ${field}`,
          path: ['characters'],
        });
    }
    if (catalog.characters.some((c) => !c.sourceKey.startsWith(`${catalog.source}:`)))
      ctx.addIssue({
        code: 'custom',
        message: 'Every key must belong to the declared source',
      });
  });

/** Rarity for a popularity percentile (0 = most popular) within one catalog cohort. */
export function tierForPercentile(percentile: number, fiveTiers: boolean): Character['tier'] {
  return fiveTiers && percentile < 0.002
    ? 'legendary'
    : fiveTiers && percentile < 0.02
      ? 'epic'
      : percentile < (fiveTiers ? 0.08 : 0.1)
        ? 'rare'
        : percentile < (fiveTiers ? 0.3 : 0.35)
          ? 'uncommon'
          : 'common';
}
/**
 * Five-tier bands for the standing formula (share of ranked characters):
 * legendary 0.5%, epic 2.5%, rare 9%, uncommon 28%, common the remaining 60%.
 */
export function tierForStanding(percentile: number): Character['tier'] {
  return percentile < 0.005
    ? 'legendary'
    : percentile < 0.03
      ? 'epic'
      : percentile < 0.12
        ? 'rare'
        : percentile < 0.4
          ? 'uncommon'
          : 'common';
}
/** Weights of the standing score: overall popularity and place within its own series. */
export const standingWeights = { global: 0.6, series: 0.4, main: 0.1 } as const;
export type Standing = { score: number; floor: boolean };
/**
 * A character's standing blends its overall popularity rank (0–1) with its
 * rank inside its own series (0–1), plus a bonus for the main cast. A niche
 * series' leads can then outrank the tenth supporting character of a hit, and
 * main characters and each series' favourite are never common.
 */
export function characterStandings(
  characters: readonly {
    id: string;
    series: string;
    popularity: number | null;
    role?: string;
  }[],
): Map<string, Standing> {
  const ranked = characters
    .filter((c) => c.popularity !== null)
    .sort((a, b) => b.popularity! - a.popularity! || a.id.localeCompare(b.id));
  const bySeries = new Map<string, string[]>();
  for (const c of ranked) {
    const ids = bySeries.get(c.series);
    if (ids) ids.push(c.id);
    else bySeries.set(c.series, [c.id]);
  }
  const seriesRank = new Map<string, { index: number; size: number }>();
  for (const ids of bySeries.values())
    ids.forEach((id, index) => seriesRank.set(id, { index, size: ids.length }));
  const result = new Map<string, Standing>();
  ranked.forEach((c, index) => {
    const global = 1 - index / ranked.length,
      place = seriesRank.get(c.id)!,
      series = 1 - place.index / place.size,
      main = c.role === 'main';
    result.set(c.id, {
      score:
        standingWeights.global * global +
        standingWeights.series * series +
        (main ? standingWeights.main : 0),
      floor: main || (place.index === 0 && place.size > 1),
    });
  });
  return result;
}
/** Tier for a standing among the realm's standing scores (sorted highest first). */
export function tierAmongStandings(
  standing: Standing,
  sortedScores: readonly number[],
): Character['tier'] {
  let low = 0,
    high = sortedScores.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sortedScores[middle] > standing.score) low = middle + 1;
    else high = middle;
  }
  const tier = tierForStanding(low / Math.max(1, sortedScores.length));
  return standing.floor && tier === 'common' ? 'uncommon' : tier;
}
export function parseCatalog(input: unknown, fiveTiers = false) {
  const catalog = catalogSchema.parse(input);
  const ranked = catalog.characters
    .filter((c) => c.popularity !== null)
    .sort((a, b) => b.popularity! - a.popularity! || a.id.localeCompare(b.id));
  const ranks = new Map(ranked.map((c, index) => [c.id, index]));
  // Five-tier realms rank by standing (popularity within the whole roster and
  // within each series, plus main cast); three-tier realms keep popularity only.
  const standings = fiveTiers ? characterStandings(catalog.characters) : null;
  const sortedScores = standings
    ? [...standings.values()].map((standing) => standing.score).sort((a, b) => b - a)
    : [];
  const characters: Character[] = catalog.characters.map((c) => {
    const percentile = (ranks.get(c.id) ?? -1) / ranked.length;
    const standing = standings?.get(c.id);
    const tier =
      c.popularity === null
        ? 'common'
        : standing
          ? tierAmongStandings(standing, sortedScores)
          : tierForPercentile(percentile, fiveTiers);
    return {
      id: c.id,
      sourceKey: c.sourceKey,
      name: c.name,
      series: c.series,
      categories: [...new Set(c.categories)].sort(),
      tier,
      ...(c.artwork ? { artwork: c.artwork } : {}),
    };
  });
  return {
    catalog,
    characters,
    /** Standing scores (five tiers), saved so later additions rank consistently. */
    standings,
    calculationVersion: fiveTiers
      ? ('source-standing-v3' as const)
      : ('source-percentile-v1' as const),
  };
}
