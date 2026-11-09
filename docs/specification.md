# Product specification

How Bakufu is meant to behave, including features that are not built yet (see
the [roadmap](#9-roadmap)). [Implementation status](implementation-status.md)
says what actually works.

## 1. The idea

Provide a fully playable default card-collecting game with packs, rarity, unique ownership, gems, progression, and trading. Administrators can customize the rules, content, and presentation without editing source code.

An instance may run on a personal computer, a VPS, a container host, or a serverless-friendly cloud platform. **No single provider (including Vercel), Discord, anime database, or external service is required for the core game engine.**

This is a hobby project: free to play, open source, no cash-out, no paid loot boxes, and no mandatory centralized service.

### Product principles

1. **Play out of the box:** ship an original, rights-cleared demonstration catalog and an opinionated default game preset.
2. **Own your data:** easy export, restore, migration, and scheduled backups.
3. **Customize without coding:** administrators control gameplay through a wizard and advanced settings.
4. **One engine, many interfaces:** website and Discord invoke the same game operations and share the same authoritative state.
5. **Portable by design:** separate core rules from HTTP, Discord, storage, importers, and cloud-specific adapters.
6. **Respect content rights:** software and source adapters are not licenses to third-party characters, images, or databases.
7. **Integrity before cosmetics:** no duplicate claims, double-spends, or inconsistent trading.

## 2. Vocabulary and boundaries

- **Instance:** one deployment of this application and its database. An instance may host multiple independent game realms.
- **Realm:** an isolated playable community with its own character pool, inventories, wallets, rules, packs, and progression. A Discord guild can be linked to a realm, but a web-only realm is equally valid.
- **Account:** an application user with one or more authentication identities (e.g. local login, Discord OAuth).
- **Character definition:** an imported or original entry; stable internal ID, name, series/franchise, categories, optional popularity measurements, and licensed asset references.
- **Card:** a collectible instance of a character, possibly with a cosmetic variant.
- **Claim:** ownership of a character/card in a realm. Under unique ownership, one character definition may have at most one active owner in that realm, regardless of pack or cosmetic variant.
- **Pack definition:** a set of filters and rules specifying eligibility, price, size, odds, and cooldown.
- **Preset:** versioned defaults for packs, economy, permissions, and progression; not a character dataset.

**Isolation rule:** gem balances, ownership, trading, upgrades, and XP never cross realms. Cross-realm/global trading is out of scope for v1.

## 3. Audience and flows

### Administrator first run

1. Deploy with Docker Compose **or** connect a cloud-hosted web application to a persistent PostgreSQL database.
2. Complete a secure bootstrap: create first admin, configure the site URL and optional Discord application, and keep the site invite-only by default.
3. Select original demo content, import a permitted JSON/CSV dataset, or configure an optional provider adapter.
4. Preview automatically generated packs, popularity tiers, odds, and the default progression tree.
5. Choose a **Classic**, **Casual**, or **Custom** rules preset; adjust anything later.
6. Confirm backup destination and schedule; perform a test export.
7. Start inviting players. A bot integration can be added or removed without changing the inventory engine.

### Player loop

Open packs → acquire cards → keep, trade, or recycle cards into gems → gain XP → unlock/purchase upgrades (additional daily pulls, larger packs, extra wishlist slots, etc.) → collect more.

The player can use the website, and, where enabled, slash commands and interactive Discord components. Both access the same realm inventory and rules.

## 4. Gameplay specification

### Auto-generated starter packs

- On initial catalog import, examine normalized categories provided by the source (e.g. genre, theme, demographic, universe, franchise). Not all providers expose all kinds of category.
- Eligible categories are ranked by **distinct, importable characters**. By default, create up to **10** named packs from the largest qualifying categories.
- Apply a configurable minimum pool size; skip near-duplicate categories when possible; let admins override the category selection.
- Always provide a fallback **All Characters** pack if the catalog has enough playable entries; if not, clearly explain what is missing.
- The same character may qualify for multiple packs; **unique ownership is realm-wide**, not pack-specific.
- Admins can create packs for a single series, franchise, custom tag, category combination, or hand-picked selection.
- When a pack cannot deliver its advertised number of eligible cards, do not silently charge the user. Apply an explicitly configured partial-pack/refund rule; default to reject and do not spend gems or cooldown.

### Rarity and popularity

- Rarity **tier assignment** and **pull probability** are separate concepts.
- Default: calculate tier from percentile of a popularity metric **within a compatible imported catalog/source**. E.g. popularity favorites, where legitimately available; do not compare raw AniList and MAL counts directly.
- Popularity may be absent for films, games, custom datasets, or obscure characters. Support configurable fallback scoring, a neutral tier, and manual overrides.
- Capture calculation version, source, and timestamp. Changes in external popularity do not automatically downgrade owned cards; reranking requires admin preview/confirmation.
- Draw a rarity tier using server-configured odds, then choose an eligible character in that tier. Show **actual available odds**, especially when unique characters have been claimed.
- Define behavior for empty tiers explicitly; avoid claiming a tier is available when it isn't.
- Use cryptographically secure random sampling and server-side validation. Do not let clients select their own outcomes.

### Ownership, gems, trading, progression

- Default **Classic** mode: one active owner per character per realm; recycling/removing a card makes that character available again. Other realms may have separate owners.
- **Casual** mode can allow duplicate card instances. Admins control whether/how settings can change on a live economy; require an impact preview for uniqueness migrations.
- Trading transfers cards and optional gems atomically with approval from both players. No trading of nonexistent, locked, or already committed assets.
- Recycling destroys or relinquishes the owned card (as configured) and credits gems **once**. Use an auditable wallet ledger, not free-form balance adjustments.
- XP, levels, gem prices, reward tables, upgrade effects, pack cooldowns, wishlist slots/weights, and daily limits are configurable.
- Ship modest defaults that avoid trivial self-farming. Wishlist targeting must not guarantee a specific scarce character unless a pack explicitly and truthfully advertises that rule.
- Optional later features: auctions, events, cosmetics, prestige, leaderboards, achievements, and archive mode. Do not block the first release on these.

### Permissions

- Global instance admin configures deployment and restores.
- Realm admin controls settings and content within assigned realms.
- Optional game moderator manages disputes/events but cannot access secret keys or unredacted backups.
- Player controls only their own profile, packs, trades, and exports.
- Enforce authorization on the server, independent of UI and Discord role names. Discord role mapping is optional.

## 5. Content import and legal hygiene

**Distribute the engine and original demonstration content; do not bundle unauthorized third-party artwork or scraped character catalogs.** A self-hosted instance is not automatically exempt from copyright or provider terms.

- Provide a documented **versioned JSON/CSV importer** first, plus validation and preview before committing changes.
- Architect optional source adapters (such as AniList/Jikan), but do **not** implement bulk scraping, full-database mirroring, circumvention, or forbidden hoarding.
- Respect the API's current terms, rate limits, permitted caching and data use; an API exposing an image does not grant a license to use it.
- Store provenance, source identifiers, optional license/attribution, and any required restrictions for fields/assets.
- Separate metadata records from image assets. Do not silently copy remote images to permanent storage.
- Use a canonical internal character UUID and source-qualified external keys (e.g. `provider:character-id`); source IDs from unrelated providers are not interchangeable. Avoid duplicate imports of the same source key.
- Support original, licensed, and administrator-provided datasets equally. Never require a particular fictional universe to run the game.

Useful references (verify terms again at implementation time):
- AniList API terms: https://docs.anilist.co/guide/terms-of-use
- Jikan unofficial API: https://github.com/jikan-me/jikan-rest
- Discord interactions: https://discord.com/developers/docs/interactions/overview

## 6. Deployment and authentication

### Supported deployment styles

| Style | Components | Notes |
| --- | --- | --- |
| **Docker Compose (reference)** | web/API + PostgreSQL + optional background worker | Host on a personal machine or VPS; configure persistent volumes and off-machine backups. |
| **Cloud / PaaS / serverless** | web/API + external PostgreSQL + external job scheduler/backup destination | Provider-neutral configuration; document one example deployment later. No reliance on ephemeral filesystem persistence. |
| **Web-only** | no Discord integration | Login-based invite-only realms are fully playable. |
| **Web + Discord** | same backend, optional Discord interaction endpoint | HTTP interactions can run without a permanently connected Gateway bot for slash commands. |

Avoid coupling business logic to a host's secrets, queues, cron API, object storage, or auth SDK. Use adapters or standard protocols (PostgreSQL, HTTP, S3-compatible storage, OIDC where applicable).

### Auth and privacy

- Secure bootstrap flow for instance admin; no default admin password.
- Web-only authentication must be possible without a Discord account; define a simple supported provider for the MVP (local password authentication with secure hashing and sessions, or a configurable OIDC provider).
- Optional Discord OAuth allows linking identities; never treat an arbitrary Discord username as proof of account ownership.
- Site and realms are **private/invite-only by default**, with explicit sharing settings.
- Discord HTTP interactions endpoints necessarily need network reachability from Discord; verify Ed25519 signatures (raw body and timestamp), enforce authorizations, and acknowledge within Discord's response deadline.
- Provide player data export, account deletion/anonymization controls, data retention policy hooks, and basic privacy documentation.
- No gems-for-money, cash redemption, or paid loot boxes in the default game.

## 7. Portability, export, and backup

**This is not a future enhancement. Protecting collections is an MVP requirement.**

### Player export

- Download a schema-versioned, readable JSON file with their cards, source IDs, gems, XP, upgrades, achievements, wishlist and relevant timestamps.
- Exclude secrets, other players' private data, and artwork that may not be redistributed.
- A player export is primarily a **personal archive**. It does **not** grant the power to mint cards or balances in another live economy; live imports require admin authorization and duplicate/uniqueness checks.

### Full-realm / full-instance export

- Admin-only backup bundle includes settings, pack definitions, character catalog/provenance, all inventories, ledger, trade state and identifiers, plus manifest of external asset references (not unlicensed asset redistribution).
- Define export format version and upgrade path; validate referential integrity; include checksums.
- Explicitly distinguish a **human-portable export** from a **restorable database backup**. Support both.
- For private player data, restrict access, encrypt backups, and allow configured retention/deletion.

### Backups

- Default suggestion: daily backups, retain 7 daily and 4 weekly snapshots; admin can adjust schedule and retention.
- Support an external destination (e.g. encrypted S3-compatible bucket, mounted remote volume). Backups on the same disk are not sufficient protection.
- Scheduler is a deployment adapter: a local worker/cron under Docker, or a managed cron/worker for cloud deployments.
- Check results, alert admins on failure, and document/test restore. Backup jobs must be idempotent and not depend on request handlers remaining active.
- Protect the system against migration failures: backup before destructive database migrations; include a documented restore procedure.

## 8. Suggested code organization

```text
apps/
  web/                    # Web interface + API/HTTP Discord interaction route
  worker/                 # Optional persistent/cron worker for backups and jobs
packages/
  core/                   # Pure game rules: packs, rarity, ownership, economy, trades
  db/                     # PostgreSQL schema, transactions, migrations, repositories
  config/                 # Versioned presets, validation, migrations
  importers/              # JSON/CSV first, optional provider adapters later
  auth/                   # Accounts, sessions, provider links, realm roles
  shared/                 # Contracts, typed errors, validation schemas
infra/
  docker/                 # Dockerfiles, Compose, volumes, health checks
docs/
  architecture/           # ADRs and invariants
  deployment/             # Docker, generic cloud hosting, backups, restore
  content/                # Content formats, sourcing permissions
```

**Suggested stack, not a fixed requirement:** pnpm + TypeScript, Next.js for web/API, PostgreSQL, Drizzle ORM (or equivalent), Zod for input/config validation, Vitest for core tests, Playwright for e2e. Do not add a complex microservice architecture for the MVP.

### Hard invariants

1. Game state is always scoped to a realm.
2. Unique realms cannot have two active claims for the same character; enforce with database constraints/transactional claim records, not an application-only `if` check.
3. Pack opening, gem spending, recycling, and trades use transactions + idempotency keys. Concurrent web and Discord commands may happen.
4. Wallet changes are balanced against an auditable transaction/ledger record; no negative balance.
5. Clients never decide drop results, owners, cooldown expiration, or prices.
6. Content source IDs and import revisions remain stable across backups/restores.
7. Unavailable packs reveal actual odds/availability before spending; never charge for an unsuccessful draw.
8. Changing settings cannot silently corrupt or invalidate existing inventories.
9. Backups are portable and demonstrably restorable.

## 9. Roadmap

What is built is listed in [implementation status](implementation-status.md)
and the [changelog](../CHANGELOG.md). Not built yet:

- A guided setup (installer or admin GUI) and a prebuilt Docker image, so
  self-hosters can run and configure Bakufu without working from the source.
- Live catalog editing (merging or replacing a realm's catalog), pack editing
  beyond adding and removing category packs, and ownership-mode changes such as
  Casual duplicate ownership.
- More Discord commands: trading, recycling, wishlists and gem claims (today:
  status, packs and confirmed openings).
- Dated market-price charts and valuation history.
- Account deletion, continued Discord server membership checks, full-realm JSON
  import/export and automated retention for remote backups.
- More approved anime/manga providers.

Changes to values or rules must keep ownership, stable IDs, historical receipts
and separate rarity decisions intact.

**Acceptance tests**
- Two simultaneous attempts cannot both claim the same character in a unique realm.
- Recycled character returns to pool once, credits gems once, and cannot be traded afterward.
- Failed/empty pack opening does not deduct gems or consume a cooldown.
- Permissions reject non-admin configuration changes.
- Equivalent calls from web and Discord result in the same authoritative inventory (when Discord integration is enabled).
- A backup restores all realm state into a clean deployment; a player export is readable without the original server.
- Demo runs without calling external data APIs or needing third-party images.

## 10. Agent collaboration

Read [`AGENTS.md`](../AGENTS.md) before implementation. Treat this specification
as product intent, not a reason to build every feature at once: implement the
smallest end-to-end tested slice, document deviations, and never claim that
unbuilt features work.

## 11. Out of scope for the first release

A hosted global economy; cross-instance currency/card transfers; scraping entire third-party datasets; unauthorized artwork hosting; cryptocurrency, real-money trading, auctions, paid random rewards, mobile native apps, or attempting to extend proprietary Mudae internals.

## 12. Licensing

Our original code and original demonstration content use the [MIT license](../LICENSE).
Do not assume that this license extends to imported metadata, artwork, branding,
or game/community content from other sources.
