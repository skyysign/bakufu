import { z } from 'zod';
import { parseRealmConfig, tiers, type Tier } from '../../config/src/index';
import type { Character, CharacterValue } from '../../core/src/index';
import { characterValuesForRealm } from './character-values';
import { transaction, type Database } from './connection';
import { requireMember } from './game';
import { purchasedCollectorRank } from './rank-state';
import { effectiveMemberConfig } from './rank-track-state';

const browseSchema = z.strictObject({
  query: z.string().trim().max(100).default(''),
  tier: z.enum(['all', ...tiers]).default('all'),
  status: z.enum(['all', 'yours', 'claimed', 'available']).default('all'),
  /** Wishlist pickers hide characters this member already wished for. */
  excludeWished: z.boolean().default(false),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(60).default(24),
});
export type CatalogBrowseInput = z.input<typeof browseSchema>;
export type CatalogBrowseCharacter = Character & {
  status: 'yours' | 'claimed' | 'available';
  valuation: CharacterValue;
};
export type CatalogBrowsePage = {
  characters: CatalogBrowseCharacter[];
  total: number;
  offset: number;
  limit: number;
};

/**
 * Read-only, realm-scoped catalog paging for the glossary and wishlist picker.
 * Matching uses the same "name series categories" text and name order as the
 * full realm view, so large provider rosters never need to reach the browser.
 */
export async function browseRealmCatalog(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown = {},
): Promise<CatalogBrowsePage> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const options = browseSchema.parse(input);
  return transaction(
    db,
    async (tx) => {
      await requireMember(tx, realmId, actorId);
      const stored = (await tx.query('SELECT config FROM realms WHERE id=$1', [realmId])).rows[0]
        .config;
      const config = parseRealmConfig(stored);
      const rank = stored.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, actorId) : 0;
      const effectiveConfig = await effectiveMemberConfig(tx, realmId, actorId, config, rank);
      const rows = (
        await tx.query(
          `WITH catalog AS (
            SELECT c.id,c.source_key AS "sourceKey",c.name,c.series,c.categories,c.tier,c.provenance->'artwork' AS artwork,
              CASE WHEN owned.owner_id=$2 THEN 'yours' WHEN owned.id IS NOT NULL THEN 'claimed' ELSE 'available' END AS status
            FROM characters c LEFT JOIN cards owned ON owned.realm_id=c.realm_id AND owned.character_id=c.id AND owned.recycled_at IS NULL
            WHERE c.realm_id=$1
              AND ($3='' OR strpos(lower(c.name || ' ' || c.series || ' ' || array_to_string(c.categories,' ')),lower($3))>0)
              AND ($4='all' OR c.tier=$4)
              AND (NOT $6 OR NOT EXISTS(SELECT 1 FROM wishlist_entries w WHERE w.realm_id=c.realm_id AND w.account_id=$2 AND w.character_id=c.id))
          )
          SELECT *,count(*) OVER()::int AS total FROM catalog WHERE ($5='all' OR status=$5)
          ORDER BY name,id LIMIT $7 OFFSET $8`,
          [
            realmId,
            actorId,
            options.query,
            options.tier,
            options.status,
            options.excludeWished,
            options.limit,
            options.offset,
          ],
        )
      ).rows;
      const total =
        rows[0]?.total ??
        (options.offset > 0
          ? (
              await tx.query(
                `SELECT count(*)::int AS total FROM characters c LEFT JOIN cards owned ON owned.realm_id=c.realm_id AND owned.character_id=c.id AND owned.recycled_at IS NULL
                WHERE c.realm_id=$1
                  AND ($3='' OR strpos(lower(c.name || ' ' || c.series || ' ' || array_to_string(c.categories,' ')),lower($3))>0)
                  AND ($4='all' OR c.tier=$4)
                  AND (NOT $6 OR NOT EXISTS(SELECT 1 FROM wishlist_entries w WHERE w.realm_id=c.realm_id AND w.account_id=$2 AND w.character_id=c.id))
                  AND ($5='all' OR CASE WHEN owned.owner_id=$2 THEN 'yours' WHEN owned.id IS NOT NULL THEN 'claimed' ELSE 'available' END=$5)`,
                [
                  realmId,
                  actorId,
                  options.query,
                  options.tier,
                  options.status,
                  options.excludeWished,
                ],
              )
            ).rows[0].total
          : 0);
      const values = rows.length
        ? await characterValuesForRealm(tx, realmId, config, effectiveConfig)
        : {};
      return {
        characters: rows.map(({ artwork, total: _total, ...character }) => {
          void _total;
          return {
            ...character,
            tier: character.tier as Tier,
            ...(artwork ? { artwork } : {}),
            valuation: values[character.id],
          };
        }),
        total,
        offset: options.offset,
        limit: options.limit,
      };
    },
    true,
  );
}
