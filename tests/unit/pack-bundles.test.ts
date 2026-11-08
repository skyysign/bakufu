import { describe, expect, it } from 'vitest';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { drawPack, drawPacks, requirePackOpeningCount } from '../../packages/core/src/index';
import { generateScaleCatalog } from '../../packages/importers/src/scale';
import { parseCatalog } from '../../packages/importers/src/index';

const { characters } = parseCatalog(generateScaleCatalog(100));
describe('pack bundle rules', () => {
  it('accepts exactly 1, 5 and 10 without coercion', () => {
    for (const count of [1, 5, 10]) expect(requirePackOpeningCount(count)).toBe(count);
    for (const count of [0, 2, 9, 50, -1, 5.5, '5', null, undefined])
      expect(() => requirePackOpeningCount(count)).toThrow('Choose 1, 5 or 10');
  });
  it('matches ordinary single-pack sampling and never mutates the input', () => {
    expect(drawPacks(characters, defaultConfig, 1, () => 0)).toEqual(
      drawPack(characters, defaultConfig, () => 0),
    );
    const before = structuredClone(characters);
    const result = drawPacks(characters, { ...defaultConfig, packSize: 5 }, 10, () => 0);
    expect(result).toHaveLength(50);
    expect(new Set(result.map((character) => character.id)).size).toBe(50);
    expect(characters).toEqual(before);
  });
  it('rejects an incomplete bundle before sampling any result', () => {
    let sampled = false;
    expect(() =>
      drawPacks(characters.slice(0, 9), defaultConfig, 10, () => {
        sampled = true;
        return 0;
      }),
    ).toThrow('every requested pack');
    expect(sampled).toBe(false);
  });
  it('applies wishlist weighting and renormalizes tiers across pack boundaries', () => {
    const result = drawPacks(
      characters,
      {
        ...defaultConfig,
        tierWeights: { ...defaultConfig.tierWeights, common: 0, uncommon: 0, rare: 100 },
      },
      10,
      () => 0,
      [characters[0].id],
    );
    expect(result).toHaveLength(10);
    expect(result.every((character) => character.tier === 'rare')).toBe(true);
    expect(new Set(result.map((character) => character.id)).size).toBe(10);
  });
});
