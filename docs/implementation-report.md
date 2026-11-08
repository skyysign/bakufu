# Initial implementation report

Scope: Milestone 0 foundation plus a thin Milestone 1 web slice. The initial
repository contained only README.md and AGENTS.md, with no application,
packages, scripts, installed tools, or Git metadata. README.md was updated;
AGENTS.md was left unchanged.

## Files created

| Location | New files and purpose |
| --- | --- |
| Root | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`, `.dockerignore`, `.env.example`, `LICENSE`, `compose.yaml`. |
| `apps/web` | Package/TypeScript/Next configuration; `lib/server.ts`; app layout, page, error boundary, client forms/dashboard, stylesheet, and authenticated `app/api/[...path]/route.ts`. |
| `packages/core` | Package manifest and `src/index.ts`: pack generation, weighted eligibility/odds, drawing without replacement, results/errors. |
| `packages/config` | Package manifest and `src/index.ts`: strict version 1 Classic settings and defaults. |
| `packages/importers` | Package manifest, `src/index.ts`, `fixtures/demo.v1.json`: bounded original JSON format, stable IDs, source-local percentile tiers, 12 invented characters. |
| `packages/db` | Package manifest; `migrations/0001_initial.sql`; `src/connection.ts`, `migrate.ts`, `auth.ts`, `game.ts`, `export.ts`, `backup.ts`, `index.ts`. |
| `scripts` | `accounts.ts`, `migrate.ts`, `backup.ts`, `prompt.ts`, `e2e.ts`: hidden-prompt operator commands and production browser verification. |
| `tests` | `unit/rules.test.ts`, `integration/game.test.ts`, `support/postgres.ts`. |
| `infra/docker` | `Dockerfile`, `compose.dev.yaml`. |
| `docs` | Architecture ADR, deployment quickstart, backup/restore guide, catalog format, privacy notes, this report. |

Ignored local dependency caches, `.tools/`, build output, and fictional browser
screenshots are development artifacts, not source deliverables. No real
accounts, credentials, tokens, character API data, or third-party artwork were
created or committed. No Git repository or remote was created.

## How to run

Follow [the complete quickstart](deployment/quickstart.md). Prepare private
`.env` values from `.env.example`, then:

```sh
docker compose up --build -d
docker compose exec web pnpm bootstrap
```

Sign in at <http://localhost:3000>, create a realm with the original catalog,
then open packs and export the collection. Host development and optional player
provisioning commands are in the quickstart. Docker was unavailable during the
initial implementation; its build/boot verification was completed in the
authentication follow-up below.

## Verification performed

Validated on Windows, Node 24.16.0, pnpm 10.34.0, PostgreSQL 18.6, Next.js
16.4.3, and installed Microsoft Edge on 2026-10-31. pnpm was installed in an
ignored workspace-local tools directory; commands used that executable, with
its directory on PATH for scripts that invoke pnpm recursively.

| Exact project command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Passed for packages, scripts, tests, and web app. |
| `pnpm test` | Passed: 5 unit tests. |
| `pnpm test:integration` | Passed: 11 real PostgreSQL integration tests. |
| `pnpm build` | Passed: optimized production web build. |
| `pnpm test:e2e` | Passed: production browser scenario at desktop 1440px and mobile 390px. |

The service tests cover concurrent final-card claims by different players,
concurrent retry deduplication, concurrent spending of the final ten gems,
the same character in different realms, empty/undersized pools, cooldown,
late-transaction failure and rollback, direct database uniqueness/composite
foreign keys, bootstrap/membership/RBAC/session hashing, one-time membership
grants, player archive round trip, and encrypted full-instance recovery.

Recovery restores to a different freshly migrated database, compares every
persistent row (including timestamp microseconds), replays a restored opening,
and verifies login. Corruption, wrong passphrases, existing-target restore,
and inconsistent wallet reconciliation are rejected. A reconciliation failure
is tested to roll the entire restore back.

The browser scenario checks wrong-password feedback, keyboard skip-link focus,
admin login, demo realm creation, six packs, opening and refreshed wallet/card,
receipt retry, downloadable player JSON, anonymous/nonmember/player permission
failures, cross-origin mutation rejection, logout, no browser runtime errors,
and no horizontal overflow at 390px. Desktop/mobile screenshots were visually
inspected. Automated browser routes block external resources.

Testing found and fixed timestamp precision loss in backup serialization and
a successful-opening UI that initially failed to refresh server state. The
final passing checks were run against the corrected implementation.

## What works end to end

An operator bootstraps an administrator without a default password. That admin
signs in, creates an isolated realm, and installs validated original content.
The server generates five category packs and an All Characters fallback. The
player sees unclaimed availability and actual next-draw rarity odds, spends
gems once for a successful secure draw, views the authoritative collection,
and downloads a private JSON archive. An operator can provision other realm
players and create encrypted recoverable backups without a hosted service.

## Boundaries and next milestone

The database adapter uses explicit parameterized SQL rather than an ORM; this
keeps constraints and transaction boundaries visible in the small slice.
One realm row lock serializes its game writes, intentionally limiting
per-realm throughput. Settings were initially supplied at realm creation;
Milestone 2E below adds reviewed live editing. Ownership-mode migration and
pack regeneration remain deferred. Custom JSON validation exists, but HTTP installs
only the included demo. Asset integrations and CSV are deferred.

Recycling, XP/levels, purchasable pack discounts, and wishlists are implemented as Milestones 2A–2D below. Additional upgrade effects,
Casual mode, additional Discord gameplay commands, and animations remain unimplemented. Trading is delivered in Milestone 3A; signed pack commands in 3B below. Password
reset/change, account deletion/anonymization, and broader public-host security
review are outstanding. Backups are manual, in-memory snapshots: no scheduler,
offsite adapter, retention jobs, or alerting is present. Full-realm human-readable
exports are planned separately from the implemented player JSON and encrypted
instance recovery.

Recommended next small milestone: **configurable Discord affiliation-based realm admission**.
Member profiles and recipient search are delivered in 3C below.

## Authentication follow-up (2026-10-31)

The reported login failure was diagnosed through read-only checks: PostgreSQL
and the web container were running, but the database contained zero accounts.
Bootstrap had not completed. Passwords accept 12–256 characters, not exactly
12. Bootstrap now reports validation errors clearly; the login page detects an
uninitialized instance and explains account setup. No credentials or account
emails were read during diagnosis.

Optional Discord website login is implemented. Added migration
`0002_discord_auth.sql`, the database Discord identity/flow services, web OAuth
adapter, provider start/callback routes, first-admin allowlist, realm admin
invitation form, and `pnpm discord:link` operator command. Added environment
examples, Compose forwarding, a [Discord setup guide](deployment/discord-login.md),
and fixture-based unit/integration/browser tests. Local authentication remains
supported; Discord gameplay commands and bot integration are still deferred.

The OAuth flow verifies issuer, browser-bound single-use state, and S256 PKCE.
It requests `identify` only, uses immutable provider IDs, never auto-merges by
email, and discards provider tokens. A migration regression test preserves an
existing local account, session, wallet, and collection before adding a Discord
link. Recovery includes encrypted identity links and excludes transient OAuth
flows. A browser regression caught and fixed the SameSite cookie behavior on
the return from the provider.

Follow-up verification commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`
(9 unit tests), `pnpm test:integration` (19 real PostgreSQL tests), `pnpm build`,
and `pnpm test:e2e` (local and Discord fixture consent/login, invitations,
collection preservation, authorization, export, and mobile layout).
Real Discord sign-in requires the operator's own configured application;
automated tests never contact Discord APIs.

All follow-up project checks passed. Docker Desktop is now available:
`docker compose config --quiet` and `docker compose up --build -d` passed,
including the Linux production build and migrations. A read-only check inside
the running web container confirmed HTTP 200, migrations 0001 and 0002, and the
first-time setup notice. At that check, the database had zero accounts and
Discord was not configured, so first-admin setup was still required. No `.env` values,
passwords, or live account emails were printed or changed.

## Milestone 2A: recycling (2026-11-03)

Implemented confirmed recycling in the collection UI and authenticated
`POST /api/recycle`, backed by a framework-free reward calculation and a
realm-scoped transactional service. Default common/uncommon/rare rewards are
2/4/6 gems; the realm creation form accepts per-tier overrides. Settings are
version 2 with an explicit v1 migration. Live reward editing remains planned.

Added `packages/db/migrations/0003_recycling.sql`,
`packages/db/src/recycling.ts`, `tests/unit/recycling.test.ts`,
`tests/integration/recycling.test.ts`, `tests/support/legacy.ts`, and
`docs/gameplay/recycling.md`. Updated core/config, active ownership queries,
API/UI/styles, player archives, encrypted recovery, existing regression tests,
browser scenarios, architecture, and deployment/privacy documentation.
No dependencies or environment variables were added; private `.env` is unchanged.

Retired cards keep stable IDs and acquisition history. A partial unique index
protects active realm ownership, and one receipt per card prevents duplicate
credits. Removing active ownership, recording the receipt, crediting the wallet,
and writing the ledger commit together. Replaying an old recycling receipt
leaves a later claim untouched. A failed/aborted operation gives no reward and
does not alter cooldown. Wallet overflow fails without retiring the card.

Player archive version 2 includes personal recycling history and active cards.
The parser explicitly upgrades version 1 archives with empty history. Encrypted
backup format 1 remains readable: snapshots from the original, Discord, and
current schemas are explicitly recognized by migration/checksum manifests.
Older configurations and card rows upgrade during restore, with unsupported
schemas rejected. Restore verifies wallet and retirement/receipt/credit
agreement and rolls back on corruption.

Validation passed:

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | 12 unit tests passed. |
| `pnpm test:integration` | 32 real PostgreSQL tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Production browser flow passed on desktop/mobile. |

The new tests cover concurrent same/different-key recycling, late rollback,
permissions and realm isolation, character re-claiming, opening/recycling races,
custom/zero rewards, overflow, v1 configuration migration, current/older backup
restoration, corrupted-history rejection, and player archive round trips. Browser
checks configure custom rewards, confirm/cancel by keyboard, commit recycling
and drop its response, then replay the same key and verify one credit. They also
check updated pack availability, a subsequent opening, export history, anonymous
and other-owner failures, CSRF rejection, and mobile confirmation layout.
Desktop/mobile fixture screenshots were visually inspected.

`docker compose config --quiet` and `docker compose up --build -d` passed.
The running database applied migration 0003, its existing realms have version 2
settings with the default rewards, the website returns HTTP 200, and anonymous
recycling is rejected with HTTP 401. Before/after anonymous fingerprints matched
for existing account identities, realms' previous settings, memberships/wallets,
card IDs/acquisition records, ledger entries, and packs. No live card was recycled
for verification and no private values were printed. Existing progress was
preserved; refreshing the local website exposes the new collection controls.

XP/levels were delivered next in Milestone 2B below. Upgrades, wishlist,
trading, live configuration editing, and Discord gameplay commands remain
unimplemented. Rewards are below the default one-card
pack cost; recycling earns some gems back rather than supplying infinite gems.

## Milestone 2B: XP and levels (2026-11-03)

Implemented configurable first-collection XP, cumulative levels, an accessible
dashboard progress bar, XP/level-up information in opening receipts, and realm
creation controls. Defaults award 10 XP for each character a player first
collects through a pack in that realm; levels start at 0/20/40/70/100 total XP.
At this checkpoint, levels had no gem reward or upgrade effect. Settings moved to version 3;
v1/v2 configurations migrate explicitly without changing existing overrides.

Added `packages/db/migrations/0004_progression.sql`,
`packages/db/src/progression.ts`, `tests/unit/progression.test.ts`,
`tests/integration/progression.test.ts`, and
`docs/gameplay/progression.md`. Updated core/config, pack transactions,
realm views, UI/styles, archives, encrypted restore, legacy fixtures, browser
verification, architecture, README, backup/recycling/privacy documentation.
No dependencies or environment variables were added. Private `.env` is unchanged.

Each realm/player/character has at most one first-collection XP event, protected
by a database unique index. Zero-award events also retain this history.
Recycling leaves XP unchanged; repeat claims cannot earn XP again. A different
player can earn their own first-collection award. XP, first-collection history,
card claims, gems, cooldown, and immutable opening receipt commit atomically.
Retries replay receipts; late failures and XP overflow leave state unchanged.
Level is derived from membership XP and configured cumulative thresholds.

Migration 0004 seeds existing active/retired characters as already known with
zero XP. Any prior nonzero XP is preserved as a migration baseline. There are
no retroactive awards, and historical opening receipts stay unchanged. Archive
v3 includes progression rules, derived level, and personal XP history. Legacy
v1/v2 archives remain readable without fabricated history. Backup envelope v1
supports migration revisions 0001–0004; older restores apply the same seed
policy. Current restores reconcile XP totals, historical collection coverage,
event/card links, award policy snapshots, and receipt awards, rejecting
inconsistent data atomically.

Validation passed using the workspace-local pnpm executable, as described
above:

| Exact project command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Passed for packages, scripts, tests, and web. |
| `pnpm test` | 17 unit tests passed. |
| `pnpm test:integration` | 43 real PostgreSQL tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Production browser flow passed at desktop 1440px and mobile 390px. |

New checks cover exact threshold boundaries, custom/disabled rewards, multiple
levels in one pack, concurrent same/different-key openings, zero-award history,
recycle/reclaim farming prevention, per-player/realm isolation, permissions,
failed draws, late rollback, overflow, migration of active/retired duplicates,
prior-XP preservation, personal archives, current/older fresh-database restore,
and corruption rejection with rollback. The browser flow creates custom XP
rules, observes a level increase, ignores forged client XP/level fields, keeps
XP through recycling and receipt replay, verifies export history, and confirms
progress survives linked Discord login. An invited player starts separately
at level 1 with zero XP. Desktop/mobile fixture screenshots were visually
inspected; there were no browser runtime errors or mobile horizontal overflow.
All automated tests use disposable local databases and fixture-only providers.

`docker compose config --quiet` and `docker compose up --build -d` also passed.
The local app is running the new production image with migration 0004 applied.
Before/after anonymous fingerprints matched for account records, Discord links,
prior realm settings, memberships (including gems, XP, and cooldowns), catalog,
cards, opening receipts, wallet ledger, recycling history, and packs. A read-only
check confirmed default v3 progression settings, complete historical collection
markers, reconciled XP, and zero retroactive awards. HTTP startup returned 200;
an anonymous opening was rejected with 401. No live gameplay writes were made
for verification and no private values were printed. Refreshing the existing
local website exposes the progression panel.

Purchasable pack discounts were delivered next in Milestone 2C below. Wishlist
behavior, other upgrade effects, and live admin configuration editing remain
planned. Trades, Discord gameplay commands, and automated offsite backup
scheduling remain later milestones.

## Milestone 2C: purchasable pack discounts (2026-11-03)

Implemented the first purchase upgrade as `pack_discount`: rank 1 costs 10 gems
at level 2 and discounts each pack by 1 gem; rank 2 costs 20 gems at level 3
and discounts each pack by a total of 2 gems. The dashboard shop shows rank,
effects, price, and level requirements, with confirmation/cancellation and
safe retry after an uncertain response. Realm creation exposes 0–5 ranks and
each cost, level requirement, and cumulative discount. Zero ranks disables
purchases. Custom configurations may allow zero-cost purchases or free packs.
Defaults keep discounted one-card prices above the largest recycling reward.

Added `packages/db/migrations/0005_upgrades.sql`,
`packages/db/src/upgrades.ts`, `packages/db/src/upgrade-state.ts`,
`tests/unit/upgrades.test.ts`, `tests/integration/upgrades.test.ts`, and
`docs/gameplay/upgrades.md`. Updated config/core, opening transactions/views,
API/UI/styles, archives, encrypted backup restore, legacy fixtures, browser
checks, architecture, README, gameplay, privacy, and deployment guides.
No dependencies or environment variables were added. Private `.env` is unchanged.

Append-only purchases are scoped to realm/player and unique by rank and request
key. The same realm lock serializes buying, opening, and recycling. Rank/level/
fund checks, purchase receipt, debit, and namespaced wallet ledger entry commit
together. An explicit target rank prevents concurrent different-key requests
from buying successive ranks accidentally. Replaying an old purchase returns
its immutable receipt. New pack openings use the player's effective price and
record the applied rank; old openings retain their original prices and results.
XP, cooldowns, pack sizes, odds, ownership, and other players are unaffected.

Configuration v4 explicitly migrates v1–v3 with default upgrade rules and no
purchased ranks. Player archive v4 adds upgrade rules, base pack price, and
personal purchase history with stable IDs. Older v3 archives stay readable as
v3; v1/v2 stay readable as legacy v2, without invented purchase history.
Backup envelope v1 recognizes revisions 0001–0005 and preserves purchases and
policy snapshots. Restore checks contiguous ranks, receipt/policy agreement,
level gates, debit reconciliation, and orphaned upgrade debits, rolling back
inconsistent restores. Earlier snapshots restore with no purchased ranks.

Validation passed using the workspace-local pnpm executable:

| Exact project command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Passed for packages, scripts, tests, and web. |
| `pnpm test` | 22 unit tests passed. |
| `pnpm test:integration` | 55 real PostgreSQL tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Production desktop 1440px/mobile 390px flow passed. |

New service tests cover concurrent same/different-key purchases, rank uniqueness,
final-gem purchase/opening races, late rollback and retry, level/fund checks,
realm/player isolation, disabled/free custom rules, multi-card and cooldown
behavior, empty-pool rejection, old receipt replay, archive validation,
fresh-database restore, progression-era database/backup migration, and corrupt
purchase history rejection. Browser checks customize upgrade rules, test level
gates against forged client fields, confirm/cancel by keyboard, commit and drop
a purchase response, retry the identical request, and verify one debit/rank and
the discounted opening. Discord login preserves the purchased rank; another
player starts unupgraded. Desktop/mobile fixture screenshots were visually
inspected with no browser runtime errors or horizontal overflow. Tests use
disposable local PostgreSQL and fixture-only providers, with no live API calls.

Only pack discount upgrades are implemented. Larger packs, additional daily
pulls, wishlist slots, other upgrade effects, and live settings editing remain
planned. Pending UI retry keys remain in page memory, as with pack/recycling
requests; rank uniqueness still prevents duplicate ownership after a reload.
There is no refund/respec UI. Base wishlists and targeting were delivered next
in Milestone 2D below; extra slot upgrades remain planned.

The local Docker containers were stopped before deployment. Started the existing
database with `docker compose up -d --wait db`, recorded anonymous state
fingerprints through a temporary read-only app process, then ran
`docker compose config --quiet` and `docker compose up --build -d`; all passed.
The production image built successfully and migration 0005 applied. Before/after
fingerprints matched for accounts, Discord identities, prior realm settings,
memberships (gems, XP, cooldown), catalog, cards, openings, gem and XP ledgers,
recycling history, and packs. Read-only checks confirmed v4 default upgrade
rules, no automatically granted purchases, reconciled gem/XP totals, HTTP 200
startup, and HTTP 401 for an anonymous purchase. No live card was opened,
recycled, or upgraded for verification, and no private values were printed.
The existing local website is running and exposes the new shop after refresh.

## Milestone 2D: private wishlists and targeting (2026-11-04)

Implemented private realm/player wishlists with catalog search, add/remove,
capacity feedback, desired-state requests, and safe retries. Defaults are three
slots and 2× within-tier character weight. Rarity selection, unique ownership,
pack filters, prices, cooldown, and XP anti-farming remain authoritative. Wishes
persist through claims/recycling until removed; unavailable wishes have zero
chance. The UI shows per-wish/per-pack next-draw odds and aggregate pack wishlist
chance. Packs that cannot supply a full opening show zero wishlist chance.
Creation controls expose 0–20 slots and integer multipliers from 1 to 10.

Added `packages/db/migrations/0006_wishlist.sql`,
`packages/db/src/wishlist.ts`, `packages/db/src/wishlist-state.ts`,
`tests/unit/wishlist.test.ts`, `tests/integration/wishlist.test.ts`, and
`docs/gameplay/wishlist.md`. Updated rules/config, opening transactions and
snapshots, realm views, API/UI/styles, exports, encrypted restore, legacy
fixtures, browser tests, architecture, README, gameplay/deployment/privacy docs.
No dependencies or environment variables were added; private `.env` is unchanged.

Realm-locked entry changes and immutable receipts commit together. Unique
realm/player/character and request-key constraints prevent duplicate entries
and replay conflicts. Slot checks survive concurrent final-slot requests.
Historical retries return their receipt without undoing a subsequent edit;
failed changes leave no entries or receipts. No gems, XP, or cooldowns are
changed. New opening receipts snapshot wish IDs/multiplier within the existing
claim/debit/XP transaction, and old receipts remain untouched.

Configuration v5 strictly migrates v1–v4 with default rules and empty lists.
Player archive v5 preserves wishlist rules, entry/character/source IDs, metadata,
and timestamps, excluding other players' wishes. v3/v4 archives remain readable
at their original versions; v1/v2 retain legacy-v2 behavior without inventing
missing wishlist history. Backup envelope v1 explicitly recognizes revisions
0001–0006. Current snapshots include entries/change receipts and verify realm
foreign keys, uniqueness, slot limits, receipt identities/counts, and opening
multiplier snapshots. Older snapshots restore empty lists with prior cards,
gems, XP, purchases, and receipts preserved.

Validation passed using the workspace-local pnpm executable:

| Exact project command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Passed for packages, scripts, tests, and web. |
| `pnpm test` | 28 unit tests passed. |
| `pnpm test:integration` | 66 real PostgreSQL tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Production desktop 1440px/mobile 390px flow passed. |

Probability tests enumerate weighted ticket intervals, check exact probabilities
and unchanged tier totals, and cover missing/zero-weight wishes, neutral/disabled
rules, multiple wishes, natural single-character certainty, and multi-card
sampling without replacement. Database checks cover final-slot and final-card
races, stale add/remove replay, late add/remove rollback, realm/player isolation,
claim/recycle reactivation, XP protection, unavailable complete packs, archives,
current/older fresh-database restore, preservation of upgrade-era purchases, and
corrupt-capacity/receipt rejection with rollback. An initial assertion selected
the first category pack instead of All Characters; it was corrected to use the
actual pack ID before the final passing suite.

Browser checks customize slots/weight, search/add/remove by keyboard, commit an
add then drop its response and replay it, enforce capacity against forged client
fields, replay an old add after removal without resurrecting it, and verify
displayed probabilities, exports, claimed-card recycling, upgrades, auth, CSRF,
and private access. Linked Discord login preserves the player's list; another
player starts empty. Desktop/mobile screenshots were visually inspected with
no runtime errors or horizontal overflow. All automated tests use original
fixtures, disposable local PostgreSQL, and fixture-only providers.

Catalog search currently loads the tiny original catalog in full; custom-upload
pagination remains future work. Pending retry keys remain in page memory.
Wishlists do not add notifications, guaranteed pulls, or purchasable extra slots.
Reviewed live settings were delivered next in Milestone 2E below. Other upgrade
effects remain planned.

`docker compose config --quiet` and `docker compose up --build -d` passed.
The local production app applied migration 0006 and is running with v5 default
wishlist rules. Anonymous before/after fingerprints matched for accounts,
Discord links, prior realm settings, memberships (gems, XP, cooldown), catalog,
cards, openings, gem/XP ledgers, upgrade purchases, recycling history, and packs.
Read-only checks confirmed empty initial wishlists/change history, reconciled
wallet/XP totals, HTTP 200 startup, and HTTP 401 for anonymous wishlist changes.
No live gameplay or preference writes were made for verification and no private
values were printed. Refresh the existing local website to use the new controls.

## Milestone 2E: reviewed live realm settings (2026-11-04)

Implemented a realm-admin editor for pack prices/sizes, future starting grants,
cooldown, rarity weights, recycling/XP rewards, levels, wishlist rules, and
unpurchased upgrade ranks. A server-generated impact preview shows changed
values, aggregate player price/level/affordability/cooldown effects, pack pools
and odds, warnings, and safety blockers. Saving applies only that reviewed
proposal. Slot reductions below existing usage, changes/removal of purchased
rank definitions, ownership changes, and pack regeneration are rejected.
Existing balances, XP, cards, wishes, purchases, and receipts are preserved.

Added `packages/db/migrations/0007_realm_settings.sql`,
`packages/db/src/settings.ts`, `packages/db/src/settings-revision.ts`,
`apps/web/app/settings.tsx`, `tests/unit/settings.test.ts`,
`tests/integration/settings.test.ts`, and `docs/gameplay/settings.md`.
Updated core impact rules, realm views, gameplay revision guards, API/UI/styles,
backup recovery, legacy fixtures, browser checks, architecture, README, gameplay,
deployment, and privacy guides. Config/player archive remain v5. No dependencies
or environment variables were added; private `.env` is unchanged.

Previews expire in five minutes and bind proposed rules to the reviewing admin,
realm, configuration revision, and fingerprint of relevant state. Preview/apply
authorize realm-admin membership and share the existing gameplay/member-write
realm lock. Stale gameplay or another save invalidates review. Apply updates
rules/revision and writes an immutable audit receipt atomically; late failure
rolls both back. Identical request keys replay even after expiry, later saves,
or restore; permissions are rechecked first. Different previews cannot share
one request key. Aggregate previews expose no private player identities/wishes.

HTTP gameplay commands now pass the displayed `expectedRevision`, retaining it
through uncertain retries. Fresh commands from stale/missing revisions reject
with 409 before spending or changing state. Existing receipts replay first,
preserving historical offers and unknown-outcome retries. Trusted direct service
calls may act on current rules; quoted adapters should supply a revision.

Encrypted backup envelope v1 recognizes revisions 0001–0007, preserving current
config revisions and before/after audit snapshots while excluding ephemeral
previews. Restore validates contiguous revisions, receipt metadata, current-rule
agreement, and existing economy/progression/history checks. Older snapshots
gain revision 1 with an empty audit and preserve their rules and progress.

Validation passed using the workspace-local pnpm executable:

| Exact project command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Passed for packages, scripts, tests, and web. |
| `pnpm test` | 34 unit tests passed. |
| `pnpm test:integration` | 80 real PostgreSQL tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Production desktop 1440px/mobile 390px flow passed. |

New tests cover impact calculations and no-op drafts, protected purchases,
occupied wishlist limits, actual pack eligibility/odds, unreachable-rank and
economy warnings, realm-admin scope and revoked roles, transient preview-only
writes, concurrent same/different-key saves, conflicting reviews, expiry,
gameplay/member staleness, late rollback, stale player offers, apply/open races,
current player exports, fresh restore of full audit history, older snapshot
migration, and corrupt revision-chain rejection with rollback.

Browser checks reject non-admin and unsafe changes, discard previews without
saving, invalidate review after a wishlist edit, ignore forged apply-time rules,
commit and drop a save response, replay the identical request, and verify one
audit/change. A stale/missing player revision is rejected without charge while
an old successful receipt replays unchanged; a fresh opening uses the new price.
Existing login, Discord, gameplay, export, permission, and CSRF checks pass.
Desktop/mobile editor screenshots were visually inspected; narrow-screen number
fields were widened and upgrade differences use readable per-rank rows. Tests
use disposable PostgreSQL and fixtures only, with no external live API calls.

The settings history has no timeline or one-click rollback UI; a prior safe
configuration can be reviewed and applied as a new revision. Pending save keys
live in page memory. Ownership-mode changes, live pack regeneration, additional
upgrade effects, and scheduled backups remain planned. The next small slice is
two-party trading with both participants' confirmations and atomic transfers.

`docker compose config --quiet` and `docker compose up --build -d` passed.
The local app applied migration 0007 with initial configuration revisions of 1
and empty audit/preview tables. Before/after anonymous fingerprints matched for
existing rules, accounts, Discord identities, memberships (gems, XP, cooldowns),
catalog, cards, openings, gem/XP ledgers, upgrade purchases, recycling history,
wishlist entries/change receipts, and packs. Read-only checks confirmed config
schema v5 unchanged, reconciled wallet/XP totals, HTTP 200 startup, and HTTP 401
for anonymous preview/apply requests. No live rules or gameplay were changed
for verification and no private values were printed. Refresh the existing local
website to access the realm-admin settings controls.

## Milestone 3A: atomic two-party trading (2026-11-04)

Delivered realm-scoped card/gem offers, private per-realm player trade IDs,
versioned edits, both participants' confirmations, cancellation, fixed expiry,
and atomic settlement. The web dashboard supports reviewing both sides,
editing only one's own side, refreshing offers, and retrying an uncertain
request with the original key. Offered cards are reserved against recycling
or another offer. Gems stay spendable and both balances are checked before
confirmation; failed settlement transfers nothing. Each actual edit resets
both confirmations. Existing trades retain their creation rules and expiry
when admins change or disable new trading.

Added framework-free trade validation/state/balance rules in `packages/core`,
the transactional `tradeCommand` service and participant-only read views in
`packages/db`, `POST /api/trades`, dashboard trade controls, shared trading
configuration fields for realm creation/live settings, and migration
`0008_trading.sql`. The architecture decision now documents transfer ownership,
locking, retry, and XP boundaries. No dependencies or environment variables
were added; `.env` was not read or edited.

Card IDs and original openings remain stable. `owner_id` records the current
owner and immutable `original_owner_id` preserves opening provenance. A
numbered transfer journal explains subsequent ownership. Trading grants no
XP; a zero-XP `trade_collection` marker makes a received character known so
recycle/reclaim cannot farm XP. Existing XP, wishes, and upgrades remain with
their player. Unique active ownership stays enforced independently of transfers.

Config/player archive **v6** adds trading rules, own trade ID, personal offers
and confirmations, trade discovery references, and nullable card `receivedAt`.
Older archive readers retain their original information. Encrypted backup
envelope v1 recognizes revisions 0001–0008. Restore checks offer/version
history, confirmations, reservations, gem ledgers, discovery markers, transfer
sequences, and final owners. Migration and legacy restore preserve old settings
audit snapshots; comparison normalizes config versions without rewriting them.
See [trading guide](gameplay/trading.md), [recovery](deployment/backups.md),
and [privacy](privacy.md).

Verification (all passed):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 41 unit tests passed. |
| `pnpm test:integration` | 98 real PostgreSQL integration tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Desktop/mobile production browser checks passed. |

The local wrapper was `node .tools/node_modules/pnpm/bin/pnpm.cjs`, with its
ignored `.bin` directory prepended to PATH for recursive scripts. Integration
checks include concurrent retries/reservations, recycling races, participant
and realm isolation, confirmation reset/stale versions, cancellation/expiry,
live-policy snapshots, stale config guards, insufficient funds/overflow, late
failure rollback, stable return transfers, XP farming prevention, fresh restore,
corrupt ownership rejection, and migration from settings-era databases/backups.
One earlier test run timed out while initializing disposable PostgreSQL;
the final complete serial verification passed without changing timeouts.

Browser checks use two independent authenticated players and original fixtures,
drop the first successful create response, replay its exact request, edit both
sides, reset confirmation by editing, then complete a card/gem swap. They verify
stable IDs, conserved balances, unchanged XP, archive v6, CSRF/auth, reserved
card controls, and desktop/mobile layout. Screenshots were visually inspected.
Automated tests make no external live API calls and never use the live database.

Limits: default 24-hour expiry, five cards and 1,000,000 gems per side, ten
pending trades per player; all are configurable. Expiry is derived on reads and
persisted with reservation release on later valid trade/recycling writes, so no
scheduler is required. Gems are not escrowed. Dashboard history is limited to
100 entries (pending first); personal exports include all own trades. Refresh
is manual; there are no notifications, market, admin override, cross-realm
transfers, or signed Discord gameplay interactions. Pending client attempts
live only in page memory. The next small slice is signed Discord gameplay
interactions calling these same authoritative services.

### Local Docker verification

`docker compose config --quiet` and `docker compose up --build -d` passed.
The app applied migration 0008 and starts successfully. Before/after anonymous
fingerprints matched for accounts, linked identities, all prior realm rules and
revisions, memberships (gems, XP, cooldowns), catalog, packs, original card
records, openings, recyclings, gem/XP ledgers, upgrades, wishlist entries/change
receipts, and settings audits. Only the new trading defaults, realm trade IDs,
and original-owner fields were excluded from those comparisons.

Read-only checks confirmed eight migrations, config v6/default trading rules,
original ownership preserved, trade IDs present, reconciled wallet/XP totals,
empty live trade/transfer tables, HTTP 200 startup, and HTTP 401 for anonymous
trade requests. No live offers or gameplay operations were created for
verification; no private account values or secrets were displayed. Refresh
the local website and open **Trades** to use the feature.

## Milestone 3B: signed Discord pack commands (2026-11-04)

Implemented private `/atlas status`, `/atlas packs`, and reviewed `/atlas open`
commands through `POST /api/discord/interactions`. The adapter verifies Ed25519
over timestamp plus raw bytes, limits body size/read time, checks timestamp
freshness and application ID, and resolves the invoking server and existing
Discord identity to an authorized realm member. No command silently creates an
account or membership. Replies are ephemeral, disable mentions, and omit account
emails, provider credentials, and other players' collections.

Pack opening starts with a ten-minute actor/server/realm/pack/config-revision
review. Its stable UUID is the normal opening request key. Confirmation invokes
the same `openPackInTransaction` used by the website, under the same realm lock.
Repeated delivery/clicks and concurrent equivalent web calls share one receipt
and debit. Price increases/config edits require a fresh review; newly purchased
discounts may lower the quoted maximum. Current balance, pool, cooldown,
ownership, wishes, and XP remain authoritative in the existing service.

Realm admins can link/unlink one Discord server per realm on the website.
Unlink/relink invalidates old reviews using a new binding UUID; a no-op link keeps
reviews valid. The additive `0009_discord_interactions.sql` migration adds server
bindings and transient reviews without altering existing gameplay records.
Encrypted backups recognize revisions 0001–0009 and preserve server bindings;
reviews are excluded and restart after recovery. Opening receipts remain durable.
Config/player archive versions remain v6. Reviews more than one day past expiry
are cleaned on a later review in the same realm and may remain in inactive realms.

Added protocol/service/registration modules, a dedicated HTTP route, a small
realm-admin setup panel, the `pnpm discord:commands` operator script, optional
`DISCORD_PUBLIC_KEY` in `.env.example`/Compose, tests, and the step-by-step
[operator guide](deployment/discord-gameplay.md). Registration uses existing
application credentials and upserts only `/atlas` in the requested server; it
is never run automatically. No dependencies were added. The private `.env` was
not read or edited, and no live Discord commands or messages were sent.

Discord work uses a separate four-client pool with bounded connection/SQL
timeouts and a 1,700 ms client deadline that destroys a stalled transaction
connection. This leaves time for an initial synchronous response without a
worker, continuation token, or background request task. Transaction cleanup
discards failed clients and preserves the original error if rollback fails.
An uncertain commit is safe to retry with the same review key. Slow deployments
must monitor actual end-to-end latency; large deferred jobs remain a future adapter.

Verification (all passed):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 52 unit tests passed. |
| `pnpm test:integration` | 117 real PostgreSQL integration tests passed. |
| `pnpm build` | Production build passed, including the dedicated interaction route. |
| `pnpm test:e2e` | Desktop/mobile production browser checks passed. |

Commands used the ignored local pnpm wrapper described in Milestone 3A. The 11
new unit checks cover exact raw-body signing, wrong/stale signatures and app IDs,
disabled/malformed/oversized/timed-out requests, guild identity parsing, command
schemas, private replies, deterministic keys, and fixture-only registration.
The 19 new PostgreSQL checks cover binding RBAC/uniqueness, admission/scope,
private reads, free reviews, participant binding, concurrent retries and web
calls, last-character races, changed prices/discounts, free failures, expiry,
relinking, lock/statement/transaction/client deadlines, pool recovery, fresh
restore, and migration/restoration from the preceding trading release.

The browser suite signs local fixtures against the actual production route,
rejects a bad signature, acknowledges PING, reviews/confirms/replays one opening,
then verifies the web card and balance. It also links/unlinks through the admin
panel, checks CSRF, and inspects desktop/mobile layout. Screenshots contain only
fictional fixtures and were visually reviewed. An existing settings retry check
caught a duplicate React sibling key introduced by the new panel; its key is
now namespaced, and the complete browser suite passes including that retry.
No automated test calls Discord's live APIs or uses the live game database.

Live activation still requires an operator-configured public HTTPS endpoint,
the application's public key, server installation/linking, and explicit command
registration. Localhost alone cannot receive Discord's server-to-server interaction requests. There are
no Discord trade/recycle/upgrade/wishlist commands, direct messages, automatic
server-based realm admission, member-name lookup, or Gateway bot in this slice.
The next small slice is member profiles/recipient search, followed by the
configurable affiliation policy recorded in the Discord access notes.

### Local Docker verification

`docker compose config --quiet` and `docker compose up --build -d` passed.
Migration 0009 applied and the web service returned HTTP 200. Before/after
anonymous fingerprints matched for all 21 existing persistent gameplay/account
tables, including complete trade/version/confirmation/reservation/transfer/retry
history, settings audits, cards, wallets, XP, wishes, ranks, and linked identities.
Config remains v6 and wallet/XP totals reconcile. No existing columns or rules
were excluded from these comparisons.

The new binding/review tables are empty. Read-only HTTP checks confirmed that
anonymous binding changes return 401 and the interaction endpoint returns 503
with the public key unset. No live server was linked, no real command was
registered, and no gameplay action was performed for deployment verification.
Private account values and credentials were not displayed. Refresh the local
website to access **Discord gameplay**; follow the operator guide when ready
to connect an actual server.

## Milestone 3C: private Discord-name member search (2026-11-04)

Delivered a searchable, paginated realm-member picker inside **Trades → Start
a trade**, replacing the need to copy a recipient code for named players.
Results show cached Discord display name/username and a stable realm trade ID;
selection is explicit and keyboard accessible. The ID remains the command's
recipient key. Duplicate names, renamed profiles, and stale browser state cannot
redirect an existing offer. Manual code entry remains available for local or
unnamed accounts and lookup failures. Existing trade rows display cached names
alongside their counterpart codes.

Verified OAuth `/users/@me` responses now provide optional username/display-name
metadata after the existing ID/link/invitation checks. Names are normalized,
bounded, and stripped of invisible/control formatting. Optional invalid or
missing metadata does not prevent a verified identity login or erase a prior
cached profile. Credentials, avatars, and provider emails remain discarded;
names never authenticate, grant membership, or merge accounts. A sign-in notice
explains that names are visible to other members of the player's realms.
Existing users refresh names by signing in with Discord again once.

Added `0010_member_profiles.sql`, a profile/cache and realm-lookup service,
authenticated `GET /api/members`, a member picker, counterpart labels, profile
fields in the realm view, fixture OAuth metadata, tests, and the
[member guide](gameplay/members.md). No dependency, environment variable, provider
scope, bot, image request, or live roster import was added. The private `.env`
was not read or edited. The original trade service and asset semantics remain
unchanged.

Lookup requires the caller's membership in the requested realm even for instance
admins. The caller is excluded. Responses contain only trade code and nullable
names, use private/no-store caching, and cap HTTP pages at 20. Stable code cursors
bound pagination; name search uses Unicode composition normalization and literal
case-insensitive substrings, so SQL wildcard/injection text cannot broaden the
query. The client aborts stale requests, clears a selection on search changes,
offers lookup retry, and continues to support pasted IDs. There is no public or
cross-realm directory, account/provider ID exposure, wallet/collection listing,
manual profile-write endpoint, or slash-command profile refresh.

Config remains **v6**. Player archive **v7** adds only the exporting player's
nullable cached profile and refresh time; older readers retain v1–v6 information
without invented names. Other players' cached names stay out of personal
archives. Encrypted backup envelope v1 supports migrations 0001–0010 and preserves
profile timestamps and identity references. Restore validates canonical fields
and rolls back corrupt profiles atomically; older snapshots start without names.

Verification (all passed):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 56 unit tests passed. |
| `pnpm test:integration` | 130 real PostgreSQL integration tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Desktop/mobile production browser checks passed. |

Commands used the existing ignored local pnpm wrapper. Four new unit tests
cover normalized/invalid names, provider-field minimization, and optional
metadata failure. Thirteen new PostgreSQL checks cover local fallbacks, atomic
profile refresh, denied admission, realm isolation, minimal responses, literal
search/Unicode composition, pagination bounds, duplicate/renamed identities,
trade-boundary authorization, own-only archive v7 and legacy v6, fresh recovery,
corrupt profile rollback, and migration/restoration of the preceding release.
The Unicode corruption test exposed Windows' default WIN1252 test-cluster
encoding; disposable PostgreSQL now explicitly initializes UTF-8 to match the
Compose reference, and the full suite passes with Unicode fixtures.

The browser suite refreshes a linked player's names through the actual fixture
OAuth callback, searches, handles an empty result and failed lookup/retry,
selects a recipient with Space, checks the stable submitted code and minimal
no-store API response, rejects anonymous/out-of-realm lookup, and completes the
existing two-party trade flow. Desktop/mobile screenshots were visually
inspected and contain fictional fixtures only. Tests make no live provider calls
and never connect to the live game database.

Limits: names reflect the last successful Discord sign-in, not a live roster.
Profile records persist with their linked accounts; deletion/retention tooling
remains future work. There are no avatars, server nicknames, local aliases,
manual profile edits, or automatic polling. Realm admission is still invite-only.
The next small slice is the configured Discord affiliation-based admission policy
already recorded in the access notes.

### Local Docker verification

`docker compose config --quiet` and `docker compose up --build -d` passed.
Migration 0010 applied; PostgreSQL uses UTF-8 and the website returned HTTP 200.
Anonymous lookup at `/api/members` returned 401. The new profile table is empty,
confirming no names were guessed or fictional fixtures installed in the live app.

Before/after anonymous fingerprints matched for all 22 existing persistent
account/gameplay/server-binding tables, including wallets, XP, complete trade
history, settings audits, wishes, ranks, identities, and card provenance. Config
remains v6 and wallet/XP totals reconcile. No existing fields were excluded from
the comparisons. No live account was signed in or gameplay action performed for
verification, and no private data or credentials were displayed. Refresh the
website and use **Trades → Start a trade**. Linked players populate their names
through their next **Continue with Discord** sign-in.

## Milestones 3D and 4A: verified joining and scheduled preservation (2026-11-04)

Completed the interrupted Discord admission slice (3D), then delivered the next
preservation/deployment slice (4A). See [realm joining](gameplay/admission.md)
and [scheduled backups](deployment/scheduled-backups.md). The private `.env` was
not read or edited; Docker consumes its existing settings internally. No real
Discord request, message, command registration, or live gameplay write was
performed for verification.

### Verified server joining

Realm admins can choose **Invitation only** or **Members of linked Discord
server** under **Realm joining**. The latter provides a copyable public join
link. Its page deliberately reveals only realm name and required server ID.
Ordinary sign-in remains invitation-based. Only an explicit join flow adds
`guilds.members.read` to `identify` and checks the current user's membership in
that one server. The returned user must match the verified identity and have
completed screening. Tokens, roles, full membership responses, and unrelated
server data are discarded. No bot token or roster scan is needed.

Migration `0011_discord_admission.sql` adds versioned policies, admin change
receipts, and player admission receipts. One-time browser-bound OAuth state
binds realm/code/revision/server. The login transaction takes the existing
identity and realm locks, checks proof freshness after obtaining the realm lock,
then commits account/identity, membership, one starting grant, receipt, optional
profile, and session together. Repeats and invitation races cannot repeat grants
or gain admin privileges. Matching names/emails never merge accounts; existing
local accounts must first be explicitly linked by the operator.

Policy saves enforce realm-admin membership, expected revision, and durable
request-key receipts. Lost responses offer a same-key retry. Closing or changing
joining invalidates pending flows; disable it before unlinking/replacing the
active server. Re-enabling creates a fresh link. Explicit invitations and local
realms remain supported. This controls joining: existing members retain access,
permissions, and progress after leaving Discord or closing/unlinking the server.
Continuous affiliation enforcement, role gates, and revocation tooling remain
future work. Migration enables no existing realm automatically.

Config remains **v6**. Player archive **v8** adds the player's own nullable
admission receipt, excluding raw provider user IDs and other players' receipts.
Readers retain v1-v7 information. Encrypted envelope v1 now supports migrations
0001-0011. Restore validates policy revision chains, receipts/fingerprints,
bindings, historical admission policy, and matching starting grants. Older
snapshots restore invitation-only without invented policies/receipts.

Six new unit and eighteen PostgreSQL tests cover minimal permissions/data,
membership/screening rejection, policy RBAC/retries, target-bound OAuth, identity
reuse, concurrency/grant races, stale proof/policy, link rotation, preserved
access, transaction rollback, own archives, fresh recovery/corruption, and
preceding-release migration/restore. Browser checks exercise actual HTTP/cookie
navigation through fixture consent, lost-response settings retry, a new player,
nonmember rejection, preserved spending/cards on rejoin, closed links, RBAC,
and mobile layout. Screenshots contain fictional fixtures and were visually
inspected. Real Discord consent still requires the configured application/user.

### Independent scheduled backups

Added `apps/worker` and root commands `backup:init`, `backup:run`, `backup:worker`,
and `backup:status`. Deployment policy v1 defaults to 03:00 UTC, seven daily
generations, and four Monday-based weekly generations. After downtime it captures
the latest due day, without inventing missed history. Existing manual encrypted
backup/restore commands remain usable. No runtime dependencies were added.

A destination interface isolates scheduling from storage. The first adapter uses
an explicitly initialized, dedicated namespace on a mounted filesystem outside
the repository; a remote mount is an operator choice. A marker prevents silent
initialization of an empty replacement mount, and Compose never creates missing
host paths. Private encrypted temporary files are flushed and exclusively linked
to final names without overwrites. POSIX directory entries are synced. A session
advisory lock excludes overlap. Retries authenticate/complete daily and weekly
output before retention. Corruption, changed keys, and backwards clocks fail
closed. Unrelated files and incomplete temporary files are untouched.

The passphrase is read from a separate private file outside the repository and
backup destination. The optional Compose entrypoint stages its read-only source
on a private tmpfs with mode 600, handling Windows Docker Desktop's synthetic
bind-mount permission bits without weakening normal host checks. Secret values
never enter arguments, the image, status, snapshot fields, or logs. Generic
status contains only outcome, attempt/success times, scheduled date, and counts.
Missing/failed or 36-hour-stale status fails CLI/Docker health. Job failures retry
each minute; a supervisor handles startup failures.

Four unit and twelve PostgreSQL/filesystem tests cover policy/UTC boundaries,
health, initialization, key/path/symlink boundaries, encrypted publication,
byte-for-byte retry, concurrent exclusion, catch-up/retention, partial failure,
wrong keys/corruption/backwards clocks, unrelated files, fresh restore with stable
player exports, and actual noninteractive CLI execution.

The optional `pnpm test:backup-docker` uses the built image and new isolated
PostgreSQL/worker containers on an internal network. It tests a real read-only
key mount, private tmpfs, initialization, encrypted capture/retry, running worker
health, and recovery to a second fresh database. It does not load `.env`, publish
host ports, pull images, or touch live data. Fixture containers, volumes, network,
and private temporary files are removed afterward.

Limits: the operator prepares any remote mount and alerting. Direct cloud/S3
uploads, automatic mounting, managed alerts, immutable storage, automated restore
drills, and a separate cloud deployment example remain planned. Snapshots still
load into memory. Health/authentication checks do not replace an off-machine
restore drill. The worker remains disabled in base Compose; no live backup
passphrase or destination was created.

### Final verification

Commands used the existing ignored local pnpm wrapper. All passed:

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root, worker, and web TypeScript passed. |
| `pnpm test` | 66 unit tests passed. |
| `pnpm test:integration` | 160 disposable PostgreSQL integration tests passed. |
| `pnpm build` | Production build passed, including the public join route. |
| `pnpm test:e2e` | Production desktop/mobile flows passed. |
| `pnpm test:backup-docker` | Isolated Docker worker and fresh restore passed. |
| `docker compose config --quiet` | Base passed; optional two-file configuration also validated with example paths. |
| `docker compose up --build -d` | Local rebuild, migration 0011, and startup passed. |

Docker Desktop was stopped at resumption and was started for verification.
Before migration, anonymous server-side fingerprints were captured for all
**23 existing persistent tables**. All fields/rows match afterward, with none
excluded. Wallet/XP totals reconcile, PostgreSQL is UTF-8, config remains v6,
and migration count advanced from 10 to 11. New policy/audit/admission tables
remain empty, preserving invitation-only defaults. The website returned HTTP
200, anonymous admission settings returned 401, and an invalid join page explains
its unavailable link. No live account or private record was displayed or used
for gameplay verification.

## Milestone 4B: isolated automated restore verification (2026-11-04)

Added optional weekly restore checks for encrypted backups, with an explicit
manual check, independent recovery health, and a [Docker/host setup guide](deployment/restore-checks.md).
The checker creates a new temporary PostgreSQL database, migrates it, restores
the selected snapshot, compares its saved fields, and removes the database.
Only completion of all these steps records success. No live restore check or
new operator secret/destination was configured. The private `.env` was not read
or edited; Docker consumes existing settings internally.

The worker has no game `DATABASE_URL` fallback. Its separately configured control
database must be named exactly `card_engine_restore_control`; query options that
could redirect generated targets are rejected. Initialization requires a pristine
database, creates versioned control metadata, and binds it to the backup instance
ID. Existing unrelated objects or another instance's marker are rejected. The
optional Compose overlay places PostgreSQL and the checker on their own internal
network, with no game network connection or published port. The cluster uses a
disposable 1 GiB tmpfs; its statement/row error logging is suppressed.

Each attempt reserves an unpredictable database name, creates it from template0,
revokes public access, and attaches an exact job ownership marker before restoring
private data. Cleanup requires a registered matching name/job ID, current owner,
and exact marker. It does not delete arbitrary matching prefixes. Interrupted
owned databases are cleaned on the next run, even when that week already has a
successful receipt. Ambiguous or changed ownership fails closed; the guide explains
operator inspection/reinitialization on the separate restore service. The live
game database and volume are never cleanup targets.

The existing restore service still validates migrations, constraints, wallet/XP,
ownership/trading, settings, profiles, and admission history. Added a read-only
source-field comparison using PostgreSQL-typed record sets and multiset equality.
It preserves timestamp microseconds across session timezones and compares stable
IDs and all recorded fields. Legacy realm configurations are normalized through
the existing migration path; fields/IDs absent from older snapshots are not
invented for comparison. Discarded sessions, OAuth flows, login limits, previews,
and Discord reviews must be empty. No app migration was added: schema remains
0011, config v6, player archive v8, and encrypted backup envelope v1.

Deployment policy v1 defaults to Monday 04:00 UTC and snapshots captured within
36 hours, with five-minute future clock tolerance. Weekly runs skip an already
verified period; explicit manual runs always recheck. An advisory lease excludes
overlap. Job failures retry each minute. Missing/failed recovery status or no
success in eight days fails its separate CLI/Docker health check. Generic
`restore-status.json` retains outcome, attempt/success times, weekly period, and
the verified encrypted file digest/capture time. No database names, account data,
URLs, keys, or decrypted payload enter status or CLI output. Backup capture status
and retention are unchanged.

Added `backup:verify:init`, `backup:verify`, `backup:verify:worker`, and
`backup:verify:status`, an optional three-service Compose overlay, typed policy/
status/control services, comparison helpers, configuration examples, and privacy/
recovery documentation. No runtime dependency was added. The existing optional
Docker test now creates a separate restore PostgreSQL service and network and
checks the actual verifier entrypoint, private tmpfs key staging, recovery,
temporary database cleanup, and running verifier health.

Four unit and sixteen new PostgreSQL tests cover policy/UTC boundaries, URL
redirection rejection, status consistency/staleness, explicit control setup,
actual recovery/comparison/cleanup, weekly retries/manual runs, overlapping jobs,
missing/corrupt/stale/future snapshots, wrong keys and retained last success,
authenticated ledger corruption, interrupted owned checks, public access removal,
unmarked/unregistered databases, unrelated control objects, weekly fallback,
timezone comparisons, transient state, legacy migration, and the actual CLI using
only its dedicated URL. Tests use fictional fixtures and separate disposable
servers. A timing-sensitive future-clock fixture was corrected to use the
snapshot's capture time; all checks pass.

Verification (existing ignored local pnpm wrapper):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root, worker, and web passed. |
| `pnpm test` | 70 unit tests passed. |
| `pnpm test:integration` | 176 PostgreSQL tests passed; the 16 restore checks also passed after the final public-access safeguard. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Existing production desktop/mobile flows passed. |
| `pnpm test:backup-docker` | Encrypted capture, separate automated recovery, cleanup, and worker/verifier health passed. |
| `docker compose config --quiet` | Base and three-file optional configuration passed with example paths/secrets. |
| `docker compose up --build -d` | Local image rebuild and startup passed. |

Before/after anonymous server-side fingerprints matched for all **26 persistent
game tables**, with no fields excluded. The migration count remains 11 and the
website returned HTTP 200. No live player was signed in, no gameplay write or
real Discord call was made, and no private record or credential was displayed.
The live app has no restore-check service enabled. Fixture Docker containers,
volumes, networks, and private temporary files were removed after verification.

Remaining limits: this verifies the selected snapshot with the configured release,
key, and restore PostgreSQL service. Off-machine operator drills are still needed
to prove disaster access to secrets, the destination, and website deployment.
Large snapshots may exhaust the example tmpfs or in-memory snapshot processing.
Tmpfs may use host swap; host storage protection remains an operator concern.
If only the disposable database restarts while the checker remains running,
rerun its safe initialization command. Direct cloud uploads, managed alerts, and
a separate cloud deployment example remain planned. There is no automatic restore
into a live economy.

## Milestone 4C: portable HTTPS hosting and deployment health (2026-11-04)

Added an opt-in Caddy reverse-proxy overlay and a [generic Linux/VPS guide](deployment/https.md).
The recipe keeps PostgreSQL persistent, its host port unpublished, and the app's
existing port bound to loopback. A separate offline settings check requires one
lowercase DNS hostname, its exact HTTPS application origin, and secure cookies
before public proxy ports start. Certificate/config data use persistent proxy
volumes. No hosting vendor, source integration, or provider-specific core logic
was added. The base local deployment remains HTTP on localhost.

The proxy retains raw request bodies, configured-origin OAuth redirects, existing
authorization, and retry boundaries. It does not configure write retries. It
sets one-day HSTS without subdomain/preload options, disables its admin API, and
provides bounded upstream/header timeouts and shutdown grace periods. Access
logging is off; runtime logs filter request objects and URI fields to keep failed
callback codes/state, cookies, and bearer headers out of error logs. Tested the
published `caddy:2.11-alpine` image, which reported v2.11.7 during verification.

Added anonymous, uncached `GET /api/health/live` and `/api/health/ready` responses.
Liveness checks HTTP handling only. Readiness reads this release's exact migration
names with a dedicated one-connection pool, bounded connection/lock/statement/
client query timeouts, and one shared in-flight query for concurrent probes.
It returns only `{ok:true}`/200 or `{ok:false}`/503. It reads no account/gameplay
fields and exposes no connection errors, schema names, credentials, or versions.
The release migration-name list is now shared with backup compatibility; a test
checks it against actual SQL migration files. Readiness does not establish
migration-checksum, ledger, provider, or backup integrity. Base Compose now probes
readiness, and proxy startup depends on it becoming healthy.

The TLS fixture exposed an existing response-header problem: Next.js's general
referrer policy overrode the callback's stricter route response. Added a specific
callback header rule after the general rule so `no-referrer` reaches the client.
Added an idle-error handler to the ordinary PostgreSQL pool so a database restart
discards failed idle clients rather than crashing the HTTP process; query errors
still reach callers. The actual outage check verifies liveness, readiness failure,
recovery, and a fresh successful login through the gameplay pool afterward.

Added `deployment:check` and `test:https-docker`, typed settings validation,
five unit tests, eight PostgreSQL tests, deployment/privacy notes, and environment
examples. No Node runtime dependency or game migration was added. Migration count
remains 11, realm config v6, player archive v8, backup envelope v1. The operator's
private `.env` was not read or edited; Docker consumes existing settings internally.

Unit checks cover hostname injection/listener changes, exact origin, secure-cookie
requirements, minimal returned settings, and actual offline CLI privacy. Database
checks cover manifest agreement, readiness before bootstrap, missing/old/extra
migrations, denied schema access, lock timeouts/recovery, 50 concurrent probes,
unavailable TCP, and minimal liveness/readiness responses. A pre-existing signature
boundary fixture used elapsed wall time relative to an older rounded timestamp;
its invalid clock values now derive from that timestamp for deterministic tests.
Authentication timing rules were not changed.

The new Docker test uses the built app and the actual proxy snippets with a
fixture-only local certificate authority. A client container on the same internal
network verifies certificate trust without disabling verification. It tests HTTP
redirects, HSTS, secure/HttpOnly/SameSite cookies, authenticated export and anonymous
denial, Origin rejection, HTTPS OAuth callback configuration, spoofed forwarding
headers, callback referrer policy, signed raw PING, database outage/reconnection,
and an upstream failure with request canaries absent from proxy logs. No host
ports are published, no `.env` is loaded, no images are pulled by the test, and no
public DNS, ACME, or Discord request is made. Fixture resources are removed.

Final verification used the existing ignored local pnpm wrapper. All passed:

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 75 unit tests passed. |
| `pnpm test:integration` | 184 real PostgreSQL integration tests passed. |
| `pnpm build` | Production build passed with the health route. |
| `pnpm test:e2e` | Existing production desktop/mobile flows passed. |
| `pnpm test:https-docker` | Trusted local TLS, auth, signatures, outage/recovery, and privacy passed. |
| `pnpm test:backup-docker` | Encrypted capture, separate restore verification, cleanup, and health passed. |
| `docker compose config --quiet` | Base configuration passed; the HTTPS overlay also resolved correctly with example settings. |
| `docker compose up --build -d` | Local image rebuild/startup passed; web is healthy. |

Anonymous server-side before/after fingerprints matched for all **26 persistent
game tables**, with no fields excluded. No live-player sign-in, gameplay write,
or real Discord request was used for verification. Local liveness/readiness both
returned HTTP 200 with minimal uncached bodies. The default deployment has no
proxy enabled, no new public listener, and unchanged private environment settings.

Limits: this is a locally tested deployment recipe, not a provisioned remote host
or a public certificate issuance test. DNS, firewall reachability, ACME, offsite
durability, and monitoring still need operator verification. Docker health does
not automatically restart unhealthy containers, and this single-host recipe does
not promise zero downtime. Direct cloud backup uploads and managed alerts remain
planned. Public account recovery/deletion and perimeter abuse controls are still
outside this prototype slice.

## Milestone 4D: encrypted S3-compatible offsite copies (2026-11-04)

Added an optional worker that copies retained encrypted local snapshots to an
explicitly configured private S3-compatible bucket. It conditionally creates each
object and reads it back byte-for-byte before recording success. A separate
authenticated download command publishes a new encrypted recovery file for the
existing fresh-database restore path. See [offsite setup and recovery](deployment/offsite-backups.md).
Local capture, its retention, and normal gameplay remain independent.

The adapter uses the official `@aws-sdk/client-s3` package (installed v3.1161.0),
with a lockfile update. It requires an explicit HTTPS API endpoint, region,
bucket, dedicated prefix, and credentials from a separate bounded private JSON
file outside the repository/capture directory. Ambient AWS environment/profile/
machine-role discovery is not used. The SDK receives explicit credentials and
quiet logging, bounded requests, and SHA-256 upload checksums. Response bodies
are size- and time-bounded. The existing backup encryption format is unchanged;
only ciphertext and minimal namespace/probe metadata are sent to storage.

Initialization tests conditional-write behavior on a new random control object
before creating/verifying the namespace marker. A provider that ignores
`If-None-Match` is rejected before any snapshot upload. Probe objects remain
because this adapter requests no deletion. Existing identical generations are
accepted on retry; conflicting content fails without overwrite. A lost response
after a remote commit is recovered by retrying the immutable key. No bucket
creation, listing, public ACL, automatic deletion, or lifecycle API is called.

The copy worker shares capture's PostgreSQL lease so local retention cannot
remove an input mid-copy. It authenticates snapshots one at a time, hashes their
contents, and rechecks a generation's digest before upload. A successful proof
for unchanged source digests and the same destination avoids repeated cloud
requests while keeping the original success timestamp. Explicit manual runs
always recheck storage. Polling is every five minutes. Copy failures preserve
last-success metadata but remain unhealthy, without changing capture status.

Added local `remote-status.json` with only version, outcome, times, source/
destination digests, latest capture time, and generation count. It contains no
raw remote address, bucket, object key, user data, URL, passphrase, or credentials.
Health requires a recent healthy capture and matching successful copy proof
within 36 hours. Status describes a past copy, not continuous provider access or
database-semantic validation. Restore checks and operator disaster drills remain
necessary.

The download command checks the remote namespace and authenticates the encrypted
archive before publication. It requires a new absolute private recovery path
outside the repository and capture directory, refuses overwrites, uses a flushed
private temporary file, and publishes exclusively. It needs no live game database
and never restores into a live economy. The guide covers rebuilding local
filesystem metadata after a lost capture directory, retaining original remote
namespace/key information, and choosing a new prefix for a new capture timeline.

Added `backup:remote:init`, `backup:remote`, `backup:remote:worker`,
`backup:remote:status`, `backup:remote:fetch`, an optional Compose overlay,
versioned policy/status schemas, private-file loading, SDK adapter, copy/download
services, environment examples, and recovery/privacy documentation. The Docker
entrypoint stages storage credentials and the encryption passphrase separately
on private tmpfs, including Windows bind mounts. The private `.env` was not read
or edited. No real bucket, credentials, cloud API operation, or lifecycle policy
was configured. Schema remains 0011, realm config v6, archive v8, envelope v1.

Six new unit tests exercise strict settings, actual SDK signing/conditional/
checksum requests, unsupported providers, conflicts, corrupt read-back, byte/path
bounds, denied/missing objects, and target-aware health. Ten new PostgreSQL tests
cover retained generation copies, independent metadata, unchanged-source caching,
capture-lease exclusion, lost-commit response/retry, conflicts, healthy capture/
correct key requirements, preserved last success, private credentials, and a
downloaded snapshot restored to fresh PostgreSQL with stable player exports.
The SDK annotates credential objects internally; fixtures clone their supplied
credentials so those annotations cannot contaminate later JSON inputs.

The Docker backup test now runs the actual remote CLI/container entrypoint with
a test-only storage preload, checks both private-file staging paths, initializes,
copies, checks status, downloads, and restores the result into another fresh
database. This complements the actual SDK protocol fixture; it does not test a
real provider. All fixtures use original demo data and local/disposable resources.

Verification (existing ignored local pnpm wrapper; all passed):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 81 unit tests passed. |
| `pnpm test:integration` | 194 real PostgreSQL integration tests passed; the final 16 transport/copy checks also passed after checksum tightening. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Production desktop/mobile flows passed. |
| `pnpm test:https-docker` | Trusted local TLS/auth, outage/recovery, and proxy privacy passed. |
| `pnpm test:backup-docker` | Capture, offsite CLI copy/download/recovery fixtures, isolated restore checks, and health passed. |
| `docker compose config --quiet` | Base passed; the optional offsite configuration also resolved with example paths/settings. |
| `docker compose up --build -d` | Local rebuild and startup passed. |

Before/after anonymous fingerprints matched all **26 persistent game tables**,
with no fields excluded. Migration count remains 11. No live-player sign-in,
gameplay write, or real Discord/cloud call was used for verification. The local
app remains on localhost and offsite copying remains disabled. Fixture resources
were removed afterward; no real credentials or user data were displayed.

Limits: compatibility, HTTPS trust, least-privilege permissions, billing, lifecycle,
durability, and disaster access must be verified on the operator's chosen provider.
Remote retention/deletion, managed alerts, streaming large snapshots, and automatic
restore drills directly from cloud objects remain future work. Storage credentials
are loaded at worker startup; rotation requires restart/recheck. Read-back preserves
encrypted bytes and does not establish economy/ledger consistency. No default cloud
account or hosting dependency is required to play or run core tests.


## Milestone 4E: independent backup failure/recovery alerts (2026-11-04)

Added an opt-in monitor reading generic capture/restore/offsite proofs, a private
HTTPS receiver file, transactional local SQLite observations/outbox, FIFO retries
with stable UUIDs and delivery leases, bounded requests, generic logs, and an
optional Compose service with read-only captures and persistent local state.
It requires no game database, encryption key, or cloud credentials. Healthy
baselines stay quiet; unhealthy transitions and recovery produce versioned
JSON. Receiver-side deduplication is required. No actual receiver was configured
or notified. Local runtime minimum is now Node 22.13+ for built-in SQLite; the
reference image remains Node 24. Schema 0011/config v6/archive v8/envelope v1
remain unchanged.

Connection acquisition/advisory-lock failures now persist failed capture,
restore-check, and offsite proofs immediately, preserving the last good proof.
Nine new unit/SQLite tests cover private settings, missing captures, state binding,
transition deduplication, restart/FIFO retries, concurrent claims, abandoned leases,
stale acknowledgement, queue bounds, corrupt/missing/stale status, generic HTTPS
payloads, and all three workers with a closed PostgreSQL pool. The Docker suite
runs the actual monitor entrypoint in separate short-lived containers, with a
persistent named state volume, Windows-compatible private receiver staging, no
network, no database URL/key, and a test-only receiver preload. It verifies a quiet
healthy start and exactly one failure/recovery sequence across restarts.

All checks passed using the ignored local pnpm wrapper:
`pnpm lint`, `pnpm typecheck`, `pnpm test` (90), `pnpm test:integration` (194),
`pnpm build`, `pnpm test:e2e`, `pnpm test:https-docker`,
`pnpm test:backup-docker`, and `docker compose build web`.

Limits: SQLite state needs a private persistent local disk. Generic HTTPS JSON
requires a compatible receiver; Discord webhooks need a format adapter. Delivery
is at least once and one pending event is attempted per minute. Queue size is
100; transitions during a prolonged full queue may be missed. Monitor health
reports observation/delivery, independently of backup health. An external
supervisor must detect monitor absence/startup failures. Provider credentials,
actual notification delivery, remote retention, and cloud restore scheduling
remain operator setup or future work. See deployment/backup-alerts.md.


## Milestone 5A: reviewed original JSON catalogs (2026-11-04)

Instance admins can now choose the original demo or upload an original JSON v1
catalog when creating a realm. The form loads a bounded file, requires a content
rights attestation, previews source/license/revision, assigned character tiers,
generated packs/pools, playability, and initial first-draw odds, then confirms
creation. Form edits invalidate the preview; fields are disabled during requests.
Character/pack tables support keyboard scrolling and mobile layouts. Existing
realm content and gameplay values are untouched.

Preview and installation share validation, tier calculation, pack generation,
and a digest of the parsed catalog and complete settings. Both services enforce
instance-admin RBAC; the custom install requires the matching reviewed digest.
Installation remains one transaction for realm, admin membership/starting grant,
characters/provenance, and packs. Custom installs are bounded to 1,000 entries;
HTTP bodies are limited to 2 MiB only for authenticated instance-admin catalog
preview/creation. Other writes retain 16 KiB limits. Source/key length bounds
were added to the strict JSON v1 validator. A rank map replaces repeated searches
without changing percentile/tie-break semantics. No API/provider or artwork is
fetched. No new dependency, environment option, migration, config/archive version,
or existing-realm catalog mutation is needed.

Four new unit tests cover review content/odds, deterministic IDs and digest
binding, rights/format/duplicate/pool failures, and upload limits. Six new real
PostgreSQL tests cover service RBAC, missing/stale reviews, installed provenance,
realm isolation, rollback after an injected mid-install database error, and an
encrypted snapshot restored and compared in a fresh database. Extended browser
checks exercise invalid JSON, file upload, required attestation, original preview,
character inspection, mobile width, edits invalidating the review, actual custom
realm creation with stable IDs, missing-review rejection, oversized bodies,
and player denial for both endpoints. Existing demo/game/social flows also pass.

Verification after this slice (all passed; local ignored pnpm wrapper used):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 94 unit/SQLite tests passed. |
| `pnpm test:integration` | 200 real PostgreSQL tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Original upload/review/creation plus existing desktop/mobile flows passed. |
| `docker compose build web` | Production Node 24 image built with frozen lockfile. |
| `pnpm test:backup-docker` | Capture, offsite/download/fresh recovery, isolated restore checks, monitor failure/recovery, and cleanup passed on the updated image. |
| `pnpm test:https-docker` | Trusted fixture TLS, secure auth/export, signed PING, readiness outage/recovery, and privacy passed on the updated image. |
| `docker compose --env-file .env.example config --quiet` | Base example resolved. |
| `docker compose --env-file .env.example -f compose.yaml -f infra/docker/compose.alerts.yaml config --quiet` | Optional monitor resolved using fictional absolute paths supplied only to that process. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Reused the identical tested Dockerfile image for the migration service. |
| `docker compose up -d --no-build --wait` | Updated local web/migration services; PostgreSQL and web healthy. |

Before/after anonymous ordered row fingerprints and counts matched all **26
persistent game tables**, with no fields excluded. Schema remains 0011, realm
config v6, archive v8, encrypted envelope v1. Anonymous localhost home/liveness/
readiness returned 200; catalog preview denied an anonymous request with 401.
No real account sign-in, gameplay change, external Discord/provider operation,
notification delivery, or cloud configuration was used to verify the update.
The private `.env` was neither read nor edited. Only base db/web services run;
optional preservation services remain disabled. Test containers/volumes/networks
created by the Docker checks were removed.

Limits: this is initial original JSON installation only. CSV, live catalog
merges/replacement, manual tiers, custom pack editing, provider adapters, and
animations remain future work. Rights are an administrator attestation, not
independent verification. Raw source JSON/numeric popularity scores are not
retained as a separate import archive; keep the original file. Initial review
odds change as claims, multi-card draws, and wishlists affect availability.
Realm creation still has no idempotent retry receipt: check the realm list after
an ambiguous network failure before trying again. Existing economy receipt
safety remains unchanged. See content/catalog.md and deployment/backup-alerts.md.


## Milestone 5B: original CSV catalog uploads (2026-11-04)

Added original UTF-8 comma-separated CSV as an alternative initial catalog for
new realms. The same admin form now offers CSV, a downloadable blank header
template, separate source/revision/permission fields, strict UTF-8 decoding,
rights attestation, and the shared character/tier/pack/odds review. Changing
metadata, format, content, or settings invalidates the review. File reads use
functional state updates so completing a read cannot overwrite newer metadata
or checkbox edits. The client checks serialized request size because escaping
CSV newlines/quotes can expand its JSON transport.

The importer uses MIT-licensed csv-parse 7.0.3 (workspace dependency and frozen
lockfile updated), following its official synchronous API/options documentation:
https://csv.js.org/parse/api/sync/ and https://csv.js.org/parse/options/ .
The adapter bounds raw text bytes, parser record size, and row count; handles
UTF-8 BOM, standard line endings, quoted commas/newlines/doubled quotes, and
exact headers in arbitrary order; and rejects the entire file on invalid input.
Categories use explicit pipe separators; blank popularity means unknown, while
nonempty popularity accepts only unsigned decimal safe integers. No automatic
ID/type/delimiter/source inference or malformed-row skipping is enabled. Errors
use fixed messages and record/field identifiers, never raw parser diagnostics or
submitted values.

JSON validation was moved behind the existing importer exports and its metadata
schema is shared with CSV. CSV then uses the same JSON v1 validation, percentile
assignment, pack generation, and transactional realm installation. Format plus
normalized content/settings bind the review digest. Both preview and creation
continue enforcing instance-admin access and explicit rights attestation in
services, with PostgreSQL realm scoping/unique ownership unchanged. Installed
provenance identifies original-csv-v1. Legacy JSON request shapes and the demo
remain supported. No migration, gameplay/config/archive version, environment
variable, or new hosting/service integration is required. The private .env was
not inspected or edited; .env.example needs no new setting.

Ten new unit tests cover equivalence to JSON, stable UUIDs/tiers/packs, BOM/CRLF/
quoting/Unicode, reordered headers, missing/duplicate/foreign/extra fields,
numeric and category failures, private-value error redaction, file/record/row
bounds, metadata/version/rights/review binding, and a valid 1,000-character CSV
whose JSON-wrapped request exceeds the transport limit. Five PostgreSQL tests
cover admin RBAC, atomic rejection, installed identities/provenance and playable
retries, realm isolation, stale content/metadata/config/format reviews, injected
mid-write rollback, and encrypted restore/comparison in a fresh database.

Browser coverage now includes CSV selection, UTF-16 rejection, malformed-file
errors without value reflection, source/revision/permission inputs, the actual
header-template download, UTF-8 BOM/CRLF upload, mobile layout, metadata edits
invalidating the preview, creation with stable IDs/provenance, missing/stale
review rejection, and player denial. The first full browser run exposed an
existing synchronization issue: the trade test clicked confirmation before its
requested refresh displayed the new offer version. The server correctly denied
the stale action. The test now waits for each displayed offer version and saved
first confirmation before the next action; trade implementation/guards are
unchanged. The complete browser rerun passed.

Verification (all final checks passed; existing ignored local pnpm wrapper used):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 104 unit/SQLite tests passed. |
| `pnpm test:integration` | 205 real PostgreSQL tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | JSON/CSV imports and all existing desktop/mobile gameplay/social/auth flows passed. |
| `docker compose build web` | Node 24 production image built with frozen lockfile and the new parser dependency. |
| `pnpm test:backup-docker` | Capture, offsite fixture recovery, fresh restore checks, durable alerts, worker health, and cleanup passed. |
| `pnpm test:https-docker` | Trusted fixture TLS/auth/export, signed raw interactions, readiness outage/recovery, and proxy privacy passed. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Shared the tested identical Dockerfile image with the migration service. |
| `docker compose up -d --no-build --wait` | Updated local services; database and web healthy. |

Anonymous before/after ordered row fingerprints/counts matched all **26 persistent
game tables**, without excluding fields. Schema remains 0011, realm config v6,
archive v8, envelope v1. Anonymous localhost home/liveness/readiness returned 200;
the live CSV header template matched exactly, and unauthenticated catalog preview
returned 401. No actual account login, gameplay write, provider/Discord/cloud
request, or notification delivery was used against the running app. Only the
base database/web services run. Docker test containers/networks/alert volumes
created by this verification were cleaned up.

Limits: initial original CSV installs only; no XLSX, UTF-16, semicolon delimiter,
literal pipe within a category, auto repair, source fetching, or live merging.
Use JSON for category labels containing pipes. The metadata schema is version 1,
with up to 1,000 characters and a 2 MiB complete request. Parser buffers have a
separate 16,384-unit record bound. Character definitions/provenance restore, but
the raw source file and numeric popularity scores are not a separate retained
archive. Rights are the administrator's attestation. Realm creation retains its
existing limitation: inspect the realm list after an ambiguous connection
failure before retrying. Custom pack editing, live catalog changes, provider
adapters, and animations remain future slices. See content/catalog.md.


## Milestone 5C: reviewed starter pack selection (2026-11-04)

Added initial category selection and pack display names for new realms using the
demo, JSON, or CSV. A version 1 creation plan is separate from realm config v6.
Omitting it preserves the existing automatic category ranking/near-duplicate
behavior. Manual plans require exact existing categories, configured minimum
pool/maximum category limits, distinct categories/names, and the fixed All
Characters fallback. Explicit overlap is allowed; unique claims still span all
packs in the realm. Existing global prices, size, rarity weights, cooldowns,
wishlists, and discount behavior are unchanged.

Framework-free rules build both automatic and manual packs. The preview exposes
category counts, selected names/pools, playability, and initial actual odds.
Normalized plan/content/config/format bind the review digest; installation
requires a matching manual review even with the demo. Preview and creation keep
instance-admin service authorization. Realm, grant, catalog, and all pack rows
remain one transaction. Persisted pack UUID/name/category columns already support
this slice, so no migration, archive/config/envelope version, environment setting,
new dependency, or live realm mutation is required. The private .env was not
inspected or edited; .env.example needs no new setting.

The form exposes the existing min/max rules, loads categories from the first
preview, and supports manual checkboxes, category search (50 results), editable
selected names, removal, and fallback-only creation. Selected names remain visible
under filtering. Search alone preserves a valid preview. Content/type changes
reset choices; CSV metadata edits retain them while invalidating review. Names,
selection, and rule edits require another preview. Inputs remain keyboard-labeled,
and long categories wrap within the mobile form.

Seven new unit tests cover automatic compatibility/distinct counts, selected
filters/names/fallback, intentional overlap, schema/duplicate/reserved name
failures, configured pool/quota bounds, fallback-only plans, normalized review
binding, and unplayable category previews. Nine PostgreSQL tests cover service
RBAC, JSON/CSV installations, stale/missing reviews including the demo, invalid
plans without side effects, injected later-pack failure rolling back all rows,
concurrent overlapping claims/retries, independent realms, idempotent recycling
and re-claiming via another pack, no-charge unfillable packs, and fresh-database
backup restore preserving pack UUIDs/names/filters and player receipts/archives.

Browser checks exercise selected category/name creation for JSON and CSV,
selection quota, reserved-name errors, search retaining a review, file-change
reset, metadata-edit retention with re-review, persisted filters/names, mobile
layout, missing/stale review rejection, and player denial on both endpoints.
The initial full browser run stopped at a later sign-in transition. Inspection
found SSR sign-in controls were enabled before client handlers attached. A small
readiness guard now disables the Discord control and local credential fieldset
until hydration, with POST as the native form method. A browser test deliberately
holds client scripts, verifies controls disabled and method POST, releases the
scripts, and verifies controls enabled. The complete browser rerun passed.

Verification (all final checks passed; existing ignored local pnpm wrapper used):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 111 unit/SQLite tests passed. |
| `pnpm test:integration` | 214 real PostgreSQL tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Starter selection/names/limits, source/metadata reset behavior, delayed-script sign-in readiness, and all existing desktop/mobile flows passed. |
| `docker compose build web` | Final Node 24 image built with frozen lockfile. |
| `pnpm test:backup-docker` | Capture, offsite/download/recovery fixtures, fresh restore checks, durable alerts, health, and cleanup passed on the final image. |
| `pnpm test:https-docker` | Trusted fixture TLS/auth/export, signed PING, readiness outage/recovery, and proxy privacy passed on the final image. |
| `docker compose --env-file .env.example config --quiet` | Base example resolved. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Shared the tested identical Dockerfile image with migration service. |
| `docker compose up -d --no-build --wait` | Updated local services; database and web healthy. |

Before/after anonymous ordered row fingerprints/counts matched all **26 persistent
game tables**, without excluding fields. Schema remains 0011, realm config v6,
archive v8, envelope v1. Anonymous localhost home/liveness/readiness returned 200;
manual pack preview denied anonymous access with 401. No real player login,
realm creation/gameplay write, external provider/Discord/cloud request, or actual
notification delivery was used to verify the live update. Optional services remain
disabled; only base db/web services run. Docker fixture containers/networks/alert
volumes created by verification were cleaned up.

Limits: new realms only; a manual pack selects one existing category and a name.
Combined categories, series/hand-picked filters, live editing/regeneration,
per-pack economy rules, and fallback removal remain future work. A total pool
can qualify while positive-weight availability cannot fill the configured draw;
preview marks it unavailable and gameplay rejects without charge. Raw creation
plans are not stored separately; authoritative pack IDs/names/filters are backed
up. Realm creation still lacks an idempotent retry receipt: inspect the realm
list after an ambiguous failure before creating again. See content/starter-packs.md.


## Milestone 5D: receipt-driven web pack reveals (2026-11-04)

Added optional visual reveals for successful web pack openings in existing and
new realms. The dialog uses the actual immutable opening response, in server
card order, with name/series/tier/category details, manual next/reveal, immediate
show-all, close, and Escape. Native modal behavior blocks background interaction;
explicit forward/backward Tab wrapping keeps focus inside the controls. Focus
returns to the opening control or packs heading when the control is unavailable.
Original CSS/typographic decoration uses no remote art, sound, fake outcomes,
roulette, or animation timer controlling progress. Reduced motion starts at a
static full summary and also takes effect when changed during a reveal.

A browser-local versioned on/off preference is the only new persistent client
value. It contains no receipts, player/realm/card IDs, currency, or credentials.
Other tabs reload that preference on storage events; unavailable browser storage
falls back to the current page's choice. Opening controls wait for preference
initialization, avoiding early openings against an uninitialized opt-out.
Server-provided last-opening history never triggers a reveal on load/refresh.
The existing discovery and collection panels remain available with reveals off.

The shared server service/transactions/randomness/authorization/idempotency keys
are unchanged. Pending or failed responses show no reveal. A lost response keeps
the existing retry key; only its successful original receipt starts presentation.
Advancing, skipping, and closing perform no gameplay request or award. Archive
comparisons before/after presentation prove no changes to the saved progress.
No schema/config/archive/envelope version, environment variable, dependency,
external provider, or background service was added. The private .env was not
inspected or edited, and .env.example needs no new setting.

The browser fixture helper uses actual disposable PostgreSQL and HTTP openings:
withholds a committed opening response to prove no premature reveal; checks
server debit before presentation; tests initial concealment, real name/tier,
forward/reverse focus wrapping, Escape, disabled-button fallback focus, and no
extra opening request. A second player exhausts a cached page's pool to verify
no-charge rejection and no reveal. A committed/dropped response then retry proves
identical keys, one debit/card, and recovered original contents. Multi-card tests
reveal in receipt order and compare full player archives after dismissal. Mobile
reduced-motion tests cover initial/runtime preference changes, static summary,
scroll bounds, and fixture screenshot inspection. Opt-out persists on reload;
API-created/historical openings do not auto-play; early close preserves progress
and restores an enabled control's focus. The fixture pages contain only original
project content and generated test accounts. No real player screenshot/login,
gameplay write, external Discord/cloud operation, or notification is used.

The first browser run exposed native Tab navigation leaving the reveal controls
at the end of the sequence. Explicit boundary wrapping fixed it; subsequent full
runs, including reverse traversal, passed. The final fixture mobile screenshot
was visually inspected for readable names/rarities, wrapping, and close controls.

Verification (all final checks passed; existing ignored local pnpm wrapper used):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 111 unit/SQLite tests passed. No gameplay rule changed. |
| `pnpm test:integration` | 214 real PostgreSQL tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | New receipt/reveal browser scenarios and all existing desktop/mobile game/social/auth flows passed. |
| `docker compose build web` | Final Node 24 production image built with frozen lockfile. |
| `pnpm test:backup-docker` | Capture, offsite fixture recovery, fresh restore checks, durable alerts, health, and cleanup passed. |
| `pnpm test:https-docker` | Trusted fixture TLS/auth/export, signed interactions, readiness outage/recovery, and proxy privacy passed. |
| `docker compose --env-file .env.example config --quiet` | Base example resolved. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Shared the tested identical Dockerfile image with migration service. |
| `docker compose up -d --no-build --wait` | Updated local services; database and web healthy. |

Before/after anonymous ordered row fingerprints/counts matched all **26 persistent
game tables**, without excluding any fields. Schema remains 0011, realm config v6,
archive v8, envelope v1. Anonymous localhost home/liveness/readiness returned 200;
unauthenticated opening returned 401. No actual player login, gameplay write,
external provider/Discord/cloud call, or notification was used against the live
app. Optional services remain disabled; base db/web services are healthy. Docker
fixture containers/networks/alert volumes created by verification were removed.

Limits: JavaScript/modern native-dialog browser required. Browser preference is
shared across accounts/realms on that device, not a realm policy or exported
player setting. Historical receipts can refer to cards later recycled/traded;
the collection remains the current-ownership view. Closing/navigation preserves
the committed opening but does not persist an unfinished reveal position.
Custom artwork/audio, live pack editing, additional filters/upgrades, and
Discord-specific reveal presentation remain future work. See gameplay/pack-reveals.md.


## Milestones 5E and 5F: creation recovery and local password management

Milestone 5E makes new-realm creation retry-safe across demo, original JSON and
CSV catalogs and reviewed category pack plans. Service/API authorization remains
mandatory for replay. A normalized UUID key belongs to its creator; an advisory
transaction lock serializes matching requests, and a durable fingerprint binds
the normalized name, parsed catalog/config/pack plan and reviewed digest. Matching
retries return the original realm. Changed proposals conflict. Realm, membership,
one-time starting grant, installed content/packs and receipt commit together.
Migration 0012 adds the receipt table and creator/realm constraints without
rewriting existing rows. Trusted internal calls may omit a key, retaining their
existing behavior without retry guarantees; HTTP creation requires one.

The browser preserves an unresolved proposal/key only in memory, disables edits
and competing realm-configuration actions, and offers **Retry realm creation**.
Success navigates to the saved realm. Reloading loses the key: check the realm
list before creating again. This limitation is documented in the quickstart and
catalog guide. Receipts survive encrypted recovery; no raw import file is added
to them or to player exports.

Milestone 5F adds **Account settings** for ordinary players and administrators,
including accounts with no realm. Local accounts supply the current password,
new 12-256-character password and confirmation. The service validates the
initiating session before reserving a bounded verification attempt, then locks
the account and rechecks session ownership/expiry. Revisioned changes update the
salted scrypt hash and revoke other sessions atomically, retaining this browser.
A stale retry confirms an already-current new password without another hash or
session revocation. Other stale proposals fail, including old payloads after
password reuse. Login rechecks its verified hash under the account lock before
issuing a session, preventing an old-password login racing the change.

Migration 0013 adds password_revision default zero; prior hashes, IDs, roles,
identity links and gameplay remain intact. Account metadata exposes only whether
a local password exists and its revision, never its hash. Separate per-account
password-change attempt keys reuse transient hashed throttle storage (eight in
fifteen minutes); ordinary email login limits remain separate. No password
payload/history or weak password-derived receipt fingerprint is persisted.
Pending values remain only in page memory and clear after definitive failure or
success. Discord-only accounts show their existing sign-in method; they cannot
acquire local credentials through this flow. Forgotten-password recovery,
operator resets, session lists and deletion/anonymization remain future work.

Backups use the existing version-1 encrypted envelope/payload and strict source
migration manifests: omit the new table/column for older source schemas, restore
missing revisions as zero, retain current creation receipts/revisions, and never
restore sessions. Realm config v6 and player archive v8 are unchanged. No new
environment variable, external API, dependency, cloud service, artwork or worker
was added. The private .env was not read or edited; .env.example needs no change.

Seven new real-PostgreSQL creation tests cover concurrent/case-normalized replay,
continued gameplay, changed proposals, RBAC, injected receipt-write failure with
all realm/grant/content counts rolled back, additive 0011 migration and legacy
backup restore, and current receipt replay after fresh encrypted recovery. Ten
new password tests cover hashes, preserved initiating session, revoked other
sessions, unchanged player archives, incorrect credentials, ownership/expiry,
length/revision validation, no-op/current-password verification, lost-response
recovery preserving later sessions, stale requests/password reuse, competing
changes, independent throttles/window expiry, Discord-only/linked accounts, a
deterministically gated old-password login race, additive 0012 migration, legacy
snapshots and current revisions after fresh encrypted recovery.

Browser checks use only generated accounts and original fixtures. A committed
creation response is dropped, then retried with an identical key/proposal: one
realm, receipt and starting grant result. Password checks cover mismatch/wrong
current password, cleared fields, committed/dropped response recovery, locked
pending fields, preservation of a later session on retry, a second revisioned
change revoking that session, Discord-only explanation, CSRF/auth/validation,
and mobile scroll bounds. The final mobile settings screenshot was visually
inspected and contains only original fixtures with empty password inputs.
An initial password-fixture run used the wrong existing sign-in label; it was
corrected and the complete browser suite passed. An initial Discord-only
fixture omitted the paired nullable email constraint; the fixture was corrected
and all PostgreSQL checks passed. Product constraints were retained.

Verification (all final checks passed; ignored local pnpm wrapper used):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 111 unit/SQLite tests passed. |
| `pnpm test:integration` | 231 real PostgreSQL tests passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Full desktop/mobile auth, game, social and new retry/account flows passed. |

Additional production/deployment verification:

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --project integration tests/integration/realm-creation.test.ts` | All seven tests passed again after strengthening the rollback counts assertion. |
| `docker compose build web` | Node 24 production image built with frozen lockfile. |
| `pnpm test:backup-docker` | Encrypted capture/retry, offsite fixtures, fresh recovery, isolated verification, health, durable alerts and cleanup passed. |
| `pnpm test:https-docker` | Trusted fixture TLS, secure auth/export, Origin checks, callback origin, signed raw PING, outage/recovery and proxy privacy passed. |
| `docker compose --env-file .env.example config --quiet` | Placeholder base configuration resolved. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Shared tested image with the migration service using the same Dockerfile. |
| `docker compose up -d --no-build --wait` | Additive migrations completed; local PostgreSQL/web healthy. |

Before/after anonymous ordered row counts/fingerprints matched all **26 existing
persistent game tables**, excluding only the new password_revision field from
accounts. Existing credential hashes and all other fields match. All live
password revisions are zero; the new creation receipt table is empty, bringing
the persistent game table set to 27. The migration manifest has 13 entries.
Anonymous localhost home/liveness/readiness returned 200, and an unauthenticated
password-change request returned 401. Only base database/web services run;
optional services remain disabled. No actual player sign-in, password change,
gameplay write, Discord/cloud/provider request or notification was performed
against the live app. Schema is 0013, realm config v6, player archive v8 and
encrypted envelope/payload v1. Fixture Docker containers/networks/volumes were
cleaned by their verification scripts.

Remaining limits are recorded in README and deployment/account-settings.md:
pending browser attempts are not persisted across navigation; forgotten-password
recovery, deletion/anonymization, live catalog/pack editing and other expansion
features remain future work. These two completed slices do not finish the entire
MVP roadmap.


## Player-experience rework: collector interface, ranks, market and anime/manga metadata

The request shifts effort from roadmap completion to a playable collector game.
The existing secure services and stored player progress are retained. The public
Kyara reference rejected automated inspection through BotStopper; no claim is
made to have inspected its authenticated layout or animations. The new design
uses the user's described direction with original layout, code, portraits and
video. Nothing was copied from that site's branding, character artwork or media.
The Sites skill was applied in its local-only development mode; no hosted Site,
cloud database, publishing credential or external hosting dependency was created.

The web app now has a dark collector layout, desktop navigation rail and mobile
navigation, pack showcase/shop, visible wallet/progression, searchable/filterable/
sortable collection, wishlist, separate gem-purchased collector ranks, marketplace
and illustrated direct-trade offers. Administration remains available below the
player experience. There is no chat, subscription, fake user/activity feed or
simulated market valuation. The real services power every purchase and transfer.

Original anime-inspired demo portraits are bundled as a 3x4 atlas generated with
the built-in imagegen tool. Demo UUIDs select their portraits; namesakes from
other catalogs keep original SVG fallback art. A 4.8-second silent procedural
star/aurora WebM background is bundled for rare reveals, generated locally with
Canvas/MediaRecorder. Common/uncommon/rare effects differ while all draws still
use server-authored immutable opening receipts. No new rarity tier or odds are
invented. Native dialog focus, Escape, immediate skip/close, opt-out, dynamic
reduced-motion static summaries and a playback fallback remain available.
Asset paths, generation prompt and provenance are in content/demo-art.md.

Config v7 introduces configurable Bronze, Silver, Gold, Platinum and Diamond
collector ranks, separate from XP and existing discount upgrades. A sequential,
confirmed gem purchase is atomic and idempotent. Cumulative benefits affect pack
prices, recycling credit, wishlist slots and cooldowns. Web quotes, Discord
quotes/actions, upgrade receipts and gameplay snapshots use the same effective
rules. Price/cooldown floors, credit/capacity limits and purchased-rule protection
prevent incompatible settings edits. Rank-aware settings reviews include effective
prices/capacity/cooldowns and recycling-profit warnings. Migration 0014 normalizes
existing configs to v7 with ranks disabled; earlier receipts/audits are immutable.
New realms enable defaults. Existing admins can use the default-ladder template,
preview and explicitly enable ranks. No old balances or grants are changed.

The new realm marketplace supports fixed-price listings, search/pagination,
listing history, buyer confirmation and seller cancellation. Active listings
reserve their card from direct trade/recycling. A sale locks the same realm as
all gameplay and creates a completed two-version, two-confirmation trade journal,
zero-sum gem ledger transfers and an ownership transfer with zero-XP discovery.
This reuses the existing ownership/receipt recovery invariants and avoids a
second transfer system. Migration 0015 adds listing/request tables and constraints.
Concurrent buyers cannot both buy; cancellation/replay remain possible after
trading is disabled. Current trading caps apply to new purchases/listings.
No fees, editing, automatic expiry, auctions or computed price oracle is included.

Player archive v9 retains v1-v8 readers and adds own rank rules/purchases plus
own seller/buyer listing participation. Encrypted backup envelope/payload stay
v1 with migration manifests. Restore validates rank receipts and wallet entries,
owned ladder compatibility, listings and exact sale consent/price/party journals,
existing trade/ownership chains and per-player effective wishlist capacity.
Legacy creation receipts are replayable after v6->v7 normalization: the server
reproduces the original digest from explicitly old proposals without rewriting
receipts or trusting a client digest. Authentic schema-0013 fixtures cover JSON,
CSV, reviewed/unreviewed demo, concurrent recovery, changed proposals and two
fresh encrypted restores. Entirely omitted trusted-library defaults remain
ambiguous across releases; actual prior browser requests sent explicit config.

Anime/manga is the first source-oriented setup, using an opt-in selected Wikidata
metadata adapter. Instance-admin authorization, explicit provider consent,
1-25 selected QIDs, stable namespace UUIDs, canonical catalog v1, bounded fixed-
host requests, eight-second/two-MiB limits, no redirects/retries and shared six-
lookup/minute throttles are implemented. Only English structured labels are
requested; series/medium are operator categorization and unknown popularity uses
neutral/common tiering. The ordinary permission attestation, catalog/pack preview
and transactional creation follow. No provider image, biography, HTML scraper,
full-database mirror or live API call in tests is included. The official Wikidata
CC0/API/data-access documents and AniList's collection restrictions were checked;
references and actual limitations are in content/anime-manga.md. JSON/CSV remain
available for original or separately licensed datasets and future adapters.

No new runtime dependency, environment secret or external worker is required.
The private .env was neither read nor edited. Local media is excluded from no
required build path; .dockerignore continues excluding real configuration and
fixture screenshots/data. Automated tests use generated accounts, original
catalogs and injected provider responses. No live player login, gameplay write,
Discord operation, external metadata call, notification or cloud upload is used
against the running instance.

Verification is recorded below after final production/Docker checks. The initial
full runs exposed only outdated legacy-version expectations; they were updated
to expect v7 with disabled ranks while retaining exact prior receipt/audit/other
row comparisons. A developer-only video renderer needed the browser transpiler
helper; it was corrected and the original local asset generated. Screenshot
review fixed mobile anchor overlap, a skip-animation override and imported-name
portrait mapping. Final browser capture waits for the rare entrance to finish.

Remaining product boundaries: starting grants/recycling supply gems and market
sales redistribute them; no recurring income is added, so this is not a finished
long-term economy balance. Dynamic character values are explicitly on the roadmap
with stable IDs, history and versioned formulas, not silently changing owned
rarities. Live pack/catalog editing, richer licensed artwork/source adapters,
account deletion and extra Discord commands remain future work. Password recovery
stays outside the user's Discord-focused scope. All pending browser receipt keys
remain page-local; navigation requires checking the saved state before new work.


Final verification (all passed; existing ignored local pnpm wrapper used):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 123 unit/SQLite/fixture tests passed across 21 files. |
| `pnpm test:integration` | 269 real PostgreSQL tests passed across 24 files. |
| `pnpm build` | Final production website build passed. |
| `pnpm test:e2e` | All prior flows plus ranks/market retries, applied benefits, rare video playback, reduced motion, imported-name artwork fallback, mobile geometry and source load/review/edit-invalidation/creation passed. |
| `pnpm exec tsx scripts/generate-reveal-video.ts` | Original local silent WebM generated; browser verified actual loading/playback. |
| `docker compose build web` | Final Node 24 image built with frozen lockfile and local assets. |
| `pnpm test:backup-docker` | Encrypted capture/retry, fixture offsite copying/fetch, fresh restore, isolated verification, durable alerts, health and cleanup passed. |
| `pnpm test:https-docker` | Trusted TLS, secure login/export v9, Origin/callback checks, signed raw PING, outage/recovery and error privacy passed. |
| `docker compose --env-file .env.example config --quiet` | Placeholder configuration resolved. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Tested identical Dockerfile image reused for migration service. |
| `docker compose up -d --no-build --wait` | Additive migrations completed and local database/web became healthy. |

The HTTPS fixture initially expected the former export version8; its assertion
was updated to9 and the full check passed. The added source-browser helper
initially tried reading a response body after successful navigation; it now
reads the resulting realm UUID from the URL and the entire browser suite passed.
These were fixture expectations/timing, not relaxed server authorization or
recovery checks. The source form now invalidates loaded data/rights/review on
editing IDs, medium or series and requires an explicit reload before creation.
All automated provider data was original synthetic fixture data.

Final generated-fixture desktop, mobile dashboard, mobile market and rare-reveal
screenshots were visually reviewed. The mobile header now owns its navigation
height and the realm selector clears visible controls; market anchors settle
below the header. The completed rare entrance has readable character/name/tier
content over the silent background. No screenshots contain live player data or
filled password fields. Captures remain ignored under .test-data.

Before/after anonymous ordered counts/fingerprints matched all **27 pre-existing
persistent game tables**, including every account/credential/ownership/ledger
and historical receipt field. For realm.config only the schemaVersion and newly
added ranks keys were excluded; all original rule fields match. A separate check
confirmed every existing realm migrated to config7 with exactly disabled/empty
ranks, and the new rank/listing/market-receipt tables are empty. Total persistent
game table set is now30; applied migrations15; player archive9; realm config7;
encrypted envelope/payload1. No player balance or identity was changed.

Anonymous home/liveness/readiness and both bundled media URLs returned200.
Anonymous market/rank-buy/provider-import requests returned401. The local base
PostgreSQL and web services are healthy; web remains bound to127.0.0.1:3000.
Optional workers/alerts/offsite services remain disabled. Docker fixtures cleaned
their containers, networks and volumes. The private .env was not read or edited;
.env.example requires no new field. No actual player login, gameplay action,
provider request, cloud operation, Discord call or notification was performed
against the live instance during verification.

## Routed play screens, timed gem claims and catalog providers (2026-11-05)

The follow-up replaces the single scrolling dashboard with real Next.js routes:
`/packs`, `/collection`, `/market`, `/trades`, `/ranks`, `/wishlist`, `/admin`
and `/account`. Only the selected gameplay screen is mounted. Navigation retains
the selected realm, uses browser history and exposes the current page. The pack
shop is more compact; collection, market and trade controls have their own space.
Administrative creation and reviewed settings are separate from ordinary play,
with an advanced creation disclosure and settings categories.

Administrators have an accessible **Admin view** switch. Turning it off hides
management controls and displays a player-preview indicator; it uses the same
account, collection and balance. The browser preference persists locally and
does not alter server permissions. Ordinary players receive no switch and cannot
open administration or invoke its protected services. In-app navigation, realm changes
and the switch are locked while a gameplay operation needs retry recovery.

Config v8 adds `gemRewards`: enabled, amount and interval seconds. New realms
default to 25 gems every six hours, with an immediate first claim and no banked
offline rewards. Migration 0016 preserves existing economies by adding disabled
rewards; the reviewed settings flow has a **Use 25 gems every 6 hours** preset.
Intervals support one minute through 31 days. Claims use database time, realm
locking, member authorization, revision checks, UUID retry receipts and a wallet
ledger entry in one transaction. Different keys racing inside a cooldown cannot
award twice. Existing receipts replay unchanged after settings changes; future
eligibility uses the last successful claim and current reviewed interval.
The browser shows a server-relative countdown and retains uncertain requests
for retry without blocking their own recovery button.

Player archive v10 retains v1-v9 readers and includes only the player's own gem
claim receipts and rule snapshots. Encrypted backup envelope/payload remain v1;
the migration manifest now contains 16 entries. Restore reconciles receipts and
ledger entries in both directions, recalculates rewards and cooldowns from their
saved rules, and rejects internally balanced but fabricated awards. Authentic
schema-0015 fixtures independently reconstruct old config-v7 creation digests:
migration, subsequent play and fresh encrypted recovery preserve those receipts
without silently granting gems.

The canonical catalog boundary now supports one opt-in AniList lookup for up
to 25 explicitly selected IDs, plus authorized AniList and Jikan response JSON.
Provider-specific IDs are stable and source-qualified; names, related series,
genres and compatible popularity cohorts feed the existing reviewed creation
pipeline. The fixed-host live transport has timeout/response bounds, no paging,
no automatic retry, no images and admin authorization before upstream access.
Jikan currently uses uploaded authorized JSON rather than a live fetch adapter.
The original 1,000-character catalog provides repeatable scale testing with
major-category packs, including Action, Fantasy, Mystery and Sci-Fi, without
collecting a third-party database. Existing live realm catalogs are preserved;
catalog merging/replacement and licensed artwork remain separate future work.

Automated provider checks use original synthetic responses. A separate manual
AniList adapter connectivity probe selected one ID, returned metadata successfully
and neither requested artwork nor persisted source data. The Kyara reference
site remained behind BotStopper in ordinary web/browser inspection; no challenge
was bypassed, private layout claimed inspected or third-party asset copied.
No new runtime dependency, environment variable or worker is required. The
private `.env` was not read or edited.

Final verification (all passed; the existing ignored local pnpm wrapper was used):

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed, including final browser helpers. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 141 unit tests passed across 24 files. |
| `pnpm test:integration` | 287 PostgreSQL integration tests passed across 26 files. |
| `pnpm build` | Final production build passed with all eight play/account/admin routes. |
| `pnpm test:e2e` | Full production browser suite passed, including all retained flows, route/history/mount checks, admin preview, ordinary-player boundaries, claim recovery/countdown, hidden-field settings validation, selected-provider creation and the 1,000-character realm with 11 packs. |
| `docker compose build web` | Final Node 24 image built with the frozen lockfile and bundled catalog/media. |
| `pnpm test:backup-docker` | Encrypted capture/retry, fixture offsite copy/download, fresh restore, worker/restore health, durable alerts and cleanup passed. |
| `pnpm test:https-docker` | Trusted local TLS, secure login/export v10, Origin/callback boundaries, signed raw PING, outage/recovery and error privacy passed. |
| `docker compose --env-file .env.example config --quiet` | Placeholder configuration resolved. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Tested identical image reused for migration. |
| `docker compose up -d --no-build --wait` | Additive migration applied and the local database/web became healthy. |

Initial runs caught old archive/config fixture expectations and browser waits
that assumed navigation always started at `/`. Those waits now identify the new
realm on the pack route rather than mistaking an existing admin-page realm query
for completion. A source-provenance assertion initially ran against a module
cached before its update; the stable full rerun passed. Browser review also
corrected claim navigation recovery locks, slider dimensions and settings tab
validation without weakening service authorization or receipt checks.

The final routed pack, collection, administration and mobile player-preview
captures use disposable original fixtures and were visually reviewed. They are
ignored under `.test-data/routed-*.png`; no live player data was captured.
Automated tests made no external live provider calls.

Before/after anonymous ordered counts and fingerprints matched all **30
pre-existing persistent game tables**. For realm config only the schema version
and newly introduced `gemRewards` key were excluded; every prior rule, identity,
credential, card, balance, ledger entry and historical receipt matched. Every
existing realm now has config v8 with exactly disabled 25-gem/six-hour rewards;
the new claim table is empty. There are now 31 persistent game tables, 16 applied
migrations, config v8 and player archive v10; encrypted envelope/payload remain v1.

Anonymous home, all routed pages (sign-in for anonymous visitors), liveness,
readiness, bundled portraits/video and scale catalog returned 200. Anonymous
gem-claim, provider and market writes returned 401. The local database and web
services are healthy at `http://localhost:3000`, bound to loopback. Optional
workers remain disabled. No actual player login, gameplay write, external
provider request, cloud operation, Discord call or notification was performed
against the live instance. The private `.env` was not read or edited, and
`.env.example` needs no additional field.

## Pack bundles, visible progression and a real anime API test (2026-11-05)

The reported leveling issue was investigated against the core awards and an
anonymous live XP-ledger reconciliation. Stored XP was consistent and enabled.
The pack screen hid its next-level/award explanations, and the prototype defaults
stop at level 5 / 100 XP. The UI now shows current XP, next threshold, award rules
and an explicit cap/disabled state. Existing progression rules and historical XP
are preserved. The new anime test realm uses an explicit 100-level threshold
curve, keeping the original first five thresholds and extending them.

Gem-claim readiness/countdown is now visible in the header on every play screen.
Discover additionally displays the next claim's local day/time and an explicit
disabled state with an admin setup link. Claims remain manual and use saved
server time; there is no automatic wallet refill. An uncertain claim keeps its
retry recovery and in-app navigation lock.

Discover supports 1, 5 or 10 packs of the same type. The authoritative transaction
checks the entire weighted pool, samples without replacement, applies each
pack's effective discounts, records all cards/first-collection XP, debits the
total once and starts one cooldown. Incomplete bundles charge nothing. Retry
identity includes quantity. Migration 0017 adds `openings.pack_count = 1` to old
rows without rewriting their receipts or snapshots. Five/ten-pack reveals show
the actual number of packs and group their saved cards; keyboard, show-all,
reduced-motion and rarity effects remain available. The previous single-pack
failure wording is preserved.

Migration 0018 adds auditable operator self-wallet test credits. Only an instance
admin with realm membership can invoke the service; it has no public gameplay
endpoint. A grant receipt, wallet credit and `admin_grant` ledger entry commit
under the realm lock and replay once per stable request key. Amount, overflow,
changed proposals, privilege boundaries, rollback and fresh recovery are tested.
Player archive v10 already includes the wallet entries. Backups additionally
reconcile grant receipts in both directions. The trusted operator command is
`pnpm exec tsx scripts/admin-gems.ts REALM_UUID REQUEST_UUID 100000`; it refuses
ambiguous multi-admin selection and prints no account identity.

The anime/manga setup now includes an on-demand API browser: request series pages
or search, choose series, or prepare a bounded 1,000-character roster. Each server
operation makes one fixed-host request, authorizes first and shares a lower
50-step/minute budget; the UI/CLI pace requests at 1.25 seconds and stop on 429
or failure. Preparation supports pause/resume/download and invalidates its review
when inputs change. It keeps stable MAL identities and a reviewed local gameplay
cohort, so arbitrary remote ID selection cannot silently replace rarity/category
eligibility or break ownership during an outage.

The original public Jikan host timed out through Node, IPv4 curl and web access.
Its project tracker reports the public-service discontinuation. An explicit
service selector now offers Tenrai as the default Jikan-compatible transport;
there is no silent host switch after consent. Tenrai's own terms and reference
were checked: application caches/indexing are permitted subject to technical
limits and third-party rights. AniList remains a bounded selected-ID adapter.
See [provider setup and primary references](content/providers.md).

Optional artwork contains only validated HTTPS CDN references, provider-page
attribution and the operator's permission/permitted-use statement. Images load
lazily in the browser with no referrer; failures use original portraits. The
server does not proxy, download or bundle image bytes. Full reference validation
applies to imports, rendering, exports and fresh recovery, including saved
opening receipts. API access is not represented as an artwork redistribution
license. Automated tests use original labels and mocked original image bytes.

A separate manual API preparation completed **1,000 unique real anime characters
across 28 series in 30 requests**, with **993 artwork references**, 920 positive
favourites and 13 source genres. The approximately 410-KiB canonical selection
and checkpoint remain ignored under `.test-data/`; no provider records or image
files were added to committed fixtures or the Docker build context.

That actual roster was then installed in disposable PostgreSQL outside the
automated suite. Its 11 generated packs, 1/5/10 openings, 16 unique awards,
160-gem debit, 160 XP and level 6/100 were verified. Every receipt replay,
personal archive and complete state survived encrypted recovery into a fresh
database using structural comparisons. The selected 16 cards retained artwork
references. A separate actual CDN HEAD returned 200 / image/jpeg without
downloading image bytes. Neither manual check accessed live player records.

Final verification (all passed; the existing ignored local pnpm wrapper was used):

| Command | Result |
| --- | --- |
| `pnpm lint` | Final full repository lint passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 152 unit tests passed across 26 files. |
| `pnpm test:integration` | 303 real PostgreSQL tests passed across 28 files. |
| `pnpm build` | Final production build passed. |
| `pnpm test:e2e` | Full browser suite passed, including 1/5/10 quantity/cost, stable retry quantity, XP thresholds/caps, gem timing on collection/reload, static ten-pack summary, remote artwork, explicit API service/consent, on-demand browsing and 1,000-character fixture preparation/install with 429 pause/resume. |
| `pnpm exec tsx scripts/prepare-jikan.ts --service tenrai --characters 1000 --medium anime --output .test-data/anime-1000-tenrai.catalog.json --confirm-provider-use --artwork-permission "Operator-authorized private prototype display; no redistribution license asserted"` | Separate manual API preparation: 1,000 actual characters, 993 artwork references, 28 series, 30 requests; no image files downloaded. |
| `pnpm exec tsx .test-data/verify-actual-anime.ts` | Manual real-roster verification in disposable PostgreSQL: 11 packs, 1/5/10 draws, exact retries, 16 unique cards, 160 XP / level 6, personal export and fresh encrypted recovery passed. |
| `docker compose build web` | Final Node 24 image built with the frozen lockfile. Checksums of twelve runtime files matched the reviewed workspace. |
| `pnpm test:backup-docker` | Encrypted capture/retry, fixture offsite copy/download, fresh restore, worker/restore health, durable alerts and cleanup passed. |
| `pnpm test:https-docker` | TLS, secure login/export, Origin/callback checks, signed raw PING, outage/recovery and error privacy passed. |
| `docker compose --env-file .env.example config --quiet` | Placeholder configuration resolved. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Same verified image reused for migration. |
| `docker compose up -d --no-build --wait` | Migrations 0017/0018 applied and local database/web became healthy. |

The first broad runs exposed five exact legacy row assertions that did not yet
include the additive `pack_count: 1` column; those assertions still compare every
old field and receipt exactly. A single-pack empty-pool message was restored to
its previous wording. Windows fixture cleanup now retries bounded transient
file locks within the verified fixture directory. The initial manual real-data
harness compared JSON property order against JSONB; structural comparisons
corrected that harness and the full real-data recovery check passed. Final
5/10-pack captures wait for entrance animations before visual review.

Immediately after deployment and before authorized test setup, anonymous ordered
counts/fingerprints matched all **31 pre-existing persistent game tables**, with
only the newly added `openings.pack_count` column excluded. Existing cards,
balances, XP, configuration and historical receipts were preserved exactly.

The user's requested setup was then applied through authorized services: each
of the two existing administrator realm wallets received **100,000 gems**, and
the one existing realm whose timed claims were disabled was enabled through the
reviewed settings service. The other realm's enabled rules were preserved.
A separate **Anime API test · 1,000 characters** realm now has the actual roster,
11 packs, 993 remote artwork references, an explicit 100-level curve, enabled
25-gem/six-hour claims and a **100,100-gem** wallet (100 starting gems plus the
requested 100,000 credit). Three distinct realm-scoped grant receipts each
record exactly 100,000 and replay without further credit. No cards were opened
on behalf of the real account. All live wallet and XP journals reconcile.

Current state uses 18 applied migrations, 32 persistent game tables, config v8,
player archive v10 and encrypted envelope/payload v1. Anonymous home, all routed
pages, liveness and readiness returned 200; anonymous opening, claim and provider
writes returned 401. The database and web are healthy at `http://localhost:3000`
on loopback. Optional workers remain disabled. The private `.env` was not read
or edited; no new environment setting, dependency or cloud service is needed.
No live player data or provider artwork was captured in screenshots. Automated
tests used original fixtures with injected API/image responses. Actual provider
records and manual harnesses remain ignored under `.test-data/`.

## Artwork preparation and cinematic pack reveals (2026-11-06)

The reported show-all layout now uses one responsive portrait gallery for the
entire saved opening, with pack-number badges rather than nested pack grids.
Cards keep a bounded width and portrait artwork on desktop and mobile, including
ten five-card packs. Summary cards do not replay their individual entrances.
Close and completion controls remain visible while the gallery scrolls.

An original animated sealed pack appears as soon as Open is pressed, covering
both the server request and artwork preparation. Only awarded image references
are prepared: at most four concurrent loads, deduplicated by URL, with decoding
completed before the reveal mounts. The reveal reuses the decoded image itself;
simultaneous copies use decorative canvas drawing without pixel readback or
another request. A bounded memory cache retains public artwork resources only.
Failed or late images settle to original fallback artwork after a six-second
overall deadline rather than starting another load during the entrance.
Collection thumbnails continue to load lazily. No image files are downloaded
by the server or added to backups.

The new foil pack has a tearing seam, cap, halo, rays and rarity-dependent charge
and card entrances. Rare faces retain the original silent local cinematic.
Opening a five/ten-pack bundle or choosing Next card starts the next charge
directly. Skip animation, Show all cards, Close, Escape and reduced motion stay
available. A skipped charge cannot later replace the summary with a single card.
Closing preparation while a response is pending hides the presentation without
cancelling the transaction, losing its retry key or reopening a dismissed modal.
No presentation action spends gems or chooses outcomes.

The initial browser run caught one pixel of horizontal overflow in the mobile
ten-pack fan. Its second row reused the global animation index as a rotation
index, producing excessive tilt. Rotation now uses the column within each row;
the strict overflow assertion remains. Final review also caught the native
prepared demo atlas missing a direct-child cropping selector. The selector now
includes its preparation wrapper, with a browser assertion for the original
three-column/four-row crop dimensions.

The reference site returned an access-denied page during ordinary automated
inspection. No access control was bypassed, and an exact match to its protected
opening sequence was not verified. The implemented motion, foil presentation
and effects are original. Screenshots use disposable original fixtures and
mocked original image bytes; no live player data or provider artwork was captured.

This update changes presentation only: no dependency, environment field, rule,
odds, price, schema migration or archive/encryption version was added. The
existing realm/transaction architecture remains applicable.

Verification (all passed; commands used the existing ignored local pnpm wrapper):

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed; the final added browser assertion also passed scoped ESLint. |
| `pnpm typecheck` | Root and web TypeScript passed; root TypeScript passed again after the browser assertion. |
| `pnpm test` | 158 unit tests passed across 27 files, including six artwork-preparation tests. |
| `pnpm test:integration` | 303 real PostgreSQL tests passed across 28 files. |
| `pnpm build` | Final production build passed with the portrait-cropping fix. |
| `pnpm test:e2e` | Full production browser suite passed, including immediate pending animation, delayed image decoding, six-second fallback with no entrance retry, closing a pending response, charge cancellation, strict gallery geometry, 1/5/10-pack openings, fifty-card desktop/mobile scrolling, original demo atlas cropping, keyboard and reduced motion. |
| `docker compose build web` | Final Node 24 image built with the frozen lockfile; hashes of all five changed runtime files matched the reviewed source. |
| `docker compose --env-file .env.example config --quiet` | Placeholder reference configuration resolved. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Verified image reused by the migration service. |
| `docker compose up -d --no-build --wait` | Existing database volume retained, migration service completed, database and web healthy. |

Before/after anonymous ordered counts and fingerprints matched all **32
persistent game tables exactly**, without column exclusions. Existing accounts,
realms, the actual 1,000-character test roster, artwork references, cards, gems,
XP, settings and receipts were preserved. No extra test credits, roster imports
or gameplay actions were performed on the live instance. Current versions remain
18 migrations, config v8, player archive v10 and encrypted envelope/payload v1.

Anonymous home, all play/admin/account routes, liveness, readiness, bundled
portraits and rare video returned 200. Anonymous opening, claim and provider
writes returned 401. The updated game is healthy at `http://localhost:3000`,
bound to loopback. Optional workers remain disabled. The private `.env` was not
read or edited. Automated tests used disposable PostgreSQL and original fixtures
with intercepted image/API responses; they made no external live provider calls.

## Illustrated pack discovery, collector hub and rarity sound (2026-11-06)

Discover now presents large illustrated packs instead of compact odds/stock
panels. Choosing a pack opens its own URL-selected view with pointer-reactive
artwork, the existing 1/5/10 quantity selector, exact total cost and opening
controls. Reload and Back/Forward retain the selection. Pending opening keys
override URL selection so an uncertain result remains recoverable. Rarity odds,
availability, wishlist chance, cooldown and ownership rules live in a native
information disclosure that supports mouse, keyboard and touch.

The larger banner uses actual rarest claimable characters from the current
realm, with gentle floating and pointer-reactive highlights. Both banner and
pack artwork use the authoritative unclaimed category pools. Zero-weight tiers,
claimed cards and incomplete packs are excluded; rarity ties use stable IDs.
No provider lookup, speculative remote ID or random outcome is used for display.
The shortlist is a snapshot and reserves no cards. Reduced motion disables
decorative tilt/floating. No new image assets were needed.

XP/level progress and timed gem claims have moved to Collector ranks, alongside
metal ranks and pack-discount upgrades. The header's readiness/countdown links
to that page, where claiming remains an explicit action. Colocated claim/rank/
upgrade controls respect each other's pending/recovery locks. Existing gem
amounts, six-hour defaults, progression thresholds and receipts are unchanged.

The three existing rarities now have distinct choreography: common foil
peel/sweep, uncommon crossing orbits and crystal fragments, and rare summoning
circles, a rising column and star burst with the original local video. Original
Web Audio scores add a soft sweep/bell, ascending harmony, and layered bass/chimes
respectively. Audio is synthesized locally, never downloaded. It unlocks only
from a user gesture and plays no cue on page load or selection. Sound on/off is
available before and during opening; its browser-local preference contains no
player identifiers. Mute, skip, show-all, close, backgrounding, reduced motion
and unmount cancel sounding and scheduled notes. Static summaries stay silent.

Provider uniqueness was verified explicitly with original fixtures normalized
through both AniList and MAL adapters. Concurrent attempts through overlapping
packs produce one winner, and the database rejects a second active claim.
Retries spend once; a depleted pool charges nothing; ten two-card packs award
twenty distinct characters; another realm remains independent. Recycling releases
the character and makes it eligible again. Current Classic ownership is always
unique while active, not a lifetime pull prohibition; duplicate ownership and a
live ownership-mode switch remain unimplemented.

Visual and browser review found a clipped mobile hero headline and an information
bubble that could close while moving the pointer into its content. The mobile
line break is retained; hover-open clicks pin the disclosure, its hover corridor
allows movement into the text, and popup positioning stays within the viewport,
including tablet widths with two pack columns. The assertions check actual text
and popup bounds rather than relying only on document overflow.

The reference website again returned an access-denied page during ordinary
inspection. No protection was bypassed, and no exact match to its protected
animation is claimed. All motion, sound and interface code in this update is
original. Automated browser artwork/API responses are intercepted original
fixtures; screenshots contain no live player records or provider artwork.

Verification (all passed, using the existing ignored local pnpm wrapper):

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed; final changed UI and browser helpers also passed scoped ESLint. |
| `pnpm typecheck` | Root and web TypeScript passed after the final information-control changes; root TypeScript passed again after final browser helper changes. |
| `pnpm test` | 165 unit tests across 29 files, including spotlight eligibility and original audio scheduling/cancellation. |
| `pnpm test:integration` | 307 PostgreSQL tests across 29 files, including explicit AniList/MAL ownership, concurrent overlapping packs, bundles, recycling and spotlight depletion. |
| `pnpm build` | Final production build passed. |
| `pnpm test:e2e` | Final full suite passed: large tiles and dedicated routes, Back/Forward/reload, actual mobile headline bounds, tablet popup bounds, keyboard/hover/pinning/traversal, tilt and reduced motion, header-to-ranks claims, distinct actual-rarity animation mechanisms, audio gesture/mute/cancellation, and existing gameplay/retry/loading checks. |
| `pnpm exec tsx .test-data/capture-discovery-mobile.ts` | Additional original-fixture mobile hero capture passed and was visually reviewed; separate disposable database, external requests blocked, preview processes cleaned up. |
| `docker compose build web` | Final Node 24 image built with frozen lockfile; all twelve changed runtime file hashes matched the reviewed source. |
| `docker compose --env-file .env.example config --quiet` | Reference configuration resolved with placeholders. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Same verified image used for the migration service. |
| `docker compose up -d --no-build --wait` | Existing persistent database retained; migration service completed, database and web healthy. |

The final broad browser run exposed an existing Market test sequencing race:
listing contents appeared while the component was still completing its refresh,
so an immediate navigation click was correctly blocked. Ordinary test navigation
now waits for the existing global pending-operation guard to release. Intentional
blocked-navigation and receipt/retry checks remain direct and unchanged. No
arbitrary sleep or weaker gameplay assertion was introduced.

Before/after anonymous ordered counts and fingerprints matched all **32
persistent game tables exactly**, with no excluded columns. Accounts, settings,
cards, gems, XP, receipts and the actual 1,000-character API test realm are
preserved. No live gameplay, test credit or provider request was performed.
There are still 18 migrations, config v8, player archive v10 and encrypted
envelope/payload v1. No dependency or environment setting was added, and the
private `.env` was not read or edited.

Anonymous home, all play/admin/account routes, liveness/readiness and bundled
portraits/video returned 200. Anonymous opening, claim and provider writes
returned 401. The updated game is healthy at `http://localhost:3000`, bound to
loopback. Optional workers remain disabled.

## Collector progression, five rarities and card browsing (2026-11-07)

Realm selection and ownership information now live in Account settings. Play
navigation starts each destination at the top; same-route refreshes retain their
position. The brand link preserves the selected realm. Banner preview cards
stand upright, while pointer interactions remain available. Collection, reveal,
market and offer cards use physical frames. Wishlist and trade selection use
searchable, paginated card dialogs with keyboard support, preserved selections
and explicit reserved-card states. Wishlist also contains a complete character
glossary with tier, ownership and name/series filters and base recycling values.

Six independent collector tracks replace new purchases from the separate
discount shop and linear rank ladder. Bronze, Silver and Gold each have four
increasingly expensive levels; Sapphire, Ruby and Emerald require combinations
of earlier track levels. Rank purchases authenticate realm membership, serialize
with gameplay, require the displayed settings revision, and use durable receipts
for uncertain-response retries. Effects compose with previously purchased legacy
benefits. Old purchases, history and successful retry receipts remain valid.
All costs, prerequisites and benefits are versioned realm configuration.

New defaults use five rarity tiers through Epic and Legendary, a 200-gem pull,
2,000 starting gems, manual 1,000-gem claims every six hours and a 60-second
opening cooldown. Base tier weights are 8,000/1,700/270/29/1; base recycling values
are 20/60/200/1,000/5,000. Category availability still determines actual next-draw
odds. Each tier has distinct original motion and synthesized sound; reduced
motion, mute, skip and pending-artwork preparation remain available. Market
asking prices remain player choices, with a selected card's base value suggested
by the form. Dynamic valuations remain future work.

Migrations 0019–0022 add five-tier compatibility, rank-track receipts, optional
Discord avatar URLs and operator economy journals. Schema migration preserves
old live rules, adding zero-weight tiers and disabled tracks. A separate reviewed
economy preset changes an existing realm atomically, enables collector tracks and
retires new legacy purchases. Only never-awarded characters can be reranked;
previously recycled characters are protected too. Saved rarity and stable IDs
order older catalogs because their numeric source popularity was not retained.
No live provider lookup is needed. The preset uses a matching preview hash,
settings revision, realm lock and stable request key, and records both settings
and tier changes for recovery.

Discord profile pictures refresh after verified sign-in. Stored values are
validated public Discord CDN URLs; image bytes and OAuth tokens are not retained
for this feature. The UI supplies an initials fallback, including failed images
that finish loading before hydration. Existing linked profiles need another
Discord sign-in to populate the new optional field. Player archive v11 includes
leveled progression and optional avatar information; legacy archives still parse.
Encrypted recovery validates rank receipts and operator tier-change chains.

The preset is an initial playtesting balance, not a guarantee against profitable
recycling in depleted or custom pools. Earned cooldown reductions can reach zero.
These limits and operator commands are recorded in
[rarity and economy](gameplay/rarity-economy.md). No dependency or environment
setting was added. Automated tests use original fixtures, disposable PostgreSQL
and intercepted artwork/provider responses.

Verification passed using the existing ignored local pnpm wrapper:

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository passed; final browser-helper changes also passed scoped ESLint. |
| `pnpm typecheck` | Root and web TypeScript passed on the final runtime; root TypeScript also passed after browser-helper changes. |
| `pnpm test` | 176 unit tests across 32 files passed. |
| `pnpm test:integration` | 317 real PostgreSQL tests across 32 files passed, including rank purchases, avatars, economy presets and fresh encrypted recovery. |
| `pnpm build` | Final production build passed. |
| `pnpm test:e2e` | Full production browser suite passed, including the original 1,000-character glossary, filters, visual trade/wishlist selection, keyboard/focus recovery, navigation scroll, Discord avatar/fallback, rank-purchase lost-response retry, five rarity motions/sounds and existing bundle/loading/market/OAuth flows. |
| `pnpm exec tsx .test-data/collection-experience-only.ts` | Focused original-fixture collection checks passed again for final desktop/mobile captures. |
| `pnpm test:backup-docker` | Encrypted capture, retries, offsite fixture and fresh-database restore checks passed. |
| `pnpm test:https-docker` | TLS/redirect, secure login/export v11, Origin/callback protection, raw signed PING, outage/recovery and error privacy passed. |
| `docker compose build web` | Final Node 24 production image passed; all 168 runtime code/migration file hashes matched the reviewed workspace. |
| `docker compose --env-file .env.example config --quiet` | Placeholder reference configuration resolved. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Same verified image reused for migrations. |
| `docker compose up -d --no-build --wait` | Existing PostgreSQL volume retained; migrations completed, database and web healthy. |

The final browser run updated historical checkbox interactions to use the actual
trade card dialog. Its delayed-hydration check now waits for explicitly released
client scripts to load before checking enabled controls. No arbitrary delay or
weaker gameplay assertion was added. Original-fixture desktop/mobile glossary,
trade-picker and collector-rank captures were visually reviewed; collection
captures were also reviewed. No live player data or provider images were used.

Local installation completed with **22 migrations, config v10, player archive
v11 and 34 persistent game tables**. Encrypted envelope/payload versions remain
v1. Before/after anonymous ordered counts and fingerprints matched all 32 older
game tables across migration, normalizing only the added configuration fields,
zero-weight tiers and optional avatar column.

The reviewed preset was then applied to the three existing administrator realms,
using stable per-realm request keys and matching preview hashes. Three receipts
were recorded. A second comparison matched all 35 preservation fingerprint sets:
existing records, all rank-track purchases, every ever-awarded character's full
record, and all realm rules outside the explicitly changed economy fields.
The comparison excludes the intended new settings revision/journals and the
never-awarded characters' tier/audit additions. Wallets, cards, XP, purchases,
historical receipts, artwork references and the existing 100-level curve remain
unchanged. Starting grants were not repeated; no packs, claims, roster imports
or extra test credits were performed on the live instance.

Anonymous home, all play/admin/account pages, liveness/readiness, bundled
portraits and the local video returned 200. Unauthenticated opening, gem-claim,
provider and rank-track writes returned 401. The updated game is healthy at
`http://localhost:3000`, bound to loopback. Optional workers remain disabled.
The private `.env` was neither read nor edited; Docker used its existing settings.

## Direct play, card inspection and character values (2026-11-07)

The earlier 60-second default opening wait is removed. New realms default to
zero, while existing realms retain their rule during schema migration and can
remove it through a reviewed settings change. The 1/5/10 opening flow still
waits for its own pending transaction and presentation to finish. Atomic bundle
spending, unique ownership and retry receipts are unchanged.

Collector-track and legacy-rank purchases, and collection recycling, now submit
on the first click. An uncertain result retains its original request key and an
explicit recovery button. Expected revisions, authentication, reservations and
pending-operation locks still apply. Trading and market-purchase confirmations
retain their existing behavior.

Collection, glossary, wishlist, market, trade and revealed cards use a consistent
5:7 portrait face with dominant artwork, a colored rarity frame, compact name,
series and value. Genre data and action controls are outside card faces. Card
inspection shows a larger face, value evidence and optional source attribution;
it supports keyboard, backdrop closing, mobile scrolling and focus restoration.
Inspection within a pack reveal closes independently without dismissing the
opening. The dedicated opening room centers a floating, pointer-reactive pack
above quantity and opening controls, with a compact back/balance/info header.
The ordinary sidebar, page header and large footer are omitted in that room.
Reduced motion disables decorative movement.

Config v11 adds versioned character-value settings. The default formula adds up
to 75% of the tier's base value for saved popularity, comparing only characters
within the same source and tier. Equal scores stay equal; absent scores and
single-character cohorts receive no invented bonus. Each interested collector's
wishlist adds 5%, capped at 25%; an active owner's own wish is excluded. Quotes
include the player's existing recycling bonus. Sellers retain control of asking
prices, and a zero-value custom realm gets a valid minimum listing suggestion.

Migration 0023 stores nullable numeric popularity and leaves valuation disabled
in older realms. New imports retain their supplied numbers. The admin-only
saved-catalog preview/apply service and `scripts/character-popularity.ts` can fill
missing evidence after checking stable IDs, source keys, source, revision and a
matching preview hash. They do not replace rosters, rerank characters, fetch a
provider or download artwork. Values recompute from saved evidence and aggregate
realm demand; they do not alter pull odds, rarity or ownership.

Recycling calculates its value under the existing realm transaction lock and
saves formula/evidence alongside the credit receipt. Retrying after later demand
changes returns the original credit. Player archive v12 includes the player's
relevant current values and historical recycling evidence. Encrypted recovery
validates saved quotes against historical rules and ledger credits rather than
current wishes. Older configuration, archive and backup formats remain readable.
Richer market-price histories and automatic source-popularity refresh remain
future work; the configurable formula is intended for playtesting.

The linked reference pages were unavailable during ordinary web inspection. No
access restriction was bypassed. The implemented layout, card frames, motion
and inspection code are original. No dependency or environment setting was added.

Verification passed using the existing ignored local pnpm wrapper:

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed, including the new operator command. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 180 unit tests across 33 files passed. |
| `pnpm test:integration` | 321 tests across 33 files passed against disposable PostgreSQL, including popularity restoration, owner-wish exclusion, immutable recycling quotes and fresh encrypted recovery. |
| `pnpm build` | Final host production build passed; final Docker production compilation passed too. |
| `pnpm test:e2e` | Full suite passed, including consecutive 1/5/10 openings without clock edits, first-click rank/recycle with safe retries, 5:7 geometry across card views, colors and absent genre text, desktop/mobile inspection, nested-reveal Escape/focus, live wishlist-value changes and a valid one-gem listing suggestion for a zero-value custom realm. Existing auth/provider/trade/bundle/loading/five-tier motion and sound checks also passed. |
| `pnpm exec tsx .test-data/collection-experience-only.ts` | Focused original 1,000-character experience passed; original-fixture collection, inspection and opening-room desktop/mobile captures were visually reviewed. |
| `pnpm test:backup-docker` | Encrypted capture/retry, offsite fixtures, fresh restore, worker health, isolated verification, failure/recovery alerts and cleanup passed. Live deployment untouched by the test. |
| `pnpm test:https-docker` | Local TLS, redirects, secure login/export v12, Origin/callback protection, raw signed PING, outage/recovery and error privacy passed. Live deployment untouched by the test. |
| `docker compose build web` | Final image built with the frozen lockfile; all 175 runtime code/migration/operator file hashes matched the reviewed workspace. |
| `docker compose --env-file .env.example config --quiet` | Reference configuration resolved using placeholders. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Same verified image reused for migrations. |
| `docker compose up -d --no-build --wait` | Persistent database retained; migration service completed, database and web healthy. |

The broad browser tests were adapted to the opening room's compact navigation:
returning to the catalog creates a real history entry before ordinary page
navigation. Their history assertions preserve that entry. Ordinary navigation
still waits for pending operations; intentional blocked-navigation tests exercise
the room's actual locked back link. No arbitrary sleep or weaker transaction
assertion was introduced. All automated artwork/provider responses use original
fixtures; no live player screenshot or provider call was used.

Local installation now has **23 migrations, config v11, player archive v12 and
34 persistent game tables**. Encrypted envelope/payload remain v1. Migration
preservation fingerprints matched all 34 prior game tables, normalizing only the
added popularity/configuration fields and schema-version number.

The operator reviewed and applied zero opening cooldown and enabled valuation
in the three existing administrator realms through the normal settings service,
using stable request keys. Matching saved catalogs supplied 1,000 popularity
scores in each larger realm and 11 in the 12-character original realm; the one
missing demo score remains neutral. No provider lookup, roster replacement or
reranking occurred. Afterward all 34 preservation fingerprint sets matched again,
excluding only the intended popularity column, cooldown/value settings, new
configuration revision and new settings-journal entries. Existing cards, tiers,
gems, XP, purchases, artwork/provenance, old receipts and progression remain
intact. No live pack, claim, recycling, listing or test-credit action was performed.

A read-only anonymous aggregate check confirmed zero cooldown and enabled values
in every realm. The actual anime test roster has 56 distinct Rare values for its
56 Rare characters, 15 distinct Epic values for 15 Epic characters, and two
different Legendary values. Other tiers also vary; whole-gem rounding and equal
source scores can produce equal values. The check printed only tier counts and
value ranges, with no player or character identifiers.

Anonymous home, all play/admin/account pages, readiness/liveness and bundled
portraits/video returned 200. Unauthenticated opening, claim, provider and
rank-track writes returned 401. The game is healthy at `http://localhost:3000`,
bound to loopback. Optional workers remain disabled. The private `.env` was not
read or edited; Docker consumed its existing settings.

## Shared Discover cards and full-room pack reveals (2026-11-07)

Discover's rare-character banner now uses the same 5:7 card faces, rarity frames,
character values and inspection interaction as the collection. Its shortlist
still comes from the authoritative claimable pools; it reserves no characters
and makes no provider request. Desktop pointer highlights and reduced-motion
behavior remain available.

Preparation, pack unsealing, rarity entrances and the final card spread now
occupy the selected opening room directly. They are ordinary page regions,
without an opening dialog, body-scroll lock or modal focus trap. The five
rarity effects, original sound/video, skip/show-all, reduced motion and bounded
artwork preparation still use the saved server result. Return to pack and Open
more packs restore the room controls; View collection navigates to the actual
collection page. Explicit card inspection retains its separate dialog. Closing
preparation never cancels a committed opening, drops an uncertain retry key or
reopens a dismissed presentation when late artwork finishes.

Ordinary pack wrappers now use original abstract symbols, foil and crimped seals
with the pack's own title. Character art requires an explicit franchise-specific
presentation. The loading/unsealing pack uses the same wrapper component, and
ordinary catalog or opening packs no longer load a preview character portrait.
Selected colors and symbols persist through preparation, unsealing and bundles.
Return-to-pack controls expose their visible text as their accessible name.

Default pack labels use recognizable themed editions such as Battle Arena,
Grand Voyage, Fantasy Realms, Spirit Realm and School Days. Actual source tags
can produce Shōnen Showdown, Shōjo Stories, Isekai Gateways or Mecha Hangar;
genres are never treated as evidence for an absent demographic or theme.
The information disclosure shows the exact source category and authoritative
availability/odds. Existing custom names remain intact, aliases are
disambiguated and Discord accepts a unique saved name, current label or ID.
Existing pack rows, IDs, categories, pools and historical records are not renamed.
New automatic packs and initial manual-selection names use the themed defaults.

The bounded Jikan-compatible normalizer also retains optional themes and
demographics supplied by the same existing series response. It performs no
additional provider lookup, changes no previously saved roster and does not
infer missing tags. AniList's query is unchanged. No schema migration,
configuration/archive version, dependency, environment field, price, reward,
rarity or ownership rule was added or changed.

Ordinary reference-site inspection returned an access-denied page. No restriction
was bypassed, and no exact match to its protected sequence is claimed. Wrapper
graphics and layout code are original, and automated artwork/API responses use
original fixtures rather than live provider images or player screenshots.

Verification passed using the existing ignored local pnpm wrapper:

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed. |
| `pnpm typecheck` | Root and web TypeScript passed, including browser helpers. |
| `pnpm test` | 187 unit tests across 34 files passed, including truthful category labels, custom-name preservation and deterministic aliases across web/Discord query orders. |
| `pnpm test:integration` | 323 tests across 34 files passed against disposable PostgreSQL, including current pack labels/legacy Discord names, unchanged ownership transactions, exports and fresh encrypted recovery. |
| `pnpm build` | Final host production build passed. |
| `pnpm test:e2e` | Full suite passed on the final production build: shared banner cards/keyboard inspection; inline regions without opening dialogs, body locks or focus traps; preparation/bundle/unsealing color and symbol continuity; five-tier desktop/mobile effects and sound; decoding/fallback/hidden preparation/retries; fifty-card page scrolling; consecutive 1/5/10 openings; collection, provider, account, trading and authorization flows. |
| `docker compose build web` | Final production image passed; all 178 runtime code/migration/operator file hashes matched the reviewed workspace. |
| `docker compose --env-file .env.example config --quiet` | Portable reference configuration resolved using placeholder values. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Migration service uses the same verified image. |
| `docker compose up -d --no-build --wait` | Database retained, migration service completed, web/database healthy on loopback port 3000. |

Fresh original-fixture captures of the desktop/mobile Discover banner, abstract
pack room, inline preparation, rarity entrances and fifty-card summary were
visually reviewed. Browser checks use the visible Return to pack label and
keyboard activation for continuously floating banner cards. No live provider
request, live player screenshot or gameplay action was used for verification.

The localhost installation was updated after the final checks. Before/after
read-only anonymous fingerprints matched **all 34 persistent game tables with
no excluded columns or normalized fields**. Collections, gems, XP, ranks,
wishlists, trades, catalogs, saved names, configuration and historical receipts
remain unchanged. The installation still has 23 migrations, config v11 and
player archive v12; encrypted payload/envelope remain v1. No economy rollout,
catalog rewrite, popularity backfill or test credit was applied.

Anonymous home/play/admin/account pages, readiness/liveness and bundled media
returned 200 after deployment. Unauthenticated opening, gem-claim, provider and
rank-track writes returned 401. The private `.env` was neither read nor edited;
Docker used its existing settings. The game is available at
`http://localhost:3000`.

## Demographic packs and Discord server playtest (2026-11-07)

Pack wrappers no longer display the provisional game name. Anime/manga defaults
now use actual Shōnen, Seinen, Shōjo, Josei and Kodomo source categories, with
All Characters as the complete-roster fallback. Distinct demographic groups
remain separate even when their pools overlap; normal configured pool limits,
rarity weights, unique ownership and spending still apply. Generic original
category catalogs and explicit custom names remain supported.

Web and Discord use a shared view policy that omits prior automatic genre packs
from anime browsing without deleting stored pack rows, IDs or historical
receipts. Confirmed Discord reviews still replay the saved pack safely. A
genre-only provider catalog displays All Characters and explains its missing
demographic metadata. The existing 1,000-character anime test roster has no such
tags, so this update does not pretend to reclassify it. Existing-catalog enrichment
and live pack creation require a separate reviewed workflow and remain outside
this change; new reviewed Jikan-compatible catalogs can supply the actual tags.

Jikan normalization and resumable duplicate merges prioritize supplied
demographic evidence within the existing twenty-category bound. A shared pure
helper is safe for the browser bundle and server normalization; Node-only
identity/transport code stays out of the client. No extra provider request,
dependency, schema migration, configuration/archive or encryption version is
required. Pack searches accept ordinary Shonen/Shounen and Shojo/Shoujo spellings.

The signed HTTP `/atlas collection` command lists ten currently owned cards per
page in rarity/name order. The invoking account must be linked and admitted to
the server's realm. Replies are private by default; `share:true` deliberately
posts only that member's selected nonempty page to the channel. Empty collections
and errors stay private. Output is bounded, Markdown is escaped, mentions are
disabled, and no provider call, artwork download or gameplay write occurs.
The command registration definition, operator setup and privacy documentation
agree. Website trading remains the trade interface and shares this inventory.

The new Windows Discord playtest guide documents temporary PC hosting through
Cloudflare, stable-hostname and Docker/VPS alternatives, existing-data recovery,
OAuth/interaction URLs, command installation/registration, invitations and a
two-account web trade check. Public setup and live verification are recorded
below separately from fixture-based automated checks.

Verification passed using the existing local pnpm wrapper:

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed. |
| `pnpm typecheck` | Root/web TypeScript and browser helpers passed. |
| `pnpm test` | 194 unit tests across 34 files passed. |
| `pnpm test:integration` | Final full run: 329 tests across 34 files passed against disposable PostgreSQL. A stale genre-pack expectation was corrected to the demographic fallback before this rerun. |
| `pnpm build` | Final host production build passed after separating the browser-safe category helper from Node-only provider identity code. |
| `pnpm test:e2e` | Full production browser suite passed, including a 1,000-character original MAL-shaped fixture with separate 500-character Shōnen/Seinen pools, actual category-filtered opening, plain titles, unbranded wrappers, demographic search and genre-only fallback. Existing rarity, loading, retry, collection, trading, account and provider checks passed too. |
| `docker compose build web` | Final image passed; all 179 runtime source/migration/operator file hashes matched the reviewed workspace. |
| `docker compose --env-file .env.example config --quiet` | Portable configuration resolved with placeholders. |
| `docker image tag card-engine-web:latest card-engine-migrate:latest` | Shared verified image installed for both services. |
| `docker compose up -d --no-build --wait` | Migration service completed; existing database and updated web service healthy. |

Focused signed HTTP/PostgreSQL tests also verified private/public collection
pages, pagination, current ownership after recycling, authorization and realm
isolation, bounded escaped output and read-only game state. A legacy Discord
pack review still confirms and replays after its genre pack leaves current
browsing. Fresh original-fixture desktop/mobile demographic pack captures were
visually reviewed. Automated checks used no external provider or live player.

The operator selected temporary hosting on the existing PC. The official Windows
Cloudflare helper was downloaded into ignored local tools and its published
SHA-256 digest verified. It runs hidden and forwards only the existing web port;
the database remains in its original Docker volume. The public origin and secure
cookie settings were applied to the private `.env`, along with the supplied
Discord public key. Existing OAuth/database credentials were preserved and were
never printed. No schema/config/archive/encryption version changed.

Before/after anonymous fingerprints matched all 34 persistent game tables with
no exclusions or normalization. No live gameplay action, metadata rewrite,
economy adjustment or test credit was performed. Public HTTPS home, packs,
collection, trades and readiness/liveness returned 200. An unsigned interaction
returned 401. Four unauthenticated gameplay writes returned 401 and a request
from the old localhost Origin returned 403. The actual sign-in POST returned the matching public HTTPS callback
and a Secure browser-binding cookie, without authorizing a player account.

Live command registration initially returned Discord Missing Access (50001),
despite successful application authentication. The operator then installed the
application and confirmed saving both public portal URLs. Registration completed
successfully; a live read-back returned HTTP 200 and confirmed the collection
subcommand with page/share options. The saved server binding was reused; no new
realm binding or account was invented. A real player invocation and two-player
trade remain manual playtest actions, rather than results claimed from fixtures.
Temporary tunnel runtime/log files remain ignored; a restart changes its address
as described in the playtest guide. The PC, Docker and tunnel process must remain
running for this temporary address to work.

Discord's live authorization metadata also confirmed the configured application
ID and supplied public key match. An ignored local shutdown helper restores the
prior public-origin/cookie settings and stops only the recorded tunnel executable;
its syntax was checked without stopping the active trial.

## Interface redesign, bounded full rosters and pack variety (2026-11-08)

The operator asked for a modern redesign inspired by kyara.games, far less small
or unreadable text, a fuller AniList/Jikan implementation with more pack variety,
and no change to how pack opening works. kyara.games rejects automated visits
with a bot challenge, so the result is an original dark, artwork-first collector
design in the same genre; no layout, artwork or branding was copied.

**Interface.** Every play screen shares one slim top bar: home link, **Packs,
Collection, Wishlist, Market, Trades, Ranks**, the gem wallet with the timed-claim
pill, and an account menu holding **Admin view**, **Administration**, **Account
settings** and **Sign out**. Below 1024px the navigation becomes a bottom tab bar.
Each screen has one page header (title, one-sentence lede, actions); eyebrow
labels and repeated titles/balances were removed and rules moved into the pack
information control, field help or disclosures. Body text is 16px, interface
text is at least 13px (card rarity badges are 12px), controls are at least 44px,
and Inter/Bricolage Grotesque are self-hosted (SIL OFL) so the strict CSP is
unchanged. The four previous stylesheets were replaced by `theme.css`,
`shell.css`, `cards.css`, `screens.css` and `opening.css`; opening-room and
reveal rules were moved verbatim before a readability pass raised their text
sizes. The opening flow, quantities, receipts, retries, sound and reduced-motion
behavior are unchanged. Control labels used by the browser tests were kept (the
open button's gem symbol is now announced as "gems"), and locked navigation also
reports `aria-disabled`. Server-paged glossary and picker labels change only when
that page's cards arrive. See [interface notes](design/interface.md).

**Client data at scale.** Pages receive a slim realm view: catalog size/status
plus only the characters referenced by cards, wishlist, trades, spotlights and
the last opening. The service `getRealmView` contract used by tests and Discord
is unchanged. The character glossary and wishlist picker page through a new
read-only, member-only `GET /api/catalog` (search, rarity, ownership and
exclude-wished filters). Market listings now carry categories, source key,
artwork and valuation for full card faces. Realm creation inserts characters in
batches of 1,000.

**Providers.** A literal "all characters" import was not built: AniList's terms
prohibit mass collection, and AGENTS.md forbids automated mass-import scrapers
and database mirroring. Instead, provider (MAL/AniList) catalogs may hold 10,000
characters per realm (12 MiB preview/create bodies); original JSON/CSV catalogs
keep 1,000 characters and 2 MiB. The Tenrai/Jikan browser builds a popular roster
from anime, manga or both (500–10,000 characters, 10–50 per series, main
characters first), alternating media, pausing on rate limits and resuming; seed
state v2 migrates v1 progress files. Newly prepared MAL names read "Given Family"
instead of "Family, Given", and era categories come from air/publication years.
The new **AniList series browser** searches or lists popular series and imports
the characters of up to 100 chosen series (10–25 each) with genres, demographic
tags, era, favourites and optional artwork references, paced at 2.5 s per request
and limited to 24 requests per minute per instance. `scripts/prepare-jikan.ts`
gained `--medium` and `--per-series`. See [providers](content/providers.md).

**Pack variety.** Starter-pack planning still leads with actual demographic tags,
then adds the largest distinct genre, theme and era packs, skipping categories
that cover at least 85% of the roster or are at least 0.9 Jaccard-similar to an
earlier pack, up to 30 category packs (previously 10). Era packs get edition
names such as "90s Icons", and the gallery filters by kind. Behavior change: the
2026-11-07 view policy that hid saved automatic genre packs of older provider
realms was removed, so those stored packs are visible and openable again on web
and Discord. Realm admins can add packs to an existing realm under
**Administration → Packs** (`GET`/`POST /api/realm-packs`): admin-only, the realm
row is locked, only existing categories with enough characters qualify, duplicate,
reserved and conflicting names are rejected, and the total stays at most 30.
Cards, ownership, receipts and existing packs are untouched.

No schema migration, configuration version, archive version or encryption
change was needed. The `maximumCategoryPacks` and starter-plan category bounds
widened from 10 to 30; existing configurations remain valid. New tests cover
AniList normalization (5 unit tests), Jikan name/era/per-series/round-robin/v1
migration behavior, demographic-plus-genre planning, and a 5,000-character
provider realm with pools versus draws, limits, paging, adding packs and market
enrichment (6 integration tests).

Verification passed on the host workspace using the existing local pnpm wrapper:

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 204 unit tests across 35 files passed. |
| `pnpm test:integration` | 335 tests across 35 files passed against disposable PostgreSQL. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` (`tsx scripts/e2e.ts`) | Full production browser suite passed. Earlier runs found three issues, fixed before the final run: the locked-navigation steps now assert `aria-disabled` and force a click (navigation stays blocked), the bundle cost line regained its "5 packs · 5 cards · 50 gems" wording, and glossary/picker page labels now wait for their cards. |

Desktop and phone captures of every screen from an original-fixture preview were
reviewed during the redesign. No live provider, player data or Docker deployment
was used; the image was not rebuilt.

Remaining limitations: roster preparation runs in the administrator's browser
tab, which must stay open (10,000 characters at 25 per series is about 500 paced
requests, roughly 11 minutes). Existing realms keep their stored names and
categories; live catalog merging/replacement is still not implemented, so an
existing realm can only gain packs for categories it already has. AniList imports
only explicitly chosen series. The running Docker deployment used for the
temporary public playtest was not rebuilt or restarted and still serves the
previous version. The workspace is not a git repository, so a pre-change source
archive was kept outside the repository.

## Guided administration, market picker and Kirameki branding (2026-11-08)

Follow-up requests: make listing a card on the market searchable, fix overlapping
cards in the wishlist and trade pickers, redesign Administration and realm
creation so an admin is guided through each task, and give the site a more
fitting name. Pack visuals and animations were deliberately left for later.

**Card pickers.** The picker grid scrolls inside a fixed-height dialog; without
`grid-auto-rows: max-content` the browser shrank every row to fit that height,
so cards overlapped in the wishlist, trade and (new) market pickers. Page labels
of server-paged pickers already change only when their cards arrive. On phones
the picker footer now puts Previous/Next on one row.

**Market.** The always-visible **Sell a card** panel replaces the collapsed form
and its plain dropdown: **Choose a card to sell** opens the same searchable,
illustrated picker (name, series, category and rarity filters), the chosen card
is shown with its suggested value (one tap uses it as the price), then
**Asking price (gems)** and **List card · N gems**. Reserved cards stay excluded.

**Administration hub** (`apps/web/app/admin-hub.tsx`). One task at a time:
**Overview** (realm at a glance plus a numbered setup checklist: packs, game
rules, Discord server, joining, invitations, each linking to its section),
**Game rules** (the existing previewed settings editor with a one-line
description per category), **Packs**, **Players & access** (three numbered
steps: connect the Discord server, choose who can join, invite players, with
"where do I find this ID?" help) and, for instance admins, **New realm**.
`?task=rules|packs|access|create` opens a section directly. Saving game rules
returns to the overview with a confirmation. Server-side RBAC is unchanged.

**New realm wizard** (`apps/web/app/create-realm.tsx`). Five steps with a
progress rail: name, characters (six illustrated source cards instead of a
dropdown), packs (generated packs, pools and odds from the server preview, plus
the existing category/pack-name controls), rules (recommended defaults summary;
**Customize gameplay rules** keeps every previous field) and review (summary with
Edit links and what happens next). All steps stay mounted so one submission still
carries every setting; an invalid field opens its step. The preview-fingerprint
check, retry-safe creation key and **Retry realm creation** behave as before.
Admin code moved out of `ui.tsx` (about 450 lines) into these components.

**Name.** The site is now **Kirameki** (きらめき, "sparkle"), set in
`apps/web/lib/brand.ts`. The Discord slash command keeps its registered name
`/atlas`, and the fictional demo universe keeps "The Lantern Atlas".

Browser tests were updated to the new flows (wizard steps, hub sections, market
picker); assertions about creation, previews, retries, settings impact, Discord
linking, joining and invitations are unchanged.

Verification on the host workspace with the local pnpm wrapper:

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 204 unit tests across 35 files passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` (`tsx scripts/e2e.ts`) | Full production browser suite passed with the new wizard, hub sections and market picker (final run after the last UI change). |

`pnpm test:integration` was not rerun for this change: no package, schema, API
or service code changed since its last full pass earlier the same day (335
tests across 35 files). Desktop and phone captures of the hub, every wizard
step, the market panel and both card pickers were reviewed on an original-fixture
preview. The running Docker deployment was not rebuilt.

## Settings layout, Mudae-like values, larger rosters and adding characters (2026-11-08)

Follow-up requests: drop the demo, large test catalog and Wikidata options from
realm creation; replace the 10,000-character cap with a roster-size slider;
shorten the artwork checkbox; let admins add missing characters to an existing
realm through the lookup; fix the "Use 1000 gems every 6 hours" button that did
nothing and the misaligned settings forms; bring card values closer to Mudae;
keep the footer from moving with the page height. Pack visuals stay for later.

**Character sources.** The wizard offers three sources: **Anime & manga roster**
(default), **Your JSON file** and **Your CSV file**. Inside the roster, a
**Data source** switch picks **MyAnimeList** (default; popular roster or chosen
series via Tenrai), **AniList** (chosen series) or **Other formats** (AniList ID
lookup, AniList/Jikan JSON). The 12-character demo and the 1,000-character test
catalog are now download links in the JSON option
(`/catalog-demo.v1.json`, a byte-identical copy of the fixture checked by a unit
test, and `/catalog-scale.v1.json`). The Wikidata picker component was removed;
the importer and `POST /api/catalog/wikidata` remain for scripted use, and the
server still accepts a creation without a catalog (the demo) for API clients and
tests. The artwork opt-in reads **Include character artwork through API,
permission needed** with a one-line consequence, and the catalog preview warns
when a provider roster has no artwork (the cause of the earlier "no images"
realm).

**Roster size.** A slider (100 → 100,000 in fine-to-coarse steps) plus an exact
number field (50–100,000) replaces the 500–10,000 select. The validator, the
preparation state and the provider-catalog service accept 100,000 characters in
a request of up to 100 MiB; this is a request/memory safeguard, not a roster
policy. Previews return counts, packs and odds for the whole roster plus a
300-character sample (`artworkCount` added). Hand-made JSON/CSV limits are
unchanged (1,000 characters, 2 MiB).

**Scaling the realm view.** A synthetic 100,000-character roster took 3.3 s per
realm view. Four result-identical changes bring it to 1.3 s (25,000 characters:
0.3 s, the old 10,000-character time): pack spotlights use a bounded selection
instead of sorting each pool; wishlist odds are computed only for wished
characters (`selectedCharacterOdds`); wishlist demand is aggregated once instead
of one correlated subquery per character; popularity is read from its column
instead of serializing every row with `to_jsonb`, and a realm's values are
quoted with one rules validation (`quoteCharacterValues`). Unit tests compare the
new helpers with the previous full computations. Realm pages still read the
whole roster on the server, so the slider warns above 25,000 characters.

| Characters | Preview | Create | Realm view | Open one pack | Catalog page |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 (before) | 0.24 s | 0.54 s | 0.32 s | 0.07 s | 0.11 s |
| 25,000 (after) | 0.54 s | 1.28 s | 0.30 s | 0.14 s | 0.10 s |
| 100,000 (before → after) | 2.2 → 2.0 s | 6.2 s | 3.3 → 1.3 s | 0.69 → 0.67 s | 1.12 → 0.39 s |

Measured with the embedded test PostgreSQL on the development PC (scratch
benchmark, not part of the suite).

**Adding missing characters.** New **Administration → Characters** section
(`app/realm-characters.tsx`; service `packages/db/src/realm-characters.ts`;
`GET/POST /api/realm-characters`, `POST /api/realm-characters/check`). Three
steps: confirm the lookup (provider, medium, artwork opt-in prefilled from the
realm), search a series, tick cast members. Present characters are marked and
disabled; others show the rarity they would get. Rules:

- Instance admin who also administers the realm; MyAnimeList and AniList
  rosters only (realms from your own JSON/CSV keep their catalog, with an
  explanation instead of the lookup).
- New rows only, inside the realm lock; config revision, cards, packs, receipts
  untouched. New characters join All Characters and their category packs; the
  result lists categories that are new to the realm.
- Rarity: the same source-percentile thresholds as creation (`tierForPercentile`
  extracted from `parseCatalog`), ranked against the realm's saved popularity
  cohort; no evidence → common.
- Idempotent by source key (a retry reports `alreadyPresent`), rejects foreign
  source prefixes and IDs that belong to a different source key, at most 200
  characters per request. Provenance records `importKind: '<source>-addition-v1'`,
  `addedAt` and the cohort size; backups already cover the characters table, so
  no migration or backup format change was needed.

**Settings design language.** `app/rules-fields.tsx` renders every gameplay rule
group once for both **Game rules** and the wizard's **Customize gameplay rules**
(same category tabs; the wizard now also exposes pack price, cards per pack,
starting gems, cooldown and rarity weights). Each setting is a row with its
label/help on the left and the control in a shared right column, numbers carry
their unit inside the field, on/off settings are switches, and rarity weight,
resulting chance and base value share one table (`app/forms.css`). The old
preset buttons ("Use 1000 gems every 6 hours", "Use six-rank progression") reset
values that were already at the defaults, which is why nothing visibly
happened; they are now **Use recommended …** links shown only while a group
differs from the defaults. Rank tracks show a readable summary with the JSON
editor under **Edit ranks as JSON**. `gem-reward-fields.tsx`,
`character-value-fields.tsx`, `trading-fields.tsx` and the old rank-track form
were folded into the shared component.

**Card values.** Default base values per tier are now 30 / 60 / 120 / 260 / 620
gems (were 20 / 60 / 200 / 1,000 / 5,000). With the default 75% popularity bonus
values run from 30 to about 1,085 gems (legendary top was about 8,750, a
437× spread; now about 36×), similar to Mudae's kakera range. Existing realms
keep their saved values; **Game rules → Collection → Use recommended values**
proposes the new ones through the usual previewed settings change.

**Footer.** `body` is a column flex container and `main` grows to the viewport
height, so the footer stays at the bottom of short pages on every screen.

Verification on the host workspace with the local pnpm wrapper (final runs after
the last code change):

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 208 unit tests across 36 files passed (new: helper equivalence for spotlights, wished-character odds and batch value quotes; demo download identity). |
| `pnpm test:integration` | 340 integration tests across 36 files passed (new `realm-characters.test.ts`: summary, check, additions, retry, rarity, RBAC, fixed catalogs; preview sample and the 100,000 ceiling in `catalog-scale.test.ts`). |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` (`tsx scripts/e2e.ts`) | Full production browser suite passed: three content options with the roster as default, demo catalog via JSON upload, rule tabs and **Use recommended** behaviour in the wizard and Game rules, MyAnimeList default source, provider "no pictures" note, test catalog upload, and the Characters lookup adding two of three missing characters against mocked provider responses. |

An intermediate full integration run exposed that schema-0011 snapshots used by
upgrade/restore tests lack the popularity column; the value query now checks
`pg_attribute` once and falls back to `NULL` there. The running Docker deployment
was not rebuilt.

## Live pulls, reveal sounds and opening backdrop (2026-11-08)

Requests: a tracker on the Packs page showing what is being pulled; better
opening sound effects and background animation; admin-provided sounds per
rarity tier (clips cut to 30 seconds). Per-character sounds and background
video clips were explicitly deferred.

**Live pulls.** `recentPulls` (`packages/db/src/pull-feed.ts`, `GET /api/pulls`)
returns the realm's newest awarded cards from saved opening receipts (members
only, newest reveal first, at most 24 cards). Collectors are shown by Discord
display name or as "A collector"; emails never leave the server. Migration 0024
adds `openings_realm_recent (realm_id, created_at DESC, id DESC)`.
`app/pull-tracker.tsx` renders a horizontal strip under the Packs hero, polls
every 15 seconds while the tab is visible and after your own opening, slides new
cards in, makes epic/legendary glow and outlines your own pulls; reduced motion
disables the animations.

**Sounds.** The synthesized scores were rewritten (`app/reveal-audio.ts`): tiers
now differ in instrumentation as well as length: plucks, chimes with inharmonic
bell partials, impacts with pitch drops, choir-like detuned chords, fanfares and
sparkle cascades, plus filtered-noise whooshes, risers, impact bodies and glitter.
When the browser supports it, cues share a compressor and a generated reverb
whose send grows with rarity. Minimal audio contexts keep the original
oscillator-only path, so the existing lifecycle tests (cancellation, bounds,
distinct tiers, unlock/mute/reduced-motion) still apply unchanged.

**Custom tier sounds.** Migration 0024 adds `realm_tier_sounds` (one row per realm
and tier; base64 16-bit PCM WAV, file name, duration ≤ 30,000 ms, permission flag,
uploader). `app/sound-prepare.ts` decodes any browser-supported file, cuts it to
30 seconds with a fade-out, renders mono 32 kHz through an `OfflineAudioContext`
and encodes WAV; `setTierSound` re-validates the RIFF header, PCM format and
duration (`wavDuration`) and requires a realm admin. `GET /api/tier-sound` serves
members; the realm view lists which tiers have sounds (no bytes). Reveals preload
the URLs and play the custom sound instead of the built-in arrival cue, falling
back to the synthesized cue if it cannot load. The table is part of encrypted
backups; pre-0024 snapshots restore without sounds. Manually verified in Edge: a
35-second 44.1 kHz stereo WAV uploaded through **Administration → Reveal sounds**
was saved as exactly 30 s (1,920,044-byte WAV) and served back.

**Backdrop.** `app/reveal-backdrop.tsx` draws a canvas under the opening room and
the preparation screen: tier-tinted aurora, a particle field that drifts, spirals
inward while charging and bursts outward on arrival with shockwave rings; epic and
legendary add rotating light rays and legendary twinkling glitter. Pixel ratio is
capped at 1.5, drawing pauses in hidden tabs, and it is not rendered for reduced
motion. The pack wrapper designs were not changed in this round.

Verification on the host workspace with the local pnpm wrapper:

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 211 unit tests across 37 files passed (new `reveal-sounds.test.ts`: WAV encoding, server duration check, 30-second limit, fade-out; existing reveal-audio lifecycle tests unchanged). |
| `pnpm test:integration` | 343 integration tests across 37 files passed (new `pulls-and-sounds.test.ts`: feed order, members only, no emails; sound storage, replacement, removal, RBAC, invalid/too-long audio). |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Full production browser suite passed, including the Live pulls strip listing the card just opened. |

The first full browser run failed in the pack-information hover check: the
tracker grew after loading and shifted the page under the pointer. Loading,
empty and filled states now share one height. The running Docker deployment was
not rebuilt.

## Pack wrappers, character sounds, artwork backfill and Bakufu (2026-11-08)

Requests: redesign the sealed packs and make the tear more satisfying; let admins
attach a sound to a specific character (priority over the rarity sound); add
artwork to characters already in a realm created without it; a browser test for
the Reveal sounds page; rename the site and the Discord command to Bakufu.
Background video clips per tier/character remain unimplemented.

**Pack wrappers.** `app/pack-palettes.ts` gives every pack theme (or, without a
theme, its sigil shape) an original five-colour palette, applied as CSS variables
on the wrapper. `app/pack-premium.css` restyles the existing wrapper structure so
every place a pack appears keeps its geometry: radial body in the theme colour,
inner double frame with guilloche lines and corner rivets, ridged crimp seals with
a sawtooth edge, a dashed tear line with side notches, a pulsing glow emblem
behind the theme sigil, gradient title type and a holographic film with a light
sweep (stronger on hover and in the opening room).

**Tear moment.** The seal strip in the opening room now uses the pack's palette;
while it tears off, a flash runs along the tear line and sixteen foil scraps with
fixed, spread trajectories fly out. Every charge cue starts with a short
synthesized foil rip (two crackling filtered-noise layers with deterministic level
steps). Reduced motion disables the sheen, emblem pulse, flash and scraps; the
existing audio lifecycle tests still pass unchanged.

**Character sounds.** Migration 0025 adds `realm_character_sounds` (realm and
character key, same WAV/30-second/permission rules as tier sounds, included in
backups and gated for older snapshots). `setCharacterSound`,
`removeCharacterSound` and `readCharacterSound` require a realm admin to write and
membership to read; the realm view lists `characterSounds` (no bytes). Reveals
preload the sounds of the awarded characters and play a character's sound before
its rarity sound before the built-in cue. **Administration → Reveal sounds → By
character** searches the realm catalog and offers Play/Replace/Remove.

**Artwork backfill.** `realmArtworkGaps` and `backfillRealmArtwork`
(`GET/POST /api/realm-characters/artwork`, instance admin who administers the
realm) add provider artwork references to characters that have none, matched by
stable source key, never replacing existing references and leaving names, rarity,
ownership and receipts unchanged (at most 500 per request). The **Add artwork to
existing characters** panel in Administration → Characters walks the popular
MyAnimeList series again with artwork enabled (paced, 50 characters per series,
pause/resume, stops after 80 series without a match).

**Bakufu.** `siteName` is now Bakufu. The slash command is `/bakufu`
(`discordCommandName`); interactions named `atlas` are still accepted, and
`pnpm discord:commands` now removes a guild's former `/atlas` registration after
upserting `/bakufu` (best effort). Button custom IDs keep their `atlas:` prefix so
reviews posted before the upgrade still work.

Verification on the host workspace with the local pnpm wrapper:

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 211 unit tests across 37 files passed (Discord registration now also covers removing the former `/atlas`). |
| `pnpm test:integration` | 345 integration tests across 37 files passed (new: character sound storage, priority data, RBAC and limits; artwork gaps and backfill, no overwrite, retry, foreign URLs, fixed catalogs). |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Full production browser suite passed, including the new `reveal-sounds-browser.ts` (permission gate, a 35-second stereo upload saved as 30 s, character sound upload and removal) and the `/bakufu` interaction payloads. |

Pack wrappers, the tear moment, the character-sound section and the artwork panel
were also reviewed on desktop screenshots of an original-fixture preview. The
running Docker deployment was not rebuilt.

## Waifus/husbandos, removable packs, info bubble and public test (2026-11-08)

Requests: the pack information bubble appeared behind the tiles below it; only
All Characters should be mandatory; add female (waifus) and male (husbandos)
packs; prepare a small public test with Cloudflare.

**Info bubble.** Pack tiles are separate stacking contexts, so a bubble's own
z-index could not rise above later tiles. The tile whose bubble is open,
hovered or focused is now lifted (`.pack:has(.pack-insight[open])`, …).

**Removable packs.** Migration 0026 adds `packs.retired_at`. `retireRealmPack`
(realm admin; `POST /api/realm-packs/remove`) retires a category pack instead of
deleting it, because openings and Discord reviews reference packs. Retired packs
are excluded from the realm view, pack plans, Discord pack lists and settings
impact, and opening one fails with NOT_FOUND without charging. Adding the same
category again reactivates the original pack ID. All Characters cannot be
removed. Administration → Packs shows a two-step **Remove**/**Confirm remove** per
category pack; the wizard text states that every other pack is optional. Pack
queries read `retired_at` through `to_jsonb` so pre-0026 databases used by
upgrade/restore checks still work.

**Waifus and husbandos.** `Female` and `Male` categories are named **Waifus** and
**Husbandos** (shōjo and seinen palettes). AniList series imports now request
`gender` and add the category directly. Tenrai/Jikan expose no gender (verified
in the Tenrai API reference), so a new `profile` provider step reads one
character and returns only an inferred gender: an explicit "Gender:"/"Sex:" line,
otherwise at least three pronouns agreeing two to one, else unknown. The
biography is never stored. `realmGenderGaps`/`setRealmCharacterGenders`
(instance admin who administers the realm) list unchecked characters by
popularity and record results (category plus provenance `gender`,
`genderCheckedAt`, `genderSource`), idempotently. The **Waifus & husbandos**
panel in Administration → Characters runs the paced checks (pause/continue) and
creates both packs.

**Public test.** The earlier trial left `.tools/cloudflared.exe`, tunnel logs and
`docs/deployment/discord-playtest.md`. `scripts/public-test.ps1` (`-Start`,
`-Status`, `-Stop`) starts a quick tunnel, waits for its address, switches
`APP_ORIGIN`/`COOKIE_SECURE` in `.env` (UTF-8 without BOM, previous values saved
under `.test-data/`) and prints the Docker command and the two Discord URLs. It
never prints secrets, restarts Docker or edits Discord. The checklist is in
`docs/deployment/public-test.md`. The script was parsed and `-Status` was run;
the tunnel itself was not started.

Verification on the host workspace with the local pnpm wrapper:

| Command | Result |
| --- | --- |
| `pnpm lint` | Full repository lint passed. |
| `pnpm typecheck` | Root and web TypeScript passed. |
| `pnpm test` | 214 unit tests across 38 files passed (new `waifu-packs.test.ts`: pack names, gender inference rules, profile step with a fixture response that never returns the biography). |
| `pnpm test:integration` | 346 integration tests across 37 files passed (gender gaps ordering, idempotent recording, RBAC; Waifus pack built, removal blocked for All Characters, retired pack hidden and unopenable, restored with its original ID). |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Full production browser suite passed (including the pack information hover check). |

The running Docker deployment was not rebuilt and the tunnel was not started.

## Faster MyAnimeList pacing and waifu/husbando detection during preparation (2026-11-08)

Requests: detect waifus/husbandos already while a new MyAnimeList roster is
prepared; explain (and reduce) the deliberate slowness.

**Pacing.** Preparation was throttled on purpose: 1.25 s between requests and an
instance budget of 50 requests/minute for both Tenrai and the legacy Jikan API.
`jikanPacing` (`packages/importers/src/jikan-pacing.ts`, browser-safe) now sets
per-service values below the published limits: Tenrai (120/minute, 4/second)
0.65 s spacing and a budget of 100/minute; legacy Jikan (60/minute, 3/second)
1.1 s and 55/minute. The server keeps one budget per service. The preparation
page, artwork and gender panels and `scripts/prepare-jikan.ts` use these values;
a unit test checks them against the published limits and the sources
integration test covers both budgets.

**Detection during preparation.** **Detect waifus & husbandos** (on by default
under Popular roster, also used by Prepare selected series) runs the profile
step for each character that enters the roster, keeps results across
pause/resume, checks any skipped characters before review and adds the Female or
Male category to the prepared catalog (also in the downloaded JSON). The time
estimate includes the extra lookups. The Jikan browser test now prepares 50
characters with detection (50 profile requests, Waifus/Husbandos in the preview)
and the 1,000-character roster without it.

The first build of this round failed because client pages imported the pacing
values from the server-side adapter (pulling `node:crypto` into the browser
bundle); the values now live in their own module.

| Command | Result |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | Passed. |
| `pnpm test` | 215 unit tests across 38 files passed. |
| `pnpm test:integration` | 346 integration tests across 37 files passed. |
| `pnpm build` | Production build passed (after the module move). |
| `pnpm test:e2e` | Full production browser suite passed. |

The running Docker deployment was not rebuilt.


## Player collection repair, pull odds review, standing-based rarity and GitHub preparation

**Pull odds review.** The draw code was checked against the user's own realms
(read-only aggregate queries). It is correct: each card picks a rarity by weight,
then a character inside it, using `node:crypto`. The surprising results came from
pool composition, not luck or a bug. In "bulk test 2" the Husbandos pack paid 82
rare, 29 epic and 5 legendary cards, because the waifu/husbando detection had
tagged the most popular characters first, so the Male category held mostly top
tiers. In "Anime API test" the Action pool's cheaper tiers had been bought out, so
renormalization paid out the remaining high tiers (the same two legendaries were
recycled and re-pulled repeatedly). In a full pool the old preset was very stingy:
epic about 1 in 345 pulls, legendary 1 in 10,000. A new statistical unit test
draws 200,000 cards with a seeded generator and checks every tier against its
displayed chance (within five standard deviations); another documents the
empty-tier renormalization.

**New default odds.** 65 / 26 / 7 / 1.7 / 0.3% (were 80 / 17 / 2.7 / 0.29 / 0.01%).
Existing realms keep their saved weights until an admin applies **Use recommended
values** (preview and receipt as before).

**Standing-based rarity (`source-standing-v3`).** New five-tier rosters rank
characters by 60% overall popularity rank + 40% rank inside the character's
series + 10% for the main cast (MyAnimeList `Main`/AniList `MAIN`, now kept as an
optional `role` in catalog entries; main in any series counts). Bands: 0.5%
legendary, 2.5% epic, 9% rare, 28% uncommon, 60% common; main characters and each
series' favourite are never common. Standing and role are saved in character
provenance, and **Administration → Characters** additions in standing-v3 realms
are placed among the saved standings. Existing realms keep their tiers;
three-tier realms keep popularity percentiles. Answer to the sample-size
question: a larger roster only lifts characters if it adds less popular series
below them; rosters prepared from popular series stay top-heavy under
popularity-only ranking, which the series component corrects.

**Player collections (migration 0027).** `admin_collection_actions` records
restore/return/gem actions (actor, member, card, amount, reason, receipt);
`card_transfers` now holds either a trade move or an admin move
(`admin_action_id`, exactly one of the two); wallet reason `admin_adjustment`.
Services `adminMemberCollection` and `adminCollectionCommand` require realm-admin
membership, lock the realm, address members by trade code and are idempotent per
request key. Restoring moves the recycling row into the action receipt and
reactivates the same card (origin and XP history unchanged); recycling retries of
the old request key return the old receipt. Returning a card requires an earlier
owner and refuses cards in pending trades or market listings. Backups include the
table, and restores reconcile every action with its ledger entry, card move or
undone recycling; snapshots before 0027 restore without it. Not implemented:
granting a never-owned character or removing a card without moving it.
UI: **Administration → Player collections** (member lookup, recently recycled,
traded/sold away with market price, gem adjustment, filterable collection,
action history, wallet activity). The member picker's wording is now
configurable.

**Inspector.** The reveal's tier effect layer moved to `rarity-effects.tsx`; the
card inspector renders it and replays the face-phase effect and the tier arrival
on every open (reduced motion hides it). Live pulls now include the character
value and ownership status, so their inspector matches collection and glossary.

**GitHub preparation.** `git init` on `main`, extended `.gitignore`, a
`.prettierrc.json` matching the existing style (single quotes, 100 columns; an
unconfigured Prettier run had switched touched files to double quotes and was
reverted), `CHANGELOG.md` (0.1.0-alpha.1) and `.github/workflows/ci.yml` (lint,
typecheck, unit, integration and build on Ubuntu; browser suite on manual
dispatch). The CI workflow has not run yet; it first runs after the first push.
The files to commit were scanned for keys, tokens, real e-mail addresses and
local paths (none found; `.env` stays ignored).

During this round the first full integration run failed once: recycling on the
schema-3 legacy fixture queried the new table before migration. The lookup and
backup check now skip when the table does not exist.

The browser suite first failed on the old scale-catalog tier counts (updated),
then on card geometry measured mid-animation (the measurement helper now waits
for finite animations) and on a sideways scroll in the phone inspector (the
effect layer is now positioned against and clipped to the dialog).

| Command | Result |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | Passed. |
| `pnpm test` | 221 unit tests across 39 files passed. |
| `pnpm test:integration` | 351 integration tests across 38 files passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Full production browser suite passed, including the new Player collections and inspector checks. |

The running Docker deployment was not rebuilt. The GitHub remote was not created.


## Free hosting preparation: Vercel + Neon

Goal: run Bakufu on free tiers (Vercel Hobby for the website, Neon Free for
PostgreSQL) with Discord sign-in as the main login and the `/bakufu` slash
commands off. A review of the code found nothing tied to a long-running server:
no runtime file writes, no background loops on the server, and only
transaction-scoped advisory locks (compatible with Neon's PgBouncer pooler).
The interactions endpoint already returns 503 without `DISCORD_PUBLIC_KEY`, and
`DISCORD_ADMIN_USER_ID` already bootstraps the first admin through Discord.

Changes:

- `apps/web/lib/request-body.ts` replaces the route's inline body reader. It
  still streams with a byte cap and now also accepts gzip, recognized by its
  signature (so it works whether or not a proxy kept `Content-Encoding`), with
  `maxOutputLength` set to the same cap; an oversized expansion returns 413 and
  broken compression 400. `post()` compresses JSON bodies over 256 KB with
  `CompressionStream` (rosters compress about 5–10×).
- The API route exports `maxDuration = 60` (ignored when self-hosted).
- `createDatabase` reads `DATABASE_POOL_MAX` (1–50, default 10) and closes idle
  connections after 10 seconds. The Discord pool's `options` startup parameters
  would not pass Neon's pooler, which is acceptable because slash commands are
  off on this setup.
- The live-pulls panel pauses its 15-second polling after 5 minutes without
  input, because an always-polling tab would keep Neon's compute awake and use
  up the free compute hours.
- `removeDiscordCommands` and `pnpm discord:commands remove` delete `/bakufu`
  and `/atlas` from one server (fixture-tested; no live Discord call in tests).
- `docs/deployment/vercel-neon.md` covers Neon, migrations and backups from the
  PC through Docker, moving an existing game with backup/restore, Vercel settings
  (root directory `apps/web`, environment variables, function region, Node 24),
  Discord OAuth with the permanent `*.vercel.app` redirect and
  `DISCORD_ADMIN_USER_ID`, updates and limits.

Not verified: an actual Vercel or Neon deployment (no account access from here).
Idea recorded on the roadmap: a guided setup (installer or admin GUI) for
self-hosters.

The browser suite now also posts a compressed preview through the real server
(read and answered with 200) and a small compressed body that would unpack past
the cap (413). The first run expected 400 for the partial preview, but the
preview completes missing fields with defaults; the expectation was corrected.

| Command | Result |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | Passed. |
| `pnpm test` | 225 unit tests across 40 files passed. |
| `pnpm test:integration` | 351 integration tests across 38 files passed. |
| `pnpm build` | Production build passed. |
| `pnpm test:e2e` | Full production browser suite passed. |
