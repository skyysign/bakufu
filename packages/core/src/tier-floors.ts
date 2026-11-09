import { tiers, type RealmConfig, type Tier } from '../../config/src/index';

/** Sources whose popularity is a favourites count on a shared, public scale. */
export const fameFloorSources: readonly string[] = ['mal', 'anilist'];
const floorTiers = ['rare', 'epic', 'legendary'] as const;

export const tierRank = (tier: Tier) => tiers.indexOf(tier);
export const higherTier = (a: Tier, b: Tier): Tier => (tierRank(a) >= tierRank(b) ? a : b);

/** Tiers a pack can draw in this realm (positive odds). */
export function drawableTiers(config: RealmConfig): Tier[] {
  return tiers.filter((tier) => config.tierWeights[tier] > 0);
}

/**
 * The minimum tier a character's fame earns it, or null. Only provider
 * characters (MyAnimeList/AniList favourites) qualify, and a floor never
 * lifts a character into a tier no pack can draw.
 */
export function fameFloorTier(
  popularity: number | null,
  sourceKey: string,
  config: RealmConfig,
): Tier | null {
  if (popularity === null || !fameFloorSources.includes(sourceKey.split(':')[0])) return null;
  let floor: Tier | null = null;
  for (const tier of floorTiers) {
    const threshold = config.fameFloors[tier];
    if (threshold !== null && popularity >= threshold) floor = tier;
  }
  if (!floor) return null;
  const drawable = drawableTiers(config);
  while (floor !== 'common' && !drawable.includes(floor)) floor = tiers[tierRank(floor) - 1];
  return floor;
}

/**
 * The tier a character should have: an admin override wins; otherwise its
 * computed tier (from the roster standing at import) raised to its fame floor.
 */
export function adjustedTier(
  computed: Tier,
  override: Tier | null,
  popularity: number | null,
  sourceKey: string,
  config: RealmConfig,
): Tier {
  if (override) return override;
  const floor = fameFloorTier(popularity, sourceKey, config);
  return floor ? higherTier(computed, floor) : computed;
}
