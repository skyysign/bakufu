import type { RealmConfig, RankTrackBenefits } from '../../config/src/index';
import { GameError } from './errors';

export type RankTrackLevels = Record<string, number>;
export const emptyTrackBenefits: RankTrackBenefits = {
  packDiscount: 0,
  recycleBonus: 0,
  wishlistSlots: 0,
  cooldownReductionSeconds: 0,
};
export function rankTrackBenefits(config: RealmConfig, levels: RankTrackLevels): RankTrackBenefits {
  const result = { ...emptyTrackBenefits };
  for (const [id, level] of Object.entries(levels)) {
    const track = config.rankTracks?.tracks.find((entry) => entry.id === id);
    if (
      !Number.isInteger(level) ||
      level < 0 ||
      !track ||
      level > track.levels.length ||
      (level > 0 && !config.rankTracks.enabled)
    )
      throw new GameError(
        'INVALID_RANK_TRACK',
        'Your rank progression is incompatible with this realm. Contact an administrator.',
        409,
      );
    if (level === 0) continue;
    const benefits = track.levels[level - 1].benefits;
    for (const key of Object.keys(result) as (keyof RankTrackBenefits)[])
      result[key] += benefits[key];
  }
  return result;
}
export function rankTracksView(config: RealmConfig, levels: RankTrackLevels, balance: number) {
  const benefits = rankTrackBenefits(config, levels);
  const tracks = (config.rankTracks?.tracks ?? []).map((track) => {
    const level = levels[track.id] ?? 0;
    const unmet = track.requires
      .filter((rule) => (levels[rule.trackId] ?? 0) < rule.level)
      .map((rule) => ({
        ...rule,
        name: config.rankTracks.tracks.find((entry) => entry.id === rule.trackId)!.name,
        currentLevel: levels[rule.trackId] ?? 0,
      }));
    const next = track.levels[level] ? { ...track.levels[level], level: level + 1 } : null;
    return {
      ...track,
      level,
      maxLevel: track.levels.length,
      benefits: level ? track.levels[level - 1].benefits : { ...emptyTrackBenefits },
      unmet,
      next,
      blocked: !config.rankTracks.enabled
        ? ('disabled' as const)
        : !next
          ? ('max_level' as const)
          : unmet.length
            ? ('prerequisites' as const)
            : balance < next.cost
              ? ('gems' as const)
              : null,
    };
  });
  return { enabled: config.rankTracks?.enabled ?? false, levels: { ...levels }, benefits, tracks };
}
export function applyRankTrackBenefits(config: RealmConfig, levels: RankTrackLevels): RealmConfig {
  const benefits = rankTrackBenefits(config, levels);
  return {
    ...config,
    packPrice: Math.max(0, config.packPrice - benefits.packDiscount),
    recycleRewards: Object.fromEntries(
      Object.entries(config.recycleRewards).map(([tier, value]) => [
        tier,
        Math.min(1_000_000, value + benefits.recycleBonus),
      ]),
    ) as RealmConfig['recycleRewards'],
    wishlist: {
      ...config.wishlist,
      slots: Math.min(20, config.wishlist.slots + benefits.wishlistSlots),
    },
    cooldownSeconds: Math.max(0, config.cooldownSeconds - benefits.cooldownReductionSeconds),
  };
}
export type RankTracksView = ReturnType<typeof rankTracksView>;
export function calculateRankTrackPurchase(
  config: RealmConfig,
  levels: RankTrackLevels,
  trackId: string,
  targetLevel: number,
  balance: number,
) {
  if (!Number.isInteger(balance) || balance < 0 || balance > 2_147_483_647)
    throw new GameError('WALLET_LIMIT', 'Your wallet is outside the supported range.', 409);
  const view = rankTracksView(config, levels, balance);
  if (!view.enabled)
    throw new GameError('RANK_TRACKS_DISABLED', 'Rank progression is disabled in this realm.', 409);
  const track = view.tracks.find((entry) => entry.id === trackId);
  if (!track)
    throw new GameError('RANK_TRACK_NOT_FOUND', 'This collector rank does not exist.', 404);
  if (!track.next)
    throw new GameError('RANK_TRACK_MAXED', 'This rank is at its highest level.', 409);
  if (targetLevel !== track.next.level)
    throw new GameError('RANK_TRACK_CONFLICT', 'Buy the next level of this rank in order.', 409);
  if (track.unmet.length)
    throw new GameError(
      'RANK_PREREQUISITES',
      'Improve the required ranks before unlocking this rank.',
      409,
    );
  if (balance < track.next.cost)
    throw new GameError(
      'INSUFFICIENT_GEMS',
      'You do not have enough gems for this rank level.',
      409,
    );
  return {
    trackId,
    name: track.name,
    level: targetLevel,
    charged: track.next.cost,
    balance: balance - track.next.cost,
    levelsBefore: Object.fromEntries(
      Object.entries(levels)
        .filter(([, value]) => value > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    trackBenefits: track.next.benefits,
    benefits: rankTrackBenefits(config, { ...levels, [trackId]: targetLevel }),
  };
}
export type RankTrackResult = ReturnType<typeof calculateRankTrackPurchase> & {
  ok: true;
  purchaseId: string;
  purchasedAt: string;
};
