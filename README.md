  # Card Engine (working title)

> An open-source, self-hostable, host-agnostic collectible-character game engine for the web and optional Discord communities.
>
> **Status:** Foundation, the playable demo web slice, and Milestone 2A–2E recycling, XP/levels, pack discounts, wishlists, reviewed live settings, and Milestones 3A-3D trading, signed Discord pack commands, private Discord-name member search, and verified server joining are implemented. Milestones 4A-4E add optional scheduled encrypted backups, isolated restore checks, a portable HTTPS deployment recipe, verified encrypted offsite copies to S3-compatible storage, and optional durable failure/recovery alerts. Milestones 5A-5B add reviewed original JSON and CSV catalogs for new realms. Milestone 5C adds category selection and pack names at realm creation; 5D adds accessible web pack reveals. Milestones 5E-5F add retry-safe realm creation and local password changes with session revocation. The player-experience rework adds separate play screens, admin/player preview, original anime-inspired artwork, rarity-specific reveals with a local rare cinematic, a real gem marketplace, configurable metal ranks and timed gem claims, selected anime/manga metadata adapters, and an original 1,000-character scale catalog. The interface redesign adds a readable, artwork-first layout (top bar, mobile tab bar, account menu, 16px body text), server-paged character browsing for provider rosters (now up to 100,000 characters), MyAnimeList rosters across anime and manga, an AniList series browser, demographic plus genre/theme/era pack variety and adding packs to existing realms. The product specification below also describes future milestones; see the implementation status for what actually works.

## Implementation status and quickstart

The current slice uses TypeScript, pnpm, Next.js, PostgreSQL, Zod, and explicit
parameterized SQL migrations. No Discord, cloud provider, external character
API, or third-party artwork is required. Original code and demo text are MIT
licensed; that license does not grant rights to imported third-party content.
Release history and the newest migration of each version are in
[CHANGELOG.md](CHANGELOG.md). Realm admins can repair player collections
(restore recycled cards, return cards, adjust gems); see
[player collections](docs/gameplay/admin-collections.md).

| Area | Implemented in this slice |
| --- | --- |
| Foundation | pnpm workspaces, typed rule/config/import/database packages, Next.js app, SQL migration runner with checksums, lint/typecheck/test scripts, lockfile, original fixture catalog. |
| Deployment | Persistent PostgreSQL 18 Compose reference, production Dockerfile, host development overlay, `.env.example`, operator bootstrap and player provisioning. Docker build, migrations, HTTP startup, readiness/liveness, and an optional HTTPS reverse-proxy recipe verified with isolated Docker fixtures. |
| Accounts | Private local login and authenticated password changes with other-session revocation; optional Discord OAuth with PKCE, explicit links, first-admin allowlist and realm invitations; expiring/revocable sessions, local login attempt limits, same-origin writes, database-backed realm authorization. |
| Player experience | Separate pack, collection, market, trade, rank, wishlist, administration and account pages; one slim top bar with a gem wallet and account menu, a bottom tab bar on phones/tablets, and browser history. Readability-first design system (self-hosted Inter/Bricolage Grotesque, 16px body text, no interface text below 13px apart from card rarity badges). Visual pack shop, collection search/filter/sort, illustrated trades and an admin/player preview switch. Original local portraits and rare-opening video; accessible skip, keyboard and reduced-motion controls. No chat or paid subscription. |
| Gameplay | Create an isolated realm with retry-safe receipts from an anime & manga roster (MyAnimeList via Tenrai, or AniList series), or a reviewed JSON/CSV catalog; the 12-character original demo and the 1,000-character original test catalog are downloadable JSON examples. Admins can add missing characters to provider realms later. Category packs plus All Characters, secure five-tier draws through legendary, card reveals, collections, recycling, XP, visual wishlists/trading, character-specific values, a fixed-price gem market and six collector tracks with four levels and prerequisites. New realms default to 200 gems per pack, 2,000 starting gems, no opening cooldown and manual 1,000-gem claims every six hours. Realm admins can review live rule changes while preserving progress. |
| Economy integrity | Realm-wide active ownership uniqueness, atomic opening/recycling/XP/purchase/trading and ledger changes, safe retries, complete-pack rejection without charge, and retained recycling/first-collection/purchase history. |
| Discord gameplay | Optional signed HTTP endpoint, private `/bakufu status`, `/bakufu packs`, confirmed `/bakufu open`, realm-admin server links, explicit command registration. Requires operator setup and public HTTPS reachability for commands. Optional server joining uses fresh OAuth membership checks. |
| Preservation | Player JSON archive v12 with progression, preserved upgrades/linear ranks, leveled collector tracks, character value rules/quotes, historical recycling evidence, wishlists, personal trades/market listings, gem claim rules/receipts and own admission/profile data; legacy readers; encrypted recovery in fresh PostgreSQL; optional scheduled snapshots with retention/health, isolated restore verification, encrypted S3-compatible copies and durable failure/recovery alerts. |

Not implemented: live catalog merging/replacement, live pack regeneration or ownership-mode migration,
Casual duplicate ownership, larger-pack/daily-pull upgrades,
Discord commands for trading/recycling/upgrades/wishlists/gem claims, continued affiliation enforcement, account deletion, automated cloud retention, general full-realm JSON import/export, dated market-price charts, and further provider/artwork integrations. Starting gems are a one-time grant; recycling earns back part of
the default pack cost, timed claims supply configurable recurring gems, and the market redistributes gems between players. Local-password recovery is outside the current Discord-focused scope. Realms are invitation-only by default, with optional verified server joining. This is a prototype slice, not the entire MVP roadmap.

The **Packs**, **Collection**, **Wishlist**, **Market**, **Trades** and **Ranks**
links open their own pages at `/packs`, `/collection`, `/wishlist`, `/market`,
`/trades` and `/ranks`. Only the selected play screen is mounted;
links retain the realm and work with browser Back/Forward. Administration and
account settings have separate pages at `/admin` and `/account`, reached from the
account menu. Admins can turn off **Admin view** in that menu to preview the player
navigation using their current inventory. **Administration** is a hub: an **Overview**
with a setup checklist (packs, game rules, Discord server, joining, invitations),
**Game rules**, **Packs**, **Players & access** and, for instance admins,
**Characters** (look up a series and add the characters a realm is missing) and a
guided **New realm** wizard (name → characters → packs → rules → review) that shows
the generated packs and odds before anything is created. Every rule is one row
with its unit (gems, hours, %) in an aligned column; **Use recommended** links
appear only when a group differs from the defaults. The site is called
**Bakufu**; change `apps/web/lib/brand.ts` to rename an instance.
This browser-local switch hides admin controls; actual permissions remain
enforced by the server. Original anime-inspired demo portraits are bundled locally;
source imports do not grant artwork rights.
Realm selection and ownership information live only in **Account settings**;
ordinary play pages keep that space for the game. Navigation starts at the top
of the destination, while refreshing the current route preserves its position.
Discord profile pictures refresh on verified sign-in, with an initials fallback
until an old cached profile is refreshed or if its image is unavailable.
**Packs** presents large, illustrated packs and a banner of the rarest currently
claimable characters. Anime/manga catalogs lead with actual **Shōnen**, **Seinen**,
**Shōjo**, **Josei** and **Kodomo** source tags, then add the largest distinct genre,
theme and era packs for variety, plus **All Characters**; genres are never relabelled
as demographics, and chips filter the gallery by kind. Realm admins can add category
packs to an existing realm from **Administration → Packs** without touching cards or
receipts. Choose a pack to open its dedicated view, with a pointer-reactive
pack and **1, 5 or 10 packs** per opening. The selected pack uses an immersive
opening room with compact navigation and no large footer. Rarity odds, remaining availability and
ownership rules sit behind the pack's information control, available by hover,
keyboard or tap. See [pack discovery](docs/gameplay/discovery.md).
The displayed total includes every pack; the whole bundle commits together or
charges nothing. Opening starts an animated preparation screen and decodes only
the awarded artwork before the reveal. **Show all cards** uses one responsive
portrait gallery with pack labels, including fifty-card bundles. Pack unsealing
and rarity entrances have immediate skip/show-all controls; reduced motion uses
a static summary. See [pack bundles](docs/gameplay/pack-bundles.md).
The five rarity tiers are **common, uncommon, rare, epic and legendary**, each
with distinct opening motion and original synthesized sound. The higher tiers
add fuller effects; rare openings retain the original local video.
Sound can be muted before or during opening; reduced motion stays silent and
uses a static summary. See
[demo asset provenance](docs/content/demo-art.md) and [pack reveals](docs/gameplay/pack-reveals.md).

**Timed gem claims** are available from **Ranks**: the first claim is immediate,
then the default wait is six hours for another 1,000 gems. Claims never accumulate
while offline. Existing realms migrate with claims disabled to preserve their
economy. Enable them through **Administration → Game rules → Economy →
Free gem claims** (switch on **Timed gem claims**, or choose **Use recommended**),
then preview and apply. Amount and interval are
configurable per realm. See [gem claim rules](docs/gameplay/gem-claims.md).
The header shows gem-claim readiness or its countdown on every play screen;
Click the header claim/countdown to open **Ranks**, which also shows the
next claim's local date/time alongside XP and levels. These are manual claims,
not an automatic wallet refill. Disabled realms display that state explicitly.

**Collector ranks** are separate from XP: improve Bronze, Silver and Gold
independently through four increasingly expensive levels, then unlock Sapphire,
Ruby and Emerald by meeting their mixed level prerequisites. Benefits include
pack discounts, recycling bonuses, wishlist slots and cooldown reduction. New
realms enable these tracks; existing realms require a reviewed settings change
or collector economy preset. Old purchases/benefits remain intact.
See [rank rules](docs/gameplay/collector-ranks.md).

New realms use base rarity weights of **65% / 26% / 7% / 1.7% / 0.3%**, in
tier order (previously 80 / 17 / 2.7 / 0.29 / 0.01%, where a legendary took about
10,000 pulls), and base card values of **30 / 60 / 120 / 260 / 620 gems**. With the
75% popularity bonus a card is worth 30 gems (least popular common) up to about
1,085 gems (most popular legendary), a spread similar to Mudae's kakera values.
Existing realms keep their values until an admin applies **Game rules →
Collection → Use recommended values**.
Actual next-draw odds depend on eligible unclaimed tiers. Existing realms keep
their old rules until the reviewed preset is applied; already awarded character
tiers and historical receipts are preserved. See [rarity and economy](docs/gameplay/rarity-economy.md).

The **Market** lets a player pick an owned card from a searchable card browser and list it for a fixed gem price, another
player confirm purchase, or the seller cancel. Listed cards are reserved from
trading/recycling. Sales share the existing confirmed trade and ownership journals
and award no farming XP. Asking prices are player choices. Character
valuation uses saved source popularity within a compatible source/tier cohort
and bounded demand from other collectors' wishlists. Recycling uses that
character's current value plus the player's rank bonus, with immutable receipt
evidence. No API lookup is needed during a draw. See
[character values](docs/gameplay/character-values.md) and [market rules](docs/gameplay/market.md).

For an anime/manga-focused catalog, the optional provider pipeline offers an
**AniList series browser** (search or browse popular series and import the
characters of the series you pick, with genres, real demographic tags, era,
favourites and optional artwork references) and, under **Other formats**, can
still load up to 25 explicitly selected AniList character IDs or normalize
authorized AniList/Jikan JSON responses. All use the ordinary rights/catalog
review, stable source IDs and the same gameplay engine. Metadata and artwork stay
separate: tick **Include character artwork through API, permission needed** to
show pictures; the preview warns when a roster has none. For tests without a
third-party database, download the original 1,000-character test catalog from the
**Your JSON file** option and upload it. The Wikidata importer is no longer offered
in the wizard but remains available through `POST /api/catalog/wikidata`. See
[providers and scale testing](docs/content/providers.md) and
[Wikidata setup](docs/content/anime-manga.md).

The **MyAnimeList** source (Tenrai, a Jikan-compatible API) builds a popular
roster from anime, manga or both — main characters first, with a chosen number of
characters per series — or prepares only the series you select. A slider (plus an
exact number field) picks the roster size from 100 to 100,000 characters; beyond
about 25,000, realm pages load noticeably slower. Original JSON/CSV catalogs keep
their 1,000-character limit. Remote
artwork references are a separate opt-in: permitted images load from the provider
when displayed, with attribution and an original fallback. Image bytes are not
bundled or backed up. Source-qualified IDs, categories and rarity snapshots stay
local so API outages cannot change ownership or historical draws. Choosing an
arbitrary remote numeric ID is not equivalent to sampling the eligible rarity
and category pool. Provider availability and current setup are documented in the
[provider guide](docs/content/providers.md).

New characters earn **10 XP** on a player's first collection in that realm.
Default levels start at **0, 20, 40, 70, and 100 total XP**. Recycling, trading, and repeat
claims give no XP. Received characters count as known. Existing cards, including recycled cards, count as already
known without retroactive awards. XP remains scoped to each player and realm.
**Ranks** shows current XP, the next threshold and the award rule. The
prototype defaults stop at level 5 (100 XP); XP keeps accumulating at that cap.
Admins can extend the threshold list through reviewed progression settings.
See [XP and level rules](docs/gameplay/progression.md) for configuration and
milestone details. The separate XP-gated pack-discount shop is retired; older
purchased benefits and receipts remain preserved. **Your wishlist** has three
slots by default and gives wished characters 2× selection weight within their
rarity tier, preserving rarity odds. The UI shows actual next-draw chances;
claimed characters and unavailable packs show zero. Its **Character glossary**
tab browses every realm character with search, rarity/ownership filters, portrait
cards and recycling values. Wishlist and trade selection use searchable card
dialogs. See [wishlist rules](docs/gameplay/wishlist.md).
Card faces have a fixed **5:7 portrait shape**, artwork-led name/series overlays
and colored rarity frames. Select a card to inspect its enlarged artwork,
ownership state, source and character-value evidence; genres stay off the faces.
Recycling and rank level-ups act on the first click, retaining pending-operation
locks and same-request retries after uncertain responses.
Realm admins can open **Administration → Game rules**, edit rules, choose **Preview settings
changes**, and apply the reviewed proposal. Purchased ranks and occupied wishlist
slots are protected; stale pages cannot spend at unexpected new prices. See
[live settings](docs/gameplay/settings.md). **Trades** lets two players exchange cards
and gems after both confirm the same offer. Search existing realm members by Discord name or share a realm trade ID to start;
offered cards are reserved, edits reset confirmations, and offers expire after
24 hours by default. See [trading rules](docs/gameplay/trading.md). Realm admins can enable a [verified Discord server join link](docs/gameplay/admission.md), while existing players retain their progress and access. Trade partners can now be found through the private [member search](docs/gameplay/members.md). The optional [Discord pack commands](docs/deployment/discord-gameplay.md) now share the web inventory and use a confirmation before spending. See
[recycling rules and validation](docs/gameplay/recycling.md) for Milestone 2A,
its defaults (2/4/6 gems), schema migration, and remaining limits.

For the Docker reference quickstart, copy `.env.example` to `.env`, replace the
example database password in both fields with the same long URL-safe value,
then run:

```sh
docker compose up --build -d
docker compose exec web pnpm bootstrap
```

Open <http://localhost:3000>, sign in, open **Administration → New realm** and follow its five steps (name, characters, packs, rules, review), then select **Create realm** and open a pack.
Bootstrap prompts for a private admin password; there is no default account.
Local passwords accept 12–256 characters; the database password in `.env` is
separate. Bootstrap must finish with **Account ready** before login.
Use **Account settings** to change a local password and sign out other sessions;
see [password changes](docs/deployment/account-settings.md).
Use `docker compose exec web pnpm player:create` to provision an invited player.
Alternatively, configure [Discord sign-in](docs/deployment/discord-login.md) for
password-free first-admin setup and invited players. Existing accounts can be
explicitly linked while keeping their collections and permissions.

Host development (Node 22.13+, pnpm 10.34.0, PostgreSQL 18, root `.env` prepared):

```sh
pnpm install --frozen-lockfile
docker compose -f compose.yaml -f infra/docker/compose.dev.yaml up -d db
pnpm db:migrate
pnpm bootstrap
pnpm dev
```

Verification commands:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

The integration suite starts real disposable PostgreSQL; the browser suite
uses a production build and a separate disposable database. It uses Edge on
Windows, or installed Playwright Chromium elsewhere. Neither suite connects to
your live database or external character APIs. See the [run guide](docs/deployment/quickstart.md),
[backup/restore guide](docs/deployment/backups.md), [architecture decision](docs/architecture/0001-realm-transactions.md),
[catalog format](docs/content/catalog.md), [starter pack selection](docs/content/starter-packs.md), [pack reveals](docs/gameplay/pack-reveals.md), [privacy limitations](docs/privacy.md),
[optional scheduled backups](docs/deployment/scheduled-backups.md),
[automated restore checks](docs/deployment/restore-checks.md),
[portable HTTPS deployment](docs/deployment/https.md),
[encrypted offsite copies](docs/deployment/offsite-backups.md),
[backup alerts](docs/deployment/backup-alerts.md),
and [implementation and verification report](docs/implementation-report.md).

### Current repository layout

```text
apps/web/           Next.js web interface and authenticated HTTP API
apps/worker/        Optional backup scheduler and isolated restore verifier
packages/core/      Framework-free rules, eligibility, pack generation, drawing
packages/config/    Strict versioned realm settings
packages/importers/ Versioned JSON/CSV validators and original fixtures
packages/db/        PostgreSQL schema, transactions, auth, exports, backups
scripts/            Operator commands and production browser verification
tests/              Unit tests and real PostgreSQL integration tests
infra/docker/       Reference production image and development overlay
docs/               Architecture, deployment/recovery, content, privacy
```

The remainder of this README preserves product intent and the planned roadmap.

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

## 9. Proposed MVP (deliver vertical slices, not every feature at once)

**Milestone 0 — Foundation**
- Repo structure, README/AGENTS, `.env.example`, Docker Compose, PostgreSQL, migrations, test/lint/typecheck commands, original demo catalog.
- A working local quickstart, plus an `architecture/decisions` note covering world/realm scoping and unique ownership.

**Milestone 1 — Playable web slice**
- Private admin bootstrap, one web realm, demo import, 10 auto-generated packs (or fewer if demo data lacks categories), default tiering, one pack-opening operation, inventory, a basic responsive UI.
- Transactional unique-claim enforcement and gem debits; proof via concurrent request test.

**Milestone 2 — Economy + progression**
- Recycling for gems, level/XP, purchasable upgrades, cooldowns and wishlist. Configurable presets and admin settings.
- Current status: recycling, XP/levels, purchasable pack discounts, private wishlists/targeting, cooldowns, and reviewed live realm settings are implemented. Other upgrade effects, ownership-mode changes, and pack regeneration remain planned.

**Milestone 3 — Social play**
- Two-party trades, permissions, Discord HTTP interactions adapter, identity linking; web and Discord must operate on the same realm and inventory.
- Current status: web card/gem trading with both confirmations, reservations, safe retries, transfer history, and backup recovery is implemented (3A). Optional OAuth linking already works. Signed private status/pack-list/confirmed-opening commands and realm-admin server linking are implemented (3B). Other Discord gameplay commands remain planned.
- Member lookup (3C) is implemented: browse/search existing realm members by cached Discord username/display name, choose an explicit recipient, and retain stable realm codes behind names. Refresh names through Discord sign-in. See [member search](docs/gameplay/members.md).
- Server joining (3D) is implemented: realm admins may share a join link for freshly verified members of the linked Discord server. Invitation-only remains the default; explicit account invitations and web-only realms stay supported. Joining does not continuously revoke existing memberships after a player leaves Discord. See [realm admission](docs/gameplay/admission.md).

**Milestone 4 — Preservation + deployment**
- Player export, admin export, automated off-site backup adapter, documented restore, cloud deployment example independent of vendor-specific core code.
- Current status: player archives, encrypted instance snapshots, fresh-database restores, optional scheduled backups to a mounted local/remote destination with daily/weekly retention and health (4A), weekly isolated fresh-database restore checks (4B), an optional HTTPS reverse proxy with health probes and a generic Linux/VPS guide (4C), and verified encrypted copying/downloads to an S3-compatible bucket (4D) are implemented. Optional independent failure/recovery webhook alerts (4E) are implemented; automated remote retention remains planned. Public DNS, certificates, and remote deployment require operator setup. See [scheduled backups](docs/deployment/scheduled-backups.md), [restore checks](docs/deployment/restore-checks.md), [HTTPS deployment](docs/deployment/https.md), [offsite copies](docs/deployment/offsite-backups.md), and [backup alerts](docs/deployment/backup-alerts.md).

**Milestone 5 — Expansion**
- Approved metadata source adapters, richer pack creator, visual pack reveal, optional extras (auctions/events/achievements).
- Current status (5A): instance admins can upload an original version 1 JSON catalog when creating a new realm, attest rights, review generated packs/tiers/initial odds, and confirm the matching preview. The demo remains available. Existing catalogs are not replaced; merges and live pack editing remain planned. Selected provider adapters were added in the player-experience follow-up below. See [catalog creation](docs/content/catalog.md).
- Current status (5B): original UTF-8 CSV uploads use the same authorized preview and transactional new-realm creation. Enter source/revision/permission details, use the downloadable header template, and review before installing. Stable IDs, tiering, provenance, and backup recovery are preserved. See [CSV format and setup](docs/content/catalog.md#original-csv-catalogs-milestone-5b).
- Current status (5C): after previewing a catalog, admins can choose qualifying categories and pack names for a new realm, set the existing minimum-pool/maximum-category rules, and review actual pools/odds. Automatic generation and the All Characters fallback remain available. Live editing and other filter types remain planned. See [starter pack selection](docs/content/starter-packs.md).
- Current status (5D): successful web openings offer manual card reveals, show-all/close, keyboard controls, reduced-motion summaries, and a browser-local opt-out. Presentation uses the actual saved opening result; failed requests reveal nothing and retries keep their existing receipt. Original CSS needs no external art/audio. See [pack reveals](docs/gameplay/pack-reveals.md).

- Current status (5E): realm creation uses durable, authorized retry receipts for demo/JSON/CSV catalogs and reviewed starter packs. Lost-response retries return the original realm and grant once, including after fresh encrypted recovery. Keep the page open to recover an uncertain result; reloads require checking the realm list. See [catalog creation](docs/content/catalog.md).
- Current status (5F): signed-in local accounts can change passwords with current-password verification, stale-form protection, separate attempt limits, atomic other-session revocation and safe retry confirmation. Discord-only accounts keep using Discord. Account deletion remains planned; password recovery is outside the current Discord-focused scope. See [account settings](docs/deployment/account-settings.md).

**Player-experience rework**
- Follow-up: atomic 1/5/10-pack openings with grouped reveals, visible XP thresholds/caps, gem-claim timing on every play screen, and an on-demand Tenrai/Jikan-compatible API browser with optional remote artwork references. See [bundles](docs/gameplay/pack-bundles.md) and [provider setup](docs/content/providers.md).
- Implemented: separate play/admin/account pages, admin/player preview, original local art, searchable physical-card collections, a complete character glossary, visual wishlist/trade pickers, the gem market, six leveled collector tracks and five rarity tiers with distinct motion/sound. Saved tiers, historical receipts and realm-wide ownership remain protected.
- Implemented: configurable timed gem claims with server-authoritative rolling cooldown, retry-safe receipts, archive v12 and encrypted recovery. Existing rules remain unchanged by schema migration; current new realms default to 1,000 gems every six hours and the collector preset is reviewed before changing an existing economy.
- Implemented: bounded, opt-in AniList/Wikidata metadata selection, authorized AniList/Jikan JSON adapters, stable canonical source IDs, explicit rights review and no image fetching. An original 1,000-character scale catalog generates major-category packs; automated tests use fixtures.
- Manually verified: an actual 1,000-character anime roster from Tenrai, 993 remote artwork references, 1/5/10-pack draws, progression beyond level 5 using an explicit 100-level curve, retry receipts, personal export and fresh encrypted recovery. Real provider records remain outside committed fixtures.
- Implemented: config v11 character values from saved source popularity and bounded realm wishlist demand, immediate recycling/rank purchases, inspectable portrait cards and a dedicated pack-opening room. Migration 0023 stores popularity without rewriting tiers or historical receipts; existing realms keep valuation disabled until a reviewed settings change.
- Implemented: interface redesign (top bar, mobile tab bar, account menu, page headers without duplicated titles or balances, readable type scale), slim client realm view with server-paged glossary/wishlist picker, enriched market listings, batched catalog installation, 10,000-character provider rosters, anime+manga Tenrai rosters with era categories and readable MAL names, an AniList series browser, demographic+genre/theme/era pack generation and adding packs to existing realms. See [interface notes](docs/design/interface.md) and [providers](docs/content/providers.md).
- Implemented: guided Administration hub (overview checklist, game rules, packs, players & access), five-step realm creation wizard with character source cards, searchable market listing picker, fixed card-picker layout, Kirameki branding.
- Implemented: **Live pulls** below the packs on the Packs page (the latest rare, epic and legendary pulls as one row of cards, no scrolling; select a card to inspect it; Discord names only; refreshed every 15 seconds), richer synthesized reveal sounds with reverb, risers and impacts, an animated canvas background for openings, and **Administration → Reveal sounds** for one custom sound per rarity (any browser-decodable file, cut to 30 seconds). See [pack reveals](docs/gameplay/pack-reveals.md).
- Implemented: **Waifus** and **Husbandos** packs (Female/Male categories from AniList gender data or, for MyAnimeList rosters, a paced profile check in Administration → Characters), removable category packs (only All Characters is required; removed packs can be added back), pack information above neighbouring tiles, and a [public test guide](docs/deployment/public-test.md) with `scripts/public-test.ps1`.
- Implemented: themed premium pack wrappers (palette per pack theme, holographic foil, crimped seals with a tear line, glowing emblem) and a tear moment with a light flash, foil scraps and a synthesized rip; per-character reveal sounds that take priority over rarity sounds; **Add artwork to existing characters** for MyAnimeList realms (Administration → Characters); the site is now **Bakufu** and the Discord command `/bakufu` (the former `/atlas` keeps working until commands are re-registered). See [pack reveals](docs/gameplay/pack-reveals.md) and [providers](docs/content/providers.md).
- Implemented: aligned settings layout shared by Game rules and the wizard (units, switches, rarity chance/value table, conditional **Use recommended**), Mudae-like card values (30 → ~1,085 gems), roster-size slider up to 100,000 characters with faster realm views for large rosters, **Administration → Characters** to add missing characters to MyAnimeList/AniList realms, and a footer that stays at the bottom of short pages. See [providers](docs/content/providers.md) and [rarity and economy](docs/gameplay/rarity-economy.md).
- Implemented: free hosting on **Vercel + Neon** with Discord sign-in (slash commands off): gzip-compressed large uploads with the same server-side cap, a 60-second request limit, a configurable database pool (`DATABASE_POOL_MAX`), live pulls that pause when idle, and `pnpm discord:commands remove`. See [Vercel + Neon](docs/deployment/vercel-neon.md).
- Roadmap: a guided setup (installer or admin GUI) so self-hosters can deploy and configure Bakufu without working from the source code; dated market-price charts and richer valuation history; richer approved anime/manga providers/artwork pipelines; live catalog editing and pack editing beyond adding category packs; recurring-reward economy balancing. Valuation updates must preserve ownership, stable IDs, historical receipts and separate rarity decisions.

**MVP acceptance tests**
- Two simultaneous attempts cannot both claim the same character in a unique realm.
- Recycled character returns to pool once, credits gems once, and cannot be traded afterward.
- Failed/empty pack opening does not deduct gems or consume a cooldown.
- Permissions reject non-admin configuration changes.
- Equivalent calls from web and Discord result in the same authoritative inventory (when Discord integration is enabled).
- A backup restores all realm state into a clean deployment; a player export is readable without the original server.
- Demo runs without calling external data APIs or needing third-party images.

## 10. Agent collaboration

Read [`AGENTS.md`](./AGENTS.md) before implementation. Treat this README as product intent, not an excuse to build all features immediately. Agents should implement the **smallest end-to-end tested milestone**, document deviations, and never claim unbuilt features are working.

The initial implementation is deliberately limited to the foundation and thin
web slice described in **Implementation status and quickstart** above.

## 11. Out of scope for the first release

A hosted global economy; cross-instance currency/card transfers; scraping entire third-party datasets; unauthorized artwork hosting; cryptocurrency, real-money trading, auctions, paid random rewards, mobile native apps, or attempting to extend proprietary Mudae internals.

## 12. Licensing

Our original code and original demonstration content use the [MIT license](LICENSE).
Do not assume that this license extends to imported metadata, artwork, branding,
or game/community content from other sources.
