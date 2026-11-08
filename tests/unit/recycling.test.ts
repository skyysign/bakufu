import { describe, expect, it } from 'vitest';
import {
  parseRealmConfig,
  disabledCollectorRanks,
  disabledGemRewards,
} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { calculateRecycleCredit } from '../../packages/core/src/index';
import { legacyConfig } from '../support/legacy';

describe('versioned recycling rules', () => {
  it('upgrades v1 rules while preserving the original gameplay settings', () => {
    const upgraded = parseRealmConfig(legacyConfig);
    expect(upgraded).toEqual({
      ...legacyConfig,
      schemaVersion: 11,
      legacyPurchasesRetired: false,
      rankTracks: defaultConfig.rankTracks,
      characterValues: defaultConfig.characterValues,
      tierWeights: defaultConfig.tierWeights,
      ranks: disabledCollectorRanks,
      gemRewards: disabledGemRewards,
      recycleRewards: { common: 2, uncommon: 4, rare: 6, epic: 0, legendary: 0 },
      progression: defaultConfig.progression,
      upgrades: defaultConfig.upgrades,
      wishlist: defaultConfig.wishlist,
      trading: defaultConfig.trading,
    });
    expect(parseRealmConfig(JSON.parse(JSON.stringify(upgraded)))).toEqual(upgraded);
    expect(() => parseRealmConfig({ ...legacyConfig, unexpected: true })).toThrow();
  });
  it('calculates server-side tier rewards, including custom and zero rewards', () => {
    expect(calculateRecycleCredit('common', 90, defaultConfig)).toEqual({
      credited: 2,
      balance: 92,
    });
    expect(calculateRecycleCredit('uncommon', 90, defaultConfig)).toEqual({
      credited: 4,
      balance: 94,
    });
    expect(calculateRecycleCredit('rare', 90, defaultConfig)).toEqual({ credited: 6, balance: 96 });
    const config = parseRealmConfig({
      ...defaultConfig,
      recycleRewards: { ...defaultConfig.recycleRewards, common: 0, uncommon: 3, rare: 7 },
    });
    expect(calculateRecycleCredit('common', 0, config)).toEqual({ credited: 0, balance: 0 });
    expect(calculateRecycleCredit('rare', 0, config)).toEqual({ credited: 7, balance: 7 });
    expect(Math.max(...Object.values(defaultConfig.recycleRewards))).toBeLessThan(
      defaultConfig.packPrice,
    );
  });
  it('rejects invalid rewards, incomplete v2 settings, and wallet overflow', () => {
    for (const invalid of [-1, 0.5, 1_000_001])
      expect(() =>
        parseRealmConfig({
          ...defaultConfig,
          recycleRewards: { common: invalid, uncommon: 4, rare: 6 },
        }),
      ).toThrow();
    expect(() => parseRealmConfig({ ...legacyConfig, schemaVersion: 2 })).toThrow();
    expect(() => calculateRecycleCredit('common', 2_147_483_647, defaultConfig)).toThrow(
      'wallet cannot hold',
    );
    expect(calculateRecycleCredit('common', 2_147_483_645, defaultConfig).balance).toBe(
      2_147_483_647,
    );
  });
});
