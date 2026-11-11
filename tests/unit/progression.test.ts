import { describe, expect, it } from 'vitest';
import {
  defaultProgression,
  parseRealmConfig,
  disabledCollectorRanks,
  disabledGemRewards,
  disabledFameFloors,
} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { calculateXpAward, xpProgress } from '../../packages/core/src/index';
import { legacyConfig } from '../support/legacy';

describe('versioned XP and levels', () => {
  it('upgrades v1/v2 rules while preserving prior economy overrides', () => {
    expect(parseRealmConfig(legacyConfig)).toEqual({
      ...legacyConfig,
      schemaVersion: 13,
      recycleSafeguard: true,
      fameFloors: disabledFameFloors,
      legacyPurchasesRetired: false,
      rankTracks: defaultConfig.rankTracks,
      characterValues: defaultConfig.characterValues,
      tierWeights: defaultConfig.tierWeights,
      ranks: disabledCollectorRanks,
      gemRewards: disabledGemRewards,
      recycleRewards: { common: 2, uncommon: 4, rare: 6, epic: 0, legendary: 0 },
      progression: defaultProgression,
      upgrades: defaultConfig.upgrades,
      wishlist: defaultConfig.wishlist,
      trading: defaultConfig.trading,
    });
    const v2 = {
      ...legacyConfig,
      schemaVersion: 2,
      packPrice: 7,
      recycleRewards: { common: 1, uncommon: 2, rare: 3 },
    };
    expect(parseRealmConfig(v2)).toEqual({
      ...v2,
      recycleRewards: { ...v2.recycleRewards, epic: 0, legendary: 0 },
      schemaVersion: 13,
      recycleSafeguard: true,
      fameFloors: disabledFameFloors,
      legacyPurchasesRetired: false,
      rankTracks: defaultConfig.rankTracks,
      characterValues: defaultConfig.characterValues,
      tierWeights: defaultConfig.tierWeights,
      ranks: disabledCollectorRanks,
      gemRewards: disabledGemRewards,
      progression: defaultProgression,
      upgrades: defaultConfig.upgrades,
      wishlist: defaultConfig.wishlist,
      trading: defaultConfig.trading,
    });
    expect(() => parseRealmConfig({ ...v2, progression: defaultProgression })).toThrow();
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 999 })).toThrow();
  });
  it('uses cumulative level thresholds and exact boundaries', () => {
    for (const [xp, level] of [
      [0, 1],
      [19, 1],
      [20, 2],
      [39, 2],
      [40, 3],
      [69, 3],
      [70, 4],
      [99, 4],
      [100, 5],
      [150, 5],
    ]) {
      expect(xpProgress(xp, defaultConfig).level).toBe(level);
    }
    expect(xpProgress(10, defaultConfig)).toMatchObject({
      totalXp: 10,
      level: 1,
      levelStartsAt: 0,
      nextLevelAt: 20,
      xpIntoLevel: 10,
      xpToNextLevel: 10,
    });
    expect(xpProgress(150, defaultConfig)).toMatchObject({
      level: 5,
      maxLevel: 5,
      nextLevelAt: null,
      xpToNextLevel: 0,
    });
  });
  it('supports custom curves, multi-card awards, disabled XP, and a one-level realm', () => {
    const config = parseRealmConfig({
      ...defaultConfig,
      progression: { xpPerNewCharacter: 7, levelThresholds: [0, 7, 21] },
    });
    expect(calculateXpAward(0, 3, config)).toMatchObject({
      xpAwarded: 21,
      totalXp: 21,
      level: 3,
      levelsGained: 2,
      nextLevelAt: null,
    });
    expect(calculateXpAward(21, 0, config)).toMatchObject({
      xpAwarded: 0,
      totalXp: 21,
      level: 3,
      levelsGained: 0,
    });
    expect(
      calculateXpAward(0, 2, {
        ...config,
        progression: { xpPerNewCharacter: 0, levelThresholds: [0] },
      }),
    ).toMatchObject({ totalXp: 0, xpAwarded: 0, level: 1, nextLevelAt: null });
  });
  it('rejects ambiguous or unsafe level curves and XP settings', () => {
    for (const thresholds of [
      [],
      [1, 20],
      [0, 20, 20],
      [0, 30, 20],
      [0, -1],
      [0, 0.5],
      [0, 2_147_483_648],
      Array.from({ length: 101 }, (_, i) => i),
    ])
      expect(() =>
        parseRealmConfig({
          ...defaultConfig,
          progression: { xpPerNewCharacter: 10, levelThresholds: thresholds },
        }),
      ).toThrow();
    for (const xp of [-1, 0.5, 1_000_001])
      expect(() =>
        parseRealmConfig({
          ...defaultConfig,
          progression: { ...defaultProgression, xpPerNewCharacter: xp },
        }),
      ).toThrow();
  });
  it('rejects invalid XP state, discovery counts, and integer overflow', () => {
    for (const xp of [-1, 0.5, NaN, Infinity, 2_147_483_648])
      expect(() => xpProgress(xp, defaultConfig)).toThrow();
    for (const count of [-1, 0.5])
      expect(() => calculateXpAward(0, count, defaultConfig)).toThrow();
    expect(() => calculateXpAward(-5, 1, defaultConfig)).toThrow();
    expect(() => calculateXpAward(2_147_483_647, 1, defaultConfig)).toThrow('limit');
    expect(calculateXpAward(2_147_483_637, 1, defaultConfig).totalXp).toBe(2_147_483_647);
    expect(calculateXpAward(2_147_483_647, 0, defaultConfig).xpAwarded).toBe(0);
  });
});
