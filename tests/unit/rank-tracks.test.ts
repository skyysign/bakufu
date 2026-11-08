import { describe, it, expect } from 'vitest';
import { defaultConfig, rankTracksSchema } from '../../packages/config/src/index';
import {
  applyRankTrackBenefits,
  calculateRankTrackPurchase,
  rankTracksView,
} from '../../packages/core/src/rank-tracks';

describe('leveled collector rank tracks', () => {
  it('makes every level more expensive and strengthens owned per-track totals', () => {
    for (const track of defaultConfig.rankTracks.tracks)
      for (let i = 1; i < track.levels.length; i++)
        expect(track.levels[i].cost).toBeGreaterThan(track.levels[i - 1].cost);
    const config = applyRankTrackBenefits(defaultConfig, { bronze: 2, silver: 2, gold: 2 });
    expect(config.packPrice).toBe(180);
    expect(config.recycleRewards.common).toBe(defaultConfig.recycleRewards.common + 4);
    expect(config.wishlist.slots).toBe(5);
    expect(defaultConfig.packPrice).toBe(200);
  });
  it('enforces mixed prerequisite levels and sequential upgrades', () => {
    expect(() => calculateRankTrackPurchase(defaultConfig, {}, 'sapphire', 1, 100000)).toThrow(
      'required ranks',
    );
    expect(() => calculateRankTrackPurchase(defaultConfig, {}, 'bronze', 2, 100000)).toThrow(
      'next level',
    );
    expect(
      calculateRankTrackPurchase(
        defaultConfig,
        { bronze: 2, silver: 2, gold: 2 },
        'sapphire',
        1,
        100000,
      ),
    ).toMatchObject({ level: 1, charged: 5000, balance: 95000 });
    expect(
      rankTracksView(defaultConfig, { bronze: 2, silver: 2, gold: 2 }, 100000).tracks.find(
        (track) => track.id === 'ruby',
      )?.blocked,
    ).toBe('prerequisites');
  });
  it('rejects poor wallets, unknown tracks and invalid progression state', () => {
    expect(() => calculateRankTrackPurchase(defaultConfig, {}, 'bronze', 1, 499)).toThrow(
      'enough gems',
    );
    expect(() => calculateRankTrackPurchase(defaultConfig, {}, 'forged', 1, 1000)).toThrow(
      'does not exist',
    );
    expect(() => applyRankTrackBenefits(defaultConfig, { bronze: 5 })).toThrow('incompatible');
  });
  it('does not make recycling ordinary cards a profitable endless loop at maximum default ranks', () => {
    const levels = Object.fromEntries(
      defaultConfig.rankTracks.tracks.map((track) => [track.id, track.levels.length]),
    );
    const effective = applyRankTrackBenefits(defaultConfig, levels);
    expect(effective.recycleRewards.common).toBeLessThan(effective.packPrice);
  });
  it('rejects prerequisite cycles and descending costs or benefits', () => {
    const rules = structuredClone(defaultConfig.rankTracks);
    rules.tracks[0].requires = [{ trackId: 'emerald', level: 1 }];
    expect(() => rankTracksSchema.parse(rules)).toThrow('cycle');
    const costs = structuredClone(defaultConfig.rankTracks);
    costs.tracks[0].levels[1].cost = costs.tracks[0].levels[0].cost;
    expect(() => rankTracksSchema.parse(costs)).toThrow('cost more');
  });
});
