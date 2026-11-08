import { describe, expect, it } from 'vitest';
import {
  parseRealmConfig,
  defaultCollectorRanks,
  disabledCollectorRanks,
  disabledGemRewards,
  collectorRanksSchema,
} from '../../packages/config/src/index';
import { defaultConfig, legacyRules } from '../support/prototype-config';
import {
  rankBenefits,
  applyRankBenefits,
  collectorRankView,
  calculateRankPurchase,
} from '../../packages/core/src/ranks';

describe('gem-purchased collector rank rules', () => {
  it('migrates v6 rules without activating ranks or changing existing values', () => {
    const { ranks: _ranks, gemRewards: _gemRewards, ...legacy } = defaultConfig;
    expect(_ranks).toEqual(defaultCollectorRanks);
    expect(_gemRewards).toEqual(defaultConfig.gemRewards);
    expect(parseRealmConfig({ ...legacyRules(legacy), schemaVersion: 6 })).toEqual({
      ...defaultConfig,
      ranks: disabledCollectorRanks,
      gemRewards: disabledGemRewards,
    });
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 6 })).toThrow();
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 999 })).toThrow();
  });
  it('offers the next named rank in sequence without an XP requirement', () => {
    expect(collectorRankView(defaultConfig, 0, 100)).toMatchObject({
      name: 'Unranked',
      rank: 0,
      blocked: null,
      next: { name: 'Bronze', rank: 1, cost: 25, status: 'available' },
    });
    expect(calculateRankPurchase(defaultConfig, 0, 1, 25)).toEqual({
      rank: 1,
      name: 'Bronze',
      charged: 25,
      balance: 0,
      benefits: { packDiscount: 1, recycleBonus: 0, wishlistSlots: 0, cooldownReductionSeconds: 0 },
    });
    expect(collectorRankView(defaultConfig, 1, 40)).toMatchObject({
      name: 'Bronze',
      next: { name: 'Silver', rank: 2 },
      blocked: 'gems',
    });
    expect(collectorRankView(defaultConfig, 5, 0)).toMatchObject({
      name: 'Diamond',
      next: null,
      blocked: 'max_rank',
    });
    expect(() => calculateRankPurchase(defaultConfig, 0, 2, 1000)).toThrow('next collector rank');
    expect(() => calculateRankPurchase(defaultConfig, 0, 1, 24)).toThrow('enough gems');
    expect(() => calculateRankPurchase(defaultConfig, 5, 6, 1000)).toThrow('already owned');
  });
  it('applies cumulative benefits once and preserves rarity, XP and base configuration', () => {
    const config = { ...defaultConfig, cooldownSeconds: 60 },
      before = structuredClone(config),
      effective = applyRankBenefits(config, 4);
    expect(effective).toMatchObject({
      packPrice: 9,
      cooldownSeconds: 45,
      wishlist: { slots: 5 },
      recycleRewards: { common: 3, uncommon: 5, rare: 7 },
    });
    expect(rankBenefits(config, 4)).toEqual({
      packDiscount: 1,
      recycleBonus: 1,
      wishlistSlots: 2,
      cooldownReductionSeconds: 15,
    });
    expect(effective.tierWeights).toEqual(config.tierWeights);
    expect(effective.progression).toEqual(config.progression);
    expect(effective.upgrades).toEqual(config.upgrades);
    expect(config).toEqual(before);
    expect(applyRankBenefits(config, 0)).toEqual(config);
  });
  it('supports configured free ranks and bounded effective values at the schema limits', () => {
    const config = parseRealmConfig({
      ...defaultConfig,
      packPrice: 0,
      cooldownSeconds: 0,
      recycleRewards: {
        ...defaultConfig.recycleRewards,
        common: 1_000_000,
        uncommon: 1_000_000,
        rare: 1_000_000,
      },
      wishlist: { slots: 20, weightMultiplier: 2 },
      ranks: {
        enabled: true,
        levels: [
          {
            name: 'Community',
            cost: 0,
            packDiscount: 999,
            recycleBonus: 1_000_000,
            wishlistSlots: 20,
            cooldownReductionSeconds: 999,
          },
        ],
      },
    });
    expect(calculateRankPurchase(config, 0, 1, 0)).toMatchObject({
      name: 'Community',
      charged: 0,
      balance: 0,
    });
    expect(applyRankBenefits(config, 1)).toMatchObject({
      packPrice: 0,
      cooldownSeconds: 0,
      wishlist: { slots: 20 },
      recycleRewards: { rare: 1_000_000 },
    });
    expect(parseRealmConfig(applyRankBenefits(config, 1))).toEqual(applyRankBenefits(config, 1));
  });
  it('validates every configured benefit, names, monotonic totals and disabled state', () => {
    const first = defaultCollectorRanks.levels[0],
      second = defaultCollectorRanks.levels[1];
    for (const field of [
      'cost',
      'packDiscount',
      'recycleBonus',
      'wishlistSlots',
      'cooldownReductionSeconds',
    ]) {
      for (const value of [-1, 0.5, '1'])
        expect(() =>
          collectorRanksSchema.parse({ enabled: true, levels: [{ ...first, [field]: value }] }),
        ).toThrow();
    }
    for (const levels of [
      [],
      [{ ...first, name: 'Bad\nname' }],
      [first, { ...second, name: 'BRONZE' }],
      [second, first],
    ])
      expect(() => collectorRanksSchema.parse({ enabled: true, levels })).toThrow();
    expect(() =>
      collectorRanksSchema.parse({ enabled: true, levels: [{ ...first, wishlistSlots: 21 }] }),
    ).toThrow();
    expect(() =>
      collectorRanksSchema.parse({
        enabled: true,
        levels: Array.from({ length: 11 }, (_, i) => ({ ...first, name: String(i) })),
      }),
    ).toThrow();
    const disabled = { ...defaultConfig, ranks: disabledCollectorRanks };
    expect(collectorRankView(disabled, 0, 100)).toMatchObject({
      enabled: false,
      next: null,
      blocked: 'disabled',
    });
    expect(() => calculateRankPurchase(disabled, 0, 1, 100)).toThrow('disabled');
    for (const rank of [-1, 0.5, 6]) expect(() => rankBenefits(defaultConfig, rank)).toThrow();
    for (const balance of [-1, 0.5, Number.POSITIVE_INFINITY, 2147483648])
      expect(() => calculateRankPurchase(defaultConfig, 0, 1, balance)).toThrow();
  });
});
