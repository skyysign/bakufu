import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseRealmConfig, realmConfigSchema } from '../../config/src/index';
import {
  GameError,
  realmSettingsImpact,
  type SettingsMember,
  type SettingsPreview,
  type SettingsResult,
} from '../../core/src/index';
import { eligiblePool, requireMember } from './game';
import { transaction, type Database, type Transaction } from './connection';
import { purchasedRankTrackLevels } from './rank-track-state';

async function adminRealm(tx: Transaction, actorId: string, realmId: string) {
  const realm = (
    await tx.query('SELECT config,config_revision FROM realms WHERE id=$1 FOR UPDATE', [realmId])
  ).rows[0];
  if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
  const member = await requireMember(tx, realmId, actorId);
  if (member.role !== 'admin')
    throw new GameError('FORBIDDEN', 'Only a realm administrator can change settings.', 403);
  return { config: parseRealmConfig(realm.config), revision: realm.config_revision as number };
}
async function state(tx: Transaction, realmId: string) {
  const members = (
    await tx.query(
      `SELECT m.account_id,m.balance,m.xp,m.last_opened_at,
    (SELECT COALESCE(max(rank),0) FROM upgrade_purchases u WHERE u.realm_id=m.realm_id AND u.account_id=m.account_id) AS rank,
    (SELECT COALESCE(max(rank),0) FROM rank_purchases u WHERE u.realm_id=m.realm_id AND u.account_id=m.account_id) AS "collectorRank",
    (SELECT count(*)::integer FROM wishlist_entries w WHERE w.realm_id=m.realm_id AND w.account_id=m.account_id) AS wishes
    FROM memberships m WHERE m.realm_id=$1 ORDER BY m.account_id`,
      [realmId],
    )
  ).rows.map(({ last_opened_at, ...member }) => ({
    ...member,
    lastOpenedAt: last_opened_at?.toISOString() ?? null,
  })) as SettingsMember[];
  for (const member of members) {
    const row = member as SettingsMember & { account_id?: string };
    member.rankTrackLevels = await purchasedRankTrackLevels(tx, realmId, row.account_id!);
    delete row.account_id;
  }
  const packs = [];
  for (const pack of (
    await tx.query(`SELECT id,name,category FROM packs p WHERE realm_id=$1 AND (to_jsonb(p)->>'retired_at') IS NULL ORDER BY id`, [realmId])
  ).rows)
    packs.push({
      id: pack.id as string,
      name: pack.name as string,
      pool: await eligiblePool(tx, realmId, pack.category),
    });
  // Only the digest is retained; private IDs never enter a preview response.
  const fingerprint = (
    await tx.query(
      `SELECT jsonb_build_array(
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY account_id) FROM memberships m WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM cards c WHERE realm_id=$1 AND recycled_at IS NULL),
    (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM wishlist_entries w WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM gem_reward_claims g WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM rank_purchases r WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM rank_track_purchases r WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM market_listings l WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM upgrade_purchases u WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM characters c WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM packs p WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM trades t WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(v) ORDER BY trade_id,version) FROM trade_versions v WHERE realm_id=$1),
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY trade_id,version,account_id) FROM trade_confirmations c WHERE realm_id=$1)
  )::text AS data`,
      [realmId],
    )
  ).rows[0].data;
  const pendingTrades = (
    await tx.query(
      "SELECT count(*)::integer AS count FROM trades WHERE realm_id=$1 AND status='pending' AND expires_at>clock_timestamp()",
      [realmId],
    )
  ).rows[0].count as number;
  return {
    members,
    packs,
    pendingTrades,
    hash: createHash('sha256').update(fingerprint).digest('hex'),
  };
}

export async function previewRealmSettings(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<SettingsPreview> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const proposed = realmConfigSchema.parse(input);
  return transaction(db, async (tx) => {
    const current = await adminRealm(tx, actorId, realmId),
      currentState = await state(tx, realmId);
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const impact = realmSettingsImpact(
      current.config,
      proposed,
      currentState.members,
      currentState.packs,
      now.getTime(),
      currentState.pendingTrades,
    );
    const id = randomUUID(),
      expiresAt = new Date(now.getTime() + 300_000).toISOString();
    await tx.query(
      'DELETE FROM realm_config_previews WHERE realm_id=$1 AND expires_at <= clock_timestamp()',
      [realmId],
    );
    await tx.query(
      'INSERT INTO realm_config_previews(realm_id,id,account_id,base_revision,state_hash,proposed_config,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [realmId, id, actorId, current.revision, currentState.hash, proposed, expiresAt],
    );
    return { id, revision: current.revision, expiresAt, impact };
  });
}

export async function applyRealmSettings(
  db: Database,
  actorId: string,
  realmId: string,
  previewId: string,
  requestKey: string,
): Promise<SettingsResult> {
  [actorId, realmId, previewId, requestKey].forEach((value) => z.uuid().parse(value));
  return transaction(db, async (tx) => {
    const current = await adminRealm(tx, actorId, realmId);
    const previous = (
      await tx.query(
        'SELECT preview_id,result FROM realm_config_changes WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.preview_id !== previewId)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This settings request key was used for another preview.',
          409,
        );
      return previous.result as SettingsResult;
    }
    const preview = (
      await tx.query(
        'SELECT *,expires_at > clock_timestamp() AS valid FROM realm_config_previews WHERE realm_id=$1 AND id=$2 AND account_id=$3',
        [realmId, previewId, actorId],
      )
    ).rows[0];
    if (!preview || !preview.valid)
      throw new GameError(
        'PREVIEW_EXPIRED',
        'This preview expired or is unavailable. Preview the settings again.',
        409,
      );
    const currentState = await state(tx, realmId);
    if (preview.base_revision !== current.revision || preview.state_hash !== currentState.hash)
      throw new GameError(
        'PREVIEW_STALE',
        'This realm changed since review. Preview the settings again before saving.',
        409,
      );
    const proposed = realmConfigSchema.parse(preview.proposed_config);
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const impact = realmSettingsImpact(
      current.config,
      proposed,
      currentState.members,
      currentState.packs,
      now.getTime(),
      currentState.pendingTrades,
    );
    if (impact.blockers.length)
      throw new GameError('SETTINGS_BLOCKED', impact.blockers.join(' '), 409);
    if (preview.expires_at.getTime() <= now.getTime())
      throw new GameError(
        'PREVIEW_EXPIRED',
        'This preview expired. Preview the settings again.',
        409,
      );
    if (current.revision >= 2_147_483_647)
      throw new GameError('SETTINGS_LIMIT', 'The settings revision limit has been reached.', 409);
    const result: SettingsResult = {
      ok: true,
      changeId: randomUUID(),
      revision: current.revision + 1,
      appliedAt: now.toISOString(),
    };
    await tx.query('UPDATE realms SET config=$2,config_revision=$3 WHERE id=$1', [
      realmId,
      proposed,
      result.revision,
    ]);
    await tx.query(
      'INSERT INTO realm_config_changes(realm_id,id,account_id,request_key,preview_id,from_revision,to_revision,before_config,after_config,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        realmId,
        result.changeId,
        actorId,
        requestKey,
        previewId,
        current.revision,
        result.revision,
        current.config,
        proposed,
        result,
        now,
      ],
    );
    return result;
  });
}
