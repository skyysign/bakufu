import { describe, expect, it } from 'vitest';
import {
  parseRealmConfig,
  disabledCollectorRanks,
  disabledGemRewards,
} from '../../packages/config/src/index';
import { defaultConfig, legacyRules } from '../support/prototype-config';
import {
  availableOdds,
  characterOdds,
  drawPack,
  requireWishlistSpace,
  type Character,
} from '../../packages/core/src/index';
const pool: Character[] = ['a', 'b', 'c'].map((id) => ({
  id,
  sourceKey: id,
  name: id,
  series: 'Fixture',
  categories: [],
  tier: 'common',
}));
describe('wishlist weighting and capacity', () => {
  it('migrates earlier settings while preserving custom upgrades and XP', () => {
    const { wishlist, trading, ranks, gemRewards, ...v4 } = defaultConfig;
    expect(ranks).toEqual(defaultConfig.ranks);
    expect(gemRewards).toEqual(defaultConfig.gemRewards);
    expect(trading).toEqual(defaultConfig.trading);
    expect(parseRealmConfig({ ...legacyRules(v4), schemaVersion: 4, packPrice: 7 })).toEqual({
      ...defaultConfig,
      ranks: disabledCollectorRanks,
      gemRewards: disabledGemRewards,
      packPrice: 7,
    });
    expect(wishlist).toEqual({ slots: 3, weightMultiplier: 2 });
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 4 })).toThrow();
    for (const value of [
      { slots: -1, weightMultiplier: 2 },
      { slots: 21, weightMultiplier: 2 },
      { slots: 1.5, weightMultiplier: 2 },
      { slots: 3, weightMultiplier: 0 },
      { slots: 3, weightMultiplier: 11 },
      { slots: 3, weightMultiplier: 1.5 },
    ])
      expect(() => parseRealmConfig({ ...defaultConfig, wishlist: value })).toThrow();
  });
  it('reports exact within-tier probabilities and samples every weighted interval', () => {
    expect(characterOdds(pool, defaultConfig, ['a'])).toEqual({ a: 0.5, b: 0.25, c: 0.25 });
    const counts = { a: 0, b: 0, c: 0 };
    for (let ticket = 0; ticket < 4; ticket++) {
      let call = 0;
      const chosen = drawPack(pool, defaultConfig, () => (call++ === 0 ? 0 : ticket), ['a'])[0];
      counts[chosen.id as keyof typeof counts]++;
    }
    expect(counts).toEqual({ a: 2, b: 1, c: 1 });
  });
  it('preserves rarity odds and excludes missing or zero-weight characters', () => {
    const mixed = [
      ...pool,
      { ...pool[0], id: 'rare', tier: 'rare' as const },
      { ...pool[0], id: 'uncommon', tier: 'uncommon' as const },
    ];
    const odds = characterOdds(mixed, defaultConfig, ['a', 'rare', 'missing']);
    expect(odds.a).toBeCloseTo(0.35);
    expect(odds.rare).toBeCloseTo(0.05);
    expect(odds.b + odds.c + odds.a).toBeCloseTo(availableOdds(mixed, defaultConfig).common);
    expect(Object.values(odds).reduce((sum, n) => sum + n, 0)).toBeCloseTo(1);
    const noRare = {
      ...defaultConfig,
      tierWeights: { ...defaultConfig.tierWeights, common: 1, uncommon: 0, rare: 0 },
    };
    expect(characterOdds(mixed, noRare, ['rare']).rare).toBe(0);
    expect(drawPack(mixed, noRare, () => 0, ['rare'])[0].tier).toBe('common');
    expect(characterOdds([], defaultConfig, ['a'])).toEqual({});
  });
  it('recalculates without replacement and does not manufacture guarantees', () => {
    const config = { ...defaultConfig, packSize: 3 };
    expect(drawPack(pool, config, () => 0, ['a']).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(characterOdds(pool, defaultConfig, ['a']).a).toBeLessThan(1);
    expect(characterOdds([pool[0]], defaultConfig, ['a']).a).toBe(1);
    expect(() => drawPack(pool, { ...config, packSize: 4 }, () => 0, ['a'])).toThrow('Not enough');
  });
  it('treats neutral/disabled rules and duplicate wish IDs deterministically', () => {
    const ordinary = characterOdds(pool, defaultConfig);
    expect(
      characterOdds(pool, { ...defaultConfig, wishlist: { slots: 0, weightMultiplier: 10 } }, [
        'a',
      ]),
    ).toEqual(ordinary);
    expect(
      characterOdds(pool, { ...defaultConfig, wishlist: { slots: 3, weightMultiplier: 1 } }, ['a']),
    ).toEqual(ordinary);
    expect(characterOdds(pool, defaultConfig, ['a', 'a'])).toEqual(
      characterOdds(pool, defaultConfig, ['a']),
    );
    expect(characterOdds(pool, defaultConfig, ['a', 'b', 'c'])).toEqual(ordinary);
    expect(
      drawPack(
        pool,
        { ...defaultConfig, wishlist: { slots: 0, weightMultiplier: 10 } },
        (max) => max - 1,
        ['a'],
      )[0].id,
    ).toBe('c');
  });
  it('enforces full and disabled slot limits without changing the caller data', () => {
    expect(() => requireWishlistSpace(2, defaultConfig)).not.toThrow();
    expect(() => requireWishlistSpace(3, defaultConfig)).toThrow('full');
    expect(() =>
      requireWishlistSpace(0, { ...defaultConfig, wishlist: { slots: 0, weightMultiplier: 2 } }),
    ).toThrow('disabled');
  });
});
