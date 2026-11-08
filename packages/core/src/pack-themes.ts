export type PackMotif =
  | 'collection'
  | 'battle'
  | 'voyage'
  | 'fantasy'
  | 'romance'
  | 'mystery'
  | 'future'
  | 'spirit'
  | 'school'
  | 'sports'
  | 'everyday'
  | 'comedy'
  | 'drama'
  | 'music'
  | 'night'
  | 'mecha'
  | 'isekai'
  | 'shonen'
  | 'shojo'
  | 'seinen'
  | 'josei'
  | 'magical'
  | 'historical'
  | 'custom';

const editions: {
  categories: string[];
  name: string;
  motif: PackMotif;
  demographic?: boolean;
  previousNames?: string[];
}[] = [
  { categories: ['Action'], name: 'Battle Arena', motif: 'battle' },
  { categories: ['Adventure'], name: 'Grand Voyage', motif: 'voyage' },
  { categories: ['Fantasy'], name: 'Fantasy Realms', motif: 'fantasy' },
  { categories: ['Romance'], name: 'Heartstrings', motif: 'romance' },
  { categories: ['Mystery'], name: 'Detective Files', motif: 'mystery' },
  { categories: ['Sci-Fi', 'Science Fiction', 'SciFi'], name: 'Future City', motif: 'future' },
  { categories: ['Supernatural'], name: 'Spirit Realm', motif: 'spirit' },
  { categories: ['School', 'School Life'], name: 'School Days', motif: 'school' },
  { categories: ['Sports'], name: 'Sports Festival', motif: 'sports' },
  { categories: ['Slice of Life'], name: 'Everyday Stories', motif: 'everyday' },
  { categories: ['Comedy'], name: 'Comedy Club', motif: 'comedy' },
  { categories: ['Drama'], name: 'Character Arcs', motif: 'drama' },
  { categories: ['Music'], name: 'Encore Stage', motif: 'music' },
  { categories: ['Horror'], name: 'Midnight Tales', motif: 'night' },
  { categories: ['Suspense'], name: 'Edge of Night', motif: 'night' },
  { categories: ['Thriller'], name: 'Final Countdown', motif: 'night' },
  { categories: ['Historical'], name: 'Era Chronicles', motif: 'historical' },
  { categories: ['Mecha'], name: 'Mecha Hangar', motif: 'mecha' },
  { categories: ['Isekai'], name: 'Isekai Gateways', motif: 'isekai' },
  // Character gender categories (from AniList data or detected MyAnimeList profiles).
  { categories: ['Female'], name: 'Waifus', motif: 'shojo' },
  { categories: ['Male'], name: 'Husbandos', motif: 'seinen' },
  {
    categories: ['Shonen', 'Shounen'],
    name: 'Shōnen',
    motif: 'shonen',
    demographic: true,
    previousNames: ['Shōnen Showdown'],
  },
  {
    categories: ['Shojo', 'Shoujo'],
    name: 'Shōjo',
    motif: 'shojo',
    demographic: true,
    previousNames: ['Shōjo Stories'],
  },
  {
    categories: ['Seinen'],
    name: 'Seinen',
    motif: 'seinen',
    demographic: true,
    previousNames: ['Seinen Archives'],
  },
  {
    categories: ['Josei'],
    name: 'Josei',
    motif: 'josei',
    demographic: true,
    previousNames: ['Josei Stories'],
  },
  { categories: ['Kodomo', 'Kids'], name: 'Kodomo', motif: 'custom', demographic: true },
  {
    categories: ['Mahou Shoujo', 'Magical Girls', 'Magical Girl'],
    name: 'Magical Girls',
    motif: 'magical',
  },
  // Era packs come from a series' first release year (for example "2010s").
  { categories: ['1950s', '1960s', '1970s'], name: 'Golden Age', motif: 'historical' },
  { categories: ['1980s'], name: '80s Classics', motif: 'historical' },
  { categories: ['1990s'], name: '90s Icons', motif: 'night' },
  { categories: ['2000s'], name: '2000s Hits', motif: 'collection' },
  { categories: ['2010s'], name: '2010s Stars', motif: 'collection' },
  { categories: ['2020s'], name: 'New Generation', motif: 'future' },
];
function normalized(category: string) {
  return category
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ');
}
const byCategory = new Map(
  editions.flatMap((edition) =>
    edition.categories.map((category) => [normalized(category), edition] as const),
  ),
);

/** Themes describe an actual saved category; they never infer demographics. */
export function defaultPackName(category: string): string {
  return byCategory.get(normalized(category))?.name ?? category;
}

/** Genres as published by MyAnimeList/AniList; everything else is a theme. */
const genreCategories = new Set(
  [
    'Action',
    'Adventure',
    'Avant Garde',
    'Award Winning',
    'Boys Love',
    'Comedy',
    'Drama',
    'Ecchi',
    'Fantasy',
    'Girls Love',
    'Gourmet',
    'Horror',
    'Mahou Shoujo',
    'Mecha',
    'Music',
    'Mystery',
    'Psychological',
    'Romance',
    'Sci-Fi',
    'Science Fiction',
    'Slice of Life',
    'Sports',
    'Supernatural',
    'Suspense',
    'Thriller',
  ].map(normalized),
);
export type PackGroup = 'all' | 'demographic' | 'genre' | 'theme' | 'era';
/** Presentation grouping for galleries; it never affects eligibility. */
export function packGroup(category: string | null): PackGroup {
  if (category === null) return 'all';
  if (isDemographicCategory(category)) return 'demographic';
  if (/^(?:19|20)\d0s$/.test(category.trim())) return 'era';
  return genreCategories.has(normalized(category)) ? 'genre' : 'theme';
}

export function isDemographicCategory(category: string): boolean {
  return byCategory.get(normalized(category))?.demographic === true;
}

type CategorizedCharacter = { sourceKey: string; categories: string[] };
export function catalogPackGrouping(characters: CategorizedCharacter[]) {
  const hasDemographics = characters.some((character) =>
    character.categories.some(isDemographicCategory),
  );
  const providerAnime =
    characters.length > 0 &&
    characters.every((character) => /^(mal|anilist):/.test(character.sourceKey));
  return {
    mode: hasDemographics || providerAnime ? ('demographics' as const) : ('categories' as const),
    missingDemographics: providerAnime && !hasDemographics,
  };
}

/** Every saved pack stays visible, including genre/theme packs in anime
 * catalogs: they add variety alongside demographic packs and always draw from
 * their exact saved category. Rows and receipts are never modified. */
export function packsForCatalog<T extends { id?: string; name: string; category: string | null }>(
  packs: T[],
  characters: CategorizedCharacter[],
): T[] {
  void characters;
  return presentPacks(packs);
}

/** Keep custom names, stored records and historical receipts untouched. */
export function packPresentation(pack: { name: string; category: string | null }) {
  const edition = pack.category === null ? undefined : byCategory.get(normalized(pack.category));
  return {
    name:
      pack.category !== null &&
      (pack.name === pack.category || edition?.previousNames?.includes(pack.name))
        ? (edition?.name ?? pack.name)
        : pack.name,
    motif:
      pack.category === null ? ('collection' as const) : (edition?.motif ?? ('custom' as const)),
    sourceCategory: pack.category,
  };
}

/** Disambiguate themed defaults without renaming explicitly customized packs. */
export function presentPacks<T extends { id?: string; name: string; category: string | null }>(
  packs: T[],
): T[] {
  const presented = packs.map((pack) => ({ ...pack, name: packPresentation(pack).name }));
  const counts = new Map<string, number>();
  for (const pack of presented) {
    const key = pack.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const needsSuffix = packs.map(
    (pack, index) =>
      pack.category !== null &&
      (pack.name === pack.category || presented[index].name !== pack.name) &&
      (counts.get(presented[index].name.toLowerCase()) ?? 0) > 1,
  );
  const reserved = new Set(
    presented.filter((_, index) => !needsSuffix[index]).map((pack) => pack.name.toLowerCase()),
  );
  // Web and Discord query packs in different orders. Allocate aliases by saved
  // identity so a case-insensitive collision always receives the same suffix.
  const allocationOrder = packs
    .map((_, index) => index)
    .filter((index) => needsSuffix[index])
    .sort((left, right) => {
      const a = packs[left],
        b = packs[right];
      for (const [aValue, bValue] of [
        [a.category ?? '', b.category ?? ''],
        [a.name, b.name],
        [a.id ?? '', b.id ?? ''],
      ]) {
        if (aValue < bValue) return -1;
        if (aValue > bValue) return 1;
      }
      return 0;
    });
  for (const index of allocationOrder) {
    const pack = presented[index];
    const preferred = `${pack.name} (${pack.category})`;
    let name = preferred,
      suffix = 2;
    while (reserved.has(name.toLowerCase())) name = `${preferred} ${suffix++}`;
    reserved.add(name.toLowerCase());
    presented[index] = { ...pack, name };
  }
  return presented;
}
