/*
 * Kinds of series provider rosters can walk. Kept free of Node.js imports so
 * browser screens (the realm wizard, Administration → Characters) can use it.
 */

/** Most characters one MyAnimeList series may contribute (long series list hundreds). */
export const jikanMaxPerWork = 100;
/**
 * MyAnimeList kinds. Each maps to MyAnimeList's anime or manga list (separate
 * ID spaces) and its type filter. MyAnimeList has no donghua type; Chinese
 * animation is listed almost entirely as web anime (ONA).
 */
export const jikanMedia = [
  'anime',
  'ona',
  'movie',
  'manga',
  'manhwa',
  'manhua',
  'lightnovel',
] as const;
export type JikanMedium = (typeof jikanMedia)[number];
export const jikanMediumInfo: Record<
  JikanMedium,
  { path: 'anime' | 'manga'; type: string; label: string; categories: string[] }
> = {
  anime: { path: 'anime', type: 'tv', label: 'Anime (TV)', categories: ['Anime'] },
  ona: {
    path: 'anime',
    type: 'ona',
    label: 'Web anime (ONA), includes most donghua',
    categories: ['Web Anime'],
  },
  movie: {
    path: 'anime',
    type: 'movie',
    label: 'Anime films',
    categories: ['Anime', 'Anime Film'],
  },
  manga: { path: 'manga', type: 'manga', label: 'Manga', categories: ['Manga'] },
  manhwa: { path: 'manga', type: 'manhwa', label: 'Manhwa (Korean)', categories: ['Manhwa'] },
  manhua: { path: 'manga', type: 'manhua', label: 'Manhua (Chinese)', categories: ['Manhua'] },
  lightnovel: {
    path: 'manga',
    type: 'lightnovel',
    label: 'Light novels',
    categories: ['Light Novel'],
  },
};

/** Most characters one AniList series may contribute; loaded 25 per request. */
export const aniListMaxPerWork = 100;
/**
 * AniList kinds. Anime and manga list every country, as before; the others
 * filter by AniList's country of origin or format.
 */
export const aniListMedia = [
  'anime',
  'donghua',
  'manga',
  'manhwa',
  'manhua',
  'lightnovel',
] as const;
export type AniListMedium = (typeof aniListMedia)[number];
export const aniListMediumInfo: Record<
  AniListMedium,
  { type: 'ANIME' | 'MANGA'; country?: string; format?: string; label: string }
> = {
  anime: { type: 'ANIME', label: 'Anime (all countries)' },
  donghua: { type: 'ANIME', country: 'CN', label: 'Donghua (Chinese animation)' },
  manga: { type: 'MANGA', label: 'Manga and comics (all countries)' },
  manhwa: { type: 'MANGA', country: 'KR', label: 'Manhwa (Korean)' },
  manhua: { type: 'MANGA', country: 'CN', label: 'Manhua (Chinese)' },
  lightnovel: { type: 'MANGA', format: 'NOVEL', label: 'Light novels' },
};
