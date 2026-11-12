import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig, type RealmConfig } from '../../config/src/index';
import {
  calculateGemReward,
  gemRewardView,
  type GemRewardResult,
} from '../../core/src/gem-rewards';
import { GameError } from '../../core/src/errors';
import { transaction, type Database, type Transaction } from './connection';
import { requireMember } from './game';
import { requireExpectedRevision } from './settings-revision';
import { effectiveMemberConfig } from './rank-track-state';
import { purchasedCollectorRank } from './rank-state';

async function lastClaim(
  tx: Transaction,
  realmId: string,
  actorId: string,
): Promise<string | null> {
  return (
    (
      await tx.query(
        'SELECT created_at FROM gem_reward_claims WHERE realm_id=$1 AND account_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
        [realmId, actorId],
      )
    ).rows[0]?.created_at.toISOString() ?? null
  );
}
// Internal helper: caller has authorized membership in this same transaction.
export async function gemRewardState(
  tx: Transaction,
  realmId: string,
  actorId: string,
  config: RealmConfig,
  now?: Date,
) {
  const timestamp =
    now ?? ((await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date);
  return gemRewardView(config, await lastClaim(tx, realmId, actorId), timestamp.getTime());
}
export async function claimGems(
  db: Database,
  actorId: string,
  realmId: string,
  requestKey: string,
  expectedRevision?: number,
): Promise<GemRewardResult> {
  const uuid = z.uuid().transform((value) => value.toLowerCase());
  const actor = uuid.parse(actorId),
    realm = uuid.parse(realmId),
    key = uuid.parse(requestKey);
  return transaction(db, async (tx) => {
    const row = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realm]))
      .rows[0];
    if (!row) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
    const member = await requireMember(tx, realm, actor);
    const previous = (
      await tx.query(
        'SELECT result FROM gem_reward_claims WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realm, actor, key],
      )
    ).rows[0];
    if (previous) return previous.result as GemRewardResult;
    await requireExpectedRevision(tx, realm, expectedRevision);
    // The member's own rules: rank perks can shorten the claim interval. They
    // are saved with the claim, so its receipt and restore checks use them too.
    const base = parseRealmConfig(row.config);
    const config = await effectiveMemberConfig(
        tx,
        realm,
        actor,
        base,
        row.config.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realm, actor) : 0,
      ),
      now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const quote = calculateGemReward(
      config,
      await lastClaim(tx, realm, actor),
      member.balance,
      now.getTime(),
    );
    const result: GemRewardResult = { ok: true, claimId: randomUUID(), ...quote };
    await tx.query(
      'INSERT INTO gem_reward_claims(realm_id,id,account_id,request_key,result,config_snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [realm, result.claimId, actor, key, result, config, now],
    );
    await tx.query('UPDATE memberships SET balance=$3 WHERE realm_id=$1 AND account_id=$2', [
      realm,
      actor,
      result.balance,
    ]);
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'gem_reward',$7)",
      [realm, randomUUID(), actor, `gem-reward:${key}`, result.amount, result.balance, now],
    );
    return result;
  });
}
