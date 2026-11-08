import { z } from 'zod';

export const collectorRankRuleSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine(
      (value) =>
        Array.from(value).every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      'Use a single-line rank name.',
    ),
  cost: z.number().int().min(0).max(1_000_000),
  // Benefits are cumulative totals, never sums of the preceding rows.
  packDiscount: z.number().int().min(0).max(1_000_000),
  recycleBonus: z.number().int().min(0).max(1_000_000),
  wishlistSlots: z.number().int().min(0).max(20),
  cooldownReductionSeconds: z.number().int().min(0).max(604800),
});
export const collectorRanksSchema = z
  .strictObject({
    enabled: z.boolean(),
    levels: z.array(collectorRankRuleSchema).max(10),
  })
  .superRefine((ranks, context) => {
    if (ranks.enabled && ranks.levels.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['levels'],
        message: 'Add at least one rank before enabling ranks.',
      });
    const names = new Set<string>();
    ranks.levels.forEach((level, index) => {
      const name = level.name.toLowerCase();
      if (names.has(name))
        context.addIssue({
          code: 'custom',
          path: ['levels', index, 'name'],
          message: 'Rank names must be unique.',
        });
      names.add(name);
      const previous = ranks.levels[index - 1];
      if (
        previous &&
        (
          ['packDiscount', 'recycleBonus', 'wishlistSlots', 'cooldownReductionSeconds'] as const
        ).some((key) => level[key] < previous[key])
      )
        context.addIssue({
          code: 'custom',
          path: ['levels', index],
          message: 'Cumulative rank benefits must not decrease.',
        });
    });
  });
export type CollectorRankRule = z.infer<typeof collectorRankRuleSchema>;
export type CollectorRanksConfig = z.infer<typeof collectorRanksSchema>;
export const disabledCollectorRanks: CollectorRanksConfig = { enabled: false, levels: [] };
export const defaultCollectorRanks: CollectorRanksConfig = {
  enabled: true,
  levels: [
    {
      name: 'Bronze',
      cost: 25,
      packDiscount: 1,
      recycleBonus: 0,
      wishlistSlots: 0,
      cooldownReductionSeconds: 0,
    },
    {
      name: 'Silver',
      cost: 50,
      packDiscount: 1,
      recycleBonus: 1,
      wishlistSlots: 0,
      cooldownReductionSeconds: 0,
    },
    {
      name: 'Gold',
      cost: 100,
      packDiscount: 1,
      recycleBonus: 1,
      wishlistSlots: 1,
      cooldownReductionSeconds: 0,
    },
    {
      name: 'Platinum',
      cost: 200,
      packDiscount: 1,
      recycleBonus: 1,
      wishlistSlots: 2,
      cooldownReductionSeconds: 15,
    },
    {
      name: 'Diamond',
      cost: 400,
      packDiscount: 1,
      recycleBonus: 1,
      wishlistSlots: 3,
      cooldownReductionSeconds: 30,
    },
  ],
};
