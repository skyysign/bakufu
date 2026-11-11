import { z } from 'zod';
import {
  parseRealmConfig,
  profilePageInputSchema,
  profileLimits,
  profilePageSchema,
  tiers,
  type ProfilePage,
  type ProfileTheme,
  type Tier,
} from '../../config/src/index';
import { GameError, xpProgress, type Character, type CharacterValue } from '../../core/src/index';
import { characterValuesForRealm } from './character-values';
import { transaction, type Database, type Transaction } from './connection';
import { requireMember } from './game';
import { purchasedRankTrackLevels } from './rank-track-state';
import { realmRoster } from './roster-cache';
import { wishlistEntries } from './wishlist-state';

export type ProfileCard = Character & { cardId: string; valuation: CharacterValue };
export type PlayerSummary = {
  tradeCode: string;
  username: string | null;
  displayName: string | null;
  avatarUrl?: string;
  admin: boolean;
  level: number;
};
export type PlayerProfile = {
  /** The viewer's own page. */
  self: boolean;
  player: PlayerSummary;
  page: Omit<ProfilePage, 'updatedAt'> & { updatedAt: string | null };
  stats: {
    cards: number;
    /** Sum of the cards' market values. */
    value: number;
    rosterSize: number;
    tiers: Record<Tier, number>;
    series: number;
  };
  /** Collector ranks with at least one level. */
  ranks: { id: string; name: string; level: number; maxLevel: number }[];
  /** Pinned cards still in the collection; without any, the most valuable cards. */
  showcase: { pinned: boolean; cards: ProfileCard[] };
  /** Null while the player keeps their wishlist private. */
  wishlist: (Character & { viewerOwns: boolean })[] | null;
  /** This player's cards that are on the viewer's wishlist (other players only). */
  wanted: ProfileCard[];
};

const defaultPage = { bio: '', theme: 'violet' as ProfileTheme, showcase: [], showWishlist: false };
const automaticShowcase = 6;

async function savedPage(tx: Transaction, realmId: string, accountId: string) {
  const row = (
    await tx.query(
      'SELECT bio,theme,showcase,show_wishlist AS "showWishlist",updated_at FROM profile_pages WHERE realm_id=$1 AND account_id=$2',
      [realmId, accountId],
    )
  ).rows[0];
  return row
    ? profilePageSchema.parse({
        bio: row.bio,
        theme: row.theme,
        showcase: row.showcase,
        showWishlist: row.showWishlist,
        updatedAt: row.updated_at.toISOString(),
      })
    : null;
}
/** The player's saved page for their archive; null when they never customized it. */
export async function ownProfilePage(tx: Transaction, realmId: string, accountId: string) {
  // Exports also run on databases that are not migrated yet (before 0032).
  const exists = (await tx.query("SELECT to_regclass('profile_pages') IS NOT NULL AS present"))
    .rows[0].present;
  return exists ? savedPage(tx, realmId, accountId) : null;
}

/**
 * A player's profile page in a realm, for any member of that realm. Without a
 * trade code it is the viewer's own page. Gems are never part of a profile;
 * the collection itself is already visible to members when they trade.
 */
export async function getPlayerProfile(
  db: Database,
  actorId: string,
  realmId: string,
  tradeCode?: string,
): Promise<PlayerProfile> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const code = tradeCode === undefined ? undefined : z.uuid().parse(tradeCode);
  return transaction(
    db,
    async (tx) => {
      await requireMember(tx, realmId, actorId);
      const target = (
        await tx.query(
          `SELECT m.account_id,m.trade_code AS "tradeCode",m.role,m.xp,p.username,p.display_name AS "displayName",
          to_jsonb(p)->>'avatar_url' AS avatar_url
          FROM memberships m LEFT JOIN discord_profiles p ON p.account_id=m.account_id
          WHERE m.realm_id=$1 AND ${code ? 'm.trade_code=$2' : 'm.account_id=$2'}`,
          [realmId, code ?? actorId],
        )
      ).rows[0];
      if (!target)
        throw new GameError('PLAYER_NOT_FOUND', 'This player is not in this realm.', 404);
      const self = target.account_id === actorId;
      const config = parseRealmConfig(
        (await tx.query('SELECT config FROM realms WHERE id=$1', [realmId])).rows[0].config,
      );
      const roster = await realmRoster(tx, realmId);
      const values = await characterValuesForRealm(tx, realmId, config, config, roster);
      const owned = (
        await tx.query(
          'SELECT id,character_id FROM cards WHERE realm_id=$1 AND owner_id=$2 AND recycled_at IS NULL ORDER BY acquired_at DESC,id',
          [realmId, target.account_id],
        )
      ).rows as { id: string; character_id: string }[];
      const card = (row: { id: string; character_id: string }): ProfileCard => ({
        ...roster.byId.get(row.character_id)!.character,
        cardId: row.id,
        valuation: values[row.character_id],
      });
      const tierCounts = Object.fromEntries(tiers.map((tier) => [tier, 0])) as Record<Tier, number>;
      const series = new Set<string>();
      let value = 0;
      for (const row of owned) {
        const character = roster.byId.get(row.character_id)!.character;
        tierCounts[character.tier]++;
        series.add(character.series);
        value += values[row.character_id]?.marketValue ?? 0;
      }
      const page = (await savedPage(tx, realmId, target.account_id)) ?? {
        ...defaultPage,
        updatedAt: null,
      };
      const byCard = new Map(owned.map((row) => [row.id, row]));
      const pinned = page.showcase
        .flatMap((id) => (byCard.has(id) ? [card(byCard.get(id)!)] : []))
        .slice(0, profileLimits.showcase);
      const showcase = pinned.length
        ? pinned
        : [...owned]
            .sort(
              (a, b) =>
                (values[b.character_id]?.marketValue ?? 0) -
                  (values[a.character_id]?.marketValue ?? 0) || a.id.localeCompare(b.id),
            )
            .slice(0, automaticShowcase)
            .map(card);
      const levels = await purchasedRankTrackLevels(tx, realmId, target.account_id);
      const viewerCharacters = self
        ? new Set(owned.map((row) => row.character_id))
        : new Set(
            (
              await tx.query(
                'SELECT character_id FROM cards WHERE realm_id=$1 AND owner_id=$2 AND recycled_at IS NULL',
                [realmId, actorId],
              )
            ).rows.map((row) => row.character_id as string),
          );
      const wishlist =
        self || page.showWishlist
          ? (await wishlistEntries(tx, realmId, target.account_id)).flatMap((entry) => {
              const found = roster.byId.get(entry.character_id);
              return found && !found.retired
                ? [{ ...found.character, viewerOwns: viewerCharacters.has(entry.character_id) }]
                : [];
            })
          : null;
      const viewerWishes = self
        ? new Set<string>()
        : new Set((await wishlistEntries(tx, realmId, actorId)).map((entry) => entry.character_id));
      return {
        self,
        player: {
          tradeCode: target.tradeCode,
          username: target.username ?? null,
          displayName: target.displayName ?? null,
          ...(target.avatar_url ? { avatarUrl: target.avatar_url } : {}),
          admin: target.role === 'admin',
          level: xpProgress(target.xp, config).level,
        },
        page,
        stats: {
          cards: owned.length,
          value,
          rosterSize: roster.entries.filter((entry) => !entry.retired).length,
          tiers: tierCounts,
          series: series.size,
        },
        ranks: config.rankTracks.enabled
          ? config.rankTracks.tracks.flatMap((track) =>
              (levels[track.id] ?? 0) > 0
                ? [
                    {
                      id: track.id,
                      name: track.name,
                      level: Math.min(levels[track.id], track.levels.length),
                      maxLevel: track.levels.length,
                    },
                  ]
                : [],
            )
          : [],
        showcase: { pinned: pinned.length > 0, cards: showcase },
        wishlist,
        wanted: owned.filter((row) => viewerWishes.has(row.character_id)).map(card),
      };
    },
    true,
  );
}

/**
 * Saves the player's own profile page. Showcased cards must be cards the
 * player holds right now. Saving the same page again changes nothing but the
 * time, so a retry is safe.
 */
export async function updateProfilePage(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown,
): Promise<ProfilePage> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const page = profilePageInputSchema.parse(input);
  return transaction(db, async (tx) => {
    await requireMember(tx, realmId, actorId);
    if (page.showcase.length) {
      const held = (
        await tx.query(
          'SELECT count(*)::integer AS count FROM cards WHERE realm_id=$1 AND owner_id=$2 AND recycled_at IS NULL AND id=ANY($3::uuid[])',
          [realmId, actorId, page.showcase],
        )
      ).rows[0].count;
      if (held !== page.showcase.length)
        throw new GameError(
          'SHOWCASE_INVALID',
          'Showcase only cards that are in your collection. Nothing was saved.',
          409,
        );
    }
    const saved = (
      await tx.query(
        `INSERT INTO profile_pages(realm_id,account_id,bio,theme,showcase,show_wishlist,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())
        ON CONFLICT(realm_id,account_id) DO UPDATE SET bio=EXCLUDED.bio,theme=EXCLUDED.theme,
          showcase=EXCLUDED.showcase,show_wishlist=EXCLUDED.show_wishlist,updated_at=EXCLUDED.updated_at
        RETURNING updated_at`,
        [realmId, actorId, page.bio, page.theme, JSON.stringify(page.showcase), page.showWishlist],
      )
    ).rows[0];
    return { ...page, updatedAt: saved.updated_at.toISOString() };
  });
}

export const playerSorts = ['cards', 'rarest', 'name'] as const;
const directorySchema = z.strictObject({
  query: z
    .string()
    .trim()
    .max(80)
    .transform((value) => value.normalize('NFC'))
    .default(''),
  sort: z.enum(playerSorts).default('cards'),
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(50).default(24),
});
export type PlayerDirectoryEntry = PlayerSummary & {
  self: boolean;
  cards: number;
  tiers: Record<Tier, number>;
};
export type PlayerDirectory = { players: PlayerDirectoryEntry[]; total: number };
const directoryOrder = {
  cards: 'cards DESC,legendary DESC,epic DESC,name,m.trade_code',
  rarest: 'legendary DESC,epic DESC,rare DESC,cards DESC,name,m.trade_code',
  // Players without a Discord name come last.
  name: "lower(COALESCE(p.display_name,p.username,''))='',name,m.trade_code",
};

/**
 * The realm's players for its members: a searchable list ordered by collection
 * size, by rarest cards or by name. Card counts only; no gems.
 */
export async function listPlayers(
  db: Database,
  actorId: string,
  realmId: string,
  input: unknown = {},
): Promise<PlayerDirectory> {
  [actorId, realmId].forEach((value) => z.uuid().parse(value));
  const options = directorySchema.parse(input);
  return transaction(
    db,
    async (tx) => {
      await requireMember(tx, realmId, actorId);
      const config = parseRealmConfig(
        (await tx.query('SELECT config FROM realms WHERE id=$1', [realmId])).rows[0].config,
      );
      const filter = (query: string) =>
        `m.realm_id=$1 AND (${query}='' OR strpos(lower(COALESCE(p.username,'')),lower(${query}))>0
        OR strpos(lower(COALESCE(p.display_name,'')),lower(${query}))>0 OR m.trade_code::text=${query})`;
      const rows = (
        await tx.query(
          `SELECT m.trade_code AS "tradeCode",m.account_id=$2 AS self,m.role,m.xp,p.username,p.display_name AS "displayName",
          to_jsonb(p)->>'avatar_url' AS avatar_url,lower(COALESCE(p.display_name,p.username,'')) AS name,
          count(owned.id)::integer AS cards,
          ${tiers.map((tier) => `count(owned.id) FILTER (WHERE c.tier='${tier}')::integer AS ${tier}`).join(',')},
          count(*) OVER()::integer AS total
          FROM memberships m LEFT JOIN discord_profiles p ON p.account_id=m.account_id
          LEFT JOIN cards owned ON owned.realm_id=m.realm_id AND owned.owner_id=m.account_id AND owned.recycled_at IS NULL
          LEFT JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id
          WHERE ${filter('$3')}
          GROUP BY m.realm_id,m.account_id,m.trade_code,m.role,m.xp,p.username,p.display_name,p.account_id
          ORDER BY ${directoryOrder[options.sort]} LIMIT $4 OFFSET $5`,
          [realmId, actorId, options.query, options.limit, options.offset],
        )
      ).rows;
      const total =
        rows[0]?.total ??
        (
          await tx.query(
            `SELECT count(*)::integer AS total FROM memberships m LEFT JOIN discord_profiles p ON p.account_id=m.account_id WHERE ${filter('$2')}`,
            [realmId, options.query],
          )
        ).rows[0].total;
      return {
        total,
        players: rows.map((row) => ({
          tradeCode: row.tradeCode,
          username: row.username ?? null,
          displayName: row.displayName ?? null,
          ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
          admin: row.role === 'admin',
          level: xpProgress(row.xp, config).level,
          self: row.self,
          cards: row.cards,
          tiers: Object.fromEntries(tiers.map((tier) => [tier, row[tier]])) as Record<Tier, number>,
        })),
      };
    },
    true,
  );
}

/** Restore check: every saved page is well formed and belongs to a member. */
export async function validateProfilePages(tx: Transaction) {
  for (const row of (
    await tx.query(
      'SELECT bio,theme,showcase,show_wishlist AS "showWishlist",updated_at FROM profile_pages',
    )
  ).rows) {
    if (
      !profilePageSchema.safeParse({
        bio: row.bio,
        theme: row.theme,
        showcase: row.showcase,
        showWishlist: row.showWishlist,
        updatedAt: row.updated_at.toISOString(),
      }).success
    )
      throw new Error('Backup profile pages are invalid.');
  }
}
