# Implementation status

What works today, area by area, with the details of each feature. For setup
start with the [README](../README.md); for the release history see the
[changelog](../CHANGELOG.md). The [product specification](specification.md)
describes the intended product, including features that don't exist yet.

The current slice uses TypeScript, pnpm, Next.js, PostgreSQL, Zod, and explicit
parameterized SQL migrations. No Discord, cloud provider, external character
API, or third-party artwork is required. Original code and demo text are MIT
licensed; that license does not grant rights to imported third-party content.
Release history and the newest migration of each version are in
[CHANGELOG.md](../CHANGELOG.md). Realm admins can repair player collections
(restore recycled cards, return cards, adjust gems); see
[player collections](gameplay/admin-collections.md).

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
keyboard or tap. See [pack discovery](gameplay/discovery.md).
The displayed total includes every pack; the whole bundle commits together or
charges nothing. Opening starts an animated preparation screen and decodes only
the awarded artwork before the reveal. **Show all cards** uses one responsive
portrait gallery with pack labels, including fifty-card bundles. Pack unsealing
and rarity entrances have immediate skip/show-all controls; reduced motion uses
a static summary. See [pack bundles](gameplay/pack-bundles.md).
The five rarity tiers are **common, uncommon, rare, epic and legendary**, each
with distinct opening motion and original synthesized sound. The higher tiers
add fuller effects; rare openings retain the original local video.
Sound can be muted before or during opening; reduced motion stays silent and
uses a static summary. See
[demo asset provenance](content/demo-art.md) and [pack reveals](gameplay/pack-reveals.md).

**Timed gem claims** are available from **Ranks**: the first claim is immediate,
then the default wait is six hours for another 1,000 gems. Claims never accumulate
while offline. Existing realms migrate with claims disabled to preserve their
economy. Enable them through **Administration → Game rules → Economy →
Free gem claims** (switch on **Timed gem claims**, or choose **Use recommended**),
then preview and apply. Amount and interval are
configurable per realm. See [gem claim rules](gameplay/gem-claims.md).
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
See [rank rules](gameplay/collector-ranks.md).

New realms use base rarity weights of **65% / 26% / 7% / 1.7% / 0.3%**, in
tier order (previously 80 / 17 / 2.7 / 0.29 / 0.01%, where a legendary took about
10,000 pulls), and base card values of **30 / 60 / 120 / 260 / 620 gems**. With the
75% popularity bonus a card is worth 30 gems (least popular common) up to about
1,085 gems (most popular legendary), a spread similar to Mudae's kakera values.
Existing realms keep their values until an admin applies **Game rules →
Collection → Use recommended values**.
Actual next-draw odds depend on eligible unclaimed tiers. Existing realms keep
their old rules until the reviewed preset is applied; already awarded character
tiers and historical receipts are preserved. See [rarity and economy](gameplay/rarity-economy.md).

Tiers come from each character's standing in the realm's own roster, raised by
**fame floors**: MyAnimeList/AniList characters with at least 10,000 / 30,000 /
100,000 favourites are at least rare / epic / legendary (realm config v12, never
for own JSON/CSV catalogs, never into a tier with zero odds). New realms and
character additions apply them; realms created earlier start with floors off.
**Administration → Rarity** (realm admins) edits the floors with a reviewed list
of every tier change, applies them in one transaction with a settings revision,
sets or clears one character's manual tier, and shows recent changes. Every
change is journaled (`tier_adjustments`, migration 0028) and restore-checked.
Cards can be recycled straight from the opening results, one by one or all of
one tier at once (`recycleCards`, an all-or-nothing batch with one journal entry
per card). Provider rosters walk more kinds of series (MyAnimeList: TV anime,
web anime/ONA with most donghua, films, manga, manhwa, manhua, light novels;
AniList: anime, donghua, manga, manhwa, manhua, light novels by country and
format) with up to 100 characters per series. **Administration → Characters**
can grow a MyAnimeList realm with the popular-roster walk and remove characters
(one, or all without a picture), refunding owners their card's recycle value
(migration 0029). See [providers](content/providers.md) and
[recycling](gameplay/recycling.md); covered by
`tests/integration/batch-recycling.test.ts`,
`tests/integration/character-removal.test.ts`, the importer unit tests and
`tests/support/roster-tools-browser.ts`.

Ordinary requests read the realm's roster from a per-process cache that
PostgreSQL verifies by fingerprint in the same transaction (`roster-cache.ts`),
and the Live pulls poll asks only whether a newer big pull exists, so database
transfer stays small on hosted plans with transfer caps (Neon Free: 5 GB a
month). `tests/integration/transfer-budget.test.ts` keeps the budgets (page
view, opening, pull feed) for a 3,000-character realm and checks that roster
changes from another process show up at once.

Trades are proposals: a player picks both sides (their cards and gems, and the
other player's cards and gems), sending confirms their side, and the other
player accepts, counters or declines; requested cards are never locked by an
offer (protocol 2, migration 0030; older pending trades keep protocol 1). The
collection has a **Series** view with owned/total per started series. Imported
series carry a medium category (Anime, Manga, Manhwa, …) for medium packs, and
MyAnimeList realms can tag older series by medium. Covered by
`tests/integration/trade-proposals.test.ts`, `tests/unit/medium-packs.test.ts`,
the series-tagging test in `tests/integration/character-removal.test.ts` and the
browser trade flow in `scripts/e2e.ts`.

Covered by `tests/unit/fame-floors.test.ts`,
`tests/integration/tier-adjustments.test.ts` and the browser check in
`tests/support/rarity-browser.ts`.

The **Market** lets a player pick an owned card from a searchable card browser and list it for a fixed gem price, another
player confirm purchase, or the seller cancel. Listed cards are reserved from
trading/recycling. Sales share the existing confirmed trade and ownership journals
and award no farming XP. Asking prices are player choices. Character
valuation uses saved source popularity within a compatible source/tier cohort
and bounded demand from other collectors' wishlists. Recycling uses that
character's current value plus the player's rank bonus, with immutable receipt
evidence. No API lookup is needed during a draw. See
[character values](gameplay/character-values.md) and [market rules](gameplay/market.md).

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
**Your JSON file** option and upload it. See
[providers and scale testing](content/providers.md).

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
[provider guide](content/providers.md).

New characters earn **10 XP** on a player's first collection in that realm.
Default levels start at **0, 20, 40, 70, and 100 total XP**. Recycling, trading, and repeat
claims give no XP. Received characters count as known. Existing cards, including recycled cards, count as already
known without retroactive awards. XP remains scoped to each player and realm.
**Ranks** shows current XP, the next threshold and the award rule. The
prototype defaults stop at level 5 (100 XP); XP keeps accumulating at that cap.
Admins can extend the threshold list through reviewed progression settings.
See [XP and level rules](gameplay/progression.md) for configuration and
milestone details. The separate XP-gated pack-discount shop is retired; older
purchased benefits and receipts remain preserved. **Your wishlist** has three
slots by default and gives wished characters 2× selection weight within their
rarity tier, preserving rarity odds. The UI shows actual next-draw chances;
claimed characters and unavailable packs show zero. Its **Character glossary**
tab browses every realm character with search, rarity/ownership filters, portrait
cards and recycling values. Wishlist and trade selection use searchable card
dialogs. See [wishlist rules](gameplay/wishlist.md).
Card faces have a fixed **5:7 portrait shape**, artwork-led name/series overlays
and colored rarity frames. Select a card to inspect its enlarged artwork,
ownership state, source and character-value evidence; genres stay off the faces.
Recycling and rank level-ups act on the first click, retaining pending-operation
locks and same-request retries after uncertain responses.
Realm admins can open **Administration → Game rules**, edit rules, choose **Preview settings
changes**, and apply the reviewed proposal. Purchased ranks and occupied wishlist
slots are protected; stale pages cannot spend at unexpected new prices. See
[live settings](gameplay/settings.md). **Trades** lets two players exchange cards
and gems after both confirm the same offer. Search existing realm members by Discord name or share a realm trade ID to start;
offered cards are reserved, edits reset confirmations, and offers expire after
24 hours by default. See [trading rules](gameplay/trading.md). Realm admins can enable a [verified Discord server join link](gameplay/admission.md), while existing players retain their progress and access. Trade partners can now be found through the private [member search](gameplay/members.md). The optional [Discord pack commands](deployment/discord-gameplay.md) now share the web inventory and use a confirmation before spending. See
[recycling rules and validation](gameplay/recycling.md) for Milestone 2A,
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
see [password changes](deployment/account-settings.md).
Use `docker compose exec web pnpm player:create` to provision an invited player.
Alternatively, configure [Discord sign-in](deployment/discord-login.md) for
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
your live database or external character APIs. See the [run guide](deployment/quickstart.md),
[backup/restore guide](deployment/backups.md), [architecture decision](architecture/0001-realm-transactions.md),
[catalog format](content/catalog.md), [starter pack selection](content/starter-packs.md), [pack reveals](gameplay/pack-reveals.md), [privacy limitations](privacy.md),
[optional scheduled backups](deployment/scheduled-backups.md),
[automated restore checks](deployment/restore-checks.md),
[portable HTTPS deployment](deployment/https.md),
[encrypted offsite copies](deployment/offsite-backups.md),
and [backup alerts](deployment/backup-alerts.md).

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
