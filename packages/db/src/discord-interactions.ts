import { effectiveMemberConfig } from './rank-track-state';
import { purchasedCollectorRank } from './rank-state';
import { z } from 'zod';
import { parseRealmConfig } from '../../config/src/index';
import { effectivePackPrice, GameError, packsForCatalog, xpProgress } from '../../core/src/index';
import { transaction, type Database } from './connection';
import { discordIdSchema } from './discord';
import { openPackInTransaction, requireMember } from './game';
import { purchasedUpgradeRank } from './upgrade-state';
import {
  discordMessage,
  discordQuoteId,
  discordText,
  type DiscordAction,
  type DiscordReply,
} from './discord-protocol';

export async function setDiscordGuild(
  db: Database,
  actorId: string,
  realmId: string,
  guildInput: string | null,
) {
  z.uuid().parse(actorId);
  z.uuid().parse(realmId);
  const guildId = guildInput === null ? null : discordIdSchema.parse(guildInput);
  try {
    return await transaction(db, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM realms WHERE id=$1 FOR UPDATE', [realmId])).rowCount)
        throw new GameError('NOT_FOUND', 'Realm not found.', 404);
      if ((await requireMember(tx, realmId, actorId)).role !== 'admin')
        throw new GameError('FORBIDDEN', 'Realm administrator access is required.', 403);
      const admission = (
        await tx.query(
          "SELECT guild_id FROM realm_admission_policies WHERE realm_id=$1 AND mode='discord_server'",
          [realmId],
        )
      ).rows[0];
      if (admission && admission.guild_id !== guildId)
        throw new GameError(
          'ADMISSION_ACTIVE',
          'Disable server joining before changing or unlinking this Discord server.',
          409,
        );
      if (guildId === null)
        await tx.query('DELETE FROM discord_guild_realms WHERE realm_id=$1', [realmId]);
      else
        await tx.query(
          `INSERT INTO discord_guild_realms(guild_id,realm_id,linked_by) VALUES($1,$2,$3)
      ON CONFLICT(realm_id) DO UPDATE SET guild_id=EXCLUDED.guild_id,
      id=CASE WHEN discord_guild_realms.guild_id=EXCLUDED.guild_id THEN discord_guild_realms.id ELSE gen_random_uuid() END,
      linked_by=EXCLUDED.linked_by,linked_at=clock_timestamp()`,
          [guildId, realmId, actorId],
        );
      return { ok: true, guildId };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new GameError(
        'GUILD_IN_USE',
        'This Discord server is already linked to another realm.',
        409,
      );
    throw error;
  }
}

// Only call after signature, timestamp, and application verification at the HTTP boundary.
export async function discordGameplay(
  db: Database,
  applicationId: string,
  action: DiscordAction,
): Promise<DiscordReply> {
  return transaction(db, async (tx) => {
    // All adapters lock the realm first; binding edits cannot race confirmation.
    const realm = (
      await tx.query(
        `SELECT r.id,r.name,r.config,r.config_revision FROM realms r
      JOIN discord_guild_realms b ON b.realm_id=r.id WHERE b.guild_id=$1 FOR UPDATE OF r`,
        [action.guildId],
      )
    ).rows[0];
    if (!realm)
      throw new GameError(
        'GUILD_NOT_LINKED',
        'This Discord server is not linked to a realm. Ask its realm administrator.',
      );
    const binding = (
      await tx.query('SELECT id FROM discord_guild_realms WHERE realm_id=$1 AND guild_id=$2', [
        realm.id,
        action.guildId,
      ])
    ).rows[0];
    if (!binding)
      throw new GameError('GUILD_NOT_LINKED', 'The server link changed. Run the command again.');
    const identity = (
      await tx.query(
        "SELECT account_id FROM account_identities WHERE provider='discord' AND subject=$1",
        [action.subject],
      )
    ).rows[0];
    if (!identity)
      throw new GameError(
        'DISCORD_NOT_INVITED',
        'Ask the realm administrator to invite or link your Discord account.',
        403,
      );
    const actorId = identity.account_id,
      member = await requireMember(tx, realm.id, actorId);
    if (action.kind === 'collection') {
      const pageSize = 10,
        total = Number(
          (
            await tx.query(
              'SELECT count(*) AS count FROM cards WHERE realm_id=$1 AND owner_id=$2 AND recycled_at IS NULL',
              [realm.id, actorId],
            )
          ).rows[0].count,
        ),
        pages = Math.max(1, Math.ceil(total / pageSize));
      if (action.page > pages)
        return discordMessage(
          `Your collection has ${pages} ${pages === 1 ? 'page' : 'pages'}. Use /bakufu collection page:${pages}.`,
        );
      if (!total)
        return discordMessage(
          `${discordText(realm.name)}\nYour collection is empty. Open a pack on the website to collect your first character.`,
        );
      const cards = (
        await tx.query(
          `SELECT ch.name,ch.series,ch.tier FROM cards c
        JOIN characters ch ON ch.realm_id=c.realm_id AND ch.id=c.character_id
        WHERE c.realm_id=$1 AND c.owner_id=$2 AND c.recycled_at IS NULL
        ORDER BY CASE ch.tier WHEN 'legendary' THEN 0 WHEN 'epic' THEN 1 WHEN 'rare' THEN 2 WHEN 'uncommon' THEN 3 ELSE 4 END,
        ch.name COLLATE "C",ch.id,c.id LIMIT $3 OFFSET $4`,
          [realm.id, actorId, pageSize, (action.page - 1) * pageSize],
        )
      ).rows as { name: string; series: string; tier: string }[];
      // Bound each field before escaping: ten complete rows still fit Discord's
      // content limit even when every character requires Markdown escaping.
      const field = (value: string, maximum: number) =>
        discordText(Array.from(value).slice(0, maximum).join(''));
      return discordMessage(
        `${discordText(realm.name)} · Your collection\n${total} cards · Page ${action.page}/${pages}\n` +
          cards
            .map(
              (card, index) =>
                `${(action.page - 1) * pageSize + index + 1}. ${field(card.name, 40)} · ${card.tier}\n   ${field(card.series, 25)}`,
            )
            .join('\n') +
          `\n${action.page < pages ? `Next: /bakufu collection page:${action.page + 1}. ` : ''}` +
          `${action.share ? 'Shared in this channel. ' : 'Only you can see this page. '}` +
          'Manage cards and trades on the website.',
        undefined,
        action.share,
      );
    }
    const config = await effectiveMemberConfig(
      tx,
      realm.id,
      actorId,
      parseRealmConfig(realm.config),
      realm.config.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realm.id, actorId) : 0,
    );
    const price = effectivePackPrice(config, await purchasedUpgradeRank(tx, realm.id, actorId));
    if (action.kind === 'status') {
      const count = (
        await tx.query(
          'SELECT count(*)::integer AS count FROM cards WHERE realm_id=$1 AND owner_id=$2 AND recycled_at IS NULL',
          [realm.id, actorId],
        )
      ).rows[0].count;
      return discordMessage(
        `${discordText(realm.name)}\n${member.balance} gems · ${member.xp} XP · Level ${xpProgress(member.xp, config).level}\n${count} active cards · Your pack price: ${price} gems\nTrading, recycling, upgrades, and export are available on the website.`,
      );
    }
    if (action.kind === 'packs') {
      const characters = (
        await tx.query(
          'SELECT source_key AS "sourceKey",categories FROM characters WHERE realm_id=$1',
          [realm.id],
        )
      ).rows as { sourceKey: string; categories: string[] }[];
      const packs = packsForCatalog(
        (
          await tx.query(`SELECT id,name,category FROM packs p WHERE realm_id=$1 AND (to_jsonb(p)->>'retired_at') IS NULL ORDER BY name,id`, [
            realm.id,
          ])
        ).rows as { id: string; name: string; category: string | null }[],
        characters,
      ).slice(0, 12);
      return discordMessage(
        `${discordText(realm.name)} · ${price} gems per ${config.packSize}-card pack\n${packs.map((p) => `${discordText(p.name)} — ${p.id}`).join('\n')}\nUse /bakufu open with a pack name or ID. Availability is checked when you confirm. See the website for all packs and current odds.`,
      );
    }
    if (action.kind === 'quote') {
      const characters = (
        await tx.query(
          'SELECT source_key AS "sourceKey",categories FROM characters WHERE realm_id=$1',
          [realm.id],
        )
      ).rows as { sourceKey: string; categories: string[] }[];
      const packs = packsForCatalog(
        (
          await tx.query(
            `SELECT id,name,name AS "storedName",category FROM packs p WHERE realm_id=$1 AND (to_jsonb(p)->>'retired_at') IS NULL ORDER BY id`,
            [realm.id],
          )
        ).rows as { id: string; name: string; storedName: string; category: string | null }[],
        characters,
      )
        .filter(
          (pack) =>
            pack.id === action.pack ||
            pack.storedName.toLowerCase() === action.pack.toLowerCase() ||
            pack.name.toLowerCase() === action.pack.toLowerCase(),
        )
        .slice(0, 2);
      if (packs.length !== 1)
        throw new GameError('INVALID_PACK', 'Choose an exact pack name or ID from /bakufu packs.');
      const id = discordQuoteId(applicationId, action.id),
        pack = packs[0];
      // Bound transient storage, without removing a receipt's stable request key.
      await tx.query(
        "DELETE FROM discord_pack_quotes WHERE realm_id=$1 AND expires_at<clock_timestamp()-interval '1 day'",
        [realm.id],
      );
      await tx.query(
        `INSERT INTO discord_pack_quotes(id,realm_id,account_id,guild_id,pack_id,config_revision,quoted_price,pack_size,binding_id,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '10 minutes') ON CONFLICT(id) DO NOTHING`,
        [
          id,
          realm.id,
          actorId,
          action.guildId,
          pack.id,
          realm.config_revision,
          price,
          config.packSize,
          binding.id,
        ],
      );
      const quote = (await tx.query('SELECT * FROM discord_pack_quotes WHERE id=$1', [id])).rows[0];
      if (
        quote.realm_id !== realm.id ||
        quote.account_id !== actorId ||
        quote.guild_id !== action.guildId ||
        quote.pack_id !== pack.id ||
        quote.binding_id !== binding.id
      )
        throw new GameError(
          'IDEMPOTENCY_CONFLICT',
          'This request was already used for a different offer.',
          409,
        );
      return discordMessage(
        `${discordText(realm.name)} · ${discordText(pack.name)}\nOpen ${quote.pack_size} card(s) for at most ${quote.quoted_price} gems.\nConfirm within 10 minutes. No gems have been spent. Availability, balance, cooldown, and current rules are checked on confirmation.`,
        id,
      );
    }
    const quote = (
      await tx.query(
        'SELECT *,expires_at<=clock_timestamp() AS expired FROM discord_pack_quotes WHERE id=$1 AND realm_id=$2 AND account_id=$3 AND guild_id=$4 AND binding_id=$5',
        [action.quoteId, realm.id, actorId, action.guildId, binding.id],
      )
    ).rows[0];
    if (!quote)
      throw new GameError(
        'QUOTE_EXPIRED',
        'This review expired or is unavailable. Run /bakufu open again.',
      );
    const prior = (
      await tx.query(
        'SELECT 1 FROM openings WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
        [realm.id, actorId, quote.id],
      )
    ).rowCount;
    if (quote.expired && !prior)
      throw new GameError('QUOTE_EXPIRED', 'This review expired. Run /bakufu open again.');
    const result = await openPackInTransaction(
      tx,
      actorId,
      realm.id,
      quote.pack_id,
      quote.id,
      quote.config_revision,
    );
    if (!result.ok)
      return discordMessage(
        `${result.message}\nNo gems or cooldown were spent. To try a new draw, run /bakufu open again.`,
      );
    return discordMessage(
      `${discordText(realm.name)} · Pack opened\n${result.characters
        .slice(0, 10)
        .map((c) => `${discordText(c.name)} · ${c.tier}`)
        .join(
          '\n',
        )}${result.characters.length > 10 ? '\nMore cards are visible on the website.' : ''}\nSpent ${result.charged} gems · Balance after this opening: ${result.balance}\nXP awarded: ${result.progression?.xpAwarded ?? 0}\nReceipt: ${quote.id}\nRepeated confirmation replays this receipt without spending again. The website shows your current collection and balance.`,
    );
  });
}
