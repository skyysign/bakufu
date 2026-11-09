import { z } from 'zod';
import { parseRealmConfig, type RealmConfig, type Tier } from '../../config/src/index';
import { adjustedTier, GameError } from '../../core/src/index';
import {
  catalogEntrySchema,
  providerArtworkSchema,
  tierForPercentile,
  standingWeights,
  tierAmongStandings,
} from '../../importers/src/index';
import { transaction, type Database, type Transaction } from './connection';
import { requireInstanceAdmin } from './auth';
import { requireMember } from './game';

/** Characters one addition request may install (a series cast is at most 50). */
export const realmCharacterAdditionLimit = 200;
/** Provider rosters whose source keys a lookup can extend. */
const extendableSources = new Set(['mal', 'anilist']);

export type RealmCharacterSummary = {
  characterCount: number;
  source: string | null;
  canAdd: boolean;
  reason: string | null;
  artworkCount: number;
  /** Most common saved artwork permission, offered as the default for additions. */
  artworkPermission: string | null;
};
export type RealmCharacterCheck = {
  results: { sourceKey: string; present: boolean; tier: Tier }[];
};
export type RealmCharacterAddition = {
  ok: true;
  added: {
    id: string;
    sourceKey: string;
    name: string;
    series: string;
    tier: Tier;
  }[];
  alreadyPresent: number;
  /** Categories the realm did not have before; no pack draws only from them yet. */
  newCategories: string[];
};

const checkSchema = z.strictObject({
  characters: z
    .array(
      z.strictObject({
        sourceKey: catalogEntrySchema.shape.sourceKey,
        popularity: catalogEntrySchema.shape.popularity,
      }),
    )
    .min(1)
    .max(realmCharacterAdditionLimit),
});
const additionSchema = z.strictObject({
  characters: z.array(catalogEntrySchema).min(1).max(realmCharacterAdditionLimit),
  rightsConfirmed: z.literal(true),
});

type CatalogContext = {
  config: RealmConfig;
  fiveTiers: boolean;
  source: string | null;
  revision: string | null;
  license: string | null;
  calculationVersion: string | null;
  characterCount: number;
  /** Saved source popularity, most popular first. */
  cohort: number[];
  /** Saved standing scores (standing-v3 realms), highest first; empty otherwise. */
  standings: number[];
};

async function catalogContext(
  tx: Transaction,
  actorId: string,
  realmId: string,
  lock: boolean,
): Promise<CatalogContext> {
  // Catalog changes and the provider lookups behind them are instance-level
  // actions; the actor must also administer this realm.
  await requireInstanceAdmin(tx, actorId);
  const realm = (
    await tx.query(`SELECT config FROM realms WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [realmId])
  ).rows[0];
  if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
  if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
    throw new GameError('FORBIDDEN', 'Only a realm administrator can add characters.', 403);
  const config = parseRealmConfig(realm.config);
  const primary = (
    await tx.query(
      `SELECT provenance->>'source' AS source,provenance->>'revision' AS revision,
      provenance->>'license' AS license,provenance->>'calculationVersion' AS "calculationVersion",
      count(*)::int AS count FROM characters WHERE realm_id=$1
      GROUP BY 1,2,3,4 ORDER BY count DESC,1,2 LIMIT 1`,
      [realmId],
    )
  ).rows[0];
  const totals = (
    await tx.query('SELECT count(*)::int AS count FROM characters WHERE realm_id=$1', [realmId])
  ).rows[0];
  const cohort = (
    await tx.query(
      `SELECT popularity FROM characters WHERE realm_id=$1 AND popularity IS NOT NULL
      AND split_part(source_key,':',1)=$2 ORDER BY popularity DESC`,
      [realmId, primary?.source ?? ''],
    )
  ).rows.map((row) => Number(row.popularity));
  const standings =
    primary?.calculationVersion === 'source-standing-v3'
      ? (
          await tx.query(
            `SELECT (provenance->>'standing')::float8 AS standing FROM characters
            WHERE realm_id=$1 AND provenance ? 'standing' ORDER BY 1 DESC`,
            [realmId],
          )
        ).rows.map((row) => Number(row.standing))
      : [];
  return {
    config,
    fiveTiers: config.tierWeights.epic > 0 || config.tierWeights.legendary > 0,
    source: primary?.source ?? null,
    revision: primary?.revision ?? null,
    license: primary?.license ?? null,
    calculationVersion: primary?.calculationVersion ?? null,
    characterCount: totals.count,
    cohort,
    standings,
  };
}

function additionBlocker(context: CatalogContext) {
  if (!context.source || !extendableSources.has(context.source))
    return 'Characters can be added to MyAnimeList and AniList rosters. Realms built from your own JSON or CSV file keep the catalog they were created with.';
  return null;
}

/**
 * Rarity a new character receives inside the realm's saved popularity cohort,
 * using the same percentile rules as realm creation. Without popularity
 * evidence (for the character or the realm) it is common.
 */
/** Entries strictly more popular than popularity in a list sorted most popular first. */
function morePopular(sorted: readonly number[], popularity: number) {
  let low = 0,
    high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] > popularity) low = middle + 1;
    else high = middle;
  }
  return low;
}
export function additionTier(
  popularity: number | null,
  cohort: number[],
  fiveTiers: boolean,
): Tier {
  if (popularity === null || cohort.length === 0) return 'common';
  return tierForPercentile(morePopular(cohort, popularity) / (cohort.length + 1), fiveTiers);
}
/**
 * Standing-v3 realms: a new character's standing (overall popularity rank,
 * rank inside its series, main cast) is placed among the realm's saved
 * standings, using the same bands as realm creation.
 */
export function additionStanding(
  popularity: number | null,
  role: string | undefined,
  cohort: number[],
  seriesCohort: number[],
  standings: number[],
): { tier: Tier; standing: number | null } {
  if (popularity === null || cohort.length === 0 || standings.length === 0)
    return { tier: 'common', standing: null };
  const global = 1 - morePopular(cohort, popularity) / (cohort.length + 1),
    seriesIndex = morePopular(seriesCohort, popularity),
    series = 1 - seriesIndex / (seriesCohort.length + 1),
    main = role === 'main';
  const score =
    standingWeights.global * global +
    standingWeights.series * series +
    (main ? standingWeights.main : 0);
  return {
    tier: tierAmongStandings(
      { score, floor: main || (seriesIndex === 0 && seriesCohort.length > 0) },
      standings,
    ),
    standing: Number(score.toFixed(6)),
  };
}

export async function realmCharacterSummary(
  db: Database,
  actorId: string,
  realmId: string,
): Promise<RealmCharacterSummary> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  return transaction(
    db,
    async (tx) => {
      const context = await catalogContext(tx, actorId, realmId, false);
      const artwork = (
        await tx.query(
          `SELECT count(*)::int AS count,
          mode() WITHIN GROUP (ORDER BY provenance->'artwork'->>'permission') AS permission
          FROM characters WHERE realm_id=$1 AND provenance ? 'artwork'`,
          [realmId],
        )
      ).rows[0];
      const reason = additionBlocker(context);
      return {
        characterCount: context.characterCount,
        source: context.source,
        canAdd: !reason,
        reason,
        artworkCount: artwork.count,
        artworkPermission: artwork.permission ?? null,
      };
    },
    true,
  );
}

/** Which looked-up characters the realm already has, and the rarity new ones would get. */
export async function checkRealmCharacters(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<RealmCharacterCheck> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const request = checkSchema.parse(input);
  return transaction(
    db,
    async (tx) => {
      const context = await catalogContext(tx, actorId, realmId, false);
      const present = new Set(
        (
          await tx.query(
            'SELECT source_key FROM characters WHERE realm_id=$1 AND source_key=ANY($2::text[])',
            [realmId, request.characters.map((character) => character.sourceKey)],
          )
        ).rows.map((row) => row.source_key as string),
      );
      return {
        results: request.characters.map((character) => ({
          sourceKey: character.sourceKey,
          present: present.has(character.sourceKey),
          tier: adjustedTier(
            additionTier(character.popularity, context.cohort, context.fiveTiers),
            null,
            character.popularity,
            character.sourceKey,
            context.config,
          ),
        })),
      };
    },
    true,
  );
}

/**
 * Adds looked-up provider characters to an existing realm. New rows only:
 * existing characters, cards, packs and receipts are untouched. Characters
 * join every pack whose category they carry. Stable IDs and source keys make
 * a retry report the characters as already present instead of duplicating them.
 */
export async function addRealmCharacters(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<RealmCharacterAddition> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const request = additionSchema.parse(input);
  const keys = request.characters.map((character) => character.sourceKey);
  const ids = request.characters.map((character) => character.id);
  if (new Set(keys).size !== keys.length || new Set(ids).size !== ids.length)
    throw new GameError('CATALOG_INVALID', 'Each character can be added only once per request.');
  return transaction(db, async (tx) => {
    const context = await catalogContext(tx, actorId, realmId, true);
    const blocker = additionBlocker(context);
    if (blocker) throw new GameError('CATALOG_FIXED', blocker, 409);
    if (keys.some((key) => key.split(':')[0] !== context.source))
      throw new GameError(
        'CATALOG_INVALID',
        'Look up characters from the same source as this realm’s roster.',
      );
    const existing = (
      await tx.query(
        'SELECT id,source_key FROM characters WHERE realm_id=$1 AND (source_key=ANY($2::text[]) OR id=ANY($3::uuid[]))',
        [realmId, keys, ids],
      )
    ).rows as { id: string; source_key: string }[];
    const presentKeys = new Set(existing.map((row) => row.source_key));
    // A row found only by ID belongs to a different source key: never merge them.
    for (const row of existing)
      if (!keys.includes(row.source_key))
        throw new GameError(
          'CATALOG_INVALID',
          'A looked-up character ID is already used by a different character in this realm.',
          409,
        );
    const fresh = request.characters.filter((character) => !presentKeys.has(character.sourceKey));
    const knownCategories = new Set(
      (
        await tx.query(
          `SELECT DISTINCT category FROM characters c, unnest(c.categories) AS category
          WHERE c.realm_id=$1 AND category=ANY($2::text[])`,
          [realmId, [...new Set(fresh.flatMap((character) => character.categories))]],
        )
      ).rows.map((row) => row.category as string),
    );
    const calculatedAt = new Date().toISOString();
    // Standing-v3 realms also rank a new character inside its series.
    const seriesCohorts = new Map<string, number[]>();
    if (context.standings.length)
      for (const row of (
        await tx.query(
          `SELECT series,popularity FROM characters WHERE realm_id=$1 AND popularity IS NOT NULL
          AND series=ANY($2::text[]) ORDER BY popularity DESC`,
          [realmId, [...new Set(fresh.map((character) => character.series))]],
        )
      ).rows)
        seriesCohorts.set(row.series, [
          ...(seriesCohorts.get(row.series) ?? []),
          Number(row.popularity),
        ]);
    const rows = fresh.map((character) => {
      const ranked = context.standings.length
        ? additionStanding(
            character.popularity,
            character.role,
            context.cohort,
            seriesCohorts.get(character.series) ?? [],
            context.standings,
          )
        : {
            tier: additionTier(character.popularity, context.cohort, context.fiveTiers),
            standing: null,
          };
      // Fame floors lift well-known characters; the computed tier is kept.
      const tier = adjustedTier(
        ranked.tier,
        null,
        character.popularity,
        character.sourceKey,
        context.config,
      );
      return {
        id: character.id,
        source_key: character.sourceKey,
        name: character.name,
        series: character.series,
        categories: [...new Set(character.categories)].sort(),
        tier,
        provenance: {
          source: context.source,
          revision: context.revision,
          license: context.license,
          calculationVersion:
            context.calculationVersion ??
            (context.fiveTiers ? 'source-percentile-v2' : 'source-percentile-v1'),
          calculatedAt,
          ...(character.artwork ? { artwork: character.artwork } : {}),
          importKind: `${context.source}-addition-v1`,
          rightsConfirmed: true,
          addedAt: calculatedAt,
          cohortSize: context.cohort.length,
          ...(ranked.standing === null ? {} : { standing: ranked.standing }),
          ...(character.role ? { role: character.role } : {}),
          ...(tier === ranked.tier ? {} : { tierBeforeAdjustment: ranked.tier }),
        },
        popularity: character.popularity,
      };
    });
    if (rows.length)
      await tx.query(
        `INSERT INTO characters(realm_id,id,source_key,name,series,categories,tier,provenance,popularity)
        SELECT $1,x.id,x.source_key,x.name,x.series,x.categories,x.tier,x.provenance,x.popularity
        FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,source_key text,name text,series text,categories text[],tier text,provenance jsonb,popularity bigint)`,
        [realmId, JSON.stringify(rows)],
      );
    return {
      ok: true,
      added: rows.map((row) => ({
        id: row.id,
        sourceKey: row.source_key,
        name: row.name,
        series: row.series,
        tier: row.tier as Tier,
      })),
      alreadyPresent: request.characters.length - fresh.length,
      newCategories: [
        ...new Set(rows.flatMap((row) => row.categories).filter((c) => !knownCategories.has(c))),
      ].sort(),
    };
  });
}

export type RealmArtworkGaps = {
  source: string | null;
  characterCount: number;
  /** Source keys of characters that have no artwork reference yet. */
  missing: string[];
  /** Only MyAnimeList rosters can be matched by walking popular series. */
  canFetch: boolean;
};
const artworkBackfillSchema = z.strictObject({
  artwork: z
    .array(
      z.strictObject({
        sourceKey: catalogEntrySchema.shape.sourceKey,
        artwork: providerArtworkSchema,
      }),
    )
    .min(1)
    .max(500),
  rightsConfirmed: z.literal(true),
});

/** Characters of the realm that still lack an artwork reference. */
export async function realmArtworkGaps(
  db: Database,
  actorId: string,
  realmId: string,
): Promise<RealmArtworkGaps> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  return transaction(
    db,
    async (tx) => {
      const context = await catalogContext(tx, actorId, realmId, false);
      const missing = (
        await tx.query(
          "SELECT source_key FROM characters WHERE realm_id=$1 AND NOT (provenance ? 'artwork') ORDER BY source_key",
          [realmId],
        )
      ).rows.map((row) => row.source_key as string);
      return {
        source: context.source,
        characterCount: context.characterCount,
        missing,
        canFetch: context.source === 'mal',
      };
    },
    true,
  );
}

/**
 * Adds provider artwork references to characters that have none. Existing
 * references are never replaced; names, rarity, ownership and receipts are
 * untouched. Retrying reports the characters as already updated.
 */
export async function backfillRealmArtwork(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<{ updated: number; remaining: number }> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const request = artworkBackfillSchema.parse(input);
  return transaction(db, async (tx) => {
    const context = await catalogContext(tx, actorId, realmId, true);
    if (!context.source || !extendableSources.has(context.source))
      throw new GameError(
        'CATALOG_FIXED',
        'Artwork can be added to MyAnimeList and AniList rosters only.',
        409,
      );
    if (request.artwork.some((item) => item.sourceKey.split(':')[0] !== context.source))
      throw new GameError(
        'CATALOG_INVALID',
        'Artwork must come from the same source as this realm’s roster.',
      );
    const updated =
      (
        await tx.query(
          `UPDATE characters c SET provenance=c.provenance||jsonb_build_object('artwork',x.artwork,'artworkAddedAt',$3::text)
        FROM jsonb_to_recordset($2::jsonb) AS x(source_key text,artwork jsonb)
        WHERE c.realm_id=$1 AND c.source_key=x.source_key AND NOT (c.provenance ? 'artwork')`,
          [
            realmId,
            JSON.stringify(
              request.artwork.map((item) => ({
                source_key: item.sourceKey,
                artwork: item.artwork,
              })),
            ),
            new Date().toISOString(),
          ],
        )
      ).rowCount ?? 0;
    const remaining = (
      await tx.query(
        "SELECT count(*)::int AS count FROM characters WHERE realm_id=$1 AND NOT (provenance ? 'artwork')",
        [realmId],
      )
    ).rows[0].count as number;
    return { updated, remaining };
  });
}

export type RealmGenderGaps = {
  canFetch: boolean;
  /** Source keys not yet checked, most popular first. */
  pending: string[];
  female: number;
  male: number;
};
const genderSchema = z.strictObject({
  genders: z
    .array(
      z.strictObject({
        sourceKey: catalogEntrySchema.shape.sourceKey,
        gender: z.enum(['female', 'male']).nullable(),
      }),
    )
    .min(1)
    .max(200),
  rightsConfirmed: z.literal(true),
});
const genderCategory = { female: 'Female', male: 'Male' } as const;

async function genderCounts(tx: Transaction, realmId: string) {
  const row = (
    await tx.query(
      `SELECT count(*) FILTER(WHERE 'Female'=ANY(categories))::int AS female,
      count(*) FILTER(WHERE 'Male'=ANY(categories))::int AS male FROM characters WHERE realm_id=$1`,
      [realmId],
    )
  ).rows[0];
  return { female: row.female as number, male: row.male as number };
}

/** Characters whose gender has not been checked yet (MyAnimeList rosters). */
export async function realmGenderGaps(
  db: Database,
  actorId: string,
  realmId: string,
): Promise<RealmGenderGaps> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  return transaction(
    db,
    async (tx) => {
      const context = await catalogContext(tx, actorId, realmId, false);
      const pending = (
        await tx.query(
          `SELECT source_key FROM characters WHERE realm_id=$1 AND NOT (provenance ? 'genderCheckedAt')
          AND NOT ('Female'=ANY(categories) OR 'Male'=ANY(categories))
          ORDER BY popularity DESC NULLS LAST,source_key`,
          [realmId],
        )
      ).rows.map((row) => row.source_key as string);
      return {
        canFetch: context.source === 'mal',
        pending,
        ...(await genderCounts(tx, realmId)),
      };
    },
    true,
  );
}

/**
 * Records detected genders: adds the Female or Male category (the Waifus and
 * Husbandos packs draw from them) and marks every checked character, including
 * unknown ones, so a later run only checks new characters.
 */
export async function setRealmCharacterGenders(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<{ updated: number; female: number; male: number }> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const request = genderSchema.parse(input);
  return transaction(db, async (tx) => {
    const context = await catalogContext(tx, actorId, realmId, true);
    if (!context.source || !extendableSources.has(context.source))
      throw new GameError(
        'CATALOG_FIXED',
        'Genders can be detected for MyAnimeList and AniList rosters only.',
        409,
      );
    if (request.genders.some((item) => item.sourceKey.split(':')[0] !== context.source))
      throw new GameError('CATALOG_INVALID', 'Use characters from this realm’s roster.');
    const checkedAt = new Date().toISOString();
    const updated =
      (
        await tx.query(
          `UPDATE characters c SET
          categories=CASE WHEN x.category IS NULL OR x.category=ANY(c.categories) THEN c.categories
            ELSE ARRAY(SELECT DISTINCT unnest(c.categories||ARRAY[x.category]) ORDER BY 1) END,
          provenance=c.provenance||jsonb_build_object('gender',x.gender,'genderCheckedAt',$3::text,'genderSource',$4::text)
          FROM jsonb_to_recordset($2::jsonb) AS x(source_key text,gender text,category text)
          WHERE c.realm_id=$1 AND c.source_key=x.source_key AND NOT (c.provenance ? 'genderCheckedAt')`,
          [
            realmId,
            JSON.stringify(
              request.genders.map((item) => ({
                source_key: item.sourceKey,
                gender: item.gender,
                category: item.gender ? genderCategory[item.gender] : null,
              })),
            ),
            checkedAt,
            `${context.source}-profile-v1`,
          ],
        )
      ).rowCount ?? 0;
    return { updated, ...(await genderCounts(tx, realmId)) };
  });
}
