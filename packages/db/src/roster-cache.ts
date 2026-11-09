import type { Character } from '../../core/src/index';
import type { Tier } from '../../config/src/index';
import type { Transaction } from './connection';

/**
 * A realm's characters, kept in this server process so ordinary requests do
 * not download the whole roster from PostgreSQL every time.
 *
 * Every read still asks the database, inside the caller's transaction, for an
 * MD5 digest of the realm's character rows (computed by PostgreSQL, 32 bytes
 * on the wire). The rows themselves travel only when the digest differs from
 * the cached copy, so a result is always exactly what the transaction sees:
 * any import, removal, tier or tag change alters the digest. Ownership is
 * never cached; `claims` reads it as one '0'/'1' character per roster entry.
 *
 * Hosted databases such as Neon bill or cap data transfer, and before this a
 * single page view of a 3,000-character realm moved about 1.4 MB.
 */
export type RosterEntry = {
  character: Character;
  popularity: number | null;
  retired: boolean;
  /** Position in `ORDER BY name,id` (database collation), retired included. */
  nameOrder: number;
};
export type Roster = {
  /** Every character of the realm, retired ones included, in `ORDER BY id`. */
  entries: readonly RosterEntry[];
  byId: ReadonlyMap<string, RosterEntry>;
};
type Cached = Roster & { hash: string };

const maximumRealms = 16;
const cache = new Map<string, Cached>();

type RosterRow = {
  id: string;
  sourceKey: string;
  name: string;
  series: string;
  categories: string[];
  tier: Tier;
  artwork: Character['artwork'] | null;
  popularity: number | string | null;
  retired: boolean;
  nameOrder: number;
};

function freezeEntry(row: RosterRow): RosterEntry {
  const character: Character = {
    id: row.id,
    sourceKey: row.sourceKey,
    name: row.name,
    series: row.series,
    categories: Object.freeze([...row.categories]) as string[],
    tier: row.tier,
    ...(row.artwork ? { artwork: Object.freeze({ ...row.artwork }) } : {}),
  };
  return Object.freeze({
    character: Object.freeze(character),
    popularity: row.popularity === null ? null : Number(row.popularity),
    retired: row.retired,
    nameOrder: row.nameOrder,
  });
}

export async function realmRoster(
  tx: Transaction,
  realmId: string,
  options: { claims: true },
): Promise<Roster & { claimed: readonly boolean[] }>;
export async function realmRoster(tx: Transaction, realmId: string): Promise<Roster>;
export async function realmRoster(
  tx: Transaction,
  realmId: string,
  options: { claims?: boolean } = {},
): Promise<Roster & { claimed?: readonly boolean[] }> {
  // Restore and upgrade checks read schema snapshots that predate these columns.
  const columns = (
    await tx.query(
      `SELECT COALESCE(bool_or(attname='popularity'),false) AS popularity,
      COALESCE(bool_or(attname='retired_at'),false) AS retired
      FROM pg_attribute WHERE attrelid='characters'::regclass
      AND attname IN('popularity','retired_at') AND NOT attisdropped`,
    )
  ).rows[0] as { popularity: boolean; retired: boolean };
  const cached = cache.get(realmId);
  const row = (
    await tx.query(
      `WITH roster AS (
        SELECT c.id,c.source_key AS "sourceKey",c.name,c.series,c.categories,c.tier,
        c.provenance->'artwork' AS artwork,
        ${columns.popularity ? 'c.popularity::numeric' : 'NULL::numeric'} AS popularity,
        ${columns.retired ? 'c.retired_at IS NOT NULL' : 'false'} AS retired,
        row_number() OVER (ORDER BY c.name,c.id)::int AS "nameOrder"
        FROM characters c WHERE c.realm_id=$1
      ), digest AS (
        SELECT md5(COALESCE(string_agg(r::text,E'\\n' ORDER BY r.id),'')) AS hash FROM roster r
      )
      SELECT d.hash,
      ${
        options.claims
          ? `(SELECT COALESCE(string_agg(CASE WHEN EXISTS(SELECT 1 FROM cards o WHERE o.realm_id=$1
            AND o.character_id=r.id AND o.recycled_at IS NULL) THEN '1' ELSE '0' END,'' ORDER BY r.id),'')
            FROM roster r)`
          : 'NULL::text'
      } AS claimed,
      CASE WHEN d.hash IS DISTINCT FROM $2::text
        THEN (SELECT COALESCE(json_agg(r ORDER BY r.id),'[]'::json) FROM roster r) END AS rows
      FROM digest d`,
      [realmId, cached?.hash ?? null],
    )
  ).rows[0] as { hash: string; claimed: string | null; rows: RosterRow[] | null };
  let roster: Cached;
  if (cached && cached.hash === row.hash) {
    roster = cached;
    cache.delete(realmId);
  } else {
    const entries = Object.freeze((row.rows ?? []).map(freezeEntry));
    roster = {
      hash: row.hash,
      entries,
      byId: new Map(entries.map((entry) => [entry.character.id, entry])),
    };
  }
  cache.set(realmId, roster);
  while (cache.size > maximumRealms) cache.delete(cache.keys().next().value!);
  if (!options.claims) return { entries: roster.entries, byId: roster.byId };
  const claims = row.claimed ?? '';
  if (claims.length !== roster.entries.length)
    throw new Error('Roster ownership did not match the roster.');
  return {
    entries: roster.entries,
    byId: roster.byId,
    claimed: Array.from(claims, (flag) => flag === '1'),
  };
}
