import { z } from 'zod';

export const gemRewardsSchema = z.strictObject({
  enabled: z.boolean(),
  amount: z.number().int().min(1).max(1_000_000),
  intervalSeconds: z.number().int().min(60).max(2_678_400),
});
export type GemRewardsConfig = z.infer<typeof gemRewardsSchema>;
export const defaultGemRewards: GemRewardsConfig = {
  enabled: true,
  amount: 25,
  intervalSeconds: 21600,
};
// Upgrades never silently introduce a new currency faucet into an existing realm.
export const disabledGemRewards: GemRewardsConfig = { ...defaultGemRewards, enabled: false };
