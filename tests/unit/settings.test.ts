import { describe, expect, it } from 'vitest';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import {
  realmSettingsImpact,
  type SettingsMember,
  type Character,
} from '../../packages/core/src/index';
const now = Date.parse('2026-11-04T12:00:00Z');
const member: SettingsMember = {
  balance: 20,
  xp: 40,
  rank: 1,
  wishes: 2,
  lastOpenedAt: '2026-11-04T11:59:30Z',
};
const pool: Character[] = [
  { id: 'a', sourceKey: 'a', name: 'A', series: 'Fixture', categories: [], tier: 'common' },
  { id: 'b', sourceKey: 'b', name: 'B', series: 'Fixture', categories: [], tier: 'rare' },
];
const packs = [{ id: 'p', name: 'Fixture pack', pool }];
describe('live realm settings impact', () => {
  it('compares prices, levels, affordability, cooldowns and preserves its inputs', () => {
    const before = JSON.stringify(defaultConfig);
    const draft = {
      ...defaultConfig,
      packPrice: 30,
      cooldownSeconds: 60,
      progression: { ...defaultConfig.progression, levelThresholds: [0, 50, 100] },
    };
    const result = realmSettingsImpact(defaultConfig, draft, [member], packs, now);
    expect(result).toMatchObject({
      players: 1,
      levelsDown: 1,
      levelsUp: 0,
      pricesUp: 1,
      affordableBefore: 1,
      affordableAfter: 0,
      waitingBefore: 0,
      waitingAfter: 1,
      purchasedRank: 1,
      maximumWishes: 2,
      blockers: [],
    });
    expect(result.changes.map((change) => change.label)).toContain('Pack price (gems)');
    expect(JSON.stringify(defaultConfig)).toBe(before);
  });
  it('rejects purchased-rank changes/removal but allows unpurchased rank changes', () => {
    const owned = {
      ...defaultConfig,
      upgrades: {
        packDiscount: [
          { ...defaultConfig.upgrades.packDiscount[0], cost: 11 },
          defaultConfig.upgrades.packDiscount[1],
        ],
      },
    };
    expect(
      realmSettingsImpact(defaultConfig, owned, [member], packs, now).blockers.join(),
    ).toContain('already purchased');
    expect(
      realmSettingsImpact(
        defaultConfig,
        { ...defaultConfig, upgrades: { packDiscount: [] } },
        [member],
        packs,
        now,
      ).blockers.join(),
    ).toContain('already purchased');
    const next = {
      ...defaultConfig,
      upgrades: {
        packDiscount: [
          defaultConfig.upgrades.packDiscount[0],
          { ...defaultConfig.upgrades.packDiscount[1], cost: 15 },
        ],
      },
    };
    expect(realmSettingsImpact(defaultConfig, next, [member], packs, now).blockers).toEqual([]);
  });
  it('blocks over-capacity wishes, creation-only settings, and unchanged drafts', () => {
    expect(
      realmSettingsImpact(
        defaultConfig,
        { ...defaultConfig, wishlist: { slots: 1, weightMultiplier: 2 } },
        [member],
        packs,
        now,
      ).blockers.join(),
    ).toContain('2 wishes');
    expect(
      realmSettingsImpact(
        defaultConfig,
        { ...defaultConfig, maximumCategoryPacks: 1 },
        [member],
        packs,
        now,
      ).blockers.join(),
    ).toContain('creation-only');
    expect(
      realmSettingsImpact(defaultConfig, defaultConfig, [member], packs, now).blockers.join(),
    ).toContain('at least one');
  });
  it('previews unavailable pools and actual renormalized tier odds', () => {
    const draft = {
      ...defaultConfig,
      packSize: 2,
      tierWeights: { ...defaultConfig.tierWeights, common: 0, uncommon: 0, rare: 1 },
    };
    const result = realmSettingsImpact(defaultConfig, draft, [member], packs, now);
    expect(result.packs[0]).toMatchObject({
      availableBefore: 2,
      availableAfter: 1,
      openableBefore: true,
      openableAfter: false,
      oddsAfter: { common: 0, uncommon: 0, rare: 1 },
    });
    expect(result.warnings.join()).toContain('complete opening');
  });
  it('warns about economy bounds, unreachable ranks and future-only rewards', () => {
    const draft = {
      ...defaultConfig,
      packPrice: 0,
      startingGems: 500,
      progression: { xpPerNewCharacter: 0, levelThresholds: [0] },
    };
    const result = realmSettingsImpact(defaultConfig, draft, [], packs, now);
    expect(result.warnings.join()).toMatch(/profitable recycling/);
    expect(result.warnings.join()).toMatch(/remain locked/);
    expect(result.warnings.join()).toMatch(/future memberships/);
    expect(result.warnings.join()).toMatch(/future first collections/);
    expect(result.players).toBe(0);
  });
  it('does not remove owned discounts when level thresholds lower the derived level', () => {
    const draft = {
      ...defaultConfig,
      progression: { ...defaultConfig.progression, levelThresholds: [0, 100, 200] },
    };
    const result = realmSettingsImpact(defaultConfig, draft, [member], packs, now);
    expect(result).toMatchObject({ levelsDown: 1, pricesUp: 0, pricesDown: 0, blockers: [] });
    expect(result.warnings.join()).toContain('owned upgrades stay intact');
  });
});
