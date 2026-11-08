import type { AniListCatalog } from './anilist';
import { boundedProviderCategories } from './provider-categories';

// Browser-safe helpers for the AniList series browser. Keep this module free
// of transport code and Node-only identity helpers.
export const aniListMaxSelectedSeries = 100;

/** Merge one series into the prepared catalog: categories union, first artwork wins. */
export function mergeAniListCharacters(
  catalog: AniListCatalog,
  incoming: AniListCatalog,
): AniListCatalog {
  const all = new Map(catalog.characters.map((character) => [character.sourceKey, character]));
  for (const character of incoming.characters) {
    const previous = all.get(character.sourceKey);
    all.set(
      character.sourceKey,
      previous
        ? {
            ...previous,
            categories: boundedProviderCategories([
              ...previous.categories,
              ...character.categories,
            ]),
            ...(previous.artwork ? {} : character.artwork ? { artwork: character.artwork } : {}),
            // Main cast in any of its series counts as main.
            ...(character.role === 'main' ? { role: 'main' as const } : {}),
          }
        : character,
    );
  }
  return { ...catalog, characters: [...all.values()] };
}
