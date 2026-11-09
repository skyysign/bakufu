import { z } from 'zod';

/**
 * Fame floors: a provider character (MyAnimeList or AniList) with at least this
 * many favourites is at least this rarity, whatever the rest of the roster looks
 * like. Tiers are otherwise relative to the realm's own roster, so in a realm
 * built only from hit series a well-known character can miss the rare cut.
 * `null` turns a floor off. Own JSON/CSV catalogs are never affected, because
 * their popularity numbers have no common scale.
 */
const floor = z.number().int().min(1).max(1_000_000_000).nullable();
export const fameFloorsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    rare: floor,
    epic: floor,
    legendary: floor,
  })
  .refine((floors) => {
    const set = [floors.rare, floors.epic, floors.legendary].filter(
      (value): value is number => value !== null,
    );
    return set.every((value, index) => index === 0 || value > set[index - 1]);
  }, 'Each higher rarity needs more favourites than the one below it.');
export type FameFloors = z.infer<typeof fameFloorsSchema>;
/**
 * Calibrated on MyAnimeList favourites (a 1,000-character roster of popular
 * series has about 78 characters above 10,000, 27 above 30,000 and 7 above
 * 100,000). AniList counts are similar for recent series and lower for older ones.
 */
export const defaultFameFloors: FameFloors = {
  schemaVersion: 1,
  rare: 10_000,
  epic: 30_000,
  legendary: 100_000,
};
/** Realms created before fame floors keep their tiers until an admin applies floors. */
export const disabledFameFloors: FameFloors = {
  schemaVersion: 1,
  rare: null,
  epic: null,
  legendary: null,
};
