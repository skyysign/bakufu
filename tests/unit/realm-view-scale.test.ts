import { describe, expect, it } from 'vitest';
import { defaultConfig, tiers } from '../../packages/config/src/index';
import {
  characterOdds,
  quoteCharacterValue,
  quoteCharacterValues,
  selectPackSpotlights,
  selectedCharacterOdds,
  type Character,
} from '../../packages/core/src/index';

// Deterministic original pool; tiers and IDs are mixed so ties and order matter.
function pool(size: number, seed: number): Character[] {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) % 2147483648);
  return Array.from({ length: size }, (_, index) => ({
    id: `${(next() % 0xffffffff).toString(16).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sourceKey: `original:${index}`,
    name: `Original ${index}`,
    series: 'Original Series',
    categories: ['Original'],
    tier: tiers[next() % tiers.length],
  }));
}
const fullSortSpotlights = (characters: Character[], limit: number) =>
  characters
    .filter((character) => defaultConfig.tierWeights[character.tier] > 0)
    .sort((a, b) => tiers.indexOf(b.tier) - tiers.indexOf(a.tier) || a.id.localeCompare(b.id))
    .slice(0, limit);

describe('realm view helpers for large rosters', () => {
  it('selects the same pack spotlights as sorting the whole pool', () => {
    for (const [size, seed] of [
      [1, 1],
      [5, 2],
      [40, 3],
      [2000, 4],
    ])
      for (const limit of [0, 1, 3, 10]) {
        const characters = pool(size, seed);
        expect(selectPackSpotlights(characters, defaultConfig, limit)).toEqual(
          limit === 0 ? [] : fullSortSpotlights(characters, limit),
        );
      }
    const zeroLegendary = { ...defaultConfig, tierWeights: { ...defaultConfig.tierWeights, legendary: 0 } };
    expect(
      selectPackSpotlights(pool(300, 9), zeroLegendary, 3).some((c) => c.tier === 'legendary'),
    ).toBe(false);
  });

  it('computes wished-character odds exactly like the full odds map', () => {
    const characters = pool(500, 7);
    const wished = [characters[3].id, characters[200].id, 'not-in-pool'];
    const full = characterOdds(characters, defaultConfig, wished);
    expect(selectedCharacterOdds(characters, defaultConfig, wished, wished)).toEqual({
      [characters[3].id]: full[characters[3].id],
      [characters[200].id]: full[characters[200].id],
    });
    const noWishlist = { ...defaultConfig, wishlist: { ...defaultConfig.wishlist, slots: 0 } };
    expect(selectedCharacterOdds(characters, noWishlist, wished, wished)[characters[3].id]).toBe(
      characterOdds(characters, noWishlist, wished)[characters[3].id],
    );
  });

  it('quotes a whole realm with the same values as single quotes', () => {
    const inputs = Array.from({ length: 50 }, (_, index) => ({
      baseValue: [30, 60, 120, 260, 620][index % 5],
      popularity: index % 7 ? index * 13 : null,
      popularityPercentileBps: (index * 211) % 10001,
      wishlistDemand: index % 4,
      recycleBonus: index % 3,
    }));
    expect(quoteCharacterValues(inputs, defaultConfig.characterValues)).toEqual(
      inputs.map((input) => quoteCharacterValue({ ...input, rules: defaultConfig.characterValues })),
    );
    // The most popular legendary lands just above 1,000 gems with default rules.
    expect(
      quoteCharacterValue({
        baseValue: defaultConfig.recycleRewards.legendary,
        popularity: 1,
        popularityPercentileBps: 10000,
        wishlistDemand: 0,
        recycleBonus: 0,
        rules: defaultConfig.characterValues,
      }).marketValue,
    ).toBe(1085);
  });
});
