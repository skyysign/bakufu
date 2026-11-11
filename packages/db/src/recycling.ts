import { assertMarketCardsAvailable } from './market';
import { characterValuesForRealm } from './character-values';
import { effectiveMemberConfig } from './rank-track-state';
import { purchasedCollectorRank } from './rank-state';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  parseRealmConfig,
  recycleNeedsConfirmation,
  type RealmConfig,
  type Tier,
} from '../../config/src/index';
import {
  calculateRecycleCredit,
  GameError,
  type CharacterValue,
  type RecyclingResult,
} from '../../core/src/index';
import { requireMember } from './game';
import { transaction, type Database, type Transaction } from './connection';
import { requireExpectedRevision } from './settings-revision';
import { releaseExpiredTrades } from './trade-state';
import { reversedRecycling } from './admin-collections';

/** Cards one batch recycling may include (a 10-pack opening of 5-card packs). */
export const recycleBatchLimit = 50;

type RecycleRules = {
  /** The member's rules including rank recycle bonuses (saved as the snapshot). */
  config: RealmConfig;
  values: Record<string, CharacterValue> | null;
};

/** The member's recycling rules and current character values, computed once. */
export async function recycleRules(
  tx: Transaction,
  realmId: string,
  ownerId: string,
  rawConfig: { schemaVersion: number },
): Promise<RecycleRules> {
  const baseConfig = parseRealmConfig(rawConfig);
  const config = await effectiveMemberConfig(
    tx,
    realmId,
    ownerId,
    baseConfig,
    rawConfig.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, ownerId) : 0,
  );
  return {
    config,
    values: baseConfig.characterValues.enabled
      ? await characterValuesForRealm(tx, realmId, baseConfig, config)
      : null,
  };
}

/**
 * Recycles one card the owner holds, inside the caller's transaction (realm
 * locked, expired trades released): credits its value, journals the
 * recycling and ledger entry and frees the character. With the realm's
 * recycling safeguard on, an epic or legendary card needs `confirmed` (a
 * single recycling the player confirmed); bulk recyclings never pass it.
 */
export async function recycleOwnedCard(
  tx: Transaction,
  realmId: string,
  ownerId: string,
  cardId: string,
  requestKey: string,
  rules: RecycleRules,
  balance: number,
  schemaVersion: number,
  confirmed = false,
): Promise<RecyclingResult> {
  if (schemaVersion >= 6) {
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
  if (schemaVersion >= 7) await assertMarketCardsAvailable(tx, realmId, [cardId]);
  const card = (
    await tx.query(
      `SELECT owned.recycled_at,c.id AS character_id,c.name,c.tier
      FROM cards owned JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id
      WHERE owned.realm_id=$1 AND owned.id=$2 AND owned.owner_id=$3`,
      [realmId, cardId, ownerId],
    )
  ).rows[0];
  if (!card || card.recycled_at)
    throw new GameError(
      'CARD_UNAVAILABLE',
      'This card is no longer available in your collection. No gems were awarded.',
      404,
    );
  if (!confirmed && recycleNeedsConfirmation(rules.config, card.tier as Tier))
    throw new GameError(
      'RECYCLE_CONFIRMATION_REQUIRED',
      `${card.name} is ${card.tier}: this realm protects epic and legendary cards. Recycle it on its own and confirm. Nothing was recycled.`,
      409,
    );
  const valuation = rules.values?.[card.character_id];
  const credit = calculateRecycleCredit(
    card.tier as Tier,
    balance,
    rules.config,
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
    [realmId, ownerId, requestKey, result.recyclingId, cardId, result, rules.config, now],
  );
  await tx.query('UPDATE cards SET recycled_at=$3 WHERE realm_id=$1 AND id=$2', [
    realmId,
    cardId,
    now,
  ]);
  await tx.query('UPDATE memberships SET balance=$3 WHERE realm_id=$1 AND account_id=$2', [
    realmId,
    ownerId,
    result.balance,
  ]);
  await tx.query(
    "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'recycling',$7)",
    [realmId, randomUUID(), ownerId, `recycle:${requestKey}`, result.credited, result.balance, now],
  );
  return result;
}

export async function recycleCard(
  db: Database,
  actorId: string,
  realmId: string,
  cardId: string,
  requestKey: string,
  expectedRevision?: number,
  /** The player confirmed recycling an epic or legendary card (safeguard). */
  confirmed = false,
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
    if (realm.config.schemaVersion >= 6) await releaseExpiredTrades(tx, realmId);
    return recycleOwnedCard(
      tx,
      realmId,
      actorId,
      cardId,
      requestKey,
      await recycleRules(tx, realmId, actorId, realm.config),
      member.balance,
      realm.config.schemaVersion,
      confirmed === true,
    );
  });
}

/** Stable per-card request key inside a batch: a retry recycles nothing twice. */
export function batchItemKey(batchKey: string, cardId: string) {
  const bytes = createHash('sha1')
    .update(Buffer.from('6d2f1c0e8b3a4f5e9a7b1c2d3e4f5a6b', 'hex'))
    .update(`${batchKey}:${cardId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type BatchRecyclingResult = {
  ok: true;
  recycled: RecyclingResult[];
  credited: number;
  balance: number;
};
const batchSchema = z.strictObject({
  cardIds: z
    .array(z.uuid())
    .min(1)
    .max(recycleBatchLimit)
    .refine((ids) => new Set(ids).size === ids.length, 'List each card once.'),
  requestKey: z.uuid(),
  expectedRevision: z.number().int().min(0).optional(),
});
/**
 * Recycles several of the member's cards at once (for example every common
 * of an opening). All or nothing: if one card can't be recycled, none is. A
 * retry with the same request key replays the stored results. Cards the
 * recycling safeguard protects are refused: those are recycled one by one.
 */
export async function recycleCards(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<BatchRecyclingResult> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const request = batchSchema.parse(input);
  const keys = request.cardIds.map((cardId) => batchItemKey(request.requestKey, cardId));
  return transaction(db, async (tx) => {
    const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
      .rows[0];
    if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    const member = await requireMember(tx, realmId, actorId);
    const previous = (
      await tx.query(
        'SELECT card_id,request_key,result FROM recyclings WHERE realm_id=$1 AND account_id=$2 AND request_key=ANY($3::uuid[])',
        [realmId, actorId, keys],
      )
    ).rows as { card_id: string; request_key: string; result: RecyclingResult }[];
    if (previous.length) {
      const byKey = new Map(previous.map((row) => [row.request_key, row]));
      if (
        previous.length !== keys.length ||
        keys.some((key, index) => byKey.get(key)?.card_id !== request.cardIds[index])
      )
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This recycling request key was already used for other cards.',
          409,
        );
      const recycled = keys.map((key) => byKey.get(key)!.result);
      return {
        ok: true,
        recycled,
        credited: recycled.reduce((sum, item) => sum + item.credited, 0),
        balance: recycled[recycled.length - 1].balance,
      };
    }
    await requireExpectedRevision(tx, realmId, request.expectedRevision);
    if (realm.config.schemaVersion >= 6) await releaseExpiredTrades(tx, realmId);
    const rules = await recycleRules(tx, realmId, actorId, realm.config);
    let balance = member.balance as number;
    const recycled: RecyclingResult[] = [];
    for (const [index, cardId] of request.cardIds.entries()) {
      const result = await recycleOwnedCard(
        tx,
        realmId,
        actorId,
        cardId,
        keys[index],
        rules,
        balance,
        realm.config.schemaVersion,
      );
      balance = result.balance;
      recycled.push(result);
    }
    return {
      ok: true,
      recycled,
      credited: recycled.reduce((sum, item) => sum + item.credited, 0),
      balance,
    };
  });
}
