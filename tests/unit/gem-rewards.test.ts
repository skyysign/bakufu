import { describe, expect, it } from 'vitest';
import {
  defaultGemRewards,
  disabledGemRewards,
  parseRealmConfig,
  gemRewardsSchema,
} from '../../packages/config/src/index';
import { defaultConfig, legacyRules } from '../support/prototype-config';
import { calculateGemReward, gemRewardView } from '../../packages/core/src/gem-rewards';
const time = Date.parse('2026-11-04T12:00:00.000Z');
describe('timed gem reward rules', () => {
  it('migrates v7 without activating income or changing purchased rank rules', () => {
    const { gemRewards, ...v7 } = defaultConfig;
    expect(gemRewards).toEqual(defaultGemRewards);
    expect(parseRealmConfig({ ...legacyRules(v7), schemaVersion: 7 })).toEqual({
      ...defaultConfig,
      gemRewards: disabledGemRewards,
    });
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 7 })).toThrow();
  });
  it('permits first claim immediately and exact six-hour boundary, with no accumulation', () => {
    expect(gemRewardView(defaultConfig, null, time)).toMatchObject({
      claimable: true,
      nextClaimAt: null,
      amount: 25,
      intervalSeconds: 21600,
    });
    const first = calculateGemReward(defaultConfig, null, 100, time);
    expect(first).toEqual({
      amount: 25,
      balance: 125,
      claimedAt: '2026-11-04T12:00:00.000Z',
      nextClaimAt: '2026-11-04T18:00:00.000Z',
    });
    expect(gemRewardView(defaultConfig, first.claimedAt, time + 21600000 - 1).claimable).toBe(
      false,
    );
    expect(gemRewardView(defaultConfig, first.claimedAt, time + 21600000).claimable).toBe(true);
    expect(
      calculateGemReward(defaultConfig, first.claimedAt, 125, time + 30 * 21600000).amount,
    ).toBe(25);
  });
  it('uses current reviewed interval/amount without changing prior receipts', () => {
    const last = '2026-11-04T12:00:00.000Z',
      changed = { gemRewards: { enabled: true, amount: 40, intervalSeconds: 7200 } };
    expect(gemRewardView(changed, last, time + 7200000)).toMatchObject({
      claimable: true,
      nextClaimAt: '2026-11-04T14:00:00.000Z',
    });
    expect(calculateGemReward(changed, last, 10, time + 7200000)).toMatchObject({
      amount: 40,
      balance: 50,
      nextClaimAt: '2026-11-04T16:00:00.000Z',
    });
  });
  it('rejects disabled claims, cooldown, invalid clocks and wallet overflow deterministically', () => {
    expect(() => calculateGemReward({ gemRewards: disabledGemRewards }, null, 100, time)).toThrow(
      'disabled',
    );
    expect(() =>
      calculateGemReward(defaultConfig, new Date(time).toISOString(), 100, time),
    ).toThrow('claimed again');
    for (const balance of [-1, 0.5, 2147483623, 2147483648])
      expect(() => calculateGemReward(defaultConfig, null, balance, time)).toThrow('wallet');
    expect(calculateGemReward(defaultConfig, null, 2147483622, time).balance).toBe(2147483647);
    expect(() => gemRewardView(defaultConfig, 'not-a-date', time)).toThrow('timing');
  });
  it('validates bounded configurable amounts and time frames with strict keys', () => {
    for (const value of [
      { ...defaultGemRewards, amount: 0 },
      { ...defaultGemRewards, amount: 1000001 },
      { ...defaultGemRewards, intervalSeconds: 59 },
      { ...defaultGemRewards, intervalSeconds: 2678401 },
      { ...defaultGemRewards, extra: true },
    ])
      expect(() => gemRewardsSchema.parse(value)).toThrow();
    expect(
      gemRewardsSchema.parse({ ...defaultGemRewards, amount: 1, intervalSeconds: 60 }),
    ).toMatchObject({ amount: 1, intervalSeconds: 60 });
  });
});
