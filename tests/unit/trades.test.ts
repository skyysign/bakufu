import { describe, expect, it } from 'vitest';
import {
  defaultTrading,
  parseRealmConfig,
  disabledCollectorRanks,
  disabledGemRewards,
} from '../../packages/config/src/index';
import { defaultConfig, legacyRules } from '../support/prototype-config';
import {
  requireTradeVersion,
  tradeBalances,
  tradeStatusAt,
  validateTradePair,
} from '../../packages/core/src/index';
const card = { cardIds: ['card-a'], gems: 0 },
  empty = { cardIds: [], gems: 0 };
describe('two-party trade rules', () => {
  it('migrates v5 rules without changing prior gameplay values', () => {
    const { trading, ranks, gemRewards, ...v5 } = defaultConfig;
    expect(trading).toEqual(defaultTrading);
    expect(gemRewards).toEqual(defaultConfig.gemRewards);
    expect(ranks).toEqual(defaultConfig.ranks);
    expect(parseRealmConfig({ ...legacyRules(v5), schemaVersion: 5, packPrice: 7 })).toEqual({
      ...defaultConfig,
      ranks: disabledCollectorRanks,
      gemRewards: disabledGemRewards,
      packPrice: 7,
    });
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 5 })).toThrow();
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 999 })).toThrow();
  });
  it('accepts gifts, card swaps and gem offers but rejects an empty trade', () => {
    expect(() => validateTradePair(card, empty, defaultTrading)).not.toThrow();
    expect(() =>
      validateTradePair(card, { cardIds: ['card-b'], gems: 10 }, defaultTrading),
    ).not.toThrow();
    expect(() => validateTradePair({ cardIds: [], gems: 1 }, empty, defaultTrading)).not.toThrow();
    expect(() => validateTradePair(empty, empty, defaultTrading)).toThrow('at least one');
  });
  it('requires distinct cards and integer amounts within saved trade limits', () => {
    for (const offer of [
      { cardIds: ['a', 'a'], gems: 0 },
      { cardIds: Array.from({ length: 6 }, (_, i) => String(i)), gems: 0 },
      { cardIds: [], gems: -1 },
      { cardIds: [], gems: 0.5 },
      { cardIds: [], gems: 1_000_001 },
    ])
      expect(() => validateTradePair(offer, card, defaultTrading)).toThrow();
    expect(() =>
      validateTradePair({ cardIds: [], gems: 1 }, card, { ...defaultTrading, maxGemsPerSide: 0 }),
    ).toThrow();
  });
  it('conserves gems and does not use incoming gems to fund an unfunded offer', () => {
    const a = { cardIds: [], gems: 10 },
      b = { cardIds: [], gems: 4 };
    expect(tradeBalances(20, 30, a, b)).toEqual({ aAfter: 14, bAfter: 36, aDelta: -6, bDelta: 6 });
    expect(() => tradeBalances(0, 100, a, { cardIds: [], gems: 20 })).toThrow('offered gems');
    expect(tradeBalances(0, 0, card, empty)).toEqual({
      aAfter: 0,
      bAfter: 0,
      aDelta: 0,
      bDelta: 0,
    });
  });
  it('rejects wallet overflow before any transfer', () => {
    expect(() => tradeBalances(100, 2_147_483_647, { cardIds: [], gems: 1 }, empty)).toThrow(
      'incoming gems',
    );
    expect(tradeBalances(1, 2_147_483_646, { cardIds: [], gems: 1 }, empty).bAfter).toBe(
      2_147_483_647,
    );
  });
  it('allows only pending offers with the exact reviewed version', () => {
    expect(() => requireTradeVersion('pending', 2, 2)).not.toThrow();
    expect(() => requireTradeVersion('pending', 2, 1)).toThrow('offer changed');
    for (const status of ['completed', 'cancelled', 'expired'] as const)
      expect(() => requireTradeVersion(status, 2, 2)).toThrow('closed');
  });
  it('expires exactly at the fixed deadline without a scheduler', () => {
    const expiry = '2026-11-05T12:00:00Z',
      time = Date.parse(expiry);
    expect(tradeStatusAt('pending', expiry, time - 1)).toBe('pending');
    expect(tradeStatusAt('pending', expiry, time)).toBe('expired');
    expect(tradeStatusAt('completed', expiry, time + 1)).toBe('completed');
    for (const value of [
      { ...defaultTrading, maxCardsPerSide: 0 },
      { ...defaultTrading, expiresAfterMinutes: 4 },
      { ...defaultTrading, maxPendingPerPlayer: 51 },
    ])
      expect(() => parseRealmConfig({ ...defaultConfig, trading: value })).toThrow();
  });
});
