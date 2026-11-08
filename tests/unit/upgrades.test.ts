import { describe, expect, it } from 'vitest';
import {
  defaultUpgrades,
  parseRealmConfig,
  disabledCollectorRanks,
  disabledGemRewards,
} from '../../packages/config/src/index';
import { defaultConfig, legacyRules } from '../support/prototype-config';
import {
  calculateUpgradePurchase,
  effectivePackPrice,
  upgradeView,
} from '../../packages/core/src/index';

describe('purchasable pack discounts', () => {
  it('migrates v3 rules without changing earlier economy or XP settings', () => {
    const {
      upgrades: _upgrades,
      wishlist: _wishlist,
      trading: _trading,
      ranks: _ranks,
      gemRewards: _gemRewards,
      ...old
    } = defaultConfig;
    expect(_ranks).toEqual(defaultConfig.ranks);
    expect(_gemRewards).toEqual(defaultConfig.gemRewards);
    expect(_trading).toEqual(defaultConfig.trading);
    expect(_wishlist).toEqual(defaultConfig.wishlist);
    expect(_upgrades).toEqual(defaultUpgrades);
    expect(parseRealmConfig({ ...legacyRules(old), schemaVersion: 3, packPrice: 12 })).toEqual({
      ...defaultConfig,
      ranks: disabledCollectorRanks,
      gemRewards: disabledGemRewards,
      packPrice: 12,
    });
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 3 })).toThrow();
  });
  it('derives per-player prices and next-rank offers without stacking cumulative discounts', () => {
    expect([0, 1, 2].map((rank) => effectivePackPrice(defaultConfig, rank))).toEqual([10, 9, 8]);
    expect(upgradeView(defaultConfig, 0, 0, 100)).toMatchObject({
      blocked: 'level',
      next: { rank: 1, cost: 10, requiredLevel: 2, discount: 1, packPrice: 9 },
    });
    expect(calculateUpgradePurchase(defaultConfig, 0, 1, 20, 80)).toEqual({
      rank: 1,
      charged: 10,
      balance: 70,
      discount: 1,
      packPrice: 9,
      requiredLevel: 2,
      level: 2,
    });
    expect(calculateUpgradePurchase(defaultConfig, 1, 2, 40, 20)).toMatchObject({
      rank: 2,
      charged: 20,
      balance: 0,
      discount: 2,
      packPrice: 8,
    });
    expect(upgradeView(defaultConfig, 2, 100, 100).next).toBeNull();
  });
  it('requires the exact next rank, sufficient level and gems, and rejects disabled or invalid state', () => {
    expect(() => calculateUpgradePurchase(defaultConfig, 0, 2, 100, 100)).toThrow('rank changed');
    expect(() => calculateUpgradePurchase(defaultConfig, 0, 1, 19, 100)).toThrow('level 2');
    expect(() => calculateUpgradePurchase(defaultConfig, 0, 1, 20, 9)).toThrow('enough gems');
    expect(() => calculateUpgradePurchase(defaultConfig, 2, 3, 100, 100)).toThrow('already owned');
    expect(() =>
      calculateUpgradePurchase(
        { ...defaultConfig, upgrades: { packDiscount: [] } },
        0,
        1,
        100,
        100,
      ),
    ).toThrow('disabled');
    for (const rank of [-1, 0.5, 3])
      expect(() => effectivePackPrice(defaultConfig, rank)).toThrow();
  });
  it('supports custom/free purchases and clamps pack prices at zero', () => {
    const config = parseRealmConfig({
      ...defaultConfig,
      upgrades: { packDiscount: [{ cost: 0, requiredLevel: 1, discount: 15 }] },
    });
    expect(calculateUpgradePurchase(config, 0, 1, 0, 0)).toMatchObject({
      charged: 0,
      balance: 0,
      packPrice: 0,
    });
    expect(effectivePackPrice({ ...defaultConfig, packPrice: 0 }, 0)).toBe(0);
    expect(effectivePackPrice(defaultConfig, 2)).toBeGreaterThan(
      Math.max(...Object.values(defaultConfig.recycleRewards)),
    );
  });
  it('rejects ambiguous ranks, unsupported values, and unknown versions', () => {
    const first = defaultUpgrades.packDiscount[0];
    for (const rules of [
      [{ ...first, cost: -1 }],
      [{ ...first, cost: 0.5 }],
      [{ ...first, discount: 0 }],
      [{ ...first, requiredLevel: 0 }],
      Array(6).fill(first),
      [first, first],
      [first, { ...first, discount: 2, requiredLevel: 1 }],
    ])
      expect(() =>
        parseRealmConfig({ ...defaultConfig, upgrades: { packDiscount: rules } }),
      ).toThrow();
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 999 })).toThrow();
  });
});
