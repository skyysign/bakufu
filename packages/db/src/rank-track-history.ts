import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { rankTracksSchema, type RealmConfig, type RankTracksConfig } from '../../config/src/index';
import { calculateRankTrackPurchase, type RankTrackLevels } from '../../core/src/rank-tracks';

const levelsSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  z.number().int().min(1).max(10),
);
const benefitsSchema = z.strictObject({
  packDiscount: z.number().int().nonnegative(),
  recycleBonus: z.number().int().nonnegative(),
  wishlistSlots: z.number().int().nonnegative(),
  cooldownReductionSeconds: z.number().int().nonnegative(),
  gemClaimReductionSeconds: z.number().int().nonnegative().optional(),
});
export const rankTrackReceiptSchema = z.strictObject({
  ok: z.literal(true),
  purchaseId: z.uuid(),
  requestKey: z.uuid(),
  trackId: z.string(),
  name: z.string(),
  level: z.number().int().positive(),
  charged: z.number().int().positive(),
  balance: z.number().int().nonnegative(),
  levelsBefore: levelsSchema,
  trackBenefits: benefitsSchema,
  benefits: benefitsSchema,
  purchasedAt: z.iso.datetime(),
  rules: rankTracksSchema,
});
export const rankTrackLevelsSchema = levelsSchema;
export function validateRankTrackHistory(
  rules: RankTracksConfig,
  levels: RankTrackLevels,
  purchases: z.infer<typeof rankTrackReceiptSchema>[],
  ledger: {
    operationKey: string;
    reason: string;
    amount: number;
    balanceAfter: number;
    createdAt: string;
  }[],
) {
  const current: RankTrackLevels = {},
    ids = new Set<string>(),
    keys = new Set<string>();
  let previousTime = -Infinity;
  for (const receipt of purchases) {
    const config = { rankTracks: receipt.rules } as RealmConfig;
    const quote = calculateRankTrackPurchase(
      config,
      current,
      receipt.trackId,
      receipt.level,
      receipt.balance + receipt.charged,
    );
    const { ok, purchaseId, requestKey, purchasedAt, rules: snapshot, ...actual } = receipt;
    const savedTrack = snapshot.tracks.find((track) => track.id === receipt.trackId),
      liveTrack = rules.tracks.find((track) => track.id === receipt.trackId);
    if (
      !ok ||
      ids.has(purchaseId) ||
      keys.has(requestKey) ||
      Date.parse(purchasedAt) < previousTime ||
      !isDeepStrictEqual(actual, quote) ||
      !rules.enabled ||
      !liveTrack ||
      savedTrack?.name !== liveTrack.name ||
      !isDeepStrictEqual(savedTrack?.requires, liveTrack.requires) ||
      !isDeepStrictEqual(savedTrack?.levels[receipt.level - 1], liveTrack.levels[receipt.level - 1])
    )
      throw new Error('Collector rank progression receipt is invalid.');
    if (
      !ledger.some(
        (entry) =>
          entry.operationKey === `rank-track:${requestKey}` &&
          entry.reason === 'rank_track_purchase' &&
          entry.amount === -receipt.charged &&
          entry.balanceAfter === receipt.balance &&
          entry.createdAt === purchasedAt,
      )
    )
      throw new Error('Collector rank progression wallet entry is missing.');
    current[receipt.trackId] = receipt.level;
    ids.add(purchaseId);
    keys.add(requestKey);
    previousTime = Date.parse(purchasedAt);
  }
  if (
    !isDeepStrictEqual(
      Object.fromEntries(Object.entries(current).sort()),
      Object.fromEntries(Object.entries(levels).sort()),
    )
  )
    throw new Error('Collector rank progression levels do not match purchases.');
  if (
    ledger.some(
      (entry) =>
        entry.reason === 'rank_track_purchase' &&
        !purchases.some((receipt) => entry.operationKey === `rank-track:${receipt.requestKey}`),
    )
  )
    throw new Error('Collector rank progression wallet entry has no receipt.');
}
