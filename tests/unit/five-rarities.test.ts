import { describe, it, expect } from 'vitest';
import { defaultConfig, parseRealmConfig, tiers } from '../../packages/config/src/index';
import { generateScaleCatalog, parseCatalog } from '../../packages/importers/src/index';
import { availableOdds, drawPack } from '../../packages/core/src/index';
import { legacyConfig } from '../support/legacy';

describe('five-tier rarity and economy rules', () => {
  it('offers lower high-tier odds and a complete configurable economy', () => {
    expect(defaultConfig.packPrice).toBe(200);
    expect(defaultConfig.gemRewards).toEqual({
      enabled: true,
      amount: 1000,
      intervalSeconds: 21600,
    });
    expect(defaultConfig.recycleRewards).toEqual({
      common: 30,
      uncommon: 60,
      rare: 120,
      epic: 260,
      legendary: 620,
    });
    expect(defaultConfig.upgrades.packDiscount).toEqual([]);
    expect(defaultConfig.legacyPurchasesRetired).toBe(true);
    const pool = parseCatalog(generateScaleCatalog(), true).characters;
    expect(
      Object.fromEntries(tiers.map((tier) => [tier, pool.filter((c) => c.tier === tier).length])),
    ).toEqual({ common: 600, uncommon: 280, rare: 90, epic: 25, legendary: 5 });
    expect(availableOdds(pool, defaultConfig)).toEqual({
      common: 0.65,
      uncommon: 0.26,
      rare: 0.07,
      epic: 0.017,
      legendary: 0.003,
    });
    let call = 0;
    expect(drawPack(pool, defaultConfig, () => (call++ === 0 ? 9999 : 0))[0].tier).toBe(
      'legendary',
    );
  });
  it('preserves strict old formats, snapshots and their original odds', () => {
    const migrated = parseRealmConfig(legacyConfig);
    expect(migrated.tierWeights).toEqual({
      common: 70,
      uncommon: 25,
      rare: 5,
      epic: 0,
      legendary: 0,
    });
    expect(migrated.recycleRewards).toEqual({
      common: 2,
      uncommon: 4,
      rare: 6,
      epic: 0,
      legendary: 0,
    });
    expect(migrated.packPrice).toBe(10);
    expect(migrated.rankTracks.enabled).toBe(false);
    expect(() =>
      parseRealmConfig({
        ...legacyConfig,
        tierWeights: { ...legacyConfig.tierWeights, legendary: 1 },
      }),
    ).toThrow();
    expect(() =>
      parseRealmConfig({
        ...defaultConfig,
        tierWeights: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
      }),
    ).toThrow();
    expect(parseRealmConfig(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });
});
