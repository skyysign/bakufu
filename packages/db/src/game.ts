import { gemRewardState } from './gem-rewards';
import { characterValuesForRealm } from './character-values';
import { gemRewardView } from '../../core/src/gem-rewards';
import { collectorRankView } from '../../core/src/ranks';
import { rankTracksView } from '../../core/src/rank-tracks';
import { effectiveMemberConfig, purchasedRankTrackLevels } from './rank-track-state';
import { purchasedCollectorRank } from './rank-state';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaultConfig, parseRealmConfig, type RealmConfig } from '../../config/src/index';
import {
  characterSoundsForRealm,
  tierSoundsForRealm,
  type CharacterSounds,
  type TierSounds,
} from './tier-sounds';
import {
  availableOdds,
  selectedCharacterOdds,
  drawableCount,
  selectPackSpotlights,
  packsForCatalog,
  catalogPackGrouping,
  drawPacks,
  requirePackOpeningCount,
  calculateXpAward,
  xpProgress,
  effectivePackPrice,
  upgradeView,
  GameError,
  type Character,
  type OpeningResult,
} from '../../core/src/index';
import { addMembership, requireInstanceAdmin } from './auth';
import { transaction, type Database, type Transaction } from './connection';
import { purchasedUpgradeRank } from './upgrade-state';
import { wishlistEntries } from './wishlist-state';
import { requireExpectedRevision } from './settings-revision';
import { tradeViews } from './trade-state';
import { admissionPolicy, type AdmissionPolicy } from './admission';
import { prepareRealmCatalog } from './catalog';
import {
  memberProfiles,
  ownDiscordProfile,
  type DiscordProfile,
  type RealmMember,
} from './member-profiles';

export async function requireMember(tx: Transaction, realmId: string, accountId: string) {
  const member = (
    await tx.query(
      'SELECT role,balance,xp,last_opened_at FROM memberships WHERE realm_id=$1 AND account_id=$2',
      [realmId, accountId],
    )
  ).rows[0];
  if (!member) throw new GameError('FORBIDDEN', 'You are not a member of this realm.', 403);
  return member as {
    role: 'admin' | 'player';
    balance: number;
    xp: number;
    last_opened_at: Date | null;
  };
}

export async function createRealm(
  db: Database,
  actorId: string,
  nameInput: string,
  input: unknown = defaultConfig,
  catalog?: unknown,
  expectedPreview?: string,
  packPlan?: unknown,
  requestKey?: unknown,
): Promise<string> {
  const name = z.string().trim().min(1).max(80).parse(nameInput);
  return transaction(db, async (tx) => {
    await requireInstanceAdmin(tx, actorId);
    const { config, parsed, floorBases, packs, preview, legacyFingerprints } = prepareRealmCatalog(
      input,
      catalog,
      packPlan,
    );
    const reviewedFingerprint =
      expectedPreview !== undefined && legacyFingerprints.includes(expectedPreview)
        ? expectedPreview
        : preview.fingerprint;
    const key = requestKey === undefined ? undefined : z.uuid().parse(requestKey).toLowerCase();
    const receiptFingerprint = (previewFingerprint: string) =>
      createHash('sha256')
        .update(
          JSON.stringify({
            schemaVersion: 1,
            name,
            preview: previewFingerprint,
            expectedPreview: expectedPreview ?? null,
          }),
        )
        .digest('hex');
    const fingerprint = receiptFingerprint(reviewedFingerprint);
    if (key) {
      await tx.query('SELECT pg_advisory_xact_lock(73103506,hashtext($1))', [
        `${actorId.toLowerCase()}:${key}`,
      ]);
      const previous = (
        await tx.query(
          'SELECT realm_id,fingerprint FROM realm_creation_requests WHERE account_id=$1 AND request_key=$2',
          [actorId, key],
        )
      ).rows[0];
      if (previous) {
        const oldUnreviewedDemo =
          expectedPreview === undefined &&
          catalog === undefined &&
          packPlan === undefined &&
          legacyFingerprints.length > 0;
        if (
          previous.fingerprint !== fingerprint &&
          !(
            oldUnreviewedDemo &&
            legacyFingerprints.some((legacy) => previous.fingerprint === receiptFingerprint(legacy))
          )
        )
          throw new GameError(
            'IDEMPOTENCY_CONFLICT',
            'This creation request was used for a different proposal. Review the realm list and preview your new proposal.',
            409,
          );
        return previous.realm_id as string;
      }
    }
    if (
      (catalog !== undefined || packPlan !== undefined || expectedPreview !== undefined) &&
      expectedPreview !== reviewedFingerprint
    )
      throw new GameError(
        'CATALOG_PREVIEW_CHANGED',
        'Preview this catalog and these settings again before creating the realm.',
        409,
      );
    const id = randomUUID();
    await tx.query('INSERT INTO realms(id,name,config,created_by) VALUES($1,$2,$3,$4)', [
      id,
      name,
      config,
      actorId,
    ]);
    await addMembership(tx, id, actorId, 'admin', config.startingGems);
    const popularity = new Map(
      parsed.catalog.characters.map((character) => [character.id, character.popularity ?? null]),
    );
    const calculatedAt = new Date().toISOString();
    const importKind =
      catalog === undefined
        ? undefined
        : parsed.catalog.source === 'anilist'
            ? 'anilist-metadata-v1'
            : parsed.catalog.source === 'mal'
              ? 'mal-metadata-v1'
              : `${preview.kind}-v1`;
    const roles = new Map(
      parsed.catalog.characters.map((entry) => [entry.id, entry.role] as const),
    );
    const rows = parsed.characters.map((c) => ({
      id: c.id,
      source_key: c.sourceKey,
      name: c.name,
      series: c.series,
      categories: c.categories,
      tier: c.tier,
      provenance: {
        source: parsed.catalog.source,
        revision: parsed.catalog.revision,
        license: parsed.catalog.license,
        calculationVersion: parsed.calculationVersion,
        calculatedAt,
        // Standing and cast role let later additions rank against this roster.
        ...(parsed.standings?.has(c.id)
          ? { standing: Number(parsed.standings.get(c.id)!.score.toFixed(6)) }
          : {}),
        ...(roles.get(c.id) ? { role: roles.get(c.id) } : {}),
        ...(floorBases.has(c.id) ? { tierBeforeAdjustment: floorBases.get(c.id) } : {}),
        ...('artwork' in c && c.artwork ? { artwork: c.artwork } : {}),
        ...(importKind === undefined ? {} : { importKind, rightsConfirmed: true }),
      },
      popularity: popularity.get(c.id) ?? null,
    }));
    // Large provider rosters are inserted in bounded batches within the same
    // transaction; a failure still rolls back the whole realm.
    for (let start = 0; start < rows.length; start += 1000)
      await tx.query(
        `INSERT INTO characters(realm_id,id,source_key,name,series,categories,tier,provenance,popularity)
        SELECT $1,x.id,x.source_key,x.name,x.series,x.categories,x.tier,x.provenance,x.popularity
        FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,source_key text,name text,series text,categories text[],tier text,provenance jsonb,popularity bigint)`,
        [id, JSON.stringify(rows.slice(start, start + 1000))],
      );
    for (const pack of packs)
      await tx.query('INSERT INTO packs(realm_id,id,name,category) VALUES($1,$2,$3,$4)', [
        id,
        randomUUID(),
        pack.name,
        pack.category,
      ]);
    if (key)
      await tx.query(
        'INSERT INTO realm_creation_requests(account_id,request_key,realm_id,fingerprint) VALUES($1,$2,$3,$4)',
        [actorId, key, id, fingerprint],
      );
    return id;
  });
}

export async function eligiblePool(
  tx: Transaction,
  realmId: string,
  category: string | null,
): Promise<Character[]> {
  const rows = (
    await tx.query(
      `SELECT c.id,c.source_key AS "sourceKey",c.name,c.series,c.categories,c.tier,c.provenance->'artwork' AS artwork FROM characters c
    WHERE c.realm_id=$1 AND ($2::text IS NULL OR $2=ANY(c.categories))
    AND NOT EXISTS(SELECT 1 FROM cards owned WHERE owned.realm_id=c.realm_id AND owned.character_id=c.id AND owned.recycled_at IS NULL)
    ORDER BY c.id`,
      [realmId, category],
    )
  ).rows;
  return rows.map(({ artwork, ...character }) => ({
    ...character,
    ...(artwork ? { artwork } : {}),
  })) as Character[];
}

export async function openPack(
  db: Database,
  actorId: string,
  realmId: string,
  packId: string,
  requestKey: string,
  expectedRevision?: number,
  packCount: number = 1,
): Promise<OpeningResult> {
  return transaction(db, (tx) =>
    openPackInTransaction(tx, actorId, realmId, packId, requestKey, expectedRevision, packCount),
  );
}

// Shared transaction entry point: adapters may add authorization under the same realm lock.
export async function openPackInTransaction(
  tx: Transaction,
  actorId: string,
  realmId: string,
  packId: string,
  requestKey: string,
  expectedRevision?: number,
  packCount: number = 1,
): Promise<OpeningResult> {
  const count = requirePackOpeningCount(packCount);
  [actorId, realmId, packId, requestKey].forEach((v) => z.uuid().parse(v));
  const realm = (await tx.query('SELECT config FROM realms WHERE id=$1 FOR UPDATE', [realmId]))
    .rows[0];
  if (!realm) throw new GameError('NOT_FOUND', 'Realm not found.', 404);
  const member = await requireMember(tx, realmId, actorId);
  const previous = (
    await tx.query(
      'SELECT pack_id,pack_count,result FROM openings WHERE realm_id=$1 AND account_id=$2 AND request_key=$3',
      [realmId, actorId, requestKey],
    )
  ).rows[0];
  if (previous) {
    if (previous.pack_id !== packId || previous.pack_count !== count)
      throw new GameError(
        'IDEMPOTENCY_CONFLICT',
        'This request key was already used for a different pack or pack count.',
        409,
      );
    return previous.result as OpeningResult;
  }
  await requireExpectedRevision(tx, realmId, expectedRevision);
  const pack = (
    await tx.query(
      `SELECT category FROM packs p WHERE realm_id=$1 AND id=$2 AND (to_jsonb(p)->>'retired_at') IS NULL`,
      [realmId, packId],
    )
  ).rows[0];
  if (!pack) throw new GameError('NOT_FOUND', 'Pack not found in this realm.', 404);
  const baseConfig = parseRealmConfig(realm.config);
  const config = await effectiveMemberConfig(
    tx,
    realmId,
    actorId,
    baseConfig,
    realm.config.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, actorId) : 0,
  );
  const wishIds = (await wishlistEntries(tx, realmId, actorId)).map((entry) => entry.character_id);
  const upgradeRank = await purchasedUpgradeRank(tx, realmId, actorId);
  const price = effectivePackPrice(config, upgradeRank);
  const totalPrice = price * count;
  const pool = await eligiblePool(tx, realmId, pack.category);
  const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
  const openingId = randomUUID();
  let result: OpeningResult;
  let newCharacters: Character[] = [];
  if (drawableCount(pool, config) < config.packSize * count)
    result = {
      ok: false,
      code: 'EMPTY_POOL',
      message:
        count === 1
          ? 'Not enough unclaimed characters for a complete pack. No gems or cooldown were spent.'
          : 'Not enough unclaimed characters for every requested pack. No gems or cooldown were spent.',
    };
  else if (member.balance < totalPrice)
    result = {
      ok: false,
      code: 'INSUFFICIENT_GEMS',
      message: 'You do not have enough gems for the requested packs.',
    };
  else if (
    member.last_opened_at &&
    now.getTime() - member.last_opened_at.getTime() < config.cooldownSeconds * 1000
  )
    result = {
      ok: false,
      code: 'COOLDOWN',
      message: 'Your realm pack cooldown is still active.',
    };
  else {
    const characters = drawPacks(pool, config, count, randomInt, wishIds);
    const known = new Set(
      (
        await tx.query(
          "SELECT character_id FROM xp_ledger WHERE realm_id=$1 AND account_id=$2 AND reason IN('first_collection','trade_collection') AND character_id=ANY($3::uuid[])",
          [realmId, actorId, characters.map((character) => character.id)],
        )
      ).rows.map((row) => row.character_id),
    );
    newCharacters = characters.filter((character) => !known.has(character.id));
    const progression = calculateXpAward(member.xp, newCharacters.length, config);
    result = {
      ok: true,
      openingId,
      cardIds: characters.map(() => randomUUID()),
      characters,
      charged: totalPrice,
      balance: member.balance - totalPrice,
      ...(count === 1
        ? {}
        : {
            packCount: count,
            cardsPerPack: config.packSize,
            unitPrice: price,
          }),
      packUpgradeRank: upgradeRank,
      wishlistSnapshot: {
        characterIds: wishIds,
        weightMultiplier: config.wishlist.weightMultiplier,
      },
      progression,
    };
  }
  await tx.query(
    'INSERT INTO openings(realm_id,account_id,request_key,id,pack_id,result,config_snapshot,pack_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [realmId, actorId, requestKey, openingId, packId, result, config, count],
  );
  if (result.ok) {
    for (let i = 0; i < result.characters.length; i++)
      await tx.query(
        'INSERT INTO cards(realm_id,id,character_id,owner_id,request_key) VALUES($1,$2,$3,$4,$5)',
        [realmId, result.cardIds[i], result.characters[i].id, actorId, requestKey],
      );
    for (const character of newCharacters) {
      const cardId =
        result.cardIds[result.characters.findIndex((value) => value.id === character.id)];
      await tx.query(
        "INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version,character_id,card_id,request_key) VALUES($1,$2,$3,'first_collection',$4,1,$5,$6,$7)",
        [
          realmId,
          randomUUID(),
          actorId,
          config.progression.xpPerNewCharacter,
          character.id,
          cardId,
          requestKey,
        ],
      );
    }
    await tx.query(
      'UPDATE memberships SET balance=$3,last_opened_at=$4,xp=$5 WHERE realm_id=$1 AND account_id=$2',
      [realmId, actorId, result.balance, now, result.progression!.totalXp],
    );
    await tx.query(
      "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason) VALUES($1,$2,$3,$4,$5,$6,'pack_opening')",
      [realmId, randomUUID(), actorId, requestKey, -result.charged, result.balance],
    );
  }
  return result;
}

export async function listRealms(
  db: Database,
  accountId: string,
): Promise<{ id: string; name: string }[]> {
  return (
    await db.query(
      'SELECT r.id,r.name FROM realms r JOIN memberships m ON m.realm_id=r.id WHERE m.account_id=$1 ORDER BY r.created_at',
      [accountId],
    )
  ).rows;
}

export type RealmView = {
  id: string;
  name: string;
  role: string;
  balance: number;
  config: RealmConfig;
  configRevision: number;
  /** Rarity tiers with an admin-provided reveal sound (no audio bytes). */
  tierSounds: TierSounds;
  /** Characters with their own reveal sound (priority over the tier sound). */
  characterSounds: CharacterSounds;
  characterValues: Record<string, import('../../core/src/character-values').CharacterValue>;
  discordGuildId: string | null;
  tradeCode: string;
  trades: Awaited<ReturnType<typeof tradeViews>>;
  tradePartners: RealmMember[];
  discordProfile: DiscordProfile | null;
  admission: AdmissionPolicy | null;
  upgrade: ReturnType<typeof upgradeView>;
  collectorRank: ReturnType<typeof collectorRankView>;
  rankTracks: ReturnType<typeof rankTracksView>;
  gemReward: ReturnType<typeof gemRewardView>;
  effectiveWishlistSlots: number;
  effectiveRecycleRewards: RealmConfig['recycleRewards'];
  effectiveCooldownSeconds: number;
  packPrice: number;
  progression: ReturnType<typeof xpProgress>;
  featuredCharacters: Character[];
  packGrouping: ReturnType<typeof catalogPackGrouping>;
  packs: {
    id: string;
    name: string;
    category: string | null;
    available: number;
    odds: ReturnType<typeof availableOdds>;
    wishlistOdds: Record<string, number>;
    wishlistChance: number;
    spotlights: Character[];
  }[];
  catalog: (Character & { status: 'yours' | 'claimed' | 'available' })[];
  wishlist: (Character & {
    entryId: string;
    addedAt: string;
    status: 'yours' | 'claimed' | 'available';
  })[];
  cards: (Character & {
    cardId: string;
    acquiredAt: string;
    lockedForTrade: boolean;
    listedForSale: boolean;
  })[];
  lastOpening: OpeningResult | null;
};
export async function getRealmView(
  db: Database,
  actorId: string,
  realmId: string,
): Promise<RealmView> {
  z.uuid().parse(realmId);
  return transaction(
    db,
    async (tx) => {
      const member = await requireMember(tx, realmId, actorId);
      const realm = (
        await tx.query('SELECT name,config,config_revision FROM realms WHERE id=$1', [realmId])
      ).rows[0];
      const config = parseRealmConfig(realm.config);
      const rank =
        realm.config.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, actorId) : 0;
      const effectiveConfig = await effectiveMemberConfig(tx, realmId, actorId, config, rank);
      const wishes = await wishlistEntries(tx, realmId, actorId);
      const wishIds = wishes.map((entry) => entry.character_id);
      const upgrade = upgradeView(
        effectiveConfig,
        await purchasedUpgradeRank(tx, realmId, actorId),
        member.xp,
        member.balance,
      );
      const catalog = (
        await tx.query(
          `SELECT c.id,c.source_key AS "sourceKey",c.name,c.series,c.categories,c.tier,c.provenance->'artwork' AS artwork,
        CASE WHEN owned.owner_id=$2 THEN 'yours' WHEN owned.id IS NOT NULL THEN 'claimed' ELSE 'available' END AS status
        FROM characters c LEFT JOIN cards owned ON owned.realm_id=c.realm_id AND owned.character_id=c.id AND owned.recycled_at IS NULL
        WHERE c.realm_id=$1 ORDER BY c.name,c.id`,
          [realmId, actorId],
        )
      ).rows.map(({ artwork, ...character }) => ({
        ...character,
        ...(artwork ? { artwork } : {}),
      })) as RealmView['catalog'];
      const packGrouping = catalogPackGrouping(catalog);
      const packs = [];
      const featuredPool = new Map<string, Character>();
      // The catalog query already carries ownership, so every pack's unclaimed
      // pool is derived in memory: one catalog read instead of one per pack.
      // This matches eligiblePool (no active owner, exact saved category).
      const unclaimed = catalog
        .filter((character) => character.status === 'available')
        .map(({ status: _status, ...character }) => {
          void _status;
          return character as Character;
        });
      for (const pack of packsForCatalog(
        (
          await tx.query(
            `SELECT id,name,category FROM packs p WHERE realm_id=$1 AND (to_jsonb(p)->>'retired_at') IS NULL ORDER BY category IS NULL,name`,
            [realmId],
          )
        ).rows as { id: string; name: string; category: string | null }[],
        catalog,
      )) {
        const pool =
          pack.category === null
            ? unclaimed
            : unclaimed.filter((character) => character.categories.includes(pack.category!));
        const oddsByCharacter = selectedCharacterOdds(pool, config, wishIds, wishIds);
        const available = drawableCount(pool, config);
        if (available >= config.packSize)
          for (const character of pool)
            if (config.tierWeights[character.tier] > 0) featuredPool.set(character.id, character);
        const wishlistOdds = Object.fromEntries(
          wishIds.map((id) => [id, available < config.packSize ? 0 : (oddsByCharacter[id] ?? 0)]),
        );
        packs.push({
          id: pack.id as string,
          name: pack.name,
          category: pack.category as string | null,
          available,
          odds: availableOdds(pool, config),
          wishlistOdds,
          wishlistChance: Object.values(wishlistOdds).reduce((sum, chance) => sum + chance, 0),
          spotlights: selectPackSpotlights(pool, config, 3),
        });
      }
      const cards = (
        await tx.query(
          `SELECT c.id,c.source_key AS "sourceKey",c.name,c.series,c.categories,c.tier,c.provenance->'artwork' AS artwork,
      owned.id AS "cardId",owned.acquired_at AS "acquiredAt",
      EXISTS(SELECT 1 FROM trade_cards r JOIN trades t ON t.realm_id=r.realm_id AND t.id=r.trade_id WHERE r.realm_id=owned.realm_id AND r.card_id=owned.id AND r.released_at IS NULL AND t.status='pending' AND t.expires_at>clock_timestamp()) OR ${realm.config.schemaVersion >= 7 ? "EXISTS(SELECT 1 FROM market_listings ml WHERE ml.realm_id=owned.realm_id AND ml.card_id=owned.id AND ml.status='active')" : 'false'} AS "lockedForTrade",
      ${realm.config.schemaVersion >= 7 ? "EXISTS(SELECT 1 FROM market_listings ml WHERE ml.realm_id=owned.realm_id AND ml.card_id=owned.id AND ml.status='active')" : 'false'} AS "listedForSale" FROM cards owned JOIN characters c
      ON c.realm_id=owned.realm_id AND c.id=owned.character_id WHERE owned.realm_id=$1 AND owned.owner_id=$2 AND owned.recycled_at IS NULL ORDER BY owned.acquired_at DESC,owned.id`,
          [realmId, actorId],
        )
      ).rows.map(({ artwork, ...row }) => ({
        ...row,
        ...(artwork ? { artwork } : {}),
        acquiredAt: row.acquiredAt.toISOString(),
      })) as RealmView['cards'];
      const last = (
        await tx.query(
          'SELECT result FROM openings WHERE realm_id=$1 AND account_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
          [realmId, actorId],
        )
      ).rows[0];
      const wishlist = wishes.map((entry) => ({
        ...catalog.find((character) => character.id === entry.character_id)!,
        entryId: entry.id,
        addedAt: entry.created_at.toISOString(),
      }));
      const trades = await tradeViews(tx, realmId, actorId);
      return {
        id: realmId,
        name: realm.name,
        role: member.role,
        balance: member.balance,
        config,
        configRevision: realm.config_revision,
        tierSounds: await tierSoundsForRealm(tx, realmId),
        characterSounds: await characterSoundsForRealm(tx, realmId),
        characterValues: await characterValuesForRealm(tx, realmId, config, effectiveConfig),
        discordGuildId:
          member.role === 'admin'
            ? ((
                await tx.query('SELECT guild_id FROM discord_guild_realms WHERE realm_id=$1', [
                  realmId,
                ])
              ).rows[0]?.guild_id ?? null)
            : null,
        tradeCode: (
          await tx.query('SELECT trade_code FROM memberships WHERE realm_id=$1 AND account_id=$2', [
            realmId,
            actorId,
          ])
        ).rows[0].trade_code,
        trades,
        tradePartners: await memberProfiles(tx, realmId, [
          ...new Set(trades.map((trade) => trade.counterpartyCode)),
        ]),
        discordProfile: await ownDiscordProfile(tx, actorId),
        admission: member.role === 'admin' ? await admissionPolicy(tx, realmId) : null,
        upgrade,
        collectorRank: collectorRankView(config, rank, member.balance),
        rankTracks: rankTracksView(
          config,
          await purchasedRankTrackLevels(tx, realmId, actorId),
          member.balance,
        ),
        gemReward:
          realm.config.schemaVersion >= 8
            ? await gemRewardState(tx, realmId, actorId, config)
            : gemRewardView(config, null, Date.now()),
        effectiveWishlistSlots: effectiveConfig.wishlist.slots,
        effectiveRecycleRewards: effectiveConfig.recycleRewards,
        effectiveCooldownSeconds: effectiveConfig.cooldownSeconds,
        packPrice: upgrade.packPrice,
        progression: xpProgress(member.xp, config),
        featuredCharacters: selectPackSpotlights([...featuredPool.values()], config, 5),
        packGrouping,
        packs,
        catalog,
        wishlist,
        cards,
        lastOpening: last?.result ?? null,
      };
    },
    true,
  );
}
