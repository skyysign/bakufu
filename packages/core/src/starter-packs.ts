import { starterPackPlanSchema, type RealmConfig } from '../../config/src/index';
import type { Character, StarterPack } from './index';
import { GameError } from './errors';
import {
  catalogPackGrouping,
  defaultPackName,
  isDemographicCategory,
  isManualOnlyCategory,
  isMediumCategory,
} from './pack-themes';

function categoryPools(characters: Character[]) {
  const categories = new Map<string, Set<string>>();
  for (const character of characters)
    for (const category of character.categories) {
      const ids = categories.get(category) ?? new Set<string>();
      ids.add(character.id);
      categories.set(category, ids);
    }
  return categories;
}
export function starterPackCategories(characters: Character[]) {
  return [...categoryPools(characters)]
    .map(([category, ids]) => ({ category, poolSize: ids.size }))
    .sort((a, b) => b.poolSize - a.poolSize || a.category.localeCompare(b.category));
}
export function buildStarterPacks(
  characters: Character[],
  config: RealmConfig,
  input?: unknown,
): StarterPack[] {
  if (input === undefined) return generatePacks(characters, config);
  const plan = starterPackPlanSchema.parse(input);
  if (plan.categories.length > config.maximumCategoryPacks)
    throw new GameError(
      'PACK_PLAN_INVALID',
      `Choose at most ${config.maximumCategoryPacks} category packs, or raise the configured maximum.`,
    );
  if (new Set(plan.categories.map((pack) => pack.category)).size !== plan.categories.length)
    throw new GameError('PACK_PLAN_INVALID', 'Select each category at most once.');
  const names = plan.categories.map((pack) => pack.name.toLowerCase());
  if (names.includes('all characters') || new Set(names).size !== names.length)
    throw new GameError(
      'PACK_PLAN_INVALID',
      'Use different pack names. All Characters is reserved for the fallback pack.',
    );
  const pools = categoryPools(characters);
  for (const pack of plan.categories) {
    const pool = pools.get(pack.category);
    if (!pool)
      throw new GameError(
        'PACK_PLAN_INVALID',
        'A selected category is missing from this catalog. Preview it again before choosing packs.',
      );
    if (pool.size < config.minimumPoolSize)
      throw new GameError(
        'PACK_PLAN_INVALID',
        'A selected category is smaller than the configured minimum pool. Choose another category or lower the minimum.',
      );
  }
  if (characters.length < config.minimumPoolSize) return [];
  return [
    ...plan.categories.map((pack) => ({ ...pack })),
    { name: 'All Characters', category: null },
  ];
}

/** A category covering this share of the roster would just repeat All Characters. */
export const nearTotalPoolShare = 0.85;

export function generatePacks(characters: Character[], config: RealmConfig): StarterPack[] {
  if (characters.length < config.minimumPoolSize) return [];
  const categories = categoryPools(characters);
  const demographicMode = catalogPackGrouping(characters).mode === 'demographics';
  const bySize = [...categories]
    .filter(([category]) => !isManualOnlyCategory(category))
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  // Anime/manga catalogs lead with their actual demographic tags, then add the
  // largest distinct genre/theme pools for variety. Genres are never relabelled
  // as demographics; each pack keeps its exact source category.
  // Medium packs (Anime, Manga, Manhwa, …) come next for fans of one medium; a
  // medium covering nearly the whole roster would repeat All Characters.
  const distinct = ([, ids]: [string, Set<string>]) =>
    ids.size < characters.length * nearTotalPoolShare;
  const candidates = demographicMode
    ? [
        ...bySize.filter(([category]) => isDemographicCategory(category)),
        ...bySize.filter((pool) => isMediumCategory(pool[0]) && distinct(pool)),
        ...bySize.filter(
          (pool) => !isDemographicCategory(pool[0]) && !isMediumCategory(pool[0]) && distinct(pool),
        ),
      ]
    : bySize;
  const selected: Set<string>[] = [];
  const result: StarterPack[] = [];
  const usedNames = new Set(['all characters']);
  for (const [category, ids] of candidates) {
    if (result.length >= config.maximumCategoryPacks) break;
    if (ids.size < config.minimumPoolSize) continue;
    // Skip near-identical category pools (Jaccard >= 90%). Distinct demographic
    // groups are kept even when their pools overlap.
    if (
      !(demographicMode && isDemographicCategory(category)) &&
      selected.some((other) => {
        const intersection = [...ids].filter((id) => other.has(id)).length;
        return intersection / (ids.size + other.size - intersection) >= 0.9;
      })
    )
      continue;
    selected.push(ids);
    const preferred = defaultPackName(category);
    let name = preferred;
    let suffix = 1;
    while (usedNames.has(name.toLowerCase())) {
      name = `${preferred} (${category}${suffix > 1 ? ` ${suffix}` : ''})`;
      suffix++;
    }
    usedNames.add(name.toLowerCase());
    result.push({ name, category });
  }
  return [...result, { name: 'All Characters', category: null }];
}
