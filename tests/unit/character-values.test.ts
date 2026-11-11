import { describe, it, expect } from 'vitest';
import {
  defaultConfig,
  disabledCharacterValues,
  parseRealmConfig,
} from '../../packages/config/src/index';
import {
  popularityPercentiles,
  quoteCharacterValue,
  calculateRecycleCredit,
} from '../../packages/core/src/index';

describe('character-specific value rules', () => {
  const input = {
    baseValue: 1000,
    popularity: 100,
    popularityPercentileBps: 10000,
    wishlistDemand: 2,
    recycleBonus: 8,
    rules: defaultConfig.characterValues,
  };
  it('varies values within a tier using provider evidence and bounded demand', () => {
    const high = quoteCharacterValue(input),
      low = quoteCharacterValue({ ...input, popularityPercentileBps: 0 });
    expect(high).toMatchObject({
      popularityBonus: 750,
      demandBonus: 100,
      marketValue: 1850,
      recycleValue: 1858,
    });
    expect(high.marketValue).toBeGreaterThan(low.marketValue);
    expect(quoteCharacterValue({ ...input, wishlistDemand: 10000 }).demandBonus).toBe(250);
  });
  it('keeps equal scores equal and separates source/tier cohorts', () => {
    const map = popularityPercentiles([
      { id: 'a', sourceKey: 'one:a', tier: 'epic', popularity: 100 },
      { id: 'b', sourceKey: 'one:b', tier: 'epic', popularity: 100 },
      { id: 'c', sourceKey: 'one:c', tier: 'epic', popularity: 1000 },
      { id: 'd', sourceKey: 'two:d', tier: 'epic', popularity: 10000 },
      { id: 'e', sourceKey: 'one:e', tier: 'rare', popularity: 100000 },
      { id: 'f', sourceKey: 'one:f', tier: 'epic', popularity: null },
    ]);
    expect(map.get('a')).toBe(map.get('b'));
    expect(map.get('c')).toBe(10000);
    expect(map.get('d')).toBe(0);
    expect(map.get('e')).toBe(0);
    expect(map.has('f')).toBe(false);
  });
  it('does not invent popularity, and disabled legacy rules keep exact rewards', () => {
    expect(
      quoteCharacterValue({
        ...input,
        popularity: null,
        popularityPercentileBps: 0,
        wishlistDemand: 0,
      }),
    ).toMatchObject({ marketValue: 1000, recycleValue: 1008, popularityBonus: 0 });
    expect(quoteCharacterValue({ ...input, rules: disabledCharacterValues })).toMatchObject({
      marketValue: 1000,
      recycleValue: 1008,
      popularityBonus: 0,
      demandBonus: 0,
    });
    const {
      characterValues: _values,
      fameFloors: _floors,
      recycleSafeguard: _safeguard,
      ...legacy
    } = defaultConfig;
    void _values;
    void _floors;
    void _safeguard;
    expect(parseRealmConfig({ ...legacy, schemaVersion: 10 }).characterValues.enabled).toBe(false);
  });
  it('uses configurable boosts and rejects wallet overflow without a credit', () => {
    expect(
      quoteCharacterValue({
        ...input,
        rules: {
          ...input.rules,
          popularityBoostBps: 0,
          wishlistBoostBps: 100,
          maxWishlistBoostBps: 100,
        },
      }).marketValue,
    ).toBe(1010);
    expect(() => calculateRecycleCredit('epic', 2147483600, defaultConfig, 1858)).toThrow('wallet');
    expect(() =>
      parseRealmConfig({
        ...defaultConfig,
        characterValues: { ...defaultConfig.characterValues, wishlistBoostBps: -1 },
      }),
    ).toThrow();
  });
});
