import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { parseRealmConfig, type RealmConfig, type Tier } from '../../config/src/index';
import {
  characterValueSchema,
  popularityPercentiles,
  quoteCharacterValue,
  quoteCharacterValues,
  GameError,
  type CharacterValue,
} from '../../core/src/index';
import { catalogSchema } from '../../importers/src/json';
import { transaction, type Database, type Transaction } from './connection';
import { requireMember } from './game';
import { realmRoster, type Roster } from './roster-cache';

export async function characterValuesForRealm(
  tx: Transaction,
  realmId: string,
  config: RealmConfig,
  effectiveConfig: RealmConfig = config,
  /** The roster this transaction already read (see roster-cache.ts). */
  known?: Roster,
): Promise<Record<string, CharacterValue>> {
  // Every character of the realm (retired included) with its popularity comes
  // from the verified roster cache; only wishlist demand is read here.
  const roster = known ?? (await realmRoster(tx, realmId));
  const demand = new Map(
    (
      await tx.query(
        `SELECT w.character_id,count(*)::int AS demand FROM wishlist_entries w
      WHERE w.realm_id=$1 AND NOT EXISTS(SELECT 1 FROM cards owned WHERE owned.realm_id=w.realm_id AND owned.character_id=w.character_id AND owned.recycled_at IS NULL AND owned.owner_id=w.account_id)
      GROUP BY w.character_id`,
        [realmId],
      )
    ).rows.map((row) => [row.character_id as string, row.demand as number]),
  );
  const rows = roster.entries.map((entry) => ({
    id: entry.character.id,
    sourceKey: entry.character.sourceKey,
    tier: entry.character.tier,
    popularity: entry.popularity,
    demand: demand.get(entry.character.id) ?? 0,
  }));
  const percentiles = popularityPercentiles(
    rows as { id: string; sourceKey: string; tier: Tier; popularity: number | null }[],
  );
  const quotes = quoteCharacterValues(
    rows.map((row) => ({
      baseValue: config.recycleRewards[row.tier as Tier],
      recycleBonus:
        effectiveConfig.recycleRewards[row.tier as Tier] - config.recycleRewards[row.tier as Tier],
      popularity: row.popularity,
      popularityPercentileBps: percentiles.get(row.id) ?? 0,
      wishlistDemand: row.demand,
    })),
    config.characterValues,
  );
  return Object.fromEntries(rows.map((row, index) => [row.id, quotes[index]]));
}

export async function validateCharacterValues(tx: Transaction) {
  for (const row of (await tx.query('SELECT result,config_snapshot FROM recyclings')).rows) {
    const config = parseRealmConfig(row.config_snapshot);
    if (!row.result.valuation) {
      if (config.characterValues.enabled)
        throw new Error('Recycling valuation evidence is missing.');
      continue;
    }
    const quote = characterValueSchema.parse(row.result.valuation);
    const expected = quoteCharacterValue({ ...quote, rules: config.characterValues });
    if (
      !isDeepStrictEqual(quote, expected) ||
      quote.recycleValue !== row.result.credited ||
      quote.baseValue + quote.recycleBonus !== config.recycleRewards[row.result.tier as Tier]
    )
      throw new Error('Recycling valuation evidence is invalid.');
  }
}

async function popularityReview(tx: Transaction, actorId: string, realmId: string, input: unknown) {
  const catalog = catalogSchema.parse(input);
  const realm = (await tx.query('SELECT id FROM realms WHERE id=$1 FOR UPDATE', [realmId])).rows[0];
  if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
  if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
    throw new GameError(
      'FORBIDDEN',
      'Only a realm administrator can restore catalog popularity.',
      403,
    );
  const saved = (
    await tx.query(
      "SELECT id,source_key,popularity,provenance->>'source' AS source,provenance->>'revision' AS revision FROM characters WHERE realm_id=$1 ORDER BY id",
      [realmId],
    )
  ).rows;
  const provided = new Map(catalog.characters.map((character) => [character.id, character]));
  const changes: { id: string; popularity: number }[] = [];
  let matched = 0;
  for (const character of saved) {
    const evidence = provided.get(character.id);
    if (
      !evidence ||
      evidence.sourceKey !== character.source_key ||
      catalog.source !== character.source ||
      catalog.revision !== character.revision
    )
      continue;
    matched++;
    if (evidence.popularity === null) continue;
    if (character.popularity !== null && Number(character.popularity) !== evidence.popularity)
      throw new GameError(
        'POPULARITY_CONFLICT',
        'The saved catalog popularity conflicts with existing evidence.',
        409,
      );
    if (character.popularity === null)
      changes.push({ id: character.id, popularity: evidence.popularity });
  }
  if (!matched)
    throw new GameError(
      'CATALOG_MISMATCH',
      'This catalog does not match the saved realm source and revision.',
      409,
    );
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        source: catalog.source,
        revision: catalog.revision,
        saved,
        changes,
      }),
    )
    .digest('hex');
  return { changes, hash, matched };
}
export async function previewCharacterPopularity(
  db: Database,
  actorId: string,
  realmId: string,
  catalog: unknown,
) {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  return transaction(db, async (tx) => {
    const value = await popularityReview(tx, actorId, realmId, catalog);
    return {
      previewHash: value.hash,
      matchedCharacters: value.matched,
      changedCharacters: value.changes.length,
    };
  });
}
export async function applyCharacterPopularity(
  db: Database,
  actorId: string,
  realmId: string,
  catalog: unknown,
  previewHash: string,
) {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(previewHash);
  return transaction(db, async (tx) => {
    const value = await popularityReview(tx, actorId, realmId, catalog);
    if (value.hash !== previewHash)
      throw new GameError('PREVIEW_STALE', 'Review catalog popularity again before applying.', 409);
    for (const change of value.changes)
      await tx.query(
        'UPDATE characters SET popularity=$3 WHERE realm_id=$1 AND id=$2 AND popularity IS NULL',
        [realmId, change.id, change.popularity],
      );
    return {
      ok: true as const,
      matchedCharacters: value.matched,
      changedCharacters: value.changes.length,
    };
  });
}
