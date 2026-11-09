import type { RealmConfig } from '../../config/src/index';
import { GameError } from './errors';
export type TradeRules = RealmConfig['trading'];
export type TradeOffer = { cardIds: string[]; gems: number };
export type TradeStatus = 'pending' | 'completed' | 'cancelled' | 'expired';
export type TradeResult = {
  ok: true;
  tradeId: string;
  version: number;
  status: TradeStatus;
  message: string;
};
export type TradeCard = {
  cardId: string;
  characterId: string;
  name: string;
  tier: import('../../config/src/index').Tier;
};
export type TradeView = {
  id: string;
  version: number;
  /** 1: each player edits their own side; 2: proposals with both sides (see trades service). */
  protocol: 1 | 2;
  /** Whether this player wrote the current version. */
  changedByMe: boolean;
  status: TradeStatus;
  counterpartyCode: string;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  rules: TradeRules;
  myOffer: { cards: TradeCard[]; gems: number };
  theirOffer: { cards: TradeCard[]; gems: number };
  myConfirmed: boolean;
  theirConfirmed: boolean;
};
export function validateTradeOffer(offer: TradeOffer, rules: TradeRules) {
  if (!Number.isInteger(offer.gems) || offer.gems < 0 || offer.gems > rules.maxGemsPerSide)
    throw new GameError('INVALID_TRADE', 'The gem offer is outside this trade’s limits.');
  if (
    offer.cardIds.length > rules.maxCardsPerSide ||
    new Set(offer.cardIds).size !== offer.cardIds.length
  )
    throw new GameError('INVALID_TRADE', 'Choose distinct cards within this trade’s card limit.');
}
export function validateTradePair(a: TradeOffer, b: TradeOffer, rules: TradeRules) {
  validateTradeOffer(a, rules);
  validateTradeOffer(b, rules);
  if (!a.cardIds.length && !b.cardIds.length && !a.gems && !b.gems)
    throw new GameError('EMPTY_TRADE', 'A trade must offer at least one card or gem.');
}
export function tradeBalances(aBalance: number, bBalance: number, a: TradeOffer, b: TradeOffer) {
  if (aBalance < a.gems || bBalance < b.gems)
    throw new GameError(
      'INSUFFICIENT_GEMS',
      'A participant no longer has the offered gems. No assets were transferred.',
      409,
    );
  const aAfter = aBalance - a.gems + b.gems,
    bAfter = bBalance - b.gems + a.gems;
  if (aAfter > 2_147_483_647 || bAfter > 2_147_483_647)
    throw new GameError(
      'WALLET_LIMIT',
      'A participant cannot hold the incoming gems. No assets were transferred.',
      409,
    );
  return { aAfter, bAfter, aDelta: b.gems - a.gems, bDelta: a.gems - b.gems };
}
export function requireTradeVersion(status: TradeStatus, current: number, expected: number) {
  if (status !== 'pending')
    throw new GameError('TRADE_CLOSED', 'This trade is already closed.', 409);
  if (current !== expected)
    throw new GameError(
      'TRADE_CHANGED',
      'The offer changed. Refresh and review it before acting.',
      409,
    );
}
export function tradeStatusAt(status: TradeStatus, expiresAt: string, now: number): TradeStatus {
  return status === 'pending' && Date.parse(expiresAt) <= now ? 'expired' : status;
}
