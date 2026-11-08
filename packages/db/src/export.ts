import { rankBenefits } from '../../core/src/ranks';
import { characterValuesForRealm } from './character-values';
import { characterValueSchema, quoteCharacterValue } from '../../core/src/character-values';
import { effectiveMemberConfig, purchasedRankTrackLevels } from './rank-track-state';
import {
  rankTrackReceiptSchema,
  rankTrackLevelsSchema,
  validateRankTrackHistory,
} from './rank-track-history';
import { purchasedCollectorRank } from './rank-state';
import { ownRealmAdmission, playerAdmissionSchema } from './admission';
import { discordProfileSchema, ownDiscordProfile } from './member-profiles';
import { z } from 'zod';
import { providerArtworkSchema } from '../../importers/src/artwork';
import {
  tiers,
  collectorRanksSchema,
  rankTracksSchema,
  gemRewardsSchema,
  progressionSchema,
  parseRealmConfig,
  upgradesSchema,
  wishlistSchema,
  tradingSchema,
  characterValuesSchema,
} from '../../config/src/index';
import { xpProgress } from '../../core/src/index';
import { requireMember } from './game';
import { transaction, type Database } from './connection';
import { tradeViews } from './trade-state';

const playerArchiveV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('card-engine-player-archive'),
  exportedAt: z.iso.datetime(),
  realm: z.strictObject({ id: z.uuid(), name: z.string() }),
  accountId: z.uuid(),
  gems: z.number().int().nonnegative(),
  xp: z.number().int().nonnegative(),
  cards: z.array(
    z.strictObject({
      cardId: z.uuid(),
      characterId: z.uuid(),
      sourceKey: z.string(),
      name: z.string(),
      series: z.string(),
      tier: z.enum(tiers),
      acquiredAt: z.iso.datetime(),
      artwork: providerArtworkSchema.optional(),
    }),
  ),
  ledger: z.array(
    z.strictObject({
      id: z.uuid(),
      operationKey: z.string(),
      amount: z.number().int(),
      balanceAfter: z.number().int().nonnegative(),
      reason: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
  // Historical archives predate purchasable upgrades.
  upgrades: z.array(z.never()),
  achievements: z.array(z.never()),
  wishlist: z.array(z.never()),
});
const playerArchiveV2Schema = playerArchiveV1Schema.extend({
  schemaVersion: z.literal(2),
  recyclings: z.array(
    z.strictObject({
      recyclingId: z.uuid(),
      cardId: z.uuid(),
      characterId: z.uuid(),
      sourceKey: z.string(),
      name: z.string(),
      series: z.string(),
      tier: z.enum(tiers),
      credited: z.number().int().nonnegative(),
      acquiredAt: z.iso.datetime(),
      recycledAt: z.iso.datetime(),
    }),
  ),
});
const playerArchiveV3Base = playerArchiveV2Schema.extend({
  schemaVersion: z.literal(3),
  progression: z.strictObject({ rules: progressionSchema, level: z.number().int().positive() }),
  xpLedger: z.array(
    z.strictObject({
      id: z.uuid(),
      reason: z.enum(['first_collection', 'migration_baseline']),
      amount: z.number().int().nonnegative(),
      policyVersion: z.union([z.literal(0), z.literal(1)]),
      characterId: z.uuid().nullable(),
      cardId: z.uuid().nullable(),
      requestKey: z.uuid().nullable(),
      sourceKey: z.string().nullable(),
      name: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
function validateProgression(
  archive:
    | z.infer<typeof playerArchiveV3Base>
    | {
        xp: number;
        xpLedger: { amount: number }[];
        progression: { rules: { levelThresholds: number[] }; level: number };
      },
  ctx: z.RefinementCtx,
) {
  if (archive.xpLedger.reduce((sum, entry) => sum + entry.amount, 0) !== archive.xp)
    ctx.addIssue({ code: 'custom', message: 'XP ledger does not match total XP.' });
  const expected = archive.progression.rules.levelThresholds.filter(
    (threshold) => threshold <= archive.xp,
  ).length;
  if (archive.progression.level !== expected)
    ctx.addIssue({ code: 'custom', message: 'Level does not match XP and realm thresholds.' });
}
const playerArchiveV3Schema = playerArchiveV3Base.superRefine(validateProgression);
const playerArchiveV4Base = playerArchiveV3Base.extend({
  schemaVersion: z.literal(4),
  basePackPrice: z.number().int().min(0).max(1_000_000),
  upgradeRules: upgradesSchema,
  upgrades: z
    .array(
      z.strictObject({
        purchaseId: z.uuid(),
        requestKey: z.uuid(),
        upgradeId: z.literal('pack_discount'),
        rank: z.number().int().min(1).max(5),
        charged: z.number().int().nonnegative(),
        discount: z.number().int().positive(),
        requiredLevel: z.number().int().positive(),
        purchasedAt: z.iso.datetime(),
      }),
    )
    .max(5),
});
function validateUpgradeHistory(
  archive: Pick<z.infer<typeof playerArchiveV4Base>, 'upgrades' | 'upgradeRules'>,
  ctx: z.RefinementCtx,
) {
  const ranks = [...archive.upgrades].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < ranks.length; i++) {
    const purchase = ranks[i],
      rule = archive.upgradeRules.packDiscount[i];
    if (
      purchase.rank !== i + 1 ||
      !rule ||
      purchase.charged !== rule.cost ||
      purchase.discount !== rule.discount ||
      purchase.requiredLevel !== rule.requiredLevel
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Upgrade history does not match contiguous configured ranks.',
      });
  }
  if (
    new Set(ranks.map((purchase) => purchase.purchaseId)).size !== ranks.length ||
    new Set(ranks.map((purchase) => purchase.requestKey)).size !== ranks.length
  )
    ctx.addIssue({ code: 'custom', message: 'Upgrade history contains duplicate IDs.' });
}
const playerArchiveV4Schema = playerArchiveV4Base
  .superRefine(validateProgression)
  .superRefine(validateUpgradeHistory);
const playerArchiveV5Base = playerArchiveV4Base.extend({
  schemaVersion: z.literal(5),
  wishlistRules: wishlistSchema,
  wishlist: z
    .array(
      z.strictObject({
        entryId: z.uuid(),
        characterId: z.uuid(),
        sourceKey: z.string(),
        name: z.string(),
        series: z.string(),
        tier: z.enum(tiers),
        addedAt: z.iso.datetime(),
      }),
    )
    .max(20),
});
function validateWishlist(
  archive: Pick<z.infer<typeof playerArchiveV5Base>, 'wishlist' | 'wishlistRules'>,
  ctx: z.RefinementCtx,
) {
  if (
    archive.wishlist.length > archive.wishlistRules.slots ||
    new Set(archive.wishlist.map((entry) => entry.characterId)).size !== archive.wishlist.length ||
    new Set(archive.wishlist.map((entry) => entry.entryId)).size !== archive.wishlist.length
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Wishlist exceeds capacity or contains duplicate IDs.',
    });
}
const playerArchiveV5Schema = playerArchiveV5Base
  .superRefine(validateProgression)
  .superRefine(validateUpgradeHistory)
  .superRefine(validateWishlist);
const tradeCardSchema = z.strictObject({
  cardId: z.uuid(),
  characterId: z.uuid(),
  name: z.string(),
  tier: z.enum(tiers),
});
const tradeViewSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(['pending', 'completed', 'cancelled', 'expired']),
  counterpartyCode: z.uuid(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  rules: tradingSchema,
  myOffer: z.strictObject({
    cards: z.array(tradeCardSchema).max(10),
    gems: z.number().int().nonnegative(),
  }),
  theirOffer: z.strictObject({
    cards: z.array(tradeCardSchema).max(10),
    gems: z.number().int().nonnegative(),
  }),
  myConfirmed: z.boolean(),
  theirConfirmed: z.boolean(),
});
const playerArchiveV6Base = playerArchiveV5Base.extend({
  schemaVersion: z.literal(6),
  tradeCode: z.uuid(),
  tradingRules: tradingSchema,
  trades: z.array(tradeViewSchema),
  cards: z.array(
    playerArchiveV1Schema.shape.cards.element.extend({ receivedAt: z.iso.datetime().nullable() }),
  ),
  xpLedger: z.array(
    playerArchiveV3Base.shape.xpLedger.element.extend({
      reason: z.enum(['first_collection', 'migration_baseline', 'trade_collection']),
      tradeId: z.uuid().nullable(),
    }),
  ),
});
function validateTrades(
  archive: Pick<z.infer<typeof playerArchiveV6Base>, 'trades' | 'xpLedger'>,
  ctx: z.RefinementCtx,
) {
  if (new Set(archive.trades.map((trade) => trade.id)).size !== archive.trades.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate trade IDs.' });
  for (const entry of archive.xpLedger) {
    if (
      entry.reason === 'trade_collection'
        ? entry.amount !== 0 || !entry.tradeId || entry.requestKey !== null
        : entry.tradeId !== null
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid trade discovery history.' });
  }
  for (const trade of archive.trades) {
    if (
      trade.status === 'completed' &&
      (!trade.myConfirmed || !trade.theirConfirmed || !trade.completedAt)
    )
      ctx.addIssue({ code: 'custom', message: 'Completed trade lacks confirmations.' });
    for (const offer of [trade.myOffer, trade.theirOffer])
      if (
        offer.cards.length > trade.rules.maxCardsPerSide ||
        offer.gems > trade.rules.maxGemsPerSide ||
        new Set(offer.cards.map((card) => card.cardId)).size !== offer.cards.length
      )
        ctx.addIssue({ code: 'custom', message: 'Trade offer exceeds its saved rules.' });
  }
}
const playerArchiveV6Schema = playerArchiveV6Base
  .superRefine(validateProgression)
  .superRefine(validateUpgradeHistory)
  .superRefine(validateWishlist)
  .superRefine(validateTrades);
const playerArchiveV7Base = playerArchiveV6Base
  .omit({ schemaVersion: true })
  .extend({ schemaVersion: z.literal(7), discordProfile: discordProfileSchema.nullable() });
const playerArchiveV7Schema = playerArchiveV7Base
  .superRefine(validateProgression)
  .superRefine(validateUpgradeHistory)
  .superRefine(validateWishlist)
  .superRefine(validateTrades);
const playerArchiveV8Base = playerArchiveV7Base
  .omit({ schemaVersion: true })
  .extend({ schemaVersion: z.literal(8), realmAdmission: playerAdmissionSchema.nullable() });
const playerArchiveV8Schema = playerArchiveV8Base
  .superRefine(validateProgression)
  .superRefine(validateUpgradeHistory)
  .superRefine(validateWishlist)
  .superRefine(validateTrades);
const rankReceiptSchema = z.strictObject({
  purchaseId: z.uuid(),
  requestKey: z.uuid(),
  rank: z.number().int().min(1).max(10),
  name: z.string(),
  charged: z.number().int().nonnegative(),
  balance: z.number().int().nonnegative(),
  benefits: z.strictObject({
    packDiscount: z.number().int().nonnegative(),
    recycleBonus: z.number().int().nonnegative(),
    wishlistSlots: z.number().int().min(0).max(20),
    cooldownReductionSeconds: z.number().int().nonnegative(),
  }),
  purchasedAt: z.iso.datetime(),
});
const playerArchiveV9Base = playerArchiveV8Base.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal(9),
  collectorRank: z.number().int().min(0).max(10),
  rankRules: collectorRanksSchema,
  rankPurchases: z.array(rankReceiptSchema).max(10),
  marketListings: z.array(
    z.strictObject({
      listingId: z.uuid(),
      cardId: z.uuid(),
      characterId: z.uuid(),
      sourceKey: z.string(),
      name: z.string(),
      series: z.string(),
      tier: z.enum(tiers),
      price: z.number().int().positive(),
      status: z.enum(['active', 'sold', 'cancelled']),
      role: z.enum(['seller', 'buyer']),
      tradeId: z.uuid().nullable(),
      createdAt: z.iso.datetime(),
      closedAt: z.iso.datetime().nullable(),
    }),
  ),
});
function validateCollectorArchive(
  archive: Omit<z.infer<typeof playerArchiveV9Base>, 'schemaVersion'>,
  ctx: z.RefinementCtx,
) {
  if (
    archive.collectorRank !== archive.rankPurchases.length ||
    (archive.collectorRank > 0 && !archive.rankRules.enabled)
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Collector rank does not match owned rank history.',
    });
  const ordered = [...archive.rankPurchases].sort((a, b) => a.rank - b.rank);
  for (let index = 0; index < ordered.length; index++) {
    const receipt = ordered[index],
      rule = archive.rankRules.levels[index];
    if (
      !rule ||
      receipt.rank !== index + 1 ||
      receipt.name !== rule.name ||
      receipt.charged !== rule.cost ||
      JSON.stringify(receipt.benefits) !==
        JSON.stringify(
          rankBenefits(
            { ranks: archive.rankRules } as Parameters<typeof rankBenefits>[0],
            receipt.rank,
          ),
        )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Collector rank receipt does not match its rules.',
      });
    if (
      !archive.ledger.some(
        (entry) =>
          entry.operationKey === `rank:${receipt.requestKey}` &&
          entry.reason === 'rank_purchase' &&
          entry.amount === -receipt.charged &&
          entry.balanceAfter === receipt.balance &&
          entry.createdAt === receipt.purchasedAt,
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Collector rank receipt has no matching wallet entry.',
      });
  }
  for (const listing of archive.marketListings)
    if (
      (listing.status === 'sold') !== (listing.tradeId !== null) ||
      (listing.status === 'active') !== (listing.closedAt === null)
    )
      ctx.addIssue({ code: 'custom', message: 'Market listing history is inconsistent.' });
}

const playerArchiveV9Schema = playerArchiveV9Base
  .superRefine(validateProgression)
  .superRefine(validateUpgradeHistory)
  .superRefine(validateWishlist)
  .superRefine(validateTrades)
  .superRefine(validateCollectorArchive);
const gemClaimSchema = z.strictObject({
  claimId: z.uuid(),
  requestKey: z.uuid(),
  amount: z.number().int().positive(),
  balance: z.number().int().nonnegative(),
  claimedAt: z.iso.datetime(),
  nextClaimAt: z.iso.datetime(),
  rules: gemRewardsSchema,
});
const playerArchiveV10Base = playerArchiveV9Base.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal(10),
  gemRewardRules: gemRewardsSchema,
  gemRewardClaims: z.array(gemClaimSchema),
});
const playerArchiveV10Schema = playerArchiveV10Base
  .superRefine(validateProgression)
  .superRefine(validateUpgradeHistory)
  .superRefine(validateWishlist)
  .superRefine(validateTrades)
  .superRefine(validateCollectorArchive)
  .superRefine((archive, ctx) => {
    const ids = new Set<string>(),
      keys = new Set<string>();
    let previous: number | null = null;
    for (const claim of [...archive.gemRewardClaims].sort((a, b) =>
      a.claimedAt.localeCompare(b.claimedAt),
    )) {
      const time = Date.parse(claim.claimedAt),
        next = Date.parse(claim.nextClaimAt);
      if (
        ids.has(claim.claimId) ||
        keys.has(claim.requestKey) ||
        !claim.rules.enabled ||
        claim.amount !== claim.rules.amount ||
        next !== time + claim.rules.intervalSeconds * 1000 ||
        (previous !== null && time < previous + claim.rules.intervalSeconds * 1000)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Gem reward claim or cooldown does not match its rules.',
        });
      if (
        !archive.ledger.some(
          (entry) =>
            entry.operationKey === `gem-reward:${claim.requestKey}` &&
            entry.reason === 'gem_reward' &&
            entry.amount === claim.amount &&
            entry.balanceAfter === claim.balance &&
            entry.createdAt === claim.claimedAt,
        )
      )
        ctx.addIssue({ code: 'custom', message: 'Gem reward claim has no matching wallet entry.' });
      ids.add(claim.claimId);
      keys.add(claim.requestKey);
      previous = time;
    }
    if (
      archive.ledger.some(
        (entry) =>
          entry.reason === 'gem_reward' &&
          !archive.gemRewardClaims.some(
            (claim) => entry.operationKey === `gem-reward:${claim.requestKey}`,
          ),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Gem reward wallet entry has no matching claim.' });
  });

const playerArchiveV11Base = playerArchiveV10Base.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal(11),
  rankTrackRules: rankTracksSchema,
  rankTrackLevels: rankTrackLevelsSchema,
  rankTrackPurchases: z.array(rankTrackReceiptSchema),
});
const playerArchiveV11Schema = playerArchiveV11Base.superRefine((archive, ctx) => {
  const { rankTrackRules, rankTrackLevels, rankTrackPurchases, ...legacy } = archive;
  const previous = playerArchiveV10Schema.safeParse({ ...legacy, schemaVersion: 10 });
  if (!previous.success)
    for (const issue of previous.error.issues)
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  try {
    validateRankTrackHistory(rankTrackRules, rankTrackLevels, rankTrackPurchases, archive.ledger);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Collector rank progression history is invalid.' });
  }
});

export const playerArchiveSchema = playerArchiveV11Base
  .omit({ schemaVersion: true })
  .extend({
    schemaVersion: z.literal(12),
    characterValueRules: characterValuesSchema,
    characterValues: z.record(z.uuid(), characterValueSchema),
    recyclingValuations: z.array(
      z.strictObject({
        recyclingId: z.uuid(),
        rules: characterValuesSchema,
        quote: characterValueSchema,
      }),
    ),
  })
  .superRefine((archive, ctx) => {
    const { characterValueRules, characterValues, recyclingValuations, ...legacy } = archive;
    const previous = playerArchiveV11Schema.safeParse({ ...legacy, schemaVersion: 11 });
    if (!previous.success)
      for (const issue of previous.error.issues)
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    const permitted = new Set(
      [...archive.cards, ...archive.wishlist].map((card) => card.characterId),
    );
    for (const [id, quote] of Object.entries(characterValues)) {
      try {
        const expected = quoteCharacterValue({ ...quote, rules: characterValueRules });
        if (!permitted.has(id) || JSON.stringify(expected) !== JSON.stringify(quote))
          ctx.addIssue({ code: 'custom', message: 'Character value evidence is invalid.' });
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Character value evidence is invalid.' });
      }
    }
    const seen = new Set<string>();
    for (const receipt of recyclingValuations) {
      const recycling = archive.recyclings.find((row) => row.recyclingId === receipt.recyclingId);
      try {
        const expected = quoteCharacterValue({ ...receipt.quote, rules: receipt.rules });
        if (
          seen.has(receipt.recyclingId) ||
          !recycling ||
          recycling.credited !== receipt.quote.recycleValue ||
          JSON.stringify(expected) !== JSON.stringify(receipt.quote)
        )
          ctx.addIssue({ code: 'custom', message: 'Recycling value evidence is invalid.' });
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Recycling value evidence is invalid.' });
      }
      seen.add(receipt.recyclingId);
    }
  });

export function parsePlayerArchive(input: unknown) {
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 1
  ) {
    return playerArchiveV2Schema.parse({
      ...playerArchiveV1Schema.parse(input),
      schemaVersion: 2,
      recyclings: [],
    });
  }
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 2
  )
    return playerArchiveV2Schema.parse(input);
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 3
  )
    return playerArchiveV3Schema.parse(input);
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 4
  )
    return playerArchiveV4Schema.parse(input);
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 5
  )
    return playerArchiveV5Schema.parse(input);
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 6
  )
    return playerArchiveV6Schema.parse(input);
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 7
  )
    return playerArchiveV7Schema.parse(input);
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 8
  )
    return playerArchiveV8Schema.parse(input);
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 9
  )
    return playerArchiveV9Schema.parse(input);
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 10
  )
    return playerArchiveV10Schema.parse(input);
  if (
    typeof input === 'object' &&
    input !== null &&
    'schemaVersion' in input &&
    input.schemaVersion === 11
  )
    return playerArchiveV11Schema.parse(input);
  return playerArchiveSchema.parse(input);
}

export async function exportPlayer(db: Database, actorId: string, realmId: string) {
  z.uuid().parse(realmId);
  return transaction(
    db,
    async (tx) => {
      const member = await requireMember(tx, realmId, actorId);
      const row = (await tx.query('SELECT id,name,config FROM realms WHERE id=$1', [realmId]))
        .rows[0];
      const realm = { id: row.id, name: row.name };
      const config = parseRealmConfig(row.config);
      const collectorRank =
        row.config.schemaVersion >= 7 ? await purchasedCollectorRank(tx, realmId, actorId) : 0;
      const effectiveConfig = await effectiveMemberConfig(
        tx,
        realmId,
        actorId,
        config,
        collectorRank,
      );
      const rankTrackLevels = await purchasedRankTrackLevels(tx, realmId, actorId);
      const rankTrackPurchases =
        row.config.schemaVersion >= 10
          ? (
              await tx.query(
                'SELECT result,request_key,config_snapshot FROM rank_track_purchases WHERE realm_id=$1 AND account_id=$2 ORDER BY created_at,id',
                [realmId, actorId],
              )
            ).rows.map((row) => ({
              ...row.result,
              requestKey: row.request_key,
              rules: parseRealmConfig(row.config_snapshot).rankTracks,
            }))
          : [];
      const gemRewardClaims =
        row.config.schemaVersion >= 8
          ? (
              await tx.query(
                'SELECT result,request_key,config_snapshot FROM gem_reward_claims WHERE realm_id=$1 AND account_id=$2 ORDER BY created_at,id',
                [realmId, actorId],
              )
            ).rows.map(({ result, request_key, config_snapshot }) => {
              const { ok, ...claim } = result;
              void ok;
              return {
                ...claim,
                requestKey: request_key,
                rules: parseRealmConfig(config_snapshot).gemRewards,
              };
            })
          : [];
      const rankPurchases =
        row.config.schemaVersion >= 7
          ? (
              await tx.query(
                'SELECT result,request_key FROM rank_purchases WHERE realm_id=$1 AND account_id=$2 ORDER BY rank',
                [realmId, actorId],
              )
            ).rows.map(({ result, request_key }) => {
              const { ok, ...receipt } = result;
              void ok;
              return { ...receipt, requestKey: request_key };
            })
          : [];
      const marketListings =
        row.config.schemaVersion >= 7
          ? (
              await tx.query(
                `SELECT l.id AS "listingId",l.card_id AS "cardId",c.id AS "characterId",c.source_key AS "sourceKey",c.name,c.series,c.tier,l.price,l.status,CASE WHEN l.seller_id=$2 THEN 'seller' ELSE 'buyer' END AS role,l.sale_trade_id AS "tradeId",l.created_at,l.closed_at FROM market_listings l JOIN cards owned ON owned.realm_id=l.realm_id AND owned.id=l.card_id JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id WHERE l.realm_id=$1 AND (l.seller_id=$2 OR l.buyer_id=$2) ORDER BY l.created_at,l.id`,
                [realmId, actorId],
              )
            ).rows.map(({ created_at, closed_at, ...entry }) => ({
              ...entry,
              createdAt: created_at.toISOString(),
              closedAt: closed_at?.toISOString() ?? null,
            }))
          : [];
      const cards = (
        await tx.query(
          `SELECT o.id AS "cardId",c.id AS "characterId",c.source_key AS "sourceKey",c.name,c.series,c.tier,c.provenance->'artwork' AS artwork,o.acquired_at,
      (SELECT t.created_at FROM card_transfers t WHERE t.realm_id=o.realm_id AND t.card_id=o.id ORDER BY sequence DESC LIMIT 1) AS received_at
      FROM cards o JOIN characters c ON c.realm_id=o.realm_id AND c.id=o.character_id WHERE o.realm_id=$1 AND o.owner_id=$2 AND o.recycled_at IS NULL ORDER BY o.id`,
          [realmId, actorId],
        )
      ).rows.map(({ acquired_at, received_at, artwork, ...row }) => ({
        ...row,
        ...(artwork ? { artwork } : {}),
        acquiredAt: acquired_at.toISOString(),
        receivedAt: received_at?.toISOString() ?? null,
      }));
      const ledger = (
        await tx.query(
          'SELECT id,operation_key AS "operationKey",amount,balance_after AS "balanceAfter",reason,created_at FROM wallet_ledger WHERE realm_id=$1 AND account_id=$2 ORDER BY created_at,id',
          [realmId, actorId],
        )
      ).rows.map(({ created_at, ...row }) => ({ ...row, createdAt: created_at.toISOString() }));
      const recyclings = (
        await tx.query(
          `SELECT r.id AS "recyclingId",r.card_id AS "cardId",c.id AS "characterId",
        c.source_key AS "sourceKey",c.name,c.series,c.tier,(r.result->>'credited')::integer AS credited,
        owned.acquired_at,owned.recycled_at FROM recyclings r
        JOIN cards owned ON owned.realm_id=r.realm_id AND owned.id=r.card_id
        JOIN characters c ON c.realm_id=owned.realm_id AND c.id=owned.character_id
        WHERE r.realm_id=$1 AND r.account_id=$2 ORDER BY r.created_at,r.id`,
          [realmId, actorId],
        )
      ).rows.map(({ acquired_at, recycled_at, ...row }) => ({
        ...row,
        acquiredAt: acquired_at.toISOString(),
        recycledAt: recycled_at.toISOString(),
      }));
      const xpLedger = (
        await tx.query(
          `SELECT x.id,x.reason,x.amount,x.policy_version AS "policyVersion",x.character_id AS "characterId",
        x.card_id AS "cardId",x.request_key AS "requestKey",x.trade_id AS "tradeId",c.source_key AS "sourceKey",c.name,x.created_at
        FROM xp_ledger x LEFT JOIN characters c ON c.realm_id=x.realm_id AND c.id=x.character_id
        WHERE x.realm_id=$1 AND x.account_id=$2 ORDER BY x.created_at,x.id`,
          [realmId, actorId],
        )
      ).rows.map(({ created_at, ...entry }) => ({ ...entry, createdAt: created_at.toISOString() }));
      const upgrades = (
        await tx.query(
          `SELECT id AS "purchaseId",request_key AS "requestKey",upgrade_id AS "upgradeId",rank,
        (result->>'charged')::integer AS charged,(result->>'discount')::integer AS discount,
        (result->>'requiredLevel')::integer AS "requiredLevel",created_at FROM upgrade_purchases
        WHERE realm_id=$1 AND account_id=$2 ORDER BY rank`,
          [realmId, actorId],
        )
      ).rows.map(({ created_at, ...entry }) => ({
        ...entry,
        purchasedAt: created_at.toISOString(),
      }));
      const wishlist = (
        await tx.query(
          `SELECT w.id AS "entryId",c.id AS "characterId",c.source_key AS "sourceKey",c.name,c.series,c.tier,w.created_at
        FROM wishlist_entries w JOIN characters c ON c.realm_id=w.realm_id AND c.id=w.character_id
        WHERE w.realm_id=$1 AND w.account_id=$2 ORDER BY c.id`,
          [realmId, actorId],
        )
      ).rows.map(({ created_at, ...entry }) => ({ ...entry, addedAt: created_at.toISOString() }));
      const values = await characterValuesForRealm(tx, realmId, config, effectiveConfig);
      const wanted = new Set([...cards, ...wishlist].map((card) => card.characterId));
      const recyclingValuations = (
        await tx.query(
          "SELECT id,result->'valuation' AS quote,config_snapshot->'characterValues' AS rules FROM recyclings WHERE realm_id=$1 AND account_id=$2 AND result ? 'valuation' ORDER BY created_at,id",
          [realmId, actorId],
        )
      ).rows.map((row) => ({ recyclingId: row.id, rules: row.rules, quote: row.quote }));
      return playerArchiveSchema.parse({
        schemaVersion: 12,
        characterValueRules: config.characterValues,
        characterValues: Object.fromEntries(
          Object.entries(values).filter(([id]) => wanted.has(id)),
        ),
        recyclingValuations,
        rankTrackRules: config.rankTracks,
        rankTrackLevels,
        rankTrackPurchases,
        gemRewardRules: config.gemRewards,
        gemRewardClaims,
        collectorRank,
        rankRules: config.ranks,
        rankPurchases,
        marketListings,
        realmAdmission: await ownRealmAdmission(tx, realmId, actorId),
        discordProfile: await ownDiscordProfile(tx, actorId),
        kind: 'card-engine-player-archive',
        exportedAt: new Date().toISOString(),
        realm,
        accountId: actorId,
        tradeCode: (
          await tx.query('SELECT trade_code FROM memberships WHERE realm_id=$1 AND account_id=$2', [
            realmId,
            actorId,
          ])
        ).rows[0].trade_code,
        tradingRules: config.trading,
        trades: await tradeViews(tx, realmId, actorId, null),
        gems: member.balance,
        xp: member.xp,
        progression: { rules: config.progression, level: xpProgress(member.xp, config).level },
        xpLedger,
        cards,
        ledger,
        recyclings,
        basePackPrice: config.packPrice,
        upgradeRules: config.upgrades,
        upgrades,
        achievements: [],
        wishlistRules: effectiveConfig.wishlist,
        wishlist,
      });
    },
    true,
  );
}
