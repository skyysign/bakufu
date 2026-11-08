import { z } from 'zod';
import { parseRealmConfig, tiers, type Tier } from '../../config/src/index';
import type { CharacterValue } from '../../core/src/index';
import { characterValuesForRealm } from './character-values';
import { transaction, type Database } from './connection';
import { requireMember } from './game';
import { purchasedCollectorRank } from './rank-state';
import { effectiveMemberConfig } from './rank-track-state';

export type PulledCard = {
  key: string;
  openingId: string;
  characterId: string;
  sourceKey: string;
  name: string;
  series: string;
  categories: string[];
  tier: Tier;
  /** The saved provider artwork reference, exactly as awarded (never image bytes). */
  artwork?: Record<string, unknown>;
  packName: string;
  pulledAt: string;
  /** Discord profile when the collector signed in with Discord; never an email. */
  collector: { name: string; username: string; avatarUrl?: string } | null;
  mine: boolean;
  /** Who holds the character now, as in the glossary. */
  status: 'yours' | 'claimed' | 'available';
  /** Current character value, like collection and glossary cards. */
  valuation?: CharacterValue;
};
export type PullFeed = { pulls: PulledCard[] };
/** The Packs page shows notable pulls only. */
export const notablePullTiers: readonly Tier[] = ['rare', 'epic', 'legendary'];

/**
 * The realm's most recent pulls for the "Big pulls" tracker on the Packs page.
 * Members only. Reads saved opening receipts, newest first (by default only
 * rare and above), so it shows exactly what was awarded and never queries
 * providers.
 */
export async function recentPulls(
  db: Database,
  actorId: string,
  realmId: string,
  options: { limit?: number; tiers?: readonly Tier[] } = {},
): Promise<PullFeed> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const cards = z
    .number()
    .int()
    .min(1)
    .max(48)
    .parse(options.limit ?? 12);
  const wanted = z
    .array(z.enum(tiers))
    .min(1)
    .parse(options.tiers ?? notablePullTiers);
  return transaction(
    db,
    async (tx) => {
      await requireMember(tx, realmId, actorId);
      const rows = (
        await tx.query(
          `SELECT o.id,o.created_at,o.account_id=$2 AS mine,pk.name AS pack_name,
          o.result->'characters' AS characters,p.username,p.display_name,
          to_jsonb(p)->>'avatar_url' AS avatar_url
          FROM openings o
          LEFT JOIN packs pk ON pk.realm_id=o.realm_id AND pk.id=o.pack_id
          LEFT JOIN discord_profiles p ON p.account_id=o.account_id
          WHERE o.realm_id=$1 AND o.result->>'ok'='true'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.result->'characters') c WHERE c->>'tier'=ANY($4::text[]))
          ORDER BY o.created_at DESC,o.id DESC LIMIT $3`,
          [realmId, actorId, cards, wanted],
        )
      ).rows;
      const pulls: PulledCard[] = [];
      for (const row of rows) {
        const awarded = (Array.isArray(row.characters) ? row.characters : []) as {
          id: string;
          sourceKey: string;
          name: string;
          series: string;
          categories?: string[];
          tier: Tier;
          artwork?: Record<string, unknown>;
        }[];
        // Within one opening the last card is the most recent reveal.
        [...awarded].reverse().forEach((character, reversed) => {
          if (!wanted.includes(character.tier)) return;
          const index = awarded.length - 1 - reversed;
          pulls.push({
            key: `${row.id}:${index}`,
            openingId: row.id,
            characterId: character.id,
            sourceKey: character.sourceKey,
            name: character.name,
            series: character.series,
            categories: character.categories ?? [],
            tier: character.tier,
            ...(character.artwork ? { artwork: character.artwork } : {}),
            packName: row.pack_name ?? 'A pack',
            pulledAt: (row.created_at as Date).toISOString(),
            collector: row.username
              ? {
                  name: row.display_name ?? row.username,
                  username: row.username,
                  ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
                }
              : null,
            mine: row.mine,
            status: 'available',
          });
        });
        if (pulls.length >= cards) break;
      }
      const shown = pulls.slice(0, cards);
      if (!shown.length) return { pulls: shown };
      // Same details as the collection and glossary inspectors.
      const owners = new Map(
        (
          await tx.query(
            'SELECT character_id,owner_id=$2 AS mine FROM cards WHERE realm_id=$1 AND recycled_at IS NULL AND character_id=ANY($3::uuid[])',
            [realmId, actorId, [...new Set(shown.map((pull) => pull.characterId))]],
          )
        ).rows.map((row) => [row.character_id as string, row.mine as boolean]),
      );
      const stored = (await tx.query('SELECT config FROM realms WHERE id=$1', [realmId])).rows[0]
        .config;
      const config = parseRealmConfig(stored);
      const rank =
        stored.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, actorId) : 0;
      const values = await characterValuesForRealm(
        tx,
        realmId,
        config,
        await effectiveMemberConfig(tx, realmId, actorId, config, rank),
      );
      return {
        pulls: shown.map((pull) => {
          const owned = owners.get(pull.characterId);
          const valuation = values[pull.characterId];
          return {
            ...pull,
            status: owned === undefined ? 'available' : owned ? 'yours' : 'claimed',
            ...(valuation ? { valuation } : {}),
          };
        }),
      };
    },
    true,
  );
}
