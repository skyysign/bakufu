import type { RealmConfig, CollectorRankRule } from '../../config/src/index';
import { GameError } from './errors';
import { rankTrackBenefits, type RankTrackLevels } from './rank-tracks';

export type RankBenefits = Pick<
  CollectorRankRule,
  'packDiscount' | 'recycleBonus' | 'wishlistSlots' | 'cooldownReductionSeconds'
>;
const noBenefits: RankBenefits = {
  packDiscount: 0,
  recycleBonus: 0,
  wishlistSlots: 0,
  cooldownReductionSeconds: 0,
};
export function rankBenefits(config: RealmConfig, rank: number): RankBenefits {
  if (
    !Number.isInteger(rank) ||
    rank < 0 ||
    rank > config.ranks.levels.length ||
    (rank > 0 && !config.ranks.enabled)
  )
    throw new GameError(
      'INVALID_COLLECTOR_RANK',
      'Your collector rank is incompatible with this realm. Contact a realm administrator.',
      409,
    );
  if (rank === 0) return { ...noBenefits };
  const { packDiscount, recycleBonus, wishlistSlots, cooldownReductionSeconds } =
    config.ranks.levels[rank - 1];
  return { packDiscount, recycleBonus, wishlistSlots, cooldownReductionSeconds };
}
export function applyRankBenefits(config: RealmConfig, rank: number, tracks: RankTrackLevels = {}): RealmConfig {
  const legacy = rankBenefits(config, rank);
  const trackBenefits = rankTrackBenefits(config, tracks);
  const benefits = Object.fromEntries((Object.keys(legacy) as (keyof RankBenefits)[]).map((key) => [key, legacy[key] + trackBenefits[key]])) as RankBenefits;
  return {
    ...config,
    packPrice: Math.max(0, config.packPrice - benefits.packDiscount),
    recycleRewards: Object.fromEntries(Object.entries(config.recycleRewards).map(([tier, value]) => [tier, Math.min(1_000_000, value + benefits.recycleBonus)])) as RealmConfig['recycleRewards'],
    wishlist: {
      ...config.wishlist,
      slots: Math.min(20, config.wishlist.slots + benefits.wishlistSlots),
    },
    cooldownSeconds: Math.max(0, config.cooldownSeconds - benefits.cooldownReductionSeconds),
  };
}
export function collectorRankView(config: RealmConfig, rank: number, balance: number) {
  const benefits = rankBenefits(config, rank);
  const levels = config.ranks.levels.map((level, index) => ({
    ...level,
    rank: index + 1,
    status: (index < rank
      ? 'owned'
      : index === rank && config.ranks.enabled
        ? 'available'
        : 'locked') as 'owned' | 'available' | 'locked',
  }));
  const next = config.ranks.enabled ? (levels[rank] ?? null) : null;
  const blocked = !config.ranks.enabled
    ? ('disabled' as const)
    : !next
      ? ('max_rank' as const)
      : balance < next.cost
        ? ('gems' as const)
        : null;
  return {
    enabled: config.ranks.enabled,
    rank,
    maxRank: levels.length,
    name: config.ranks.levels[rank - 1]?.name ?? 'Unranked',
    benefits,
    levels,
    next,
    blocked,
  };
}
export type CollectorRankView = ReturnType<typeof collectorRankView>;
export function calculateRankPurchase(
  config: RealmConfig,
  currentRank: number,
  targetRank: number,
  balance: number,
) {
  if (!Number.isInteger(balance) || balance < 0 || balance > 2_147_483_647)
    throw new GameError(
      'WALLET_LIMIT',
      'Your wallet is outside the supported range. No rank was purchased.',
      409,
    );
  const view = collectorRankView(config, currentRank, balance);
  if (!config.ranks.enabled)
    throw new GameError('RANKS_DISABLED', 'Collector ranks are disabled in this realm.', 409);
  if (!view.next)
    throw new GameError('RANK_MAXED', 'All available collector ranks are already owned.', 409);
  if (targetRank !== view.next.rank)
    throw new GameError(
      'RANK_CONFLICT',
      'Buy the next collector rank in order. Refresh before choosing a rank.',
      409,
    );
  if (view.blocked === 'gems')
    throw new GameError(
      'INSUFFICIENT_GEMS',
      'You do not have enough gems for this collector rank.',
      409,
    );
  return {
    rank: targetRank,
    name: view.next.name,
    charged: view.next.cost,
    balance: balance - view.next.cost,
    benefits: rankBenefits(config, targetRank),
  };
}
export type CollectorRankResult = ReturnType<typeof calculateRankPurchase> & {
  ok: true;
  purchaseId: string;
  purchasedAt: string;
};
