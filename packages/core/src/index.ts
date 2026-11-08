import { applyRankBenefits } from './ranks';
import { applyRankTrackBenefits, type RankTrackLevels } from './rank-tracks';
import { tiers, type RealmConfig, type Tier } from '../../config/src/index';
import { GameError } from './errors';
export { GameError } from './errors';
export * from './trades';
export * from './starter-packs';
export * from './character-values';
export * from './pack-themes';

export type Character = {
  id: string;
  sourceKey: string;
  name: string;
  series: string;
  categories: string[];
  tier: Tier;
  artwork?: { url: string; sourceUrl: string; permission: string };
};
export type StarterPack = { name: string; category: string | null };
export type XpProgress = {
  totalXp: number;
  level: number;
  maxLevel: number;
  levelStartsAt: number;
  nextLevelAt: number | null;
  xpIntoLevel: number;
  xpToNextLevel: number;
};
export type RecyclingResult = {
  ok: true;
  recyclingId: string;
  cardId: string;
  characterId: string;
  name: string;
  tier: Tier;
  credited: number;
  balance: number;
  recycledAt: string;
  valuation?: import('./character-values').CharacterValue;
};
export type OpeningResult =
  | {
      ok: true;
      openingId: string;
      cardIds: string[];
      characters: Character[];
      charged: number;
      balance: number;
      // Absent only on immutable receipts created before progression was introduced.
      progression?: XpProgress & { xpAwarded: number; levelsGained: number };
      // Absent on receipts written before purchasable upgrades.
      packUpgradeRank?: number;
      wishlistSnapshot?: { characterIds: string[]; weightMultiplier: number };
      // Bundle metadata is absent on single-pack and historical receipts.
      packCount?: 5 | 10;
      cardsPerPack?: number;
      unitPrice?: number;
    }
  | { ok: false; code: 'EMPTY_POOL' | 'INSUFFICIENT_GEMS' | 'COOLDOWN'; message: string };

export function calculateRecycleCredit(
  tier: Tier,
  balance: number,
  config: RealmConfig,
  quotedValue?: number,
) {
  const credited = quotedValue ?? config.recycleRewards[tier];
  if (!Number.isInteger(credited) || credited < 0 || credited > 2147483647)
    throw new GameError('INVALID_VALUE', 'The recycling value is invalid.', 409);
  if (balance > 2_147_483_647 - credited)
    throw new GameError(
      'WALLET_LIMIT',
      'Your wallet cannot hold this recycling reward. No card was recycled.',
      409,
    );
  return { credited, balance: balance + credited };
}

export function xpProgress(totalXp: number, config: RealmConfig): XpProgress {
  if (!Number.isInteger(totalXp) || totalXp < 0 || totalXp > 2_147_483_647)
    throw new GameError(
      'XP_LIMIT',
      'Experience is outside the supported range. No pack was opened.',
      409,
    );
  const thresholds = config.progression.levelThresholds;
  let index = 0;
  while (index + 1 < thresholds.length && totalXp >= thresholds[index + 1]) index++;
  const nextLevelAt = thresholds[index + 1] ?? null;
  return {
    totalXp,
    level: index + 1,
    maxLevel: thresholds.length,
    levelStartsAt: thresholds[index],
    nextLevelAt,
    xpIntoLevel: totalXp - thresholds[index],
    xpToNextLevel: nextLevelAt === null ? 0 : nextLevelAt - totalXp,
  };
}

export function calculateXpAward(totalXp: number, newCharacters: number, config: RealmConfig) {
  const previous = xpProgress(totalXp, config);
  if (!Number.isInteger(newCharacters) || newCharacters < 0)
    throw new GameError('INVALID_XP', 'Invalid discovery count.');
  const xpAwarded = newCharacters * config.progression.xpPerNewCharacter;
  if (!Number.isSafeInteger(xpAwarded) || totalXp > 2_147_483_647 - xpAwarded)
    throw new GameError(
      'XP_LIMIT',
      'The experience limit would be exceeded. No pack was opened.',
      409,
    );
  const next = xpProgress(totalXp + xpAwarded, config);
  return { ...next, xpAwarded, levelsGained: next.level - previous.level };
}

export type UpgradeResult = {
  ok: true;
  purchaseId: string;
  upgradeId: 'pack_discount';
  rank: number;
  charged: number;
  balance: number;
  discount: number;
  packPrice: number;
  requiredLevel: number;
  level: number;
  purchasedAt: string;
};

export function effectivePackPrice(config: RealmConfig, rank: number) {
  if (!Number.isInteger(rank) || rank < 0 || rank > config.upgrades.packDiscount.length)
    throw new GameError(
      'INVALID_UPGRADE',
      'Purchased upgrade rank is incompatible with this realm.',
      409,
    );
  return Math.max(0, config.packPrice - (config.upgrades.packDiscount[rank - 1]?.discount ?? 0));
}

export function upgradeView(config: RealmConfig, rank: number, xp: number, balance: number) {
  const packPrice = effectivePackPrice(config, rank);
  const level = xpProgress(xp, config).level;
  const rule = config.upgrades.packDiscount[rank];
  const next = rule
    ? { ...rule, rank: rank + 1, packPrice: Math.max(0, config.packPrice - rule.discount) }
    : null;
  const blocked = !next
    ? 'max_rank'
    : level < next.requiredLevel
      ? 'level'
      : balance < next.cost
        ? 'gems'
        : null;
  return {
    upgradeId: 'pack_discount' as const,
    rank,
    maxRank: config.upgrades.packDiscount.length,
    discount: config.upgrades.packDiscount[rank - 1]?.discount ?? 0,
    packPrice,
    next,
    blocked,
  };
}

export function calculateUpgradePurchase(
  config: RealmConfig,
  currentRank: number,
  targetRank: number,
  xp: number,
  balance: number,
) {
  const view = upgradeView(config, currentRank, xp, balance);
  if (!view.next)
    throw new GameError(
      'UPGRADE_MAXED',
      'All available ranks are already owned or upgrades are disabled.',
      409,
    );
  if (targetRank !== view.next.rank)
    throw new GameError(
      'UPGRADE_CONFLICT',
      'Your upgrade rank changed. Refresh before choosing a rank.',
      409,
    );
  if (view.blocked === 'level')
    throw new GameError(
      'LEVEL_REQUIRED',
      `Reach level ${view.next.requiredLevel} before buying this rank.`,
      409,
    );
  if (view.blocked === 'gems')
    throw new GameError('INSUFFICIENT_GEMS', 'You do not have enough gems for this upgrade.', 409);
  return {
    rank: targetRank,
    charged: view.next.cost,
    balance: balance - view.next.cost,
    discount: view.next.discount,
    packPrice: view.next.packPrice,
    requiredLevel: view.next.requiredLevel,
    level: xpProgress(xp, config).level,
  };
}

export function availableOdds(pool: Character[], config: RealmConfig): Record<Tier, number> {
  const weights = tiers.map((tier) =>
    pool.some((c) => c.tier === tier) ? config.tierWeights[tier] : 0,
  );
  const total = weights.reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    tiers.map((tier, i) => [tier, total ? weights[i] / total : 0]),
  ) as Record<Tier, number>;
}

export function drawableCount(pool: Character[], config: RealmConfig): number {
  return pool.filter((c) => config.tierWeights[c.tier] > 0).length;
}

// Presentation only: callers supply the same unclaimed category pool used by
// opening. Saved rarity and positive draw weights determine what can be shown.
export function selectPackSpotlights(
  pool: Character[],
  config: RealmConfig,
  limit: number,
): Character[] {
  if (drawableCount(pool, config) < config.packSize || limit < 1) return [];
  // Highest tier first, then stable ID order. A bounded selection gives the
  // same result as sorting the whole pool, which large rosters cannot afford
  // on every realm view.
  const order = (a: Character, b: Character) =>
    tiers.indexOf(b.tier) - tiers.indexOf(a.tier) || a.id.localeCompare(b.id);
  const top: Character[] = [];
  for (const character of pool) {
    if (config.tierWeights[character.tier] <= 0) continue;
    if (top.length < limit) {
      top.push(character);
      top.sort(order);
    } else if (order(character, top[top.length - 1]) < 0) {
      top[top.length - 1] = character;
      top.sort(order);
    }
  }
  return top;
}

export function characterOdds(
  pool: Character[],
  config: RealmConfig,
  wishlistIds: readonly string[] = [],
): Record<string, number> {
  const wishes = new Set(config.wishlist.slots === 0 ? [] : wishlistIds),
    rarity = availableOdds(pool, config);
  const weight = (character: Character) =>
    wishes.has(character.id) ? config.wishlist.weightMultiplier : 1;
  const totals = Object.fromEntries(
    tiers.map((tier) => [
      tier,
      pool.filter((c) => c.tier === tier).reduce((sum, c) => sum + weight(c), 0),
    ]),
  ) as Record<Tier, number>;
  return Object.fromEntries(
    pool.map((c) => [c.id, totals[c.tier] ? (rarity[c.tier] * weight(c)) / totals[c.tier] : 0]),
  );
}

/** characterOdds for selected IDs only (same values), without a per-character map of the pool. */
export function selectedCharacterOdds(
  pool: Character[],
  config: RealmConfig,
  ids: readonly string[],
  wishlistIds: readonly string[] = [],
): Record<string, number> {
  const wishes = new Set(config.wishlist.slots === 0 ? [] : wishlistIds),
    wanted = new Set(ids),
    rarity = availableOdds(pool, config);
  const weight = (character: Character) =>
    wishes.has(character.id) ? config.wishlist.weightMultiplier : 1;
  const totals = Object.fromEntries(tiers.map((tier) => [tier, 0])) as Record<Tier, number>;
  for (const character of pool) totals[character.tier] += weight(character);
  const result: Record<string, number> = {};
  for (const character of pool)
    if (wanted.has(character.id))
      result[character.id] = totals[character.tier]
        ? (rarity[character.tier] * weight(character)) / totals[character.tier]
        : 0;
  return result;
}

export type WishlistResult = {
  ok: true;
  changeId: string;
  characterId: string;
  present: boolean;
  entryId: string | null;
  changed: boolean;
  entryCount: number;
  slots: number;
  changedAt: string;
};

export function requireWishlistSpace(count: number, config: RealmConfig) {
  if (count >= config.wishlist.slots)
    throw new GameError(
      'WISHLIST_FULL',
      config.wishlist.slots === 0
        ? 'Wishlists are disabled in this realm.'
        : 'Your wishlist is full. Remove a wish before adding another.',
      409,
    );
}

// Production injects node:crypto.randomInt. Unit tests inject bounded integers.
export function drawPack(
  pool: Character[],
  config: RealmConfig,
  randomInt: (max: number) => number,
  wishlistIds: readonly string[] = [],
): Character[] {
  if (drawableCount(pool, config) < config.packSize)
    throw new GameError('EMPTY_POOL', 'Not enough eligible characters for a complete pack.');
  const remaining = [...pool];
  const wishes = new Set(config.wishlist.slots === 0 ? [] : wishlistIds);
  const result: Character[] = [];
  for (let i = 0; i < config.packSize; i++) {
    const eligibleTiers = tiers.filter(
      (t) => config.tierWeights[t] > 0 && remaining.some((c) => c.tier === t),
    );
    const total = eligibleTiers.reduce((sum, t) => sum + config.tierWeights[t], 0);
    let ticket = randomInt(total);
    let chosenTier = eligibleTiers[eligibleTiers.length - 1];
    for (const tier of eligibleTiers) {
      ticket -= config.tierWeights[tier];
      if (ticket < 0) {
        chosenTier = tier;
        break;
      }
    }
    const candidates = remaining.filter((c) => c.tier === chosenTier);
    const weight = (c: Character) => (wishes.has(c.id) ? config.wishlist.weightMultiplier : 1);
    let characterTicket = randomInt(candidates.reduce((sum, c) => sum + weight(c), 0));
    let chosen = candidates[candidates.length - 1];
    for (const candidate of candidates) {
      characterTicket -= weight(candidate);
      if (characterTicket < 0) {
        chosen = candidate;
        break;
      }
    }
    result.push(chosen);
    remaining.splice(
      remaining.findIndex((c) => c.id === chosen.id),
      1,
    );
  }
  return result;
}

export const packOpeningCounts = [1, 5, 10] as const;
export type PackOpeningCount = (typeof packOpeningCounts)[number];
export function requirePackOpeningCount(value: unknown): PackOpeningCount {
  if (value !== 1 && value !== 5 && value !== 10)
    throw new GameError('INVALID_PACK_COUNT', 'Choose 1, 5 or 10 packs.');
  return value;
}

// A bundle samples each pack from the still-unclaimed pool. The service commits
// all results together; this pure function never mutates its input catalog.
export function drawPacks(
  pool: Character[],
  config: RealmConfig,
  count: PackOpeningCount,
  randomInt: (max: number) => number,
  wishlistIds: readonly string[] = [],
): Character[] {
  requirePackOpeningCount(count);
  if (drawableCount(pool, config) < config.packSize * count)
    throw new GameError('EMPTY_POOL', 'Not enough eligible characters for every requested pack.');
  let remaining = pool;
  const result: Character[] = [];
  for (let pack = 0; pack < count; pack++) {
    const characters = drawPack(remaining, config, randomInt, wishlistIds);
    result.push(...characters);
    const selected = new Set(characters.map((character) => character.id));
    remaining = remaining.filter((character) => !selected.has(character.id));
  }
  return result;
}

export type SettingsMember = {
  balance: number;
  xp: number;
  rank: number;
  wishes: number;
  collectorRank?: number;
  rankTrackLevels?: RankTrackLevels;
  lastOpenedAt: string | null;
};
export type SettingsPack = { id: string; name: string; pool: Character[] };
export type SettingsImpact = {
  changes: { label: string; before: string; after: string }[];
  blockers: string[];
  warnings: string[];
  players: number;
  levelsUp: number;
  levelsDown: number;
  pricesUp: number;
  pricesDown: number;
  affordableBefore: number;
  affordableAfter: number;
  waitingBefore: number;
  waitingAfter: number;
  maximumWishes: number;
  purchasedRank: number;
  pendingTrades: number;
  packs: {
    id: string;
    name: string;
    availableBefore: number;
    availableAfter: number;
    openableBefore: boolean;
    openableAfter: boolean;
    oddsBefore: Record<Tier, number>;
    oddsAfter: Record<Tier, number>;
  }[];
};

export function realmSettingsImpact(
  current: RealmConfig,
  proposed: RealmConfig,
  members: SettingsMember[],
  packs: SettingsPack[],
  now: number,
  pendingTrades = 0,
): SettingsImpact {
  const changes: SettingsImpact['changes'] = [];
  function compare(label: string, before: unknown, after: unknown) {
    if (JSON.stringify(before) !== JSON.stringify(after))
      changes.push({
        label,
        before: typeof before === 'object' ? JSON.stringify(before) : String(before),
        after: typeof after === 'object' ? JSON.stringify(after) : String(after),
      });
  }
  compare('Pack price (gems)', current.packPrice, proposed.packPrice);
  compare('Cards per pack', current.packSize, proposed.packSize);
  compare('Starting gems for future players', current.startingGems, proposed.startingGems);
  compare('Timed gem claims', current.gemRewards, proposed.gemRewards);
  compare('Collector rank progression', current.rankTracks, proposed.rankTracks);
  compare('Character values', current.characterValues, proposed.characterValues);
  compare('Cooldown (seconds)', current.cooldownSeconds, proposed.cooldownSeconds);
  compare('Minimum catalog pool', current.minimumPoolSize, proposed.minimumPoolSize);
  compare('Maximum category packs', current.maximumCategoryPacks, proposed.maximumCategoryPacks);
  for (const tier of tiers) {
    compare(`${tier} rarity weight`, current.tierWeights[tier], proposed.tierWeights[tier]);
    compare(
      `${tier} recycling reward`,
      current.recycleRewards[tier],
      proposed.recycleRewards[tier],
    );
  }
  compare(
    'XP per new character',
    current.progression.xpPerNewCharacter,
    proposed.progression.xpPerNewCharacter,
  );
  compare(
    'Level thresholds (total XP)',
    current.progression.levelThresholds,
    proposed.progression.levelThresholds,
  );
  compare('Wishlist slots', current.wishlist.slots, proposed.wishlist.slots);
  compare(
    'Wishlist weight multiplier',
    current.wishlist.weightMultiplier,
    proposed.wishlist.weightMultiplier,
  );
  compare(
    'Pack discount ranks',
    current.upgrades.packDiscount.length,
    proposed.upgrades.packDiscount.length,
  );
  for (
    let index = 0;
    index < Math.max(current.upgrades.packDiscount.length, proposed.upgrades.packDiscount.length);
    index++
  ) {
    const before = current.upgrades.packDiscount[index],
      after = proposed.upgrades.packDiscount[index];
    compare(
      `Rank ${index + 1} cost (gems)`,
      before?.cost ?? 'Unavailable',
      after?.cost ?? 'Unavailable',
    );
    compare(
      `Rank ${index + 1} required level`,
      before?.requiredLevel ?? 'Unavailable',
      after?.requiredLevel ?? 'Unavailable',
    );
    compare(
      `Rank ${index + 1} discount (gems)`,
      before?.discount ?? 'Unavailable',
      after?.discount ?? 'Unavailable',
    );
  }
  compare('Collector rank ladder', current.ranks, proposed.ranks);
  compare('Allow new trades', current.trading.enabled, proposed.trading.enabled);
  compare(
    'Trade cards per side',
    current.trading.maxCardsPerSide,
    proposed.trading.maxCardsPerSide,
  );
  compare('Trade gems per side', current.trading.maxGemsPerSide, proposed.trading.maxGemsPerSide);
  compare(
    'Pending trades per player',
    current.trading.maxPendingPerPlayer,
    proposed.trading.maxPendingPerPlayer,
  );
  compare(
    'Trade expiry (minutes)',
    current.trading.expiresAfterMinutes,
    proposed.trading.expiresAfterMinutes,
  );
  const purchasedRank = Math.max(0, ...members.map((member) => member.rank));
  const maximumWishes = Math.max(0, ...members.map((member) => member.wishes));
  const blockers: string[] = [],
    warnings: string[] = [];
  if (pendingTrades && JSON.stringify(current.trading) !== JSON.stringify(proposed.trading))
    warnings.push(
      `${pendingTrades} pending trade(s) keep their creation rules and expiry; changed trading rules apply to new offers.`,
    );
  if (JSON.stringify(current.gemRewards) !== JSON.stringify(proposed.gemRewards))
    warnings.push(
      'Timed gem changes apply to future claims using the last successful claim time; existing wallets and receipts stay unchanged.',
    );
  if (!changes.length) blockers.push('Choose at least one settings change.');
  if (
    current.minimumPoolSize !== proposed.minimumPoolSize ||
    current.maximumCategoryPacks !== proposed.maximumCategoryPacks
  )
    blockers.push(
      'Pack-generation settings are creation-only; existing pack IDs must remain stable.',
    );
  const ownedCollectorRank = Math.max(0, ...members.map((member) => member.collectorRank ?? 0));
  for (const track of current.rankTracks.tracks) {
    const owned = Math.max(0, ...members.map((member) => member.rankTrackLevels?.[track.id] ?? 0));
    if (!owned) continue;
    const next = proposed.rankTracks.tracks.find((item) => item.id === track.id);
    if (
      !proposed.rankTracks.enabled ||
      !next ||
      next.name !== track.name ||
      JSON.stringify(next.requires) !== JSON.stringify(track.requires) ||
      JSON.stringify(next.levels.slice(0, owned)) !== JSON.stringify(track.levels.slice(0, owned))
    )
      blockers.push(
        `${track.name} has purchased levels; its owned costs, benefits and unlock requirements must stay unchanged.`,
      );
  }
  for (let index = 0; index < ownedCollectorRank; index++) {
    if (
      !proposed.ranks.enabled ||
      JSON.stringify(current.ranks.levels[index]) !== JSON.stringify(proposed.ranks.levels[index])
    )
      blockers.push(
        `Collector rank ${index + 1} is already purchased; its name, cost and bonuses must stay unchanged.`,
      );
  }
  if (
    members.some(
      (member) =>
        member.wishes >
        Math.min(
          20,
          proposed.wishlist.slots +
            (proposed.ranks.enabled
              ? (proposed.ranks.levels[(member.collectorRank ?? 0) - 1]?.wishlistSlots ?? 0)
              : 0) +
            Object.entries(member.rankTrackLevels ?? {}).reduce(
              (sum, [id, level]) =>
                sum +
                (proposed.rankTracks.enabled
                  ? (proposed.rankTracks.tracks.find((track) => track.id === id)?.levels[level - 1]
                      ?.benefits.wishlistSlots ?? 0)
                  : 0),
              0,
            ),
        ),
    )
  )
    blockers.push(
      `At least one player has ${maximumWishes} wishes. Keep at least that many slots until players remove them.`,
    );
  for (let index = 0; index < purchasedRank; index++) {
    const before = current.upgrades.packDiscount[index],
      after = proposed.upgrades.packDiscount[index];
    if (
      !after ||
      before.cost !== after.cost ||
      before.requiredLevel !== after.requiredLevel ||
      before.discount !== after.discount
    )
      blockers.push(
        `Pack discount rank ${index + 1} is already purchased; its cost, level requirement, and discount must stay unchanged.`,
      );
  }
  if (
    proposed.upgrades.packDiscount.some(
      (rank) => rank.requiredLevel > proposed.progression.levelThresholds.length,
    )
  )
    warnings.push(
      'Some upgrade ranks require levels above the highest configured level and will remain locked.',
    );
  const highestRankConfig = applyRankBenefits(
    proposed,
    proposed.ranks.enabled ? proposed.ranks.levels.length : 0,
  );
  const minimumPrice = effectivePackPrice(highestRankConfig, proposed.upgrades.packDiscount.length);
  if (
    proposed.packSize * Math.max(...Object.values(highestRankConfig.recycleRewards)) >
    minimumPrice
  )
    warnings.push(
      'The maximum recycling reward for a pack exceeds its most discounted price. These rules may allow profitable recycling.',
    );
  if (current.progression.xpPerNewCharacter !== proposed.progression.xpPerNewCharacter)
    warnings.push(
      'The XP reward applies only to future first collections; existing XP and known characters are preserved.',
    );
  if (current.startingGems !== proposed.startingGems)
    warnings.push(
      'Starting gems change only for future memberships; existing wallets receive no adjustment.',
    );
  const previewPacks = packs.map((pack) => {
    const availableBefore = drawableCount(pack.pool, current),
      availableAfter = drawableCount(pack.pool, proposed);
    return {
      id: pack.id,
      name: pack.name,
      availableBefore,
      availableAfter,
      openableBefore: availableBefore >= current.packSize,
      openableAfter: availableAfter >= proposed.packSize,
      oddsBefore: availableOdds(pack.pool, current),
      oddsAfter: availableOdds(pack.pool, proposed),
    };
  });
  if (previewPacks.some((pack) => !pack.openableAfter))
    warnings.push(
      'Some packs cannot supply a complete opening under the proposed rules. They will reject without charge.',
    );
  let levelsUp = 0,
    levelsDown = 0,
    pricesUp = 0,
    pricesDown = 0,
    affordableBefore = 0,
    affordableAfter = 0,
    waitingBefore = 0,
    waitingAfter = 0;
  for (const member of members) {
    const oldLevel = xpProgress(member.xp, current).level,
      newLevel = xpProgress(member.xp, proposed).level;
    if (newLevel > oldLevel) levelsUp++;
    if (newLevel < oldLevel) levelsDown++;
    const beforeConfig = applyRankTrackBenefits(
      applyRankBenefits(current, member.collectorRank ?? 0),
      member.rankTrackLevels ?? {},
    );
    let afterConfig =
      (member.collectorRank ?? 0) <= proposed.ranks.levels.length &&
      (!(member.collectorRank ?? 0) || proposed.ranks.enabled)
        ? applyRankBenefits(proposed, member.collectorRank ?? 0)
        : proposed;
    try {
      afterConfig = applyRankTrackBenefits(afterConfig, member.rankTrackLevels ?? {});
    } catch {
      /* A blocked draft still needs a complete preview. */
    }
    const beforePrice = effectivePackPrice(beforeConfig, member.rank);
    // A blocked rank removal still needs a complete preview; owned benefits are never applied from this draft.
    const afterPrice =
      member.rank <= proposed.upgrades.packDiscount.length
        ? effectivePackPrice(afterConfig, member.rank)
        : beforePrice;
    if (afterPrice > beforePrice) pricesUp++;
    if (afterPrice < beforePrice) pricesDown++;
    if (member.balance >= beforePrice) affordableBefore++;
    if (member.balance >= afterPrice) affordableAfter++;
    if (member.lastOpenedAt) {
      const opened = Date.parse(member.lastOpenedAt);
      if (opened + beforeConfig.cooldownSeconds * 1000 > now) waitingBefore++;
      if (opened + afterConfig.cooldownSeconds * 1000 > now) waitingAfter++;
    }
  }
  if (levelsDown)
    warnings.push(
      `${levelsDown} player(s) will display a lower derived level. XP and owned upgrades stay intact.`,
    );
  return {
    changes,
    blockers,
    warnings,
    players: members.length,
    levelsUp,
    levelsDown,
    pricesUp,
    pricesDown,
    affordableBefore,
    affordableAfter,
    waitingBefore,
    waitingAfter,
    maximumWishes,
    purchasedRank,
    pendingTrades,
    packs: previewPacks,
  };
}

export type SettingsPreview = {
  id: string;
  revision: number;
  expiresAt: string;
  impact: SettingsImpact;
};
export type SettingsResult = { ok: true; changeId: string; revision: number; appliedAt: string };

export * from './ranks';

export * from './gem-rewards';
