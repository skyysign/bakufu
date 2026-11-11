import { z } from 'zod';
import { collectorRanksSchema, disabledCollectorRanks } from './ranks';
export * from './ranks';
import { gemRewardsSchema, defaultGemRewards, disabledGemRewards } from './gem-rewards';
export * from './gem-rewards';

import { rankTracksSchema, defaultRankTracks, disabledRankTracks } from './rank-tracks';
export * from './rank-tracks';
import {
  characterValuesSchema,
  defaultCharacterValues,
  disabledCharacterValues,
} from './character-values';
export * from './character-values';
import { fameFloorsSchema, defaultFameFloors, disabledFameFloors } from './fame-floors';
export * from './fame-floors';
export * from './profile';

export const legacyTiers = ['common', 'uncommon', 'rare'] as const;
export const tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Tier = (typeof tiers)[number];
// Optional initial pack selection. Gameplay rules remain in the realm config.
export const starterPackPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  categories: z
    .array(
      z.strictObject({
        category: z.string().trim().min(1).max(60),
        name: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine(
            (name) =>
              Array.from(name).every(
                (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
              ),
            'Use a single-line pack name.',
          ),
      }),
    )
    .max(30),
});
export type StarterPackPlan = z.infer<typeof starterPackPlanSchema>;
const realmConfigV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  ownership: z.literal('unique'),
  packPrice: z.number().int().min(0).max(1_000_000),
  packSize: z.number().int().min(1).max(5),
  startingGems: z.number().int().min(0).max(1_000_000),
  cooldownSeconds: z.number().int().min(0).max(604800),
  minimumPoolSize: z.number().int().min(1).max(10000),
  maximumCategoryPacks: z.number().int().min(0).max(30),
  tierWeights: z
    .strictObject({
      common: z.number().int().min(0).max(10000),
      uncommon: z.number().int().min(0).max(10000),
      rare: z.number().int().min(0).max(10000),
    })
    .refine(
      (w) => Object.values(w).some((n) => n > 0),
      'At least one tier must have positive weight',
    ),
  emptyTierPolicy: z.literal('renormalize'),
  partialPackPolicy: z.literal('reject'),
});
const legacyRecycleRewardsSchema = z.strictObject({
  common: z.number().int().min(0).max(1_000_000),
  uncommon: z.number().int().min(0).max(1_000_000),
  rare: z.number().int().min(0).max(1_000_000),
});
export const legacyRecycleRewards = {
  common: 2,
  uncommon: 4,
  rare: 6,
} as const;
export const recycleRewardsSchema = legacyRecycleRewardsSchema.extend({
  epic: z.number().int().min(0).max(1_000_000),
  legendary: z.number().int().min(0).max(1_000_000),
});
// Base gem value per tier (recycling credit and suggested market price before
// popularity/demand bonuses). With the default 75% popularity bonus the ramp
// runs from 30 gems for the least popular common to about 1,085 for the most
// popular legendary, a value spread similar to Mudae kakera values.
export const defaultRecycleRewards = {
  common: 30,
  uncommon: 60,
  rare: 120,
  epic: 260,
  legendary: 620,
};
const realmConfigV2Schema = realmConfigV1Schema.extend({
  schemaVersion: z.literal(2),
  recycleRewards: legacyRecycleRewardsSchema,
});
export const progressionSchema = z.strictObject({
  xpPerNewCharacter: z.number().int().min(0).max(1_000_000),
  levelThresholds: z
    .array(z.number().int().min(0).max(2_147_483_647))
    .min(1)
    .max(100)
    .refine((values) => values[0] === 0, 'The first level threshold must be 0.')
    .refine(
      (values) => values.every((value, index) => index === 0 || value > values[index - 1]),
      'Level thresholds must be strictly increasing.',
    ),
});
export const defaultProgression = {
  xpPerNewCharacter: 10,
  levelThresholds: [0, 20, 40, 70, 100],
};
const realmConfigV3Schema = realmConfigV2Schema.extend({
  schemaVersion: z.literal(3),
  progression: progressionSchema,
});
export const upgradesSchema = z.strictObject({
  packDiscount: z
    .array(
      z.strictObject({
        cost: z.number().int().min(0).max(1_000_000),
        requiredLevel: z.number().int().min(1).max(100),
        discount: z.number().int().min(1).max(1_000_000),
      }),
    )
    .max(5)
    .refine(
      (ranks) =>
        ranks.every(
          (rank, index) =>
            index === 0 ||
            (rank.discount > ranks[index - 1].discount &&
              rank.requiredLevel >= ranks[index - 1].requiredLevel),
        ),
      'Rank discounts must increase and level requirements must not decrease.',
    ),
});
export const defaultUpgrades = {
  packDiscount: [
    { cost: 10, requiredLevel: 2, discount: 1 },
    { cost: 20, requiredLevel: 3, discount: 2 },
  ],
};
const realmConfigV4Schema = realmConfigV3Schema.extend({
  schemaVersion: z.literal(4),
  upgrades: upgradesSchema,
});
export const wishlistSchema = z.strictObject({
  slots: z.number().int().min(0).max(20),
  weightMultiplier: z.number().int().min(1).max(10),
});
export const defaultWishlist = { slots: 3, weightMultiplier: 2 };
const realmConfigV5Schema = realmConfigV4Schema.extend({
  schemaVersion: z.literal(5),
  wishlist: wishlistSchema,
});
export const tradingSchema = z.strictObject({
  enabled: z.boolean(),
  maxCardsPerSide: z.number().int().min(1).max(10),
  maxGemsPerSide: z.number().int().min(0).max(1_000_000),
  maxPendingPerPlayer: z.number().int().min(1).max(50),
  expiresAfterMinutes: z.number().int().min(5).max(10080),
});
export const defaultTrading = {
  enabled: true,
  maxCardsPerSide: 5,
  maxGemsPerSide: 1_000_000,
  maxPendingPerPlayer: 10,
  expiresAfterMinutes: 1440,
};
const realmConfigV6Schema = realmConfigV5Schema.extend({
  schemaVersion: z.literal(6),
  trading: tradingSchema,
});
const realmConfigV7Schema = realmConfigV6Schema.extend({
  schemaVersion: z.literal(7),
  ranks: collectorRanksSchema,
});
const realmConfigV8Schema = realmConfigV7Schema.extend({
  schemaVersion: z.literal(8),
  gemRewards: gemRewardsSchema,
});
const tierWeightsSchema = z
  .strictObject(
    Object.fromEntries(tiers.map((tier) => [tier, z.number().int().min(0).max(10000)])) as Record<
      Tier,
      z.ZodNumber
    >,
  )
  .refine(
    (weights) => Object.values(weights).some((value) => value > 0),
    'At least one tier must have positive weight',
  );
const realmConfigV9Schema = realmConfigV8Schema.extend({
  schemaVersion: z.literal(9),
  tierWeights: tierWeightsSchema,
  recycleRewards: recycleRewardsSchema,
});
const realmConfigV10Schema = realmConfigV9Schema.extend({
  schemaVersion: z.literal(10),
  rankTracks: rankTracksSchema,
  legacyPurchasesRetired: z.boolean().default(false),
});
const realmConfigV11Schema = realmConfigV10Schema.extend({
  schemaVersion: z.literal(11),
  characterValues: characterValuesSchema,
});
const realmConfigV12Schema = realmConfigV11Schema.extend({
  schemaVersion: z.literal(12),
  fameFloors: fameFloorsSchema,
});
export const realmConfigSchema = realmConfigV12Schema.extend({
  schemaVersion: z.literal(13),
  // Epic and legendary cards need a second confirmation to recycle and are
  // never part of a bulk recycling.
  recycleSafeguard: z.boolean(),
});
export type RealmConfig = z.infer<typeof realmConfigSchema>;
/** Rarities the recycling safeguard protects when it is on. */
export const safeguardedTiers: readonly Tier[] = ['epic', 'legendary'];
export function recycleNeedsConfirmation(
  config: Pick<RealmConfig, 'recycleSafeguard'>,
  tier: Tier,
): boolean {
  return config.recycleSafeguard && safeguardedTiers.includes(tier);
}
export const defaultConfig: RealmConfig = realmConfigSchema.parse({
  schemaVersion: 13,
  recycleSafeguard: true,
  legacyPurchasesRetired: true,
  ownership: 'unique',
  packPrice: 200,
  packSize: 1,
  startingGems: 2000,
  cooldownSeconds: 0,
  minimumPoolSize: 2,
  // Nine category packs plus All Characters: ten packs in a new realm.
  maximumCategoryPacks: 9,
  // 65% / 26% / 7% / 1.7% / 0.3%: close to each tier's share of a standing-v3 roster
  // (60 / 28 / 9 / 2.5 / 0.5%), slightly favouring commons so top cards last longer.
  tierWeights: {
    common: 6500,
    uncommon: 2600,
    rare: 700,
    epic: 170,
    legendary: 30,
  },
  emptyTierPolicy: 'renormalize',
  partialPackPolicy: 'reject',
  recycleRewards: defaultRecycleRewards,
  progression: defaultProgression,
  upgrades: { packDiscount: [] },
  wishlist: defaultWishlist,
  trading: defaultTrading,
  ranks: disabledCollectorRanks,
  rankTracks: defaultRankTracks,
  gemRewards: { ...defaultGemRewards, amount: 1000 },
  characterValues: defaultCharacterValues,
  fameFloors: defaultFameFloors,
});

// Explicit migration, including strict v1 validation; unknown versions fail closed.
function parseLegacyRealmConfig(input: unknown) {
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 1
  ) {
    const legacy = realmConfigV1Schema.parse(input);
    return realmConfigV8Schema.parse({
      ...legacy,
      schemaVersion: 8,
      gemRewards: disabledGemRewards,
      ranks: disabledCollectorRanks,
      recycleRewards: legacyRecycleRewards,
      progression: defaultProgression,
      upgrades: defaultUpgrades,
      wishlist: defaultWishlist,
      trading: defaultTrading,
    });
  }
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 2
  ) {
    return realmConfigV8Schema.parse({
      ...realmConfigV2Schema.parse(input),
      schemaVersion: 8,
      gemRewards: disabledGemRewards,
      ranks: disabledCollectorRanks,
      progression: defaultProgression,
      upgrades: defaultUpgrades,
      wishlist: defaultWishlist,
      trading: defaultTrading,
    });
  }
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 3
  )
    return realmConfigV8Schema.parse({
      ...realmConfigV3Schema.parse(input),
      schemaVersion: 8,
      gemRewards: disabledGemRewards,
      ranks: disabledCollectorRanks,
      upgrades: defaultUpgrades,
      wishlist: defaultWishlist,
      trading: defaultTrading,
    });
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 4
  )
    return realmConfigV8Schema.parse({
      ...realmConfigV4Schema.parse(input),
      schemaVersion: 8,
      gemRewards: disabledGemRewards,
      ranks: disabledCollectorRanks,
      wishlist: defaultWishlist,
      trading: defaultTrading,
    });
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 5
  )
    return realmConfigV8Schema.parse({
      ...realmConfigV5Schema.parse(input),
      schemaVersion: 8,
      gemRewards: disabledGemRewards,
      ranks: disabledCollectorRanks,
      trading: defaultTrading,
    });
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 6
  )
    return realmConfigV8Schema.parse({
      ...realmConfigV6Schema.parse(input),
      schemaVersion: 8,
      gemRewards: disabledGemRewards,
      ranks: disabledCollectorRanks,
    });
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 7
  )
    return realmConfigV8Schema.parse({
      ...realmConfigV7Schema.parse(input),
      schemaVersion: 8,
      gemRewards: disabledGemRewards,
    });
  return realmConfigV8Schema.parse(input);
}

// Canonical old shape is retained solely to recognize immutable creation
// fingerprints from older releases. Gameplay always uses the current parser.
export function legacyRealmConfigSnapshot(input: unknown) {
  return parseLegacyRealmConfig(input);
}

export function parseRealmConfig(input: unknown): RealmConfig {
  const version =
    typeof input === 'object' && input !== null && 'schemaVersion' in input
      ? input.schemaVersion
      : undefined;
  if (version === 13) return realmConfigSchema.parse(input);
  // The recycling safeguard starts on for every realm (migration 0031).
  return realmConfigSchema.parse({
    ...parseV12RealmConfig(input),
    schemaVersion: 13,
    recycleSafeguard: true,
  });
}
function parseV12RealmConfig(input: unknown) {
  const version =
    typeof input === 'object' && input !== null && 'schemaVersion' in input
      ? input.schemaVersion
      : undefined;
  if (version === 12) return realmConfigV12Schema.parse(input);
  // Older realms keep the tiers they were created with: fame floors start off.
  if (version === 11)
    return realmConfigV12Schema.parse({
      ...realmConfigV11Schema.parse(input),
      schemaVersion: 12,
      fameFloors: disabledFameFloors,
    });
  if (version === 10)
    return realmConfigV12Schema.parse({
      ...realmConfigV10Schema.parse(input),
      schemaVersion: 12,
      characterValues: disabledCharacterValues,
      fameFloors: disabledFameFloors,
    });
  if (version === 9)
    return realmConfigV12Schema.parse({
      ...realmConfigV9Schema.parse(input),
      schemaVersion: 12,
      rankTracks: disabledRankTracks,
      characterValues: disabledCharacterValues,
      fameFloors: disabledFameFloors,
    });
  const legacy = parseLegacyRealmConfig(input);
  return realmConfigV12Schema.parse({
    ...legacy,
    schemaVersion: 12,
    tierWeights: { ...legacy.tierWeights, epic: 0, legendary: 0 },
    recycleRewards: { ...legacy.recycleRewards, epic: 0, legendary: 0 },
    rankTracks: disabledRankTracks,
    characterValues: disabledCharacterValues,
    fameFloors: disabledFameFloors,
  });
}

/** A v13 config in its v12 shape, for recognizing receipts written before the safeguard. */
export function withoutRecycleSafeguard(config: RealmConfig) {
  const { recycleSafeguard: _safeguard, ...rest } = config;
  void _safeguard;
  return { ...rest, schemaVersion: 12 as const };
}
/** A config in its v11 shape, for recognizing receipts written before fame floors. */
export function withoutFameFloors(config: RealmConfig) {
  const { fameFloors: _floors, ...rest } = withoutRecycleSafeguard(config);
  void _floors;
  return { ...rest, schemaVersion: 11 as const };
}
