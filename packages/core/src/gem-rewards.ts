import type { RealmConfig } from '../../config/src/index';
import { GameError } from './errors';

export type GemRewardRules = Pick<RealmConfig, 'gemRewards'>;
export function gemRewardView(config: GemRewardRules, lastClaimAt: string | null, now: number) {
  const { enabled, amount, intervalSeconds } = config.gemRewards;
  const last = lastClaimAt === null ? null : Date.parse(lastClaimAt);
  if (!Number.isFinite(now) || (last !== null && !Number.isFinite(last)))
    throw new GameError(
      'INVALID_GEM_REWARD_STATE',
      'Gem reward timing is unavailable. Refresh or contact the realm administrator.',
      409,
    );
  const next = last === null ? null : last + intervalSeconds * 1000;
  return {
    enabled,
    amount,
    intervalSeconds,
    claimable: enabled && (next === null || now >= next),
    lastClaimAt,
    nextClaimAt: next === null ? null : new Date(next).toISOString(),
    serverTime: new Date(now).toISOString(),
  };
}
export type GemRewardView = ReturnType<typeof gemRewardView>;
export function calculateGemReward(
  config: GemRewardRules,
  lastClaimAt: string | null,
  balance: number,
  now: number,
) {
  const view = gemRewardView(config, lastClaimAt, now);
  if (!view.enabled)
    throw new GameError(
      'GEM_REWARDS_DISABLED',
      'Timed gem claims are disabled in this realm.',
      409,
    );
  if (!view.claimable)
    throw new GameError(
      'GEM_REWARD_COOLDOWN',
      `Gems can be claimed again at ${view.nextClaimAt}.`,
      409,
    );
  if (!Number.isInteger(balance) || balance < 0 || balance > 2147483647 - view.amount)
    throw new GameError(
      'WALLET_LIMIT',
      'Your wallet cannot receive this reward. Spend some gems before claiming.',
      409,
    );
  return {
    amount: view.amount,
    balance: balance + view.amount,
    claimedAt: new Date(now).toISOString(),
    nextClaimAt: new Date(now + view.intervalSeconds * 1000).toISOString(),
  };
}
export type GemRewardResult = ReturnType<typeof calculateGemReward> & { ok: true; claimId: string };
