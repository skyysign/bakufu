# Backup and recovery

The encrypted backup envelope and payload remain version 1. Current player
archives use version 12, including current character-value rules/quotes,
historical recycling valuation evidence and the player's collector-track rules, levels
and purchase receipts alongside gem claims, marketplace history, admission,
Discord profile and existing card/progression history. Versions 1/2 remain
readable as legacy v2; v3-v11 stay readable without inventing missing histories.

Two preservation paths exist in this slice:

- **Player archive:** authenticated `GET /api/export?realmId=<uuid>` (or the
  collection export link). Readable versioned JSON containing only that player's
  realm, active card/character/source IDs, balance, XP, progression rules/level,
  wallet and XP ledgers, recycling history, upgrade rules/purchases,
  wishlist rules/entries, collector-track levels/purchases, gem claim rules/receipts,
  personal market listings, personal trades (both offered sides and confirmation
  state), realm trade ID, own cached Discord profile, own nullable admission receipt, and timestamps. The reserved achievements array is empty. It excludes
  credentials, sessions, other players’ private account details or collections, and artwork.
  `playerArchiveSchema` validates current archives; `parsePlayerArchive` also
  migrates v1 archives with empty recycling history. It is not a live
  economy import or a backup of the instance.
- **Encrypted instance backup:** local operator CLI `pnpm backup <path>` and
  `pnpm restore <path>`. Uses a consistent PostgreSQL repeatable-read snapshot
  of all persistent application tables, migration names/checksums, realm
  settings, catalog provenance and saved popularity, packs, active/retired cards, openings, recycling
  receipts, wallet ledger, first-collection/XP ledger, upgrade purchases,
  wishlist entries, wishlist change receipts, settings revision/audit history,
  realm trade IDs, offers/versions, confirmations, reservations, trade receipts,
  the per-card ownership transfer journal, Discord server-to-realm bindings,
  cached Discord profiles with refresh timestamps and optional public avatar
  URLs, realm joining policies, policy audit receipts, automatic admission
  receipts, collector-track purchases, gem claim/admin-grant receipts, market
  journals and reviewed economy-rebalance history.
  It preserves UUIDs and PostgreSQL timestamp microseconds. Authentication
  hashes, local account emails, and linked Discord IDs are inside the encrypted payload.
  Session tokens, OAuth login flows, login counters, transient settings previews, and Discord pack reviews are excluded; everyone must log in again
  after recovery. No runtime environment variables, database credentials,
  plaintext passwords, or Redis/cloud state are included.

The original demo has no external asset dependencies. Optional provider
catalogs retain source/provenance and permitted remote artwork references;
image bytes are not included in backups or player archives. General full-realm
JSON import/export remains deferred.

## Create a manual backup

Host development: choose an absolute path **outside the source repository**, in
a private destination. The command prompts twice for a hidden passphrase of
at least 16 characters. Keep the passphrase separately in a password manager.

```sh
pnpm backup /private/backups/card-engine-2026-10-31.backup
```

PowerShell example:

```powershell
pnpm backup 'C:\PrivateBackups\card-engine-2026-10-31.backup'
```

The parent directory must already exist. Existing files are never overwritten.
The file contains a versioned JSON envelope: `schemaVersion`, `kind`, random
`salt`, random `iv`, authentication `tag`, base64 `ciphertext`, and its SHA-256
checksum. The encrypted snapshot has its own schema version and migration
manifest. Encryption is AES-256-GCM; scrypt (N=32768, r=8, p=1) derives a fresh
key from the passphrase and a random 16-byte salt. Integrity is checked before
inserting data, and wrong passphrases fail authentication. CLI errors do not
print decrypted data or credentials.

For Docker, mount a private backup destination in a one-off operator container.
The directory must be writable by the image's `node` user. For example on POSIX:

```sh
docker compose run --rm --no-deps --volume /private/backups:/backups web pnpm backup /backups/card-engine-2026-10-31.backup
```

On Windows use an absolute Windows path as the volume source. Do not use
`docker compose exec` without a mounted destination and then rely on a file in
the disposable container as your only backup.

## Restore into a fresh database

1. Keep the matching source release and lockfile alongside the encrypted backup.
   Provision an empty PostgreSQL database and point a private local `.env` at it.
   The current release explicitly supports snapshots from the original,
   Discord, recycling, progression, upgrade, wishlist, settings, trading,
   Discord-command, member-profile, admission, realm-creation and password-revision
   migrations and their successors through current schema 0028. Older
   settings and card rows are migrated during restore with IDs and balances
   preserved. Older backups mark historical characters as already collected
   with zero XP and retain any prior XP as a migration baseline. There are no
   retroactive awards. See [progression rules](../gameplay/progression.md).
   Pre-upgrade snapshots restore with no purchased ranks or purchase debits.
   Pre-wishlist snapshots restore with default wishlist rules and empty lists.
   Pre-settings snapshots restore at configuration revision 1 with an empty audit.
   Pre-trading snapshots retain original owners, gain new realm trade IDs and
   default trading rules, and restore with empty trade history. Existing settings
   audit snapshots are preserved and normalized across config versions when validated.
   Pre-command snapshots restore with no server bindings. Discord pack reviews
   are transient and require a fresh command after recovery; existing opening
   receipts remain durable.
   Pre-profile snapshots restore without invented names; players refresh through
   Discord sign-in. Profile fields and identity references are validated.
   Pre-admission snapshots restore invitation-only, with no invented joining
   policies or player admission receipts. Current admission histories must form
   contiguous policy revisions and reconcile with the original starting grants.
   Unknown revisions or checksum mismatches require investigation and the
   matching source release; there is no generic unsafe migration fallback.
2. Run `pnpm db:migrate` using the current source version.
3. Run `pnpm restore <absolute-path.backup>`, enter the passphrase, and type
   `RESTORE`. **Do not run bootstrap first.**
4. The restore refuses a nonempty database or incompatible migrations. It checks
   the envelope, checksum, authentication tag, table/column manifests, composite
   foreign keys, active ownership uniqueness, wallet/ledger reconciliation, and
   agreement between retired cards, recycling receipts, and recycling credits.
   It also reconciles XP totals, first-collection records, event/card links,
   configured awards, and new opening receipts. Current snapshots with missing
   XP history are rejected rather than silently repaired.
   Upgrade purchases must have contiguous ranks, valid policy snapshots and
   receipts, and matching wallet debits; orphaned upgrade debits are rejected.
   Wishlist entries must fit realm capacity, and change receipts and opening
   wishlist multiplier snapshots must agree with their stored identities/rules.
   Configuration audits must form a contiguous revision chain, match their
   receipts, and end at the current realm rules. Preview state never restores.
   Inserts happen in one transaction. A failure leaves the empty target empty.
5. Start the web app, log in with the previous account password, compare player
   exports and realm totals, and test an opening with a fresh idempotency key.
   A replay of an old committed key still returns its original receipt.

For Docker use a **separate Compose project and empty volume** for a restore
drill, run its migration service, then run the restore command with the mounted
backup. Keep the live database and its volume intact throughout the drill.

`pnpm test:integration` tests recovery into a separate freshly migrated
PostgreSQL database and compares all persistent rows, including IDs and exact
timestamps. It also tests corrupted backups, wrong passphrases, existing-target
rejection, wallet/recycling/XP reconciliation, trade confirmation/reservation/ledger
reconciliation and ownership journals, login after recovery, and restores
of earlier schema revisions into the current schema. Dedicated migration/recovery
tests cover migration from 0011 to creation receipts and from 0012 to password
revisions, including recovery of snapshots taken before each change.
Current schema **0028** keeps encrypted envelope/payload v1: encrypted manifests
identify the source migrations. Legacy snapshots restore missing password
revisions as zero and have no creation receipts. Current snapshots preserve
creation receipts and password revisions; sessions still never restore.

## Operational limitations and next steps

Manual backups remain available. The optional [scheduled backup worker](scheduled-backups.md)
adds independent capture, safe retries, 7 daily/4 weekly retention by default,
and generic health status. Its mounted destination can be a remote drive
prepared by the operator. Optional [encrypted S3-compatible copies](offsite-backups.md)
now support direct upload, read-back verification, and authenticated downloads.
Remote deletion/retention and alert delivery remain operator responsibilities. A snapshot on the database disk alone is insufficient. Test an off-machine
restore periodically. Both paths load the snapshot into memory and suit the
small MVP rather than very large instances. Passphrases stay out of command
arguments and logs. Optional [automated restore checks](restore-checks.md)
recover a selected snapshot on a dedicated PostgreSQL service, compare all saved
fields, remove temporary databases, and expose separate weekly recovery health.
They do not replace an off-machine operator recovery drill.

Standard PostgreSQL `pg_dump --format=custom --no-owner --no-acl` and
`pg_restore --no-owner --no-acl --exit-on-error` remain an additional operator
option, with credentials through private environment/configuration and
encryption at rest. These tools were not available in the initial test
environment; the tested recovery path here is the encrypted application
snapshot. Keep database roles/grants, TLS configuration, environment secrets,
and the backup passphrase in a separate private deployment recovery plan.


Collector ranks and market additions preserve the encrypted envelope/payload v1.
Migrations 0014 and 0015 introduced the original rank/market history. Older backups gain disabled
collector rules during config-v7 normalization and empty rank/market tables;
current archives retain purchase/listing/request receipts. Restore validates
rank/ledger agreement and purchased-rule protection, active listing ownership and
reservations, completed sale consent/prices, existing trade journals and effective
wishlist capacity. Current game backups include **34 persistent tables**;
transient sessions/reviews/throttles remain excluded. Migrations 0019-0022 add
five tiers, leveled collector tracks, public Discord avatar URLs and economy
rebalance journals without resetting older progress. Fresh recovery validates
track prerequisites/purchase debits and the rebalance tier history against
historical openings. Restore checks must use the matching production image.
Migration 0023 adds nullable catalog popularity and config v11 valuation rules,
disabled for existing realms until reviewed. Current snapshots retain popularity
and recycling quote evidence; older snapshots gain null popularity without
inventing provider data. Restore validates historical valuation math against the
saved receipt rules and ledger credit, not current wishlist demand.

Migration 0024 adds the `openings_realm_recent` index (Live pulls) and
`realm_tier_sounds`: admin-uploaded reveal sounds (at most 30 seconds of 16-bit
PCM WAV, stored as base64 text) with file name, duration, uploader and
permission confirmation. Current snapshots include these sounds; snapshots taken
before 0024 restore with no custom sounds. Migration 0025 adds
`realm_character_sounds` (per-character reveal sounds, same format and limits);
snapshots taken before 0025 restore without them. Migration 0027 adds the
admin collection action history (restored cards, returned cards and gem
adjustments) and admin card moves in `card_transfers`; restores check that every
action matches its wallet entry, card move or undone recycling. Snapshots taken
before 0027 restore without them. Migration 0026 adds
`packs.retired_at` for removed packs; older snapshots restore every pack as active.
Migration 0028 advances realm config to v12 (fame floors, off for existing
realms) and adds `tier_adjustments`, the journal of applied fame floors and
manual tiers. Restores check that every character's tier history (economy
rebalances and adjustments) reconciles with its saved tier and manual tier.
Snapshots taken before 0028 restore with floors off and no adjustments.
