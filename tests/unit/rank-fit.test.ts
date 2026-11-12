import { describe, expect, it } from 'vitest';
import {
  defaultConfig,
  defaultRankTracks,
  fitRankTracks,
  rankTracksSchema,
  recommendedRankTracks,
  type RankTracksConfig,
} from '../../packages/config/src/index';
import { realmSettingsImpact } from '../../packages/core/src/index';
import { applyRankTrackBenefits, rankTrackBenefits } from '../../packages/core/src/rank-tracks';

const basis = (packPrice: number, cooldownSeconds: number, common = 30) => ({
  packPrice,
  cooldownSeconds,
  recycleRewards: { common, uncommon: common * 2, rare: common * 4 },
});
const track = (tracks: RankTracksConfig, id: string) => tracks.tracks.find((t) => t.id === id)!;
const column = (tracks: RankTracksConfig, id: string, key: string) =>
  track(tracks, id).levels.map((level) =>
    key === 'cost' ? level.cost : level.benefits[key as keyof typeof level.benefits],
  );

describe('recommended collector ranks follow the realm rules', () => {
  it('keeps the original numbers for a 200-gem pack and 30-gem commons, without a cooldown', () => {
    expect(defaultConfig.rankTracks).toEqual(defaultRankTracks);
    expect(column(defaultRankTracks, 'bronze', 'cost')).toEqual([500, 1500, 3000, 6000]);
    expect(column(defaultRankTracks, 'bronze', 'packDiscount')).toEqual([10, 20, 30, 40]);
    expect(column(defaultRankTracks, 'silver', 'recycleBonus')).toEqual([2, 4, 6, 8]);
    expect(column(defaultRankTracks, 'gold', 'wishlistSlots')).toEqual([1, 2, 3, 4]);
    expect(column(defaultRankTracks, 'sapphire', 'packDiscount')).toEqual([10, 20, 35, 50]);
    expect(column(defaultRankTracks, 'ruby', 'recycleBonus')).toEqual([4, 8, 12, 20]);
    expect(column(defaultRankTracks, 'emerald', 'cost')).toEqual([10000, 25000, 50000, 100000]);
    // The 6-hour free gem claim gets shorter: Sapphire up to 72 minutes, Emerald
    // up to 1 h 48 min, half the wait together.
    expect(column(defaultRankTracks, 'sapphire', 'gemClaimReductionSeconds')).toEqual([
      18 * 60,
      36 * 60,
      54 * 60,
      72 * 60,
    ]);
    expect(column(defaultRankTracks, 'emerald', 'gemClaimReductionSeconds')).toEqual([
      18 * 60,
      36 * 60,
      72 * 60,
      108 * 60,
    ]);
    for (const id of ['bronze', 'silver', 'gold', 'ruby'])
      expect(column(defaultRankTracks, id, 'gemClaimReductionSeconds')).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    // No cooldown means no cooldown perks.
    for (const t of defaultRankTracks.tracks)
      expect(t.levels.every((level) => level.benefits.cooldownReductionSeconds === 0)).toBe(true);
  });
  it('cuts a 6-hour cooldown by minutes, up to half of it at the top ranks', () => {
    const tracks = recommendedRankTracks(basis(200, 6 * 3600));
    expect(column(tracks, 'sapphire', 'cooldownReductionSeconds')).toEqual([
      18 * 60,
      36 * 60,
      54 * 60,
      72 * 60,
    ]);
    expect(column(tracks, 'emerald', 'cooldownReductionSeconds')).toEqual([
      18 * 60,
      36 * 60,
      72 * 60,
      108 * 60,
    ]);
    const top = tracks.tracks.reduce(
      (sum, t) => sum + t.levels[t.levels.length - 1].benefits.cooldownReductionSeconds,
      0,
    );
    expect(top).toBe(3 * 3600);
  });
  it('counts costs in packs and discounts as a share of the price', () => {
    const tracks = recommendedRankTracks(basis(1000, 0, 100));
    expect(column(tracks, 'bronze', 'cost')).toEqual([2500, 7500, 15000, 30000]);
    expect(column(tracks, 'bronze', 'packDiscount')).toEqual([50, 100, 150, 200]);
    expect(column(tracks, 'silver', 'recycleBonus')).toEqual([7, 13, 20, 27]);
  });
  it('always produces valid ranks, whatever the rules', () => {
    for (const price of [0, 1, 3, 5, 199, 200, 999, 2000, 50_000, 1_000_000])
      for (const cooldown of [0, 1, 30, 59, 61, 600, 21_600, 604_800])
        for (const common of [0, 1, 2, 30, 1_000_000]) {
          const tracks = recommendedRankTracks(basis(price, cooldown, common));
          expect(rankTracksSchema.safeParse(tracks).success).toBe(true);
          const total = tracks.tracks.reduce(
            (sum, t) => sum + t.levels[t.levels.length - 1].benefits.cooldownReductionSeconds,
            0,
          );
          expect(total).toBeLessThanOrEqual(cooldown);
        }
  });
});

describe('free gem claims come sooner with ranks', () => {
  it('cuts the claim interval by a share of it, and none while claims are off', () => {
    const hourly = recommendedRankTracks({ ...basis(200, 0), gemClaimSeconds: 3600 });
    expect(column(hourly, 'sapphire', 'gemClaimReductionSeconds')).toEqual([180, 360, 540, 720]);
    const off = recommendedRankTracks({ ...basis(200, 0), gemClaimSeconds: 0 });
    expect(column(off, 'emerald', 'gemClaimReductionSeconds')).toEqual([0, 0, 0, 0]);
    for (const seconds of [60, 61, 600, 21_600, 2_678_400]) {
      const tracks = recommendedRankTracks({ ...basis(200, 0), gemClaimSeconds: seconds });
      expect(rankTracksSchema.safeParse(tracks).success).toBe(true);
      const total = tracks.tracks.reduce(
        (sum, t) => sum + (t.levels[t.levels.length - 1].benefits.gemClaimReductionSeconds ?? 0),
        0,
      );
      expect(total).toBeLessThanOrEqual(seconds / 2 + 1);
    }
  });
  it('shortens the member’s claim interval, never below a minute', () => {
    const config = { ...defaultConfig, rankTracks: defaultRankTracks };
    const levels = { bronze: 4, silver: 4, gold: 4, sapphire: 4, ruby: 2, emerald: 4 };
    expect(rankTrackBenefits(config, levels).gemClaimReductionSeconds).toBe(3 * 3600);
    expect(applyRankTrackBenefits(config, levels).gemRewards.intervalSeconds).toBe(3 * 3600);
    expect(applyRankTrackBenefits(config, { sapphire: 1 }).gemRewards.intervalSeconds).toBe(
      21_600 - 18 * 60,
    );
    const short = { ...config, gemRewards: { ...config.gemRewards, intervalSeconds: 120 } };
    expect(applyRankTrackBenefits(short, levels).gemRewards.intervalSeconds).toBe(60);
  });
  it('leaves rules without the perk exactly as they were (older purchase receipts)', () => {
    const older: RankTracksConfig = {
      enabled: true,
      tracks: defaultRankTracks.tracks.map((t) => ({
        ...t,
        levels: t.levels.map((level) => {
          const { gemClaimReductionSeconds: _gem, ...benefits } = level.benefits;
          void _gem;
          return { ...level, benefits };
        }),
      })),
    };
    const config = { ...defaultConfig, rankTracks: older };
    expect(rankTrackBenefits(config, { sapphire: 1 })).not.toHaveProperty(
      'gemClaimReductionSeconds',
    );
    expect(applyRankTrackBenefits(config, { sapphire: 1 }).gemRewards).toEqual(config.gemRewards);
    // Fitting such a realm keeps owned levels and adds the perk to the others.
    const fitted = fitRankTracks(
      older,
      { ...basis(200, 0), gemClaimSeconds: 21_600 },
      {
        sapphire: 1,
      },
    );
    expect(rankTracksSchema.safeParse(fitted).success).toBe(true);
    expect(track(fitted, 'sapphire').levels[0]).toEqual(track(older, 'sapphire').levels[0]);
    expect(column(fitted, 'sapphire', 'gemClaimReductionSeconds')).toEqual([
      undefined,
      36 * 60,
      54 * 60,
      72 * 60,
    ]);
  });
});

describe('fitting ranks of a realm where players already bought levels', () => {
  const member = (rankTrackLevels: Record<string, number>) => ({
    balance: 0,
    xp: 0,
    rank: 0,
    wishes: 0,
    rankTrackLevels,
    lastOpenedAt: null,
  });
  const realm = { ...defaultConfig, cooldownSeconds: 6 * 3600 };

  it('keeps owned levels and changes only the rest, which the settings review accepts', () => {
    const owned = { bronze: 2, sapphire: 1 };
    const fitted = fitRankTracks(defaultRankTracks, basis(400, 6 * 3600), owned);
    expect(rankTracksSchema.safeParse(fitted).success).toBe(true);
    const bronze = track(fitted, 'bronze');
    expect(bronze.levels.slice(0, 2)).toEqual(
      track(defaultRankTracks, 'bronze').levels.slice(0, 2),
    );
    // The unowned levels follow the doubled price but never undercut the owned ones.
    expect(bronze.levels[2]).toEqual({
      cost: 6000,
      benefits: {
        packDiscount: 60,
        recycleBonus: 0,
        wishlistSlots: 0,
        cooldownReductionSeconds: 0,
      },
    });
    const sapphire = track(fitted, 'sapphire');
    expect(sapphire.levels[0]).toEqual(track(defaultRankTracks, 'sapphire').levels[0]);
    expect(sapphire.levels[1].benefits.cooldownReductionSeconds).toBe(36 * 60);
    expect(track(fitted, 'silver')).toEqual(
      track(recommendedRankTracks(basis(400, 21_600)), 'silver'),
    );
    const impact = realmSettingsImpact(
      realm,
      { ...realm, packPrice: 400, rankTracks: fitted },
      [member(owned)],
      [],
      Date.now(),
    );
    expect(impact.blockers).toEqual([]);
    expect(impact.changes.map((change) => change.label)).toContain('Collector rank progression');
  });
  it('keeps custom tracks someone owns, and the tracks they require', () => {
    const saved: RankTracksConfig = {
      enabled: true,
      tracks: [
        ...defaultRankTracks.tracks,
        {
          id: 'onyx',
          name: 'Onyx',
          requires: [],
          levels: [
            { cost: 50, benefits: { ...track(defaultRankTracks, 'bronze').levels[0].benefits } },
          ],
        },
        {
          id: 'pearl',
          name: 'Pearl',
          requires: [{ trackId: 'onyx', level: 1 }],
          levels: [
            { cost: 80, benefits: { ...track(defaultRankTracks, 'gold').levels[0].benefits } },
          ],
        },
        {
          id: 'unused',
          name: 'Unused',
          requires: [],
          levels: [
            { cost: 10, benefits: { ...track(defaultRankTracks, 'gold').levels[0].benefits } },
          ],
        },
      ],
    };
    const fitted = fitRankTracks(saved, basis(200, 0), { pearl: 1 });
    expect(fitted.tracks.map((t) => t.id)).toEqual([
      'bronze',
      'silver',
      'gold',
      'sapphire',
      'ruby',
      'emerald',
      'pearl',
      'onyx',
    ]);
    expect(rankTracksSchema.safeParse(fitted).success).toBe(true);
    const impact = realmSettingsImpact(
      { ...defaultConfig, rankTracks: saved },
      { ...defaultConfig, rankTracks: fitted },
      [member({ pearl: 1 })],
      [],
      Date.now(),
    );
    expect(impact.blockers).toEqual([]);
  });
  it('is the plain recommendation when nobody owns a level', () => {
    expect(fitRankTracks(defaultRankTracks, basis(200, 3600), {})).toEqual(
      recommendedRankTracks(basis(200, 3600)),
    );
  });
});
