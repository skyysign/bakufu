import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  defaultFameFloors,
  fameFloorsSchema,
  parseRealmConfig,
  tiers,
  type FameFloors,
  type RealmConfig,
  type Tier,
} from '../../config/src/index';
import {
  adjustedTier,
  drawableTiers,
  fameFloorSources,
  GameError,
  tierRank,
} from '../../core/src/index';
import { requireMember } from './game';
import { transaction, type Database, type Transaction } from './connection';

/*
 * Rarity adjustments. A character's computed tier comes from its roster
 * standing at import. Fame floors raise provider characters with enough
 * favourites; an admin override fixes one character's tier outright. When the
 * live tier differs from the computed one, provenance keeps the computed tier
 * as `tierBeforeAdjustment`, so floors can later be lowered or removed again.
 * Opening receipts keep the tier a card was pulled at; values, odds and future
 * pulls follow the current tier.
 */

const tierSchema = z.enum(tiers);
const changeSchema = z.strictObject({
  characterId: z.uuid(),
  before: tierSchema,
  after: tierSchema,
});
type TierChange = z.infer<typeof changeSchema>;
/** Characters a preview lists in full; the hash still covers every change. */
export const tierPreviewListLimit = 200;

export type TierCharacter = {
  characterId: string;
  name: string;
  series: string;
  popularity: number | null;
  tier: Tier;
  /** The tier floors alone would give it (what “Automatic” restores). */
  automaticTier: Tier;
  override: Tier | null;
  owned: boolean;
};
export type TierAdjustmentView = {
  floors: FameFloors;
  recommended: FameFloors;
  /** Tiers a pack can draw; floors and overrides stay within them. */
  drawableTiers: Tier[];
  /** Characters from MyAnimeList or AniList, the only ones floors apply to. */
  providerCharacters: number;
  counts: Record<Tier, number>;
  /** Characters currently above their computed tier because of a floor. */
  raisedByFloors: number;
  overrides: TierCharacter[];
  history: {
    id: string;
    kind: 'floors' | 'override';
    createdAt: string;
    changedCharacters: number;
    characterName: string | null;
    override: Tier | null;
  }[];
};
export type TierFloorPreview = {
  previewHash: string;
  revision: number;
  floors: FameFloors;
  floorsChanged: boolean;
  before: Record<Tier, number>;
  after: Record<Tier, number>;
  changedCharacters: number;
  raised: number;
  lowered: number;
  /** Changed characters someone currently owns: their card values change too. */
  ownedChanged: number;
  changes: (TierCharacter & { before: Tier; after: Tier })[];
};
export type TierAdjustmentResult = {
  ok: true;
  adjustmentId: string;
  kind: 'floors' | 'override';
  revision: number;
  changedCharacters: number;
  appliedAt: string;
};

type Row = {
  id: string;
  name: string;
  series: string;
  source_key: string;
  tier: Tier;
  popularity: string | null;
  base: Tier | null;
  override: Tier | null;
  owned: boolean;
};

async function adminRealm(tx: Transaction, actorId: string, realmId: string, lock: boolean) {
  const realm = (
    await tx.query(
      `SELECT config,config_revision FROM realms WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [realmId],
    )
  ).rows[0];
  if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
  if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
    throw new GameError('FORBIDDEN', 'Only a realm administrator can change rarities.', 403);
  return { config: parseRealmConfig(realm.config), revision: realm.config_revision as number };
}

async function characterRows(tx: Transaction, realmId: string, characterId?: string) {
  return (
    await tx.query(
      `SELECT c.id,c.name,c.series,c.source_key,c.tier,c.popularity::text AS popularity,
      c.provenance->>'tierBeforeAdjustment' AS base,c.provenance->>'tierOverride' AS override,
      EXISTS(SELECT 1 FROM cards o WHERE o.realm_id=c.realm_id AND o.character_id=c.id AND o.recycled_at IS NULL) AS owned
      FROM characters c WHERE c.realm_id=$1 AND c.retired_at IS NULL${characterId ? ' AND c.id=$2' : ''} ORDER BY c.id`,
      characterId ? [realmId, characterId] : [realmId],
    )
  ).rows as Row[];
}
const popularityOf = (row: Row) => (row.popularity === null ? null : Number(row.popularity));
const computedTier = (row: Row) => row.base ?? row.tier;
function describe(row: Row, config: RealmConfig): TierCharacter {
  return {
    characterId: row.id,
    name: row.name,
    series: row.series,
    popularity: popularityOf(row),
    tier: row.tier,
    automaticTier: adjustedTier(computedTier(row), null, popularityOf(row), row.source_key, config),
    override: row.override,
    owned: row.owned,
  };
}
const emptyCounts = () =>
  Object.fromEntries(tiers.map((tier) => [tier, 0])) as Record<Tier, number>;

/** Tier changes the given config would make, with each character's computed tier to keep. */
function plan(rows: Row[], config: RealmConfig) {
  const changes: (TierChange & { base: Tier | null; row: Row })[] = [];
  for (const row of rows) {
    const base = computedTier(row);
    const after = adjustedTier(base, row.override, popularityOf(row), row.source_key, config);
    if (after !== row.tier)
      changes.push({
        characterId: row.id,
        before: row.tier,
        after,
        base: after === base ? null : base,
        row,
      });
  }
  return changes;
}

async function applyChanges(
  tx: Transaction,
  realmId: string,
  changes: { characterId: string; after: Tier; base: Tier | null }[],
) {
  for (let start = 0; start < changes.length; start += 1000)
    await tx.query(
      `UPDATE characters c SET tier=x.after,
      provenance=(c.provenance-'tierBeforeAdjustment')||CASE WHEN x.base IS NULL THEN '{}'::jsonb
        ELSE jsonb_build_object('tierBeforeAdjustment',x.base) END
      FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,after text,base text)
      WHERE c.realm_id=$1 AND c.id=x.id`,
      [
        realmId,
        JSON.stringify(
          changes
            .slice(start, start + 1000)
            .map((change) => ({ id: change.characterId, after: change.after, base: change.base })),
        ),
      ],
    );
}

export async function realmTierAdjustments(
  db: Database,
  actorId: string,
  realmId: string,
): Promise<TierAdjustmentView> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  return transaction(
    db,
    async (tx) => {
      const { config } = await adminRealm(tx, actorId, realmId, false);
      const counts = emptyCounts();
      let providerCharacters = 0,
        raisedByFloors = 0;
      const rows = await characterRows(tx, realmId);
      for (const row of rows) {
        counts[row.tier]++;
        if (fameFloorSources.includes(row.source_key.split(':')[0])) providerCharacters++;
        if (row.base && !row.override) raisedByFloors++;
      }
      const history = (
        await tx.query(
          `SELECT t.id,t.kind,t.created_at,t.changes,t.override_after,c.name FROM tier_adjustments t
          LEFT JOIN characters c ON c.realm_id=t.realm_id AND c.id=t.character_id
          WHERE t.realm_id=$1 ORDER BY t.created_at DESC,t.id LIMIT 10`,
          [realmId],
        )
      ).rows.map((row) => ({
        id: row.id as string,
        kind: row.kind as 'floors' | 'override',
        createdAt: (row.created_at as Date).toISOString(),
        changedCharacters: (row.changes as unknown[]).length,
        characterName: (row.name as string | null) ?? null,
        override: (row.override_after as Tier | null) ?? null,
      }));
      return {
        floors: config.fameFloors,
        recommended: defaultFameFloors,
        drawableTiers: drawableTiers(config),
        providerCharacters,
        counts,
        raisedByFloors,
        overrides: rows
          .filter((row) => row.override)
          .map((row) => describe(row, config))
          .sort((a, b) => a.name.localeCompare(b.name)),
        history,
      };
    },
    true,
  );
}

const floorsSchema = z.strictObject({ floors: fameFloorsSchema });
async function floorReview(tx: Transaction, actorId: string, realmId: string, floors: FameFloors) {
  const current = await adminRealm(tx, actorId, realmId, true);
  const proposed: RealmConfig = { ...current.config, fameFloors: floors };
  const rows = await characterRows(tx, realmId);
  const changes = plan(rows, proposed);
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        revision: current.revision,
        before: current.config.fameFloors,
        after: floors,
        changes: changes.map(({ characterId, before, after }) => ({ characterId, before, after })),
      }),
    )
    .digest('hex');
  return { ...current, proposed, rows, changes, hash };
}

/** What applying these fame floors would change, without changing anything. */
export async function previewTierFloors(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<TierFloorPreview> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const { floors } = floorsSchema.parse(input);
  return transaction(db, async (tx) => {
    const review = await floorReview(tx, actorId, realmId, floors);
    const before = emptyCounts(),
      after = emptyCounts();
    for (const row of review.rows) {
      before[row.tier]++;
      after[row.tier]++;
    }
    for (const change of review.changes) {
      after[change.before]--;
      after[change.after]++;
    }
    const listed = [...review.changes].sort(
      (a, b) =>
        (popularityOf(b.row) ?? -1) - (popularityOf(a.row) ?? -1) ||
        a.row.name.localeCompare(b.row.name),
    );
    return {
      previewHash: review.hash,
      revision: review.revision,
      floors,
      floorsChanged: !isDeepStrictEqual(review.config.fameFloors, floors),
      before,
      after,
      changedCharacters: review.changes.length,
      raised: review.changes.filter((c) => tierRank(c.after) > tierRank(c.before)).length,
      lowered: review.changes.filter((c) => tierRank(c.after) < tierRank(c.before)).length,
      ownedChanged: review.changes.filter((c) => c.row.owned).length,
      changes: listed.slice(0, tierPreviewListLimit).map((change) => ({
        ...describe(change.row, review.proposed),
        before: change.before,
        after: change.after,
      })),
    };
  });
}

const applyFloorsSchema = floorsSchema.extend({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestKey: z.uuid(),
});
/**
 * Saves the reviewed fame floors (a new settings revision when they changed)
 * and re-tiers the roster in the same transaction. A retry with the same
 * request key replays the stored result.
 */
export async function applyTierFloors(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<TierAdjustmentResult> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const request = applyFloorsSchema.parse(input);
  return transaction(db, async (tx) => {
    const review = await floorReview(tx, actorId, realmId, request.floors);
    const previous = (
      await tx.query(
        'SELECT kind,preview_hash,result FROM tier_adjustments WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, request.requestKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.kind !== 'floors' || previous.preview_hash !== request.previewHash)
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This request key was used for a different rarity change.',
          409,
        );
      return previous.result as TierAdjustmentResult;
    }
    if (review.hash !== request.previewHash)
      throw new GameError(
        'PREVIEW_STALE',
        'The realm changed since your review. Review the tier changes again.',
        409,
      );
    const floorsChanged = !isDeepStrictEqual(review.config.fameFloors, request.floors);
    if (!floorsChanged && !review.changes.length)
      throw new GameError('NO_CHANGES', 'These floors are already saved and change no tiers.', 409);
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const id = randomUUID();
    let revision = review.revision;
    if (floorsChanged) {
      if (
        (
          await tx.query(
            'SELECT 1 FROM realm_config_changes WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
            [realmId, actorId, request.requestKey],
          )
        ).rowCount
      )
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This key was already used for another settings change.',
          409,
        );
      if (revision >= 2_147_483_647)
        throw new GameError('SETTINGS_LIMIT', 'The settings revision limit has been reached.', 409);
      revision++;
      await tx.query('UPDATE realms SET config=$2,config_revision=$3 WHERE id=$1', [
        realmId,
        review.proposed,
        revision,
      ]);
      await tx.query(
        'INSERT INTO realm_config_changes(realm_id,id,account_id,request_key,preview_id,from_revision,to_revision,before_config,after_config,result,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          realmId,
          id,
          actorId,
          request.requestKey,
          randomUUID(),
          review.revision,
          revision,
          review.config,
          review.proposed,
          { ok: true, changeId: id, revision, appliedAt: now.toISOString() },
          now,
        ],
      );
    }
    await applyChanges(tx, realmId, review.changes);
    const result: TierAdjustmentResult = {
      ok: true,
      adjustmentId: id,
      kind: 'floors',
      revision,
      changedCharacters: review.changes.length,
      appliedAt: now.toISOString(),
    };
    await tx.query(
      `INSERT INTO tier_adjustments(realm_id,id,account_id,request_key,kind,preview_hash,config_change_id,before_floors,after_floors,changes,result,created_at)
      VALUES($1,$2,$3,$4,'floors',$5,$6,$7,$8,$9,$10,$11)`,
      [
        realmId,
        id,
        actorId,
        request.requestKey,
        request.previewHash,
        floorsChanged ? id : null,
        review.config.fameFloors,
        request.floors,
        JSON.stringify(
          review.changes.map(({ characterId, before, after }) => ({ characterId, before, after })),
        ),
        result,
        now,
      ],
    );
    return result;
  });
}

const overrideSchema = z.strictObject({
  characterId: z.uuid(),
  tier: tierSchema.nullable(),
  requestKey: z.uuid(),
});
/**
 * Sets one character's tier by hand (fame floors no longer move it), or with
 * `tier: null` returns it to automatic. A retry with the same request key
 * replays the stored result.
 */
export async function setTierOverride(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<TierAdjustmentResult & { characterId: string; tier: Tier; override: Tier | null }> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const request = overrideSchema.parse(input);
  return transaction(db, async (tx) => {
    const { config, revision } = await adminRealm(tx, actorId, realmId, true);
    const previous = (
      await tx.query(
        'SELECT kind,character_id,override_after,result FROM tier_adjustments WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realmId, actorId, request.requestKey],
      )
    ).rows[0];
    if (previous) {
      if (
        previous.kind !== 'override' ||
        previous.character_id !== request.characterId ||
        (previous.override_after ?? null) !== request.tier
      )
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This request key was used for a different rarity change.',
          409,
        );
      return previous.result;
    }
    const row = (await characterRows(tx, realmId, request.characterId))[0];
    if (!row) throw new GameError('NOT_FOUND', 'This character is not in the realm.', 404);
    if (request.tier && !drawableTiers(config).includes(request.tier))
      throw new GameError(
        'TIER_UNAVAILABLE',
        `No pack can draw ${request.tier} cards in this realm (its odds are 0). Raise its odds under Game rules first.`,
        409,
      );
    if ((row.override ?? null) === request.tier)
      throw new GameError(
        'NO_CHANGES',
        request.tier
          ? `${row.name} is already set to ${request.tier}.`
          : `${row.name} already follows the automatic tier.`,
        409,
      );
    const base = computedTier(row);
    const after = adjustedTier(base, request.tier, popularityOf(row), row.source_key, config);
    const changes: TierChange[] =
      after === row.tier ? [] : [{ characterId: row.id, before: row.tier, after }];
    await tx.query(
      `UPDATE characters SET tier=$3,
      provenance=(provenance-'tierOverride'-'tierBeforeAdjustment')||jsonb_strip_nulls(jsonb_build_object('tierOverride',$4::text,'tierBeforeAdjustment',$5::text))
      WHERE realm_id=$1 AND id=$2`,
      [realmId, row.id, after, request.tier, after === base ? null : base],
    );
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const id = randomUUID();
    const result = {
      ok: true as const,
      adjustmentId: id,
      kind: 'override' as const,
      revision,
      changedCharacters: changes.length,
      appliedAt: now.toISOString(),
      characterId: row.id,
      tier: after,
      override: request.tier,
    };
    await tx.query(
      `INSERT INTO tier_adjustments(realm_id,id,account_id,request_key,kind,character_id,override_before,override_after,changes,result,created_at)
      VALUES($1,$2,$3,$4,'override',$5,$6,$7,$8,$9,$10)`,
      [
        realmId,
        id,
        actorId,
        request.requestKey,
        row.id,
        row.override,
        request.tier,
        JSON.stringify(changes),
        result,
        now,
      ],
    );
    return result;
  });
}

/**
 * Restore check: every rarity change reconciles. Rebalances and adjustments
 * form one tier history per character (each change starts from the previous
 * one's result and the last one matches the saved tier), overrides match the
 * saved provenance, and floor changes match the settings journal.
 */
export async function validateTierAdjustments(tx: Transaction) {
  const present = (await tx.query("SELECT to_regclass('tier_adjustments') IS NOT NULL AS present"))
    .rows[0].present as boolean;
  if (!present) return;
  function fail(message: string): never {
    throw new Error(`Backup rarity adjustments are invalid: ${message}.`);
  }
  const rows = (
    await tx.query(`SELECT t.*,c.before_config AS journal_before,c.after_config AS journal_after,
    c.created_at AS journal_at FROM tier_adjustments t
    LEFT JOIN realm_config_changes c ON c.realm_id=t.realm_id AND c.id=t.config_change_id
    ORDER BY t.realm_id,t.created_at,t.id`)
  ).rows;
  const events: { realmId: string; at: number; changes: TierChange[] }[] = [];
  const overrides = new Map<string, Tier | null>();
  for (const row of rows) {
    const changes = z.array(changeSchema).safeParse(row.changes);
    if (!changes.success) fail('change list');
    const list = changes.data!;
    if (
      new Set(list.map((change) => change.characterId)).size !== list.length ||
      list.some((change) => change.before === change.after)
    )
      fail('duplicate or empty change');
    if (
      row.result?.ok !== true ||
      row.result.adjustmentId !== row.id ||
      row.result.kind !== row.kind ||
      row.result.changedCharacters !== list.length ||
      new Date(row.result.appliedAt).getTime() !== (row.created_at as Date).getTime()
    )
      fail('result');
    if (row.kind === 'floors') {
      const before = fameFloorsSchema.safeParse(row.before_floors),
        after = fameFloorsSchema.safeParse(row.after_floors);
      if (!before.success || !after.success) fail('floors');
      const changed = !isDeepStrictEqual(before.data, after.data);
      if (changed !== (row.config_change_id !== null)) fail('settings link');
      if (
        changed &&
        (!row.journal_after ||
          !isDeepStrictEqual(parseRealmConfig(row.journal_before).fameFloors, before.data) ||
          !isDeepStrictEqual(parseRealmConfig(row.journal_after).fameFloors, after.data) ||
          (row.journal_at as Date).getTime() !== (row.created_at as Date).getTime())
      )
        fail('settings journal');
    } else {
      if (list.length > 1 || (list.length === 1 && list[0].characterId !== row.character_id))
        fail('override change');
      overrides.set(`${row.realm_id}:${row.character_id}`, row.override_after ?? null);
    }
    events.push({ realmId: row.realm_id, at: (row.created_at as Date).getTime(), changes: list });
  }
  for (const row of (
    await tx.query('SELECT realm_id,created_at,tier_changes FROM economy_rebalances')
  ).rows)
    events.push({
      realmId: row.realm_id,
      at: (row.created_at as Date).getTime(),
      changes: z.array(changeSchema).parse(row.tier_changes),
    });
  events.sort((a, b) => a.at - b.at);
  const finalTier = new Map<string, Tier>();
  for (const event of events)
    for (const change of event.changes) {
      const key = `${event.realmId}:${change.characterId}`;
      const previous = finalTier.get(key);
      if (previous && previous !== change.before) fail('tier history');
      finalTier.set(key, change.after);
    }
  const saved = new Map<string, { tier: Tier; override: Tier | null }>();
  for (const row of (
    await tx.query(
      `SELECT realm_id,id,tier,provenance->>'tierOverride' AS override FROM characters
      WHERE realm_id IN (SELECT DISTINCT realm_id FROM tier_adjustments) OR provenance ? 'tierOverride'`,
    )
  ).rows)
    saved.set(`${row.realm_id}:${row.id}`, { tier: row.tier, override: row.override ?? null });
  for (const [key, tier] of finalTier) {
    const character = saved.get(key);
    if (character && character.tier !== tier) fail('current tier');
  }
  for (const [key, character] of saved) {
    if ((overrides.get(key) ?? null) !== character.override) fail('override state');
    if (character.override && character.override !== character.tier) fail('override tier');
  }
}
