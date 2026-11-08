import { z } from 'zod';
import {
  characterValuesSchema,
  type CharacterValuesConfig,
  type Tier,
} from '../../config/src/index';

export const characterValueSchema = z.strictObject({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  baseValue: z.number().int().min(0).max(1_000_000),
  popularity: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  popularityPercentileBps: z.number().int().min(0).max(10000),
  wishlistDemand: z.number().int().min(0).max(2147483647),
  popularityBonus: z.number().int().min(0).max(2147483647),
  demandBonus: z.number().int().min(0).max(2147483647),
  marketValue: z.number().int().min(0).max(2147483647),
  recycleBonus: z.number().int().min(0).max(2147483647),
  recycleValue: z.number().int().min(0).max(2147483647),
});
export type CharacterValue = z.infer<typeof characterValueSchema>;

type ValueInput = {
  baseValue: number;
  popularity: number | null;
  popularityPercentileBps: number;
  wishlistDemand: number;
  recycleBonus: number;
};
export function quoteCharacterValue(
  input: ValueInput & { rules: CharacterValuesConfig },
): CharacterValue {
  return characterValueSchema.parse(
    computeCharacterValue(input, characterValuesSchema.parse(input.rules)),
  );
}
/**
 * Quotes a whole realm with one rules validation. Inputs come from validated
 * realm config and saved rows, so every result stays inside the value schema's
 * bounds (base values and bonuses are capped by the config schema).
 */
export function quoteCharacterValues(
  inputs: ValueInput[],
  rules: CharacterValuesConfig,
): CharacterValue[] {
  const parsed = characterValuesSchema.parse(rules);
  return inputs.map((input) => computeCharacterValue(input, parsed));
}
function computeCharacterValue(input: ValueInput, rules: CharacterValuesConfig): CharacterValue {
  const popularityBonus =
    rules.enabled && input.popularity !== null
      ? Math.floor(
          (input.baseValue * rules.popularityBoostBps * input.popularityPercentileBps) /
            100_000_000,
        )
      : 0;
  const demandBonus = rules.enabled
    ? Math.floor(
        (input.baseValue *
          Math.min(rules.maxWishlistBoostBps, input.wishlistDemand * rules.wishlistBoostBps)) /
          10000,
      )
    : 0;
  const marketValue = input.baseValue + popularityBonus + demandBonus;
  return {
    schemaVersion: 1,
    enabled: rules.enabled,
    baseValue: input.baseValue,
    popularity: input.popularity,
    popularityPercentileBps: input.popularityPercentileBps,
    wishlistDemand: input.wishlistDemand,
    popularityBonus,
    demandBonus,
    marketValue,
    recycleBonus: input.recycleBonus,
    recycleValue: marketValue + input.recycleBonus,
  };
}

// Compare only compatible source/tier cohorts. Equal scores stay equal; missing
// evidence is neutral. IDs are never converted into invented popularity scores.
export function popularityPercentiles(
  characters: {
    id: string;
    sourceKey: string;
    tier: Tier;
    popularity: number | null;
  }[],
): Map<string, number> {
  const groups = new Map<string, typeof characters>();
  for (const character of characters) {
    if (character.popularity === null) continue;
    const key = character.sourceKey.split(':')[0] + ':' + character.tier;
    const group = groups.get(key) ?? [];
    group.push(character);
    groups.set(key, group);
  }
  const result = new Map<string, number>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.popularity! - b.popularity!);
    let first = 0;
    group.forEach((character, index) => {
      if (index && character.popularity !== group[index - 1].popularity) first = index;
      result.set(
        character.id,
        group.length < 2 ? 0 : Math.floor((first * 10000) / (group.length - 1)),
      );
    });
  }
  return result;
}
