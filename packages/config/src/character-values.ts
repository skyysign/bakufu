import { z } from 'zod';

export const characterValuesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  popularityBoostBps: z.number().int().min(0).max(100000),
  wishlistBoostBps: z.number().int().min(0).max(100000),
  maxWishlistBoostBps: z.number().int().min(0).max(100000),
});
export type CharacterValuesConfig = z.infer<typeof characterValuesSchema>;
export const defaultCharacterValues: CharacterValuesConfig = {
  schemaVersion: 1,
  enabled: true,
  popularityBoostBps: 7500,
  wishlistBoostBps: 500,
  maxWishlistBoostBps: 2500,
};
export const disabledCharacterValues: CharacterValuesConfig = {
  ...defaultCharacterValues,
  enabled: false,
};
