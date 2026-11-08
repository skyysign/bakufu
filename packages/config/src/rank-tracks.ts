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
const benefits = (
  packDiscount = 0,
  recycleBonus = 0,
  wishlistSlots = 0,
  cooldownReductionSeconds = 0,
): RankTrackBenefits => ({ packDiscount, recycleBonus, wishlistSlots, cooldownReductionSeconds });
export const defaultRankTracks: RankTracksConfig = {
  enabled: true,
  tracks: [
    {
      id: 'bronze',
      name: 'Bronze',
      requires: [],
      levels: [500, 1500, 3000, 6000].map((cost, index) => ({
        cost,
        benefits: benefits((index + 1) * 10),
      })),
    },
    {
      id: 'silver',
      name: 'Silver',
      requires: [],
      levels: [1000, 2500, 5000, 10000].map((cost, index) => ({
        cost,
        benefits: benefits(0, [2, 4, 6, 8][index]),
      })),
    },
    {
      id: 'gold',
      name: 'Gold',
      requires: [],
      levels: [1500, 3500, 7500, 15000].map((cost, index) => ({
        cost,
        benefits: benefits(0, 0, index + 1),
      })),
    },
    {
      id: 'sapphire',
      name: 'Sapphire',
      requires: [
        { trackId: 'bronze', level: 2 },
        { trackId: 'silver', level: 2 },
        { trackId: 'gold', level: 2 },
      ],
      levels: [5000, 10000, 20000, 40000].map((cost, index) => ({
        cost,
        benefits: benefits([10, 20, 35, 50][index], 0, 0, [15, 30, 60, 120][index]),
      })),
    },
    {
      id: 'ruby',
      name: 'Ruby',
      requires: [
        { trackId: 'bronze', level: 4 },
        { trackId: 'silver', level: 3 },
        { trackId: 'gold', level: 2 },
      ],
      levels: [7500, 15000, 30000, 60000].map((cost, index) => ({
        cost,
        benefits: benefits(0, [4, 8, 12, 20][index]),
      })),
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
      levels: [10000, 25000, 50000, 100000].map((cost, index) => ({
        cost,
        benefits: benefits((index + 1) * 10, 0, [1, 2, 4, 6][index], [60, 120, 240, 360][index]),
      })),
    },
  ],
};
