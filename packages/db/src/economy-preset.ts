import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  defaultConfig,
  defaultRankTracks,
  parseRealmConfig,
  tiers,
  type RealmConfig,
  type Tier,
} from '../../config/src/index';
import { GameError } from '../../core/src/errors';
import { requireMember } from './game';
import { transaction, type Database, type Transaction } from './connection';

const tierChangeSchema = z.strictObject({
  characterId: z.uuid(),
  before: z.enum(tiers),
  after: z.enum(tiers),
});
type TierChange = z.infer<typeof tierChangeSchema>;
async function review(tx: Transaction, actorId: string, realmId: string) {
  const realm = (
    await tx.query('SELECT config,config_revision FROM realms WHERE id=$1 FOR UPDATE', [realmId])
  ).rows[0];
  if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
  if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
    throw new GameError('FORBIDDEN', 'Only a realm administrator can rebalance this realm.', 403);
  const before = parseRealmConfig(realm.config);
  const after: RealmConfig = {
    ...before,
    packPrice: defaultConfig.packPrice,
    rankTracks: before.rankTracks.enabled ? before.rankTracks : defaultRankTracks,
    cooldownSeconds: defaultConfig.cooldownSeconds,
    tierWeights: { ...defaultConfig.tierWeights },
    recycleRewards: { ...defaultConfig.recycleRewards },
    gemRewards: { ...defaultConfig.gemRewards },
    legacyPurchasesRetired: true,
  };
  const characters = (
    await tx.query(
      // Characters an admin re-tiered (fame floor or manual tier) keep their
      // tier, like awarded ones.
      `SELECT c.id,c.tier,c.provenance->>'rarityBeforeExpansion' AS original_tier,
    (EXISTS(SELECT 1 FROM cards owned WHERE owned.realm_id=c.realm_id AND owned.character_id=c.id)
      OR c.provenance ?| ARRAY['tierOverride','tierBeforeAdjustment']) AS awarded
    FROM characters c WHERE c.realm_id=$1 ORDER BY c.id`,
      [realmId],
    )
  ).rows;
  // Saved rarity establishes the existing cohort. Numeric source popularity was
  // not retained by older imports; stable IDs break ties without remote lookups.
  const ranked = characters
    .filter((character) => !character.awarded)
    .sort(
      (a, b) =>
        tiers.indexOf((b.original_tier ?? b.tier) as Tier) -
          tiers.indexOf((a.original_tier ?? a.tier) as Tier) || a.id.localeCompare(b.id),
    );
  const changes: TierChange[] = [];
  const counts = Object.fromEntries(tiers.map((tier) => [tier, 0])) as Record<Tier, number>;
  for (const character of characters.filter((character) => character.awarded))
    counts[character.tier as Tier]++;
  ranked.forEach((character, index) => {
    const p = index / ranked.length;
    const tier: Tier =
      p < 0.002
        ? 'legendary'
        : p < 0.02
          ? 'epic'
          : p < 0.08
            ? 'rare'
            : p < 0.3
              ? 'uncommon'
              : 'common';
    counts[tier]++;
    if (tier !== character.tier)
      changes.push({ characterId: character.id, before: character.tier, after: tier });
  });
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        revision: realm.config_revision,
        before,
        after,
        characters,
        changes,
      }),
    )
    .digest('hex');
  return {
    before,
    after,
    changes,
    hash,
    revision: realm.config_revision as number,
    counts,
    protectedCharacters: characters.filter((character) => character.awarded).length,
  };
}

export async function previewEconomyPreset(db: Database, actorId: string, realmId: string) {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  return transaction(db, async (tx) => {
    const value = await review(tx, actorId, realmId);
    return {
      previewHash: value.hash,
      revision: value.revision,
      packPrice: value.after.packPrice,
      cooldownSeconds: value.after.cooldownSeconds,
      rankTracksEnabled: value.after.rankTracks.enabled,
      legacyPurchasesRetired: value.after.legacyPurchasesRetired,
      gemReward: value.after.gemRewards,
      recycleRewards: value.after.recycleRewards,
      tierWeights: value.after.tierWeights,
      tierCounts: value.counts,
      changedCharacters: value.changes.length,
      protectedCharacters: value.protectedCharacters,
    };
  });
}

export async function applyEconomyPreset(
  db: Database,
  actorId: string,
  realmId: string,
  requestKey: string,
  previewHash: string,
) {
  [actorId, realmId, requestKey].forEach((value) => z.uuid().parse(value));
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(previewHash);
  return transaction(db, async (tx) => {
    const current = await review(tx, actorId, realmId);
    const previous = (
      await tx.query(
        'SELECT preview_hash,result FROM economy_rebalances WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.preview_hash !== previewHash)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This rebalance key belongs to a different preview.',
          409,
        );
      return previous.result as {
        ok: true;
        changeId: string;
        revision: number;
        appliedAt: string;
        changedCharacters: number;
      };
    }
    if (current.hash !== previewHash)
      throw new GameError(
        'PREVIEW_STALE',
        'The realm changed. Review a new economy preview before applying.',
        409,
      );
    if (
      (
        await tx.query(
          'SELECT 1 FROM realm_config_changes WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
          [realmId, actorId, requestKey],
        )
      ).rowCount
    )
      throw new GameError(
        'IDEMPOTENCY_CONFLICT',
        'This key was already used for another settings change.',
        409,
      );
    if (current.revision >= 2_147_483_647)
      throw new GameError('SETTINGS_LIMIT', 'The settings revision limit has been reached.', 409);
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const result = {
      ok: true as const,
      changeId: randomUUID(),
      revision: current.revision + 1,
      appliedAt: now.toISOString(),
      changedCharacters: current.changes.length,
    };
    await tx.query('UPDATE realms SET config=$2,config_revision=$3 WHERE id=$1', [
      realmId,
      current.after,
      result.revision,
    ]);
    for (const change of current.changes)
      await tx.query(
        `UPDATE characters SET provenance=CASE WHEN provenance ? 'rarityBeforeExpansion' THEN provenance ELSE provenance||jsonb_build_object('rarityBeforeExpansion',tier,'rarityExpansionVersion',1) END,tier=$3 WHERE realm_id=$1 AND id=$2`,
        [realmId, change.characterId, change.after],
      );
    await tx.query(
      'INSERT INTO realm_config_changes(realm_id,id,account_id,request_key,preview_id,from_revision,to_revision,before_config,after_config,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        realmId,
        result.changeId,
        actorId,
        requestKey,
        randomUUID(),
        current.revision,
        result.revision,
        current.before,
        current.after,
        result,
        now,
      ],
    );
    await tx.query(
      'INSERT INTO economy_rebalances(realm_id,id,account_id,request_key,preview_hash,before_config,after_config,tier_changes,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        realmId,
        result.changeId,
        actorId,
        requestKey,
        previewHash,
        current.before,
        current.after,
        JSON.stringify(current.changes),
        result,
        now,
      ],
    );
    return result;
  });
}

export async function validateEconomyRebalances(tx: Transaction) {
  const finalChanges = new Map<
    string,
    { realmId: string; characterId: string; tier: Tier; at: Date }
  >();
  // Characters an admin re-tiered later: validateTierAdjustments checks their
  // full tier history; here only the rebalance itself is checked.
  const adjusted = new Set<string>();
  if (
    (await tx.query("SELECT to_regclass('tier_adjustments') IS NOT NULL AS present")).rows[0]
      .present
  )
    for (const row of (
      await tx.query(
        `SELECT DISTINCT t.realm_id,change->>'characterId' AS id FROM tier_adjustments t
        CROSS JOIN LATERAL jsonb_array_elements(t.changes) change`,
      )
    ).rows)
      adjusted.add(row.realm_id + ':' + row.id);
  for (const row of (
    await tx.query(
      'SELECT e.*,c.before_config AS journal_before,c.after_config AS journal_after,c.result AS journal_result FROM economy_rebalances e JOIN realm_config_changes c ON c.realm_id=e.realm_id AND c.id=e.id ORDER BY e.realm_id,c.to_revision',
    )
  ).rows) {
    const changes = z.array(tierChangeSchema).parse(row.tier_changes);
    parseRealmConfig(row.before_config);
    parseRealmConfig(row.after_config);
    if (
      !isDeepStrictEqual(row.before_config, row.journal_before) ||
      !isDeepStrictEqual(row.after_config, row.journal_after) ||
      !isDeepStrictEqual(row.result, row.journal_result) ||
      row.result.changedCharacters !== changes.length ||
      new Set(changes.map((change) => change.characterId)).size !== changes.length
    )
      throw new Error('Economy rebalance history is invalid.');
    for (const change of changes) {
      if (change.before === change.after) throw new Error('Economy tier change is invalid.');
      const key = row.realm_id + ':' + change.characterId;
      const previous = finalChanges.get(key);
      if (previous && previous.tier !== change.before && !adjusted.has(key))
        throw new Error('Economy tier history is inconsistent.');
      finalChanges.set(key, {
        realmId: row.realm_id,
        characterId: change.characterId,
        tier: change.after,
        at: row.created_at,
      });
    }
  }
  for (const [key, change] of finalChanges) {
    if (adjusted.has(key)) {
      // The rebalance must not have changed a character pulled before it.
      if (
        (
          await tx.query(
            `SELECT 1 FROM openings o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.result->'characters','[]'::jsonb)) awarded
            WHERE o.realm_id=$1 AND awarded->>'id'=$2 AND awarded->>'tier'<>$3 AND o.created_at<$4 LIMIT 1`,
            [change.realmId, change.characterId, change.tier, change.at],
          )
        ).rowCount
      )
        throw new Error('Economy rebalance changed a previously awarded character.');
      continue;
    }
    const character = (
      await tx.query(
        `SELECT c.id FROM characters c WHERE c.realm_id=$1 AND c.id=$2 AND c.tier=$3 AND NOT EXISTS(SELECT 1 FROM openings o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.result->'characters','[]'::jsonb)) awarded WHERE o.realm_id=c.realm_id AND awarded->>'id'=c.id::text AND awarded->>'tier'<>$3)`,
        [change.realmId, change.characterId, change.tier],
      )
    ).rows[0];
    if (!character) throw new Error('Economy rebalance changed a previously awarded character.');
  }
}
