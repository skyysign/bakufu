import { z } from 'zod';

export const rankTrackBenefitsSchema = z.strictObject({
  packDiscount: z.number().int().min(0).max(1_000_000),
  recycleBonus: z.number().int().min(0).max(1_000_000),
  wishlistSlots: z.number().int().min(0).max(20),
  cooldownReductionSeconds: z.number().int().min(0).max(604800),
});
export const rankTrackRuleSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine(
      (name) =>
        Array.from(name).every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      'Use a single-line track name.',
    ),
  levels: z
    .array(
      z.strictObject({
        cost: z.number().int().min(1).max(1_000_000),
        benefits: rankTrackBenefitsSchema,
      }),
    )
    .min(1)
    .max(10),
  requires: z
    .array(
      z.strictObject({
        trackId: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
        level: z.number().int().min(1).max(10),
      }),
    )
    .max(12),
});
export const rankTracksSchema = z
  .strictObject({ enabled: z.boolean(), tracks: z.array(rankTrackRuleSchema).max(12) })
  .superRefine((value, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (value.enabled && !value.tracks.length)
      issue('Add rank tracks before enabling progression.');
    const ids = new Map(value.tracks.map((track) => [track.id, track]));
    if (ids.size !== value.tracks.length) issue('Track IDs must be unique.');
    if (new Set(value.tracks.map((track) => track.name.toLowerCase())).size !== value.tracks.length)
      issue('Track names must be unique.');
    for (const track of value.tracks) {
      track.levels.forEach((level, index) => {
        const previous = track.levels[index - 1];
        if (previous && level.cost <= previous.cost) issue('Each subsequent level must cost more.');
        if (
          previous &&
          (Object.keys(level.benefits) as (keyof typeof level.benefits)[]).some(
            (key) => level.benefits[key] < previous.benefits[key],
          )
        )
          issue('Track benefits must not decrease.');
      });
      if (new Set(track.requires.map((rule) => rule.trackId)).size !== track.requires.length)
        issue('Do not repeat a prerequisite track.');
      for (const rule of track.requires) {
        const required = ids.get(rule.trackId);
        if (!required || required.id === track.id || required.levels.length < rule.level)
          issue('Use a valid prerequisite track and level.');
      }
    }
    function cyclic(id: string, visiting: Set<string>): boolean {
      if (visiting.has(id)) return true;
      const next = new Set(visiting).add(id);
      return (ids.get(id)?.requires ?? []).some((rule) => cyclic(rule.trackId, next));
    }
    if (value.tracks.some((track) => cyclic(track.id, new Set())))
      issue('Rank prerequisites must not contain a cycle.');
  });
export type RankTrackBenefits = z.infer<typeof rankTrackBenefitsSchema>;
export type RankTrackRule = z.infer<typeof rankTrackRuleSchema>;
export type RankTracksConfig = z.infer<typeof rankTracksSchema>;
export const disabledRankTracks: RankTracksConfig = { enabled: false, tracks: [] };

/** The realm rules the recommended ranks are measured against. */
export type RankTrackBasis = {
  packPrice: number;
  cooldownSeconds: number;
  recycleRewards: Record<string, number>;
};
// The six recommended ranks, as shares of the realm's own rules: costs in
// packs, pack discounts as a share of the price, recycling bonuses as a share
// of a common card's base value and cooldown cuts as a share of the cooldown.
// At a 200-gem pack and 30-gem commons this gives the original numbers.
const rankDesign: {
  id: string;
  name: string;
  requires: { trackId: string; level: number }[];
  costInPacks: number[];
  discount?: number[];
  recycle?: number[];
  wishlist?: number[];
  cooldown?: number[];
}[] = [
  {
    id: 'bronze',
    name: 'Bronze',
    requires: [],
    costInPacks: [2.5, 7.5, 15, 30],
    discount: [0.05, 0.1, 0.15, 0.2],
  },
  {
    id: 'silver',
    name: 'Silver',
    requires: [],
    costInPacks: [5, 12.5, 25, 50],
    recycle: [1 / 15, 2 / 15, 3 / 15, 4 / 15],
  },
  {
    id: 'gold',
    name: 'Gold',
    requires: [],
    costInPacks: [7.5, 17.5, 37.5, 75],
    wishlist: [1, 2, 3, 4],
  },
  {
    id: 'sapphire',
    name: 'Sapphire',
    requires: [
      { trackId: 'bronze', level: 2 },
      { trackId: 'silver', level: 2 },
      { trackId: 'gold', level: 2 },
    ],
    costInPacks: [25, 50, 100, 200],
    discount: [0.05, 0.1, 0.175, 0.25],
    cooldown: [0.05, 0.1, 0.15, 0.2],
  },
  {
    id: 'ruby',
    name: 'Ruby',
    requires: [
      { trackId: 'bronze', level: 4 },
      { trackId: 'silver', level: 3 },
      { trackId: 'gold', level: 2 },
    ],
    costInPacks: [37.5, 75, 150, 300],
    recycle: [2 / 15, 4 / 15, 6 / 15, 10 / 15],
  },
  {
    id: 'emerald',
    name: 'Emerald',
    requires: [
      { trackId: 'bronze', level: 4 },
      { trackId: 'silver', level: 4 },
      { trackId: 'gold', level: 4 },
      { trackId: 'sapphire', level: 2 },
      { trackId: 'ruby', level: 2 },
    ],
    costInPacks: [50, 125, 250, 500],
    discount: [0.05, 0.1, 0.15, 0.2],
    wishlist: [1, 2, 4, 6],
    cooldown: [0.05, 0.1, 0.2, 0.3],
  },
];
/** Rounds a gem cost to a figure that reads well (2,450 rather than 2,437). */
function roundCost(value: number) {
  const step = value < 100 ? 1 : value < 1000 ? 10 : value < 10_000 ? 50 : 500;
  return Math.max(1, Math.round(value / step) * step);
}
/**
 * Rounds a cooldown cut: whole minutes from 10 minutes, 5 seconds from a
 * minute. Cuts under half a second (cooldowns of a few seconds) round to none.
 */
function roundSeconds(value: number) {
  if (value <= 0) return 0;
  const step = value >= 600 ? 60 : value >= 60 ? 5 : 1;
  return Math.round(value / step) * step;
}
const share = (base: number, fraction: number) =>
  base > 0 ? Math.max(1, Math.round(base * fraction)) : 0;

/**
 * The recommended six ranks for a realm's rules. Costs follow the pack price
 * and every perk is a share of the rule it improves, so a realm with a 6-hour
 * cooldown gets cuts of minutes, not seconds, and a realm without a cooldown
 * gets none.
 */
export function recommendedRankTracks(basis: RankTrackBasis): RankTracksConfig {
  const price = Math.max(0, Math.floor(basis.packPrice) || 0);
  // Costs are counted in packs; free packs fall back to a 200-gem reference.
  const costUnit = price > 0 ? Math.min(price, 2_000) : 200;
  const cooldown = Math.min(604_800, Math.max(0, Math.floor(basis.cooldownSeconds) || 0));
  const values = Object.values(basis.recycleRewards).filter((value) => value > 0);
  const commonValue =
    (basis.recycleRewards.common ?? 0) > 0
      ? basis.recycleRewards.common
      : values.length
        ? Math.min(...values)
        : 0;
  return {
    enabled: true,
    tracks: rankDesign.map((track) => {
      let previousCost = 0;
      return {
        id: track.id,
        name: track.name,
        requires: track.requires.map((rule) => ({ ...rule })),
        levels: track.costInPacks.map((packs, index) => {
          const cost = Math.min(1_000_000, Math.max(previousCost + 1, roundCost(packs * costUnit)));
          previousCost = cost;
          return {
            cost,
            benefits: {
              packDiscount: track.discount ? share(price, track.discount[index]) : 0,
              recycleBonus: track.recycle ? share(commonValue, track.recycle[index]) : 0,
              wishlistSlots: track.wishlist?.[index] ?? 0,
              cooldownReductionSeconds: track.cooldown
                ? roundSeconds(cooldown * track.cooldown[index])
                : 0,
            },
          };
        }),
      };
    }),
  };
}

/**
 * The recommended ranks for these rules, keeping what players already own:
 * a level someone bought keeps its cost and perks (and its track its name and
 * requirements), and later levels never cost less or give less than it.
 * Tracks outside the recommendation stay while someone owns them or another
 * kept track requires them.
 */
export function fitRankTracks(
  saved: RankTracksConfig,
  basis: RankTrackBasis,
  ownedLevels: Record<string, number>,
): RankTracksConfig {
  const recommended = recommendedRankTracks(basis);
  const savedById = new Map(saved.tracks.map((track) => [track.id, track]));
  const tracks: RankTrackRule[] = recommended.tracks.map((track) => {
    const current = savedById.get(track.id);
    const owned = Math.min(ownedLevels[track.id] ?? 0, current?.levels.length ?? 0);
    if (!current || owned === 0) return track;
    const levels = current.levels.slice(0, owned).map((level) => ({
      cost: level.cost,
      benefits: { ...level.benefits },
    }));
    for (const level of track.levels.slice(owned)) {
      const previous = levels[levels.length - 1];
      levels.push({
        cost: Math.min(1_000_000, Math.max(level.cost, previous.cost + 1)),
        benefits: Object.fromEntries(
          (Object.keys(level.benefits) as (keyof RankTrackBenefits)[]).map((key) => [
            key,
            Math.max(level.benefits[key], previous.benefits[key]),
          ]),
        ) as RankTrackBenefits,
      });
    }
    // A level costing the maximum can't be followed by a dearer one.
    while (
      levels.length > owned &&
      levels[levels.length - 1].cost <= levels[levels.length - 2]?.cost
    )
      levels.pop();
    return {
      id: track.id,
      name: current.name,
      requires: current.requires.map((rule) => ({ ...rule })),
      levels,
    };
  });
  const kept = new Set(tracks.map((track) => track.id));
  let added = true;
  while (added) {
    added = false;
    for (const track of saved.tracks) {
      if (kept.has(track.id)) continue;
      const needed =
        (ownedLevels[track.id] ?? 0) > 0 ||
        tracks.some((other) => other.requires.some((rule) => rule.trackId === track.id));
      if (needed) {
        tracks.push(structuredClone(track));
        kept.add(track.id);
        added = true;
      }
    }
  }
  return { enabled: true, tracks };
}

export const defaultRankTracks: RankTracksConfig = recommendedRankTracks({
  packPrice: 200,
  cooldownSeconds: 0,
  recycleRewards: { common: 30 },
});
