import {
  tradeStatusAt,
  type TradeCard,
  type TradeOffer,
  type TradeView,
  type TradeStatus,
} from '../../core/src/index';
import { parseRealmConfig } from '../../config/src/index';
import type { Transaction } from './connection';

export async function releaseExpiredTrades(tx: Transaction, realmId: string) {
  await tx.query(
    `WITH expired AS (UPDATE trades SET status='expired',updated_at=clock_timestamp()
    WHERE realm_id=$1 AND status='pending' AND expires_at<=clock_timestamp() RETURNING id)
    UPDATE trade_cards SET released_at=clock_timestamp() WHERE realm_id=$1 AND released_at IS NULL AND trade_id IN(SELECT id FROM expired)`,
    [realmId],
  );
}
export async function tradeViews(
  tx: Transaction,
  realmId: string,
  actorId: string,
  limit: number | null = 100,
): Promise<TradeView[]> {
  const rows = (
    await tx.query(
      `SELECT t.*,v.creator_offer,v.counterparty_offer,v.changed_by,a.trade_code AS creator_code,b.trade_code AS counterparty_code,
    ARRAY(SELECT account_id FROM trade_confirmations c WHERE c.realm_id=t.realm_id AND c.trade_id=t.id AND c.version=t.offer_version) AS confirmed
    FROM trades t JOIN trade_versions v ON v.realm_id=t.realm_id AND v.trade_id=t.id AND v.version=t.offer_version
    JOIN memberships a ON a.realm_id=t.realm_id AND a.account_id=t.creator_id
    JOIN memberships b ON b.realm_id=t.realm_id AND b.account_id=t.counterparty_id
    WHERE t.realm_id=$1 AND (t.creator_id=$2 OR t.counterparty_id=$2)
    ORDER BY (t.status='pending' AND t.expires_at>clock_timestamp()) DESC,t.updated_at DESC,t.id LIMIT $3::integer`,
      [realmId, actorId, limit],
    )
  ).rows;
  const ids = [
    ...new Set(
      rows.flatMap((row) => [...row.creator_offer.cardIds, ...row.counterparty_offer.cardIds]),
    ),
  ];
  const cards = (
    await tx.query(
      `SELECT c.id AS "cardId",c.character_id AS "characterId",d.name,d.tier FROM cards c JOIN characters d ON d.realm_id=c.realm_id AND d.id=c.character_id WHERE c.realm_id=$1 AND c.id=ANY($2::uuid[])`,
      [realmId, ids],
    )
  ).rows as TradeCard[];
  const byId = new Map(cards.map((card) => [card.cardId, card]));
  const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
  return rows.map((row) => {
    const mine = row.creator_id === actorId,
      offer = (value: TradeOffer) => ({
        cards: value.cardIds.map((id) => byId.get(id)!),
        gems: value.gems,
      });
    return {
      id: row.id,
      version: row.offer_version,
      protocol: row.protocol === 2 ? 2 : 1,
      changedByMe: row.changed_by === actorId,
      status: tradeStatusAt(row.status as TradeStatus, row.expires_at.toISOString(), now.getTime()),
      counterpartyCode: mine ? row.counterparty_code : row.creator_code,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
      rules: parseRealmConfig(row.config_snapshot).trading,
      myOffer: offer(mine ? row.creator_offer : row.counterparty_offer),
      theirOffer: offer(mine ? row.counterparty_offer : row.creator_offer),
      myConfirmed: row.confirmed.includes(actorId),
      theirConfirmed: row.confirmed.includes(mine ? row.counterparty_id : row.creator_id),
    };
  });
}
