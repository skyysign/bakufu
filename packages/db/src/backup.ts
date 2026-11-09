import { validateGemRewardBackup } from './gem-reward-backup';
import { validateCharacterValues } from './character-values';
import { validateAdminGemGrants } from './admin-gems';
import { validateArtworkReferences } from './artwork-backup';
import { validatePackBundleBackup } from './pack-bundle-backup';
import { validateRankBackup } from './rank-backup';
import { validateRankTrackBackup } from './rank-track-backup';
import { validateEconomyRebalances } from './economy-preset';
import { validateTierAdjustments } from './tier-adjustments';
import { validateCharacterRemovals } from './character-removal';
import { effectiveMemberConfig } from './rank-track-state';
import { validateMarketBackup } from './market-backup';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { z } from 'zod';
import { transaction, type Database } from './connection';
import { parseRealmConfig } from '../../config/src/index';
import { seedHistoricalXp } from './progression';
import { validateTradeBackup } from './trade-backup';
import { validateAdminCollectionBackup } from './admin-collections';
import { discordProfileSchema } from './member-profiles';
import { validateAdmissionBackup } from './admission-backup';
import { migrationNames } from './schema-version';

// Ordered for foreign keys. Sessions and login throttles intentionally do not restore.
const columns = {
  accounts: ['id', 'email', 'password_hash', 'instance_admin', 'created_at', 'password_revision'],
  account_identities: ['provider', 'subject', 'account_id', 'created_at'],
  realms: ['id', 'name', 'config', 'created_by', 'created_at', 'config_revision'],
  realm_creation_requests: ['account_id', 'request_key', 'realm_id', 'fingerprint', 'created_at'],
  memberships: ['realm_id', 'account_id', 'role', 'balance', 'xp', 'last_opened_at', 'trade_code'],
  characters: [
    'realm_id',
    'id',
    'source_key',
    'name',
    'series',
    'categories',
    'tier',
    'provenance',
    'popularity',
    'retired_at',
  ],
  packs: ['realm_id', 'id', 'name', 'category', 'retired_at'],
  openings: [
    'realm_id',
    'account_id',
    'request_key',
    'id',
    'pack_id',
    'result',
    'config_snapshot',
    'created_at',
    'pack_count',
  ],
  cards: [
    'realm_id',
    'id',
    'character_id',
    'owner_id',
    'request_key',
    'acquired_at',
    'recycled_at',
    'original_owner_id',
  ],
  recyclings: [
    'realm_id',
    'account_id',
    'request_key',
    'id',
    'card_id',
    'result',
    'config_snapshot',
    'created_at',
  ],
  wallet_ledger: [
    'realm_id',
    'id',
    'account_id',
    'operation_key',
    'amount',
    'balance_after',
    'reason',
    'created_at',
  ],
  trades: [
    'realm_id',
    'id',
    'creator_id',
    'counterparty_id',
    'status',
    'offer_version',
    'config_snapshot',
    'created_at',
    'updated_at',
    'expires_at',
    'completed_at',
  ],
  trade_versions: [
    'realm_id',
    'trade_id',
    'version',
    'changed_by',
    'creator_offer',
    'counterparty_offer',
    'created_at',
  ],
  trade_confirmations: ['realm_id', 'trade_id', 'version', 'account_id', 'created_at'],
  trade_cards: ['realm_id', 'trade_id', 'offer_version', 'card_id', 'account_id', 'released_at'],
  admin_collection_actions: [
    'realm_id',
    'id',
    'actor_id',
    'request_key',
    'kind',
    'account_id',
    'card_id',
    'from_id',
    'amount',
    'note',
    'result',
    'created_at',
  ],
  card_transfers: [
    'realm_id',
    'id',
    'trade_id',
    'card_id',
    'sequence',
    'from_id',
    'to_id',
    'created_at',
    'admin_action_id',
  ],
  trade_requests: [
    'realm_id',
    'account_id',
    'request_key',
    'trade_id',
    'fingerprint',
    'result',
    'created_at',
  ],
  xp_ledger: [
    'realm_id',
    'id',
    'account_id',
    'reason',
    'amount',
    'policy_version',
    'character_id',
    'card_id',
    'request_key',
    'created_at',
    'trade_id',
  ],
  upgrade_purchases: [
    'realm_id',
    'id',
    'account_id',
    'request_key',
    'upgrade_id',
    'rank',
    'result',
    'config_snapshot',
    'created_at',
  ],
  wishlist_entries: ['realm_id', 'id', 'account_id', 'character_id', 'created_at'],
  wishlist_changes: [
    'realm_id',
    'id',
    'account_id',
    'request_key',
    'character_id',
    'present',
    'result',
    'config_snapshot',
    'created_at',
  ],
  realm_config_changes: [
    'realm_id',
    'id',
    'account_id',
    'request_key',
    'preview_id',
    'from_revision',
    'to_revision',
    'before_config',
    'after_config',
    'result',
    'created_at',
  ],
  discord_guild_realms: ['guild_id', 'id', 'realm_id', 'linked_by', 'linked_at'],
  discord_profiles: [
    'account_id',
    'provider',
    'username',
    'display_name',
    'updated_at',
    'avatar_url',
  ],
  gem_reward_claims: [
    'realm_id',
    'id',
    'account_id',
    'request_key',
    'result',
    'config_snapshot',
    'created_at',
  ],
  admin_gem_grants: ['realm_id', 'id', 'account_id', 'request_key', 'result', 'note', 'created_at'],
  rank_purchases: [
    'realm_id',
    'id',
    'account_id',
    'request_key',
    'rank',
    'result',
    'config_snapshot',
    'created_at',
  ],
  rank_track_purchases: [
    'realm_id',
    'id',
    'account_id',
    'request_key',
    'track_id',
    'level',
    'result',
    'config_snapshot',
    'created_at',
  ],
  economy_rebalances: [
    'realm_id',
    'id',
    'account_id',
    'request_key',
    'preview_hash',
    'before_config',
    'after_config',
    'tier_changes',
    'result',
    'created_at',
  ],
  tier_adjustments: [
    'realm_id',
    'id',
    'account_id',
    'request_key',
    'kind',
    'preview_hash',
    'config_change_id',
    'before_floors',
    'after_floors',
    'character_id',
    'override_before',
    'override_after',
    'changes',
    'result',
    'created_at',
  ],
  character_removals: [
    'realm_id',
    'id',
    'account_id',
    'request_key',
    'preview_hash',
    'character_ids',
    'refunds',
    'result',
    'created_at',
  ],
  market_listings: [
    'realm_id',
    'id',
    'seller_id',
    'card_id',
    'price',
    'status',
    'buyer_id',
    'sale_trade_id',
    'created_at',
    'closed_at',
  ],
  market_requests: [
    'realm_id',
    'account_id',
    'request_key',
    'listing_id',
    'fingerprint',
    'command',
    'result',
    'created_at',
  ],
  realm_admission_policies: [
    'realm_id',
    'schema_version',
    'revision',
    'mode',
    'guild_id',
    'join_code',
    'updated_by',
    'updated_at',
  ],
  realm_admission_changes: [
    'realm_id',
    'id',
    'account_id',
    'request_key',
    'fingerprint',
    'from_revision',
    'to_revision',
    'before_policy',
    'after_policy',
    'result',
    'created_at',
  ],
  realm_admissions: [
    'realm_id',
    'account_id',
    'id',
    'method',
    'policy_revision',
    'guild_id',
    'starting_gems',
    'admitted_at',
  ],
  realm_tier_sounds: [
    'realm_id',
    'tier',
    'file_name',
    'duration_ms',
    'audio',
    'rights_confirmed',
    'updated_by',
    'updated_at',
  ],
  realm_character_sounds: [
    'realm_id',
    'character_id',
    'file_name',
    'duration_ms',
    'audio',
    'rights_confirmed',
    'updated_by',
    'updated_at',
  ],
} as const;
const tableNames = Object.keys(columns) as (keyof typeof columns)[];
type Migration = { name: string; checksum: string };

// Only these explicitly compatible schema revisions may be restored by this release.
function columnsForMigrations(
  migrations: Migration[],
): Partial<Record<keyof typeof columns, readonly string[]>> {
  if (
    !migrations.length ||
    migrations.length > migrationNames.length ||
    migrations.some((migration, i) => migration.name !== migrationNames[i])
  )
    throw new Error('Unsupported backup schema. Use the matching source release.');
  const source: Partial<Record<keyof typeof columns, readonly string[]>> = { ...columns };
  if (!migrations.some((migration) => migration.name === '0029_character_removals.sql')) {
    delete source.character_removals;
    source.characters = columns.characters.filter((field) => field !== 'retired_at');
  }
  if (!migrations.some((migration) => migration.name === '0028_tier_adjustments.sql'))
    delete source.tier_adjustments;
  if (!migrations.some((migration) => migration.name === '0027_admin_collections.sql')) {
    delete source.admin_collection_actions;
    source.card_transfers = columns.card_transfers.filter((field) => field !== 'admin_action_id');
  }
  if (!migrations.some((migration) => migration.name === '0026_pack_retirement.sql'))
    source.packs = columns.packs.filter((field) => field !== 'retired_at');
  if (!migrations.some((migration) => migration.name === '0025_character_sounds.sql'))
    delete source.realm_character_sounds;
  if (!migrations.some((migration) => migration.name === '0024_pull_feed_tier_sounds.sql'))
    delete source.realm_tier_sounds;
  if (!migrations.some((migration) => migration.name === '0023_character_values.sql'))
    source.characters = (source.characters ?? columns.characters).filter(
      (field) => field !== 'popularity',
    );
  if (!migrations.some((migration) => migration.name === '0022_economy_rebalances.sql'))
    delete source.economy_rebalances;
  if (!migrations.some((migration) => migration.name === '0020_rank_tracks.sql'))
    delete source.rank_track_purchases;
  if (!migrations.some((migration) => migration.name === '0021_discord_avatars.sql'))
    source.discord_profiles = columns.discord_profiles.filter((field) => field !== 'avatar_url');
  if (migrations.length < 18) delete source.admin_gem_grants;
  if (migrations.length < 17)
    source.openings = columns.openings.filter((field) => field !== 'pack_count');
  if (migrations.length < 16) delete source.gem_reward_claims;
  if (migrations.length < 15) {
    delete source.market_listings;
    delete source.market_requests;
  }
  if (migrations.length < 14) delete source.rank_purchases;
  if (migrations.length < 13)
    source.accounts = columns.accounts.filter((field) => field !== 'password_revision');
  if (migrations.length < 12) delete source.realm_creation_requests;
  if (migrations.length < 11) {
    delete source.realm_admission_policies;
    delete source.realm_admission_changes;
    delete source.realm_admissions;
  }
  if (migrations.length < 10) delete source.discord_profiles;
  if (migrations.length < 9) delete source.discord_guild_realms;
  if (migrations.length < 8) {
    for (const table of [
      'trades',
      'trade_versions',
      'trade_confirmations',
      'trade_cards',
      'card_transfers',
      'trade_requests',
    ] as const)
      delete source[table];
    source.memberships = columns.memberships.filter((field) => field !== 'trade_code');
    source.cards = columns.cards.filter((field) => field !== 'original_owner_id');
    source.xp_ledger = columns.xp_ledger.filter((field) => field !== 'trade_id');
  }
  if (migrations.length < 7) {
    delete source.realm_config_changes;
    source.realms = columns.realms.filter((field) => field !== 'config_revision');
  }
  if (migrations.length < 6) {
    delete source.wishlist_entries;
    delete source.wishlist_changes;
  }
  if (migrations.length < 5) delete source.upgrade_purchases;
  if (migrations.length < 4) delete source.xp_ledger;
  if (migrations.length < 2) delete source.account_identities;
  if (migrations.length < 3) {
    delete source.recyclings;
    source.cards = source.cards!.filter((field) => field !== 'recycled_at');
  }
  return source;
}
const payloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('card-engine-instance-snapshot'),
  createdAt: z.iso.datetime(),
  migrations: z.array(z.strictObject({ name: z.string(), checksum: z.string() })),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
const envelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('card-engine-encrypted-backup'),
  salt: z.string().regex(/^[a-f0-9]{32}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
  ciphertext: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const checksum = (data: Buffer) => createHash('sha256').update(data).digest('hex');
function key(passphrase: string, salt: Buffer) {
  z.string().min(16).max(256).parse(passphrase);
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export async function makeBackup(db: Database, passphrase: string): Promise<string> {
  const snapshot = await transaction(
    db,
    async (tx) => {
      const tables: Record<string, unknown[]> = {};
      const migrations = (
        await tx.query('SELECT name,checksum FROM schema_migrations ORDER BY name')
      ).rows as Migration[];
      const sourceColumns = columnsForMigrations(migrations);
      // Server-side JSON preserves PostgreSQL timestamp microseconds (JS Date does not).
      for (const table of Object.keys(sourceColumns))
        tables[table] = (await tx.query(`SELECT to_jsonb(t) AS row FROM ${table} t`)).rows.map(
          (r) => r.row,
        );
      return {
        schemaVersion: 1,
        kind: 'card-engine-instance-snapshot',
        createdAt: new Date().toISOString(),
        migrations,
        tables,
      };
    },
    true,
  );
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(passphrase, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot)), cipher.final()]);
  return JSON.stringify(
    {
      schemaVersion: 1,
      kind: 'card-engine-encrypted-backup',
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      ciphertext: ciphertext.toString('base64'),
      sha256: checksum(ciphertext),
    },
    null,
    2,
  );
}

function readBackup(archive: string, passphrase: string) {
  const envelope = envelopeSchema.parse(JSON.parse(archive));
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  if (checksum(ciphertext) !== envelope.sha256) throw new Error('Backup checksum mismatch.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(passphrase, Buffer.from(envelope.salt, 'hex')),
    Buffer.from(envelope.iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const snapshot = payloadSchema.parse(JSON.parse(plaintext.toString('utf8')));
  const sourceColumns = columnsForMigrations(snapshot.migrations);
  if (Object.keys(snapshot.tables).sort().join(',') !== Object.keys(sourceColumns).sort().join(','))
    throw new Error('Backup table manifest is incompatible.');
  return { snapshot, sourceColumns };
}

// Authentication/format check only. A fresh-database restore remains the recovery test.
export function verifyBackup(archive: string, passphrase: string): void {
  readBackup(archive, passphrase);
}

export function backupCreatedAt(archive: string, passphrase: string): string {
  return readBackup(archive, passphrase).snapshot.createdAt;
}

// Read-only comparison after recovery. Let PostgreSQL cast expected values so
// timestamps retain microseconds and compare independently of session timezone.
export async function assertBackupRestored(
  db: Database,
  archive: string,
  passphrase: string,
): Promise<void> {
  const { snapshot, sourceColumns } = readBackup(archive, passphrase);
  await transaction(
    db,
    async (tx) => {
      for (const table of tableNames.filter((table) => sourceColumns[table])) {
        const fields = sourceColumns[table]!,
          rows = snapshot.tables[table].map((row) =>
            table === 'realms' ? { ...row, config: parseRealmConfig(row.config) } : row,
          );
        const projection = `jsonb_build_object(${fields.map((field) => `'${field}',t.${field}`).join(',')})`;
        const same = (
          await tx.query(
            `WITH expected AS (SELECT ${projection} AS row FROM jsonb_populate_recordset(NULL::${table},$1::jsonb) t), actual AS (SELECT ${projection} AS row FROM ${table} t) SELECT NOT EXISTS ((SELECT row FROM expected EXCEPT ALL SELECT row FROM actual) UNION ALL (SELECT row FROM actual EXCEPT ALL SELECT row FROM expected)) AS same`,
            [JSON.stringify(rows)],
          )
        ).rows[0].same;
        if (!same) throw new Error('Restored database differs from backup.');
      }
      for (const table of [
        'sessions',
        'oauth_flows',
        'login_limits',
        'realm_config_previews',
        'discord_pack_quotes',
      ])
        if ((await tx.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount)
          throw new Error('Restored database contains transient authentication or review state.');
    },
    true,
  );
}

export async function restoreBackup(
  db: Database,
  archive: string,
  passphrase: string,
): Promise<void> {
  const { snapshot, sourceColumns } = readBackup(archive, passphrase);
  await transaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(73103503)');
    const migrations = (await tx.query('SELECT name,checksum FROM schema_migrations ORDER BY name'))
      .rows as Migration[];
    columnsForMigrations(migrations);
    if (
      migrations.length !== migrationNames.length ||
      JSON.stringify(migrations.slice(0, snapshot.migrations.length)) !==
        JSON.stringify(snapshot.migrations)
    )
      throw new Error(
        'Backup migrations differ. Apply the current migrations or use the matching source version.',
      );
    await tx.query(
      `LOCK TABLE ${[...tableNames, 'sessions', 'login_limits', 'oauth_flows', 'realm_config_previews'].join(',')} IN ACCESS EXCLUSIVE MODE`,
    );
    for (const table of [
      ...tableNames,
      'sessions',
      'login_limits',
      'oauth_flows',
      'realm_config_previews',
    ]) {
      if ((await tx.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount)
        throw new Error('Restore requires a fresh, empty database.');
    }
    for (const table of tableNames.filter((table) => sourceColumns[table]))
      for (const row of snapshot.tables[table]) {
        const fields = columns[table].filter(
          (field) => !(table === 'memberships' && field === 'trade_code' && !('trade_code' in row)),
        );
        if (Object.keys(row).sort().join(',') !== [...sourceColumns[table]!].sort().join(','))
          throw new Error(`Invalid backup columns: ${table}`);
        await tx.query(
          `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')})`,
          fields.map((field) =>
            (table === 'economy_rebalances' && field === 'tier_changes') ||
            (table === 'tier_adjustments' && field === 'changes') ||
            (table === 'character_removals' && (field === 'character_ids' || field === 'refunds'))
              ? JSON.stringify(row[field])
              : table === 'realms' && field === 'config'
                ? parseRealmConfig(row[field])
                : table === 'realms' && field === 'config_revision' && !('config_revision' in row)
                  ? 1
                  : table === 'cards' &&
                      field === 'original_owner_id' &&
                      !('original_owner_id' in row)
                    ? row.owner_id
                    : table === 'accounts' &&
                        field === 'password_revision' &&
                        !('password_revision' in row)
                      ? 0
                      : table === 'openings' && field === 'pack_count' && !('pack_count' in row)
                        ? 1
                        : (row[field] ?? null),
          ),
        );
      }
    for (const row of (
      await tx.query('SELECT username,display_name,updated_at,avatar_url FROM discord_profiles')
    ).rows) {
      if (
        !discordProfileSchema.safeParse({
          username: row.username,
          displayName: row.display_name,
          updatedAt: row.updated_at.toISOString(),
          ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
        }).success
      )
        throw new Error('Backup Discord profiles are invalid.');
    }
    await validateAdmissionBackup(tx);
    if (snapshot.migrations.length < 4) await seedHistoricalXp(tx);
    const invalidSettings = (
      await tx.query(`SELECT 1 FROM realms r WHERE r.config_revision-1 != (SELECT count(*) FROM realm_config_changes c WHERE c.realm_id=r.id)
      UNION ALL
      SELECT 1 FROM realm_config_changes c LEFT JOIN realm_config_changes previous ON previous.realm_id=c.realm_id AND previous.to_revision=c.from_revision
        WHERE (c.from_revision>1 AND previous.id IS NULL)
          OR c.result->>'changeId' IS DISTINCT FROM c.id::text
          OR (c.result->>'revision')::integer IS DISTINCT FROM c.to_revision
          OR (c.result->>'appliedAt')::timestamptz IS DISTINCT FROM c.created_at
      LIMIT 1`)
    ).rowCount;
    if (invalidSettings) throw new Error('Backup realm settings history does not reconcile.');
    const normalized = (config: unknown) => JSON.stringify(parseRealmConfig(config));
    for (const realm of (await tx.query('SELECT id,config FROM realms')).rows) {
      const history = (
        await tx.query(
          'SELECT before_config,after_config FROM realm_config_changes WHERE realm_id=$1 ORDER BY to_revision',
          [realm.id],
        )
      ).rows;
      for (let index = 0; index < history.length; index++) {
        const change = history[index];
        if (
          index &&
          normalized(change.before_config) !== normalized(history[index - 1].after_config)
        )
          throw new Error('Backup realm settings history does not reconcile.');
        normalized(change.before_config);
        normalized(change.after_config);
      }
      if (
        history.length &&
        normalized(realm.config) !== normalized(history[history.length - 1].after_config)
      )
        throw new Error('Backup realm settings history does not reconcile.');
    }
    const invalid = (
      await tx.query(`SELECT 1 FROM memberships m WHERE m.balance !=
      (SELECT COALESCE(sum(l.amount),0) FROM wallet_ledger l WHERE l.realm_id=m.realm_id AND l.account_id=m.account_id) LIMIT 1`)
    ).rowCount;
    if (invalid) throw new Error('Backup wallet ledger does not reconcile.');
    const invalidRecycling = (
      await tx.query(`SELECT 1 FROM cards c LEFT JOIN recyclings r ON r.realm_id=c.realm_id AND r.card_id=c.id
      LEFT JOIN wallet_ledger l ON l.realm_id=r.realm_id AND l.account_id=r.account_id AND l.operation_key='recycle:'||r.request_key::text
      WHERE (c.recycled_at IS NULL) != (r.id IS NULL)
        OR (r.id IS NOT NULL AND (r.account_id != c.owner_id OR l.id IS NULL OR l.reason != 'recycling'
          OR r.result->>'ok' IS DISTINCT FROM 'true'
          OR r.result->>'cardId' IS DISTINCT FROM c.id::text
          OR r.result->>'characterId' IS DISTINCT FROM c.character_id::text
          OR r.result->>'recyclingId' IS DISTINCT FROM r.id::text
          OR r.created_at IS DISTINCT FROM c.recycled_at
          OR l.amount IS DISTINCT FROM (r.result->>'credited')::integer
          OR l.balance_after IS DISTINCT FROM (r.result->>'balance')::integer)) LIMIT 1`)
    ).rowCount;
    if (invalidRecycling) throw new Error('Backup recycling history does not reconcile.');
    await validateCharacterValues(tx);
    const invalidXp = (
      await tx.query(`SELECT 1 FROM memberships m WHERE m.xp !=
      (SELECT COALESCE(sum(x.amount),0) FROM xp_ledger x WHERE x.realm_id=m.realm_id AND x.account_id=m.account_id)
      UNION ALL
      SELECT 1 FROM cards c WHERE NOT EXISTS(SELECT 1 FROM xp_ledger x WHERE x.realm_id=c.realm_id AND x.account_id=c.original_owner_id AND x.character_id=c.character_id AND x.reason IN('first_collection','trade_collection'))
      UNION ALL
      SELECT 1 FROM xp_ledger x JOIN cards c ON c.realm_id=x.realm_id AND c.id=x.card_id
        JOIN openings o ON o.realm_id=x.realm_id AND o.account_id=x.account_id AND o.request_key=x.request_key
        WHERE x.reason='first_collection' AND (c.original_owner_id != x.account_id OR c.character_id != x.character_id OR c.request_key != x.request_key
          OR (x.policy_version=1 AND x.amount IS DISTINCT FROM (o.config_snapshot->'progression'->>'xpPerNewCharacter')::integer))
      UNION ALL
      SELECT 1 FROM openings o WHERE o.result->>'ok'='true' AND o.result ? 'progression' AND
        (o.result->'progression'->>'xpAwarded')::integer IS DISTINCT FROM
        (SELECT COALESCE(sum(x.amount),0)::integer FROM xp_ledger x WHERE x.realm_id=o.realm_id AND x.account_id=o.account_id AND x.request_key=o.request_key AND x.policy_version=1)
      LIMIT 1`)
    ).rowCount;
    if (invalidXp) throw new Error('Backup XP history does not reconcile.');
    await validatePackBundleBackup(tx);
    await validateTradeBackup(tx);
    await validateAdminCollectionBackup(tx);
    await validateMarketBackup(tx);
    await validateRankBackup(tx);
    await validateRankTrackBackup(tx);
    await validateEconomyRebalances(tx);
    await validateTierAdjustments(tx);
    await validateCharacterRemovals(tx);
    await validateGemRewardBackup(tx);
    await validateAdminGemGrants(tx);
    await validateArtworkReferences(tx);
    const invalidUpgrades = (
      await tx.query(`SELECT 1 FROM upgrade_purchases u
      LEFT JOIN wallet_ledger l ON l.realm_id=u.realm_id AND l.account_id=u.account_id AND l.operation_key='upgrade:'||u.request_key::text
      WHERE l.id IS NULL OR l.reason != 'upgrade_purchase'
        OR u.result->>'ok' IS DISTINCT FROM 'true'
        OR u.result->>'purchaseId' IS DISTINCT FROM u.id::text
        OR u.result->>'upgradeId' IS DISTINCT FROM u.upgrade_id
        OR (u.result->>'rank')::integer IS DISTINCT FROM u.rank
        OR (u.result->>'charged')::integer IS DISTINCT FROM (u.config_snapshot->'upgrades'->'packDiscount'->(u.rank-1)->>'cost')::integer
        OR (u.result->>'discount')::integer IS DISTINCT FROM (u.config_snapshot->'upgrades'->'packDiscount'->(u.rank-1)->>'discount')::integer
        OR (u.result->>'requiredLevel')::integer IS DISTINCT FROM (u.config_snapshot->'upgrades'->'packDiscount'->(u.rank-1)->>'requiredLevel')::integer
        OR (u.result->>'level')::integer < (u.result->>'requiredLevel')::integer
        OR (u.result->>'level') IS NULL
        OR (u.result->>'level')::integer > jsonb_array_length(u.config_snapshot->'progression'->'levelThresholds')
        OR (u.result->>'packPrice')::integer IS DISTINCT FROM GREATEST(0,(u.config_snapshot->>'packPrice')::integer-(u.result->>'discount')::integer)
        OR l.amount IS DISTINCT FROM -(u.result->>'charged')::integer
        OR l.balance_after IS DISTINCT FROM (u.result->>'balance')::integer
        OR l.created_at IS DISTINCT FROM u.created_at
        OR (u.result->>'purchasedAt')::timestamptz IS DISTINCT FROM u.created_at
      UNION ALL
      SELECT 1 FROM upgrade_purchases u JOIN realms r ON r.id=u.realm_id
        GROUP BY u.realm_id,u.account_id,u.upgrade_id,r.config
        HAVING count(*) != max(u.rank) OR max(u.rank) > jsonb_array_length(r.config->'upgrades'->'packDiscount')
      UNION ALL
      SELECT 1 FROM wallet_ledger l WHERE l.reason='upgrade_purchase' AND NOT EXISTS(
        SELECT 1 FROM upgrade_purchases u WHERE u.realm_id=l.realm_id AND u.account_id=l.account_id AND l.operation_key='upgrade:'||u.request_key::text)
      LIMIT 1`)
    ).rowCount;
    if (invalidUpgrades) throw new Error('Backup upgrade history does not reconcile.');
    const invalidWishlist = (
      await tx.query(`SELECT 1 FROM wishlist_changes w WHERE
        w.result->>'changeId' IS DISTINCT FROM w.id::text
        OR w.result->>'characterId' IS DISTINCT FROM w.character_id::text
        OR (w.result->>'present')::boolean IS DISTINCT FROM w.present
        OR (w.result->>'changed')::boolean IS NULL
        OR (w.present AND w.result->>'entryId' IS NULL)
        OR (w.result->>'slots')::integer IS DISTINCT FROM (w.config_snapshot->'wishlist'->>'slots')::integer
        OR (w.result->>'entryCount')::integer IS NULL
        OR (w.result->>'entryCount')::integer < 0
        OR (w.result->>'entryCount')::integer > (w.result->>'slots')::integer
        OR (w.result->>'changedAt')::timestamptz IS DISTINCT FROM w.created_at
      UNION ALL
      SELECT 1 FROM openings o WHERE o.result ? 'wishlistSnapshot' AND (
        (o.result->'wishlistSnapshot'->>'weightMultiplier')::integer IS DISTINCT FROM (o.config_snapshot->'wishlist'->>'weightMultiplier')::integer
        OR jsonb_array_length(o.result->'wishlistSnapshot'->'characterIds') > (o.config_snapshot->'wishlist'->>'slots')::integer)
      LIMIT 1`)
    ).rowCount;
    for (const row of (
      await tx.query(`SELECT r.config,w.realm_id,w.account_id,count(*)::integer AS wishes,
      (SELECT COALESCE(max(p.rank),0)::integer FROM rank_purchases p WHERE p.realm_id=w.realm_id AND p.account_id=w.account_id) AS rank
      FROM wishlist_entries w JOIN realms r ON r.id=w.realm_id GROUP BY w.realm_id,w.account_id,r.config`)
    ).rows) {
      if (
        row.wishes >
        (
          await effectiveMemberConfig(
            tx,
            row.realm_id,
            row.account_id,
            parseRealmConfig(row.config),
            row.rank,
          )
        ).wishlist.slots
      )
        throw new Error('Backup wishlist capacity is invalid.');
    }
    if (invalidWishlist) throw new Error('Backup wishlist history is invalid.');
  });
}
