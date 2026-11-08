import { assertMarketCardsAvailable } from './market';
import { characterValuesForRealm } from './character-values';
import { effectiveMemberConfig } from './rank-track-state';
import { purchasedCollectorRank } from './rank-state';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig, type Tier } from '../../config/src/index';
import { calculateRecycleCredit, GameError, type RecyclingResult } from '../../core/src/index';
import { requireMember } from './game';
import { transaction, type Database } from './connection';
import { requireExpectedRevision } from './settings-revision';
import { releaseExpiredTrades } from './trade-state';
import { reversedRecycling } from './admin-collections';

export async function recycleCard(
  db: Database,
  actorId: string,
  realmId: string,
  cardId: string,
  requestKey: string,
  expectedRevision?: number,
): Promise<RecyclingResult> {
  [actorId, realmId, cardId, requestKey].forEach((value) => z.uuid().parse(value));
  return transaction(db, async (tx) => {
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    const member = await requireMember(tx, realmId, actorId);
    const previous = (
      await tx.query(
        'SELECT card_id,result FROM recyclings WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.card_id !== cardId)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This recycling request key was already used for another card.',
          409,
        );
      return previous.result as RecyclingResult;
    }
    // A recycling an admin later undid still answers retries of its request.
    const undone = await reversedRecycling(tx, realmId, actorId, requestKey);
    if (undone) {
      if (undone.cardId !== cardId)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This recycling request key was already used for another card.',
          409,
        );
      return undone.result as RecyclingResult;
    }
    await requireExpectedRevision(tx, realmId, expectedRevision);
    if (realm.config.schemaVersion >= 6) {
      await releaseExpiredTrades(tx, realmId);
      if (
        (
          await tx.query(
            'SELECT 1 FROM trade_cards WHERE realm_id=$1 AND card_id=$2 AND released_at IS NULL',
            [realmId, cardId],
          )
        ).rowCount
      )
        throw new GameError(
          'CARD_LOCKED',
          'This card is reserved in a trade. Cancel or finish that trade before recycling.',
          409,
        );
    }
    if (realm.config.schemaVersion >= 7) await assertMarketCardsAvailable(tx, realmId, [cardId]);
    const card = (
      await tx.query(
        `SELECT owned.recycled_at,c.id AS character_id,c.name,c.tier
      FROM cards owned JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id
      WHERE owned.realm_id=$1 AND owned.id=$2 AND owned.owner_id=$3`,
        [realmId, cardId, actorId],
      )
    ).rows[0];
    if (!card || card.recycled_at)
      throw new GameError(
        'CARD_UNAVAILABLE',
        'This card is no longer available in your collection. No gems were awarded.',
        404,
      );
    const config = await effectiveMemberConfig(
      tx,
      realmId,
      actorId,
      parseRealmConfig(realm.config),
      realm.config.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, actorId) : 0,
    );
    const baseConfig = parseRealmConfig(realm.config);
    const valuation = baseConfig.characterValues.enabled
      ? (await characterValuesForRealm(tx, realmId, baseConfig, config))[card.character_id]
      : undefined;
    const credit = calculateRecycleCredit(
      card.tier as Tier,
      member.balance,
      config,
      valuation?.recycleValue,
    );
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const result: RecyclingResult = {
      ok: true,
      recyclingId: randomUUID(),
      cardId,
      characterId: card.character_id,
      name: card.name,
      tier: card.tier,
      ...credit,
      recycledAt: now.toISOString(),
      ...(valuation ? { valuation } : {}),
    };
    await tx.query(
      'INSERT INTO recyclings(realm_id,account_id,request_key,id,card_id,result,config_snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [realmId, actorId, requestKey, result.recyclingId, cardId, result, config, now],
    );
    await tx.query('UPDATE cards SET recycled_at=$3 WHERE realm_id=$1 AND id=$2', [
      realmId,
      cardId,
      now,
    ]);
    await tx.query('UPDATE memberships SET balance=$3 WHERE realm_id=$1 AND account_id=$2', [
      realmId,
      actorId,
      result.balance,
    ]);
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'recycling',$7)",
      [
        realmId,
        randomUUID(),
        actorId,
        `recycle:${requestKey}`,
        result.credited,
        result.balance,
        now,
      ],
    );
    return result;
  });
}
