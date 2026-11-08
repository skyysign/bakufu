import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Database } from '../../packages/db/src/connection';
import type { RealmConfig } from '../../packages/config/src/index';
import {
  defaultTrading,
  disabledCollectorRanks,
  disabledGemRewards,
} from '../../packages/config/src/index';
import type { OpeningResult } from '../../packages/core/src/index';
import demo from '../../packages/importers/fixtures/demo.v1.json';
import { parseCatalog } from '../../packages/importers/src/index';

// A v1 configuration snapshot, intentionally independent of future defaults.
export const legacyConfig = {
  schemaVersion: 1,
  ownership: 'unique',
  packPrice: 10,
  packSize: 1,
  startingGems: 100,
  cooldownSeconds: 0,
  minimumPoolSize: 2,
  maximumCategoryPacks: 10,
  tierWeights: { common: 70, uncommon: 25, rare: 5 },
  emptyTierPolicy: 'renormalize',
  partialPackPolicy: 'reject',
} as const;

// Old player archives had neither trade coordination IDs nor transfer fields.
export function withoutTradeArchiveFields(input: unknown) {
  const archive = structuredClone(input) as Record<string, unknown>;
  for (const key of [
    'tradingRules',
    'tradeCode',
    'trades',
    'discordProfile',
    'realmAdmission',
    'collectorRank',
    'rankRules',
    'rankPurchases',
    'marketListings',
    'gemRewardRules',
    'gemRewardClaims',
    'rankTrackRules',
    'rankTrackLevels',
    'rankTrackPurchases',
    'characterValueRules',
    'characterValues',
    'recyclingValuations',
  ])
    delete archive[key];
  const omit = (row: Record<string, unknown>, key: string) =>
    Object.fromEntries(Object.entries(row).filter(([field]) => field !== key));
  if (Array.isArray(archive.cards))
    archive.cards = archive.cards.map((row) => omit(row, 'receivedAt'));
  if (Array.isArray(archive.xpLedger))
    archive.xpLedger = archive.xpLedger.map((row) => omit(row, 'tradeId'));
  return archive;
}

export async function installLegacySchema(
  db: Database,
  through: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 = 1,
) {
  await db.query(
    'CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of [
    '0001_initial.sql',
    ...(through >= 2 ? ['0002_discord_auth.sql'] : []),
    ...(through >= 3 ? ['0003_recycling.sql'] : []),
    ...(through >= 4 ? ['0004_progression.sql'] : []),
    ...(through >= 5 ? ['0005_upgrades.sql'] : []),
    ...(through >= 6 ? ['0006_wishlist.sql'] : []),
    ...(through >= 7 ? ['0007_realm_settings.sql'] : []),
    ...(through >= 8 ? ['0008_trading.sql'] : []),
    ...(through >= 9 ? ['0009_discord_interactions.sql'] : []),
    ...(through >= 10 ? ['0010_member_profiles.sql'] : []),
    ...(through >= 11 ? ['0011_discord_admission.sql'] : []),
    ...(through >= 12 ? ['0012_realm_creation.sql'] : []),
    ...(through >= 13 ? ['0013_password_revision.sql'] : []),
    ...(through >= 14 ? ['0014_collector_ranks.sql'] : []),
    ...(through >= 15 ? ['0015_market.sql'] : []),
    ...(through >= 16 ? ['0016_gem_rewards.sql'] : []),
  ]) {
    const sql = await readFile(
      new URL(`../../packages/db/migrations/${name}`, import.meta.url),
      'utf8',
    );
    await db.query(sql);
    await db.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
      name,
      createHash('sha256').update(sql).digest('hex'),
    ]);
  }
}

export async function seedLegacyRealm(
  db: Database,
  accountId: string,
  config: Omit<
    RealmConfig,
    | 'schemaVersion'
    | 'rankTracks'
    | 'legacyPurchasesRetired'
    | 'tierWeights'
    | 'recycleRewards'
    | 'progression'
    | 'upgrades'
    | 'wishlist'
    | 'trading'
    | 'ranks'
    | 'gemRewards'
    | 'characterValues'
  > & {
    tierWeights: { common: number; uncommon: number; rare: number };
    schemaVersion: 1;
  } = legacyConfig,
) {
  const realmId = randomUUID(),
    packId = randomUUID(),
    cardId = randomUUID(),
    requestKey = randomUUID();
  const character = parseCatalog(demo).characters.find((c) => c.sourceKey === 'lantern-demo:ro')!;
  const result: OpeningResult = {
    ok: true,
    openingId: randomUUID(),
    cardIds: [cardId],
    characters: [character],
    charged: config.packPrice,
    balance: config.startingGems - config.packPrice,
  };
  const recyclingSchema = (
    await db.query("SELECT 1 FROM schema_migrations WHERE name='0003_recycling.sql'")
  ).rowCount;
  const progressionSchema = (
    await db.query("SELECT 1 FROM schema_migrations WHERE name='0004_progression.sql'")
  ).rowCount;
  const v2 = recyclingSchema
    ? { ...config, schemaVersion: 2, recycleRewards: { common: 2, uncommon: 4, rare: 6 } }
    : config;
  const v3 = progressionSchema
    ? {
        ...v2,
        schemaVersion: 3,
        progression: { xpPerNewCharacter: 10, levelThresholds: [0, 20, 40, 70, 100] },
      }
    : v2;
  const upgradeSchema = (
    await db.query("SELECT 1 FROM schema_migrations WHERE name='0005_upgrades.sql'")
  ).rowCount;
  const v4 = upgradeSchema
    ? {
        ...v3,
        schemaVersion: 4,
        upgrades: {
          packDiscount: [
            { cost: 10, requiredLevel: 2, discount: 1 },
            { cost: 20, requiredLevel: 3, discount: 2 },
          ],
        },
      }
    : v3;
  const wishlistSchema = (
    await db.query("SELECT 1 FROM schema_migrations WHERE name='0006_wishlist.sql'")
  ).rowCount;
  const v5 = wishlistSchema
    ? { ...v4, schemaVersion: 5, wishlist: { slots: 3, weightMultiplier: 2 } }
    : v4;
  const tradingSchema = (
    await db.query("SELECT 1 FROM schema_migrations WHERE name='0008_trading.sql'")
  ).rowCount;
  const v6 = tradingSchema ? { ...v5, schemaVersion: 6, trading: defaultTrading } : v5;
  const rankSchema = (
    await db.query("SELECT 1 FROM schema_migrations WHERE name='0014_collector_ranks.sql'")
  ).rowCount;
  const v7 = rankSchema ? { ...v6, schemaVersion: 7, ranks: disabledCollectorRanks } : v6;
  const gemSchema = (
    await db.query("SELECT 1 FROM schema_migrations WHERE name='0016_gem_rewards.sql'")
  ).rowCount;
  const storedConfig = gemSchema ? { ...v7, schemaVersion: 8, gemRewards: disabledGemRewards } : v7;
  await db.query('INSERT INTO realms(id,name,config,created_by) VALUES($1,$2,$3,$4)', [
    realmId,
    'Legacy realm',
    storedConfig,
    accountId,
  ]);
  await db.query(
    "INSERT INTO memberships(realm_id,account_id,role,balance) VALUES($1,$2,'admin',$3)",
    [realmId, accountId, result.balance],
  );
  await db.query(
    'INSERT INTO characters(realm_id,id,source_key,name,series,categories,tier,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      realmId,
      character.id,
      character.sourceKey,
      character.name,
      character.series,
      character.categories,
      character.tier,
      { source: 'lantern-demo', revision: '1' },
    ],
  );
  await db.query('INSERT INTO packs(realm_id,id,name) VALUES($1,$2,$3)', [
    realmId,
    packId,
    'All Characters',
  ]);
  await db.query(
    'INSERT INTO openings(realm_id,account_id,request_key,id,pack_id,result,config_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [realmId, accountId, requestKey, result.openingId, packId, result, storedConfig],
  );
  await db.query(
    'INSERT INTO cards(realm_id,id,character_id,owner_id,request_key) VALUES($1,$2,$3,$4,$5)',
    [realmId, cardId, character.id, accountId, requestKey],
  );
  await db.query(
    "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason) VALUES($1,$2,$3,'starting-grant',$4,$4,'starting_grant'),($1,$5,$3,$6,$7,$8,'pack_opening')",
    [
      realmId,
      randomUUID(),
      accountId,
      config.startingGems,
      randomUUID(),
      requestKey,
      -config.packPrice,
      result.balance,
    ],
  );
  if (progressionSchema)
    await db.query(
      "INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version,character_id,card_id,request_key) VALUES($1,$2,$3,'first_collection',0,0,$4,$5,$6)",
      [realmId, randomUUID(), accountId, character.id, cardId, requestKey],
    );
  return { realmId, packId, cardId, requestKey, result, character };
}
