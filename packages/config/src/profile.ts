import { z } from 'zod';

/** Colour themes a player can choose for their profile page. */
export const profileThemes = ['violet', 'rose', 'ocean', 'emerald', 'amber', 'slate'] as const;
export type ProfileTheme = (typeof profileThemes)[number];
export const profileThemeLabels: Record<ProfileTheme, string> = {
  violet: 'Violet',
  rose: 'Rose',
  ocean: 'Ocean',
  emerald: 'Emerald',
  amber: 'Amber',
  slate: 'Slate',
};
export const profileLimits = { bio: 280, showcase: 6 } as const;

const cleanBio = (text: string) =>
  text
    .normalize('NFC')
    // One paragraph: control and invisible format characters become spaces.
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
/** What a player may change about their own profile page. */
export const profilePageInputSchema = z.strictObject({
  bio: z
    .string()
    .max(profileLimits.bio * 4)
    .transform(cleanBio)
    .pipe(z.string().max(profileLimits.bio)),
  theme: z.enum(profileThemes),
  /** Card IDs of the player's own cards, in display order. */
  showcase: z
    .array(z.uuid())
    .max(profileLimits.showcase)
    .refine((ids) => new Set(ids).size === ids.length, 'Show each card once.'),
  showWishlist: z.boolean(),
});
export type ProfilePageInput = z.infer<typeof profilePageInputSchema>;
/** A saved profile page (also the shape kept in player archives). */
export const profilePageSchema = z.strictObject({
  bio: z
    .string()
    .max(profileLimits.bio)
    .refine((text) => cleanBio(text) === text, 'Profile text must be canonical.'),
  theme: z.enum(profileThemes),
  // Pages saved by early test builds may pin up to eight cards (the database
  // bound); new saves allow six and pages show at most six.
  showcase: z
    .array(z.uuid())
    .max(8)
    .refine((ids) => new Set(ids).size === ids.length, 'Show each card once.'),
  showWishlist: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type ProfilePage = z.infer<typeof profilePageSchema>;
