# ADR 0001: realm-scoped state and atomic pack opening

Status: accepted for the first playable slice.

Use TypeScript/pnpm, Next.js App Router, Zod, and PostgreSQL. Parameterized SQL
through `pg` and checked-in SQL migrations keep the small persistence layer and
its constraints explicit; an ORM is deliberately unnecessary for this slice.
The core package has no framework or database dependency. No hosted service is
required. Local password accounts and opaque, database-backed sessions work
without Discord or an external identity provider.

Every catalog, pack, membership, card, ledger entry, and opening has a realm ID.
Composite foreign keys prevent references across realms. Character UUIDs and
source-qualified keys survive import, export, and restore. A unique constraint
on `(realm_id, character_id)` enforces Classic ownership across all packs.
Casual ownership and live settings changes are deferred rather than simulated.

Pack opening locks the realm row with `FOR UPDATE`, then checks membership,
idempotency, eligibility, wallet, and cooldown. It draws on the server, writes
the opening receipt, claims cards, debits the wallet, and appends a ledger entry
in one transaction. Requests within one realm serialize; other realms remain
independent. This intentionally trades per-realm throughput for a short,
auditable implementation. The unique constraints remain a final defense.

An idempotency UUID is scoped to realm and player and bound to a pack. Completed
successes and business failures are persisted and replayed; reusing a key for a
different pack is rejected. Database exceptions roll back everything. Retrying
an aborted transaction may draw a different result because no result committed;
retrying a committed request always returns the stored result without drawing.

Version 1 supports Classic mode only. Empty tiers have zero available odds;
positive configured weights are renormalized across remaining tiers before
each draw. If the full advertised pack size cannot be satisfied, opening fails
without debit or cooldown. Availability shown in the UI is a snapshot, not a
reservation. Prices, pool minimum, pack count/size, starting gems, cooldown, and
tier weights live in validated versioned realm settings.

Bootstrap is an operator-only CLI with a hidden password prompt, no defaults,
and a transaction lock preventing a second bootstrap. The same trusted local
operator can provision invited players. HTTP mutations require same-origin
requests and a valid HttpOnly session; every game service rechecks database
permissions. Admin creation of a realm installs the validated original demo
catalog and generated packs atomically.

Player JSON is a versioned personal archive and cannot mint live inventory.
Full recovery uses a versioned encrypted PostgreSQL data snapshot, migration
manifest, SHA-256 integrity check, and transactional restore into an empty
database. Server-side JSON preserves timestamp microseconds. Backups include
private authentication hashes but exclude sessions, and must stay outside the
repository with operator-controlled retention. Standard PostgreSQL dump/restore
is documented as an additional operator option, not the tested recovery path.
Scheduling, offsite storage, portable full-realm JSON, trading, and Discord
gameplay commands remain later milestones. Recycling and Discord website login
are covered by the follow-ups below.

References: [PostgreSQL row locking](https://www.postgresql.org/docs/17/explicit-locking.html),
[Next.js installation](https://nextjs.org/docs/app/getting-started/installation).

## Authentication follow-up: optional Discord login

Local login remains supported. An optional OAuth adapter requests `identify`
only, uses S256 PKCE and one-time browser-bound state, validates the issuer,
and verifies `/users/@me` on the server. A globally unique Discord user ID maps
to an existing internal account; no automatic matching by email or username.
Local accounts are explicitly linked by an operator. A configured Discord ID
can bootstrap the first admin only, under the same transaction lock as local
bootstrap. Realm admins can invite Discord players, with membership/grant writes
in one transaction. Sessions, permissions, and gameplay services are shared.
Provider tokens are discarded. Linked IDs are encrypted in instance backups;
OAuth flow state and sessions are excluded. The additive migration preserves
existing account and gameplay IDs. Session cookies use SameSite=Lax so the
provider return navigation succeeds, with Origin checks on form/API mutations.
Discord pack commands and signature verification were added in Milestone 3B below.

## Milestone 2A: recycling

Recycling uses the same realm-row transaction lock as opening packs. It checks
membership and current card ownership, replays an existing receipt before
checking availability, then records the receipt, retires the card, credits the
wallet, and appends its ledger entry in one transaction. A receipt is unique
per card and per realm/player/request key. Recycling ledger keys use a
`recycle:` prefix so they cannot collide with opening keys. Unavailable cards
and unauthorized requests produce no receipt, reward, or cooldown change.

Cards retain their stable IDs and acquisition history with `recycled_at` set.
A partial unique index on `(realm_id, character_id)` for active cards replaces
the original unconditional uniqueness constraint. Eligibility, collection,
and export queries use active cards only. A new claim of the released character
gets a new card ID; replaying an old receipt never touches that new claim.
Future trade services must reject retired cards using the same active predicate.

Realm configuration version 2 adds per-tier recycling rewards (defaults 2/4/6
gems). The explicit v1 migration preserves other settings, cards, wallets, and
IDs. Rewards are chosen on the server and snapshotted in the receipt. Overrides
are supported when creating a realm; live settings editing remains a later
slice. Default rewards are below the default one-card pack price. Custom prices,
sizes, and rewards can change that economy and are the administrator's policy.

Player archive version 2 adds personal recycling history while keeping current
cards active-only; the parser explicitly upgrades v1 archives with empty history.
Encrypted instance backups include retired cards and receipts, and restore is
tested in a freshly migrated database. Original and Discord-era backups are
explicitly upgraded using recognized migration/checksum prefixes; unknown
revisions are rejected. No XP or upgrades are awarded here.

Reference: [PostgreSQL partial unique indexes](https://www.postgresql.org/docs/18/indexes-partial.html).

## Milestone 2B: XP and levels

Configuration v3 adds XP per first collection (default 10) and cumulative level
thresholds (default 0,20,40,70,100). Level is derived from total XP and the realm
rules rather than stored separately. Reaching the highest configured level
does not stop XP accumulation. No gem rewards or upgrades are attached yet.

A realm/player/character can have one `first_collection` XP-ledger row, enforced
by a partial unique index. Zero-XP rows also consume this first-collection slot.
Successful pack opening records unseen characters, their awards, the membership
XP total, ownership, gem debit, and receipt in the existing realm-locked
transaction. Retries replay the original receipt; failures and rollbacks award
nothing. Recycling never awards/removes XP. A later re-claim by that same player
has no XP reward; a different player can earn their own first-collection award.

Migration 0004 seeds zero-XP first-collection rows from all existing cards,
including retired history. It preserves existing membership XP in auditable
migration-baseline rows, with no retroactive rewards. Older backups use the
same explicit seed policy during restore. Existing opening receipts remain
unchanged; only new receipts carry optional progression details.

Current player archive v3 includes realm progression rules, derived level, and
the player's XP ledger. Legacy v1/v2 archives remain readable without inventing
missing XP histories or rule settings. Restore verifies XP totals, event/card
references, and first-collection coverage in addition to wallet/recycling checks.
Admin settings overrides are exposed at realm creation; live editing is deferred.

## Milestone 2C: purchasable pack discounts

Configuration v4 adds a bounded rank list for `pack_discount`. Defaults are
rank 1 at level 2 for 10 gems (1 gem off) and rank 2 at level 3 for 20 gems
(2 gems off). Discounts are cumulative per pack, with price clamped at zero.
An empty rank list disables purchases. New-realm controls expose these rules;
live editing remains deferred. Default discounts keep one-card packs above
the largest recycling reward. Custom economy settings can change this policy.

Purchases are append-only realm/player records. A unique index on
realm/player/upgrade/rank prevents duplicate ownership; a separate request-key
constraint permits replay. Commands specify the expected target rank, so
concurrent requests with different keys cannot accidentally buy successive
ranks. The service authenticates membership and locks the same realm row as
opening/recycling, then checks rank, level, and balance before recording the
purchase receipt, wallet debit, and namespaced ledger entry atomically. XP and
cooldown remain unchanged. Historical receipts replay before checking rank.

Future opening prices derive from the player's purchased rank and stored realm
rules. The dashboard displays that same price; draw size, odds, ownership, and
XP rules remain unchanged. New opening receipts identify the applied rank.
Existing realms migrate with no purchased ranks or balance changes. Current
player archives include purchase history and upgrade rules. Instance backups
preserve purchases and verify contiguous ranks, receipts, policy snapshots,
and debit reconciliation. Older snapshots restore with no purchases.

## Milestone 2D: wishlists and targeting

Configuration v5 adds wishlist slots (default 3, range 0–20) and an integer
within-tier weight multiplier (default 2, range 1–10). Rarity selection retains
its existing weights and empty-tier renormalization. Within a selected tier,
wished eligible characters receive the multiplier and others receive weight 1.
Each later draw recalculates weights without replacement. Wishlist membership
never bypasses realm ownership, pack categories, or zero-weight tiers.

Entries belong to a realm/player with a unique character and stable entry ID.
Wishes persist after collecting or recycling; unavailable wishes have zero
chance and still use a slot. Another player cannot view or edit those wishes.
The small original-catalog UI exposes per-wish next-draw chances for every pack
and aggregate next-draw wishlist chance. A multiplier is a weight, not a direct
probability multiplier or guaranteed outcome. A lone eligible character can
naturally have 100% chance, independent of a wishlist.

Add/remove commands authorize membership and use the same realm lock as game
writes, enforcing capacity under concurrency. Desired state plus a request key
produces an immutable receipt, so a stale retry cannot undo a later add/remove.
Preference changes spend no gems or XP and do not reset cooldown. Openings read
wishes and snapshot their IDs and multiplier inside the claim/debit transaction.
Legacy opening receipts are untouched. Old databases/backups gain default rules
and empty lists. Current player archives preserve personal entries and rules;
instance backups also preserve change receipts and validate capacity/identity.

## Milestone 2E: reviewed live realm settings

Realm admins can preview and apply validated v5 gameplay rules. Prices, sizes,
starting grants for future members, cooldowns, weights, recycling/XP rewards,
levels, wishlist rules, and unpurchased upgrade ranks are editable. Ownership and
pack-generation settings remain creation-only so existing claims and pack IDs
stay valid. Purchased rank definitions cannot change or disappear, and slot
reductions cannot strand a player's current wishes above capacity. Existing XP,
wallets, cards, purchases, and historical receipts are never rewritten.

Previews are short-lived database records bound to the reviewing admin, realm,
proposed rules, current configuration revision, and a hash of relevant realm
state. Preview and apply authorize realm-admin membership and take the existing
realm lock. Gameplay and member provisioning already use that lock. Apply takes
only the preview ID and a request UUID, rechecks expiry/state/constraints, then
updates rules/revision and records an immutable audit receipt atomically.
Concurrent admins, gameplay, or membership changes require a fresh preview.
Same-key retries replay before checking expired previews; new keys cannot
apply an old preview twice. Preview records are transient and excluded from
backups; versioned configuration audit history is preserved and validated on
fresh restore. Player archives remain v5 and reflect current public rules.

## Milestone 3A: two-party trades

Trades are private to their two realm members, addressed through shareable,
realm-specific trade codes rather than account emails or provider IDs. Each
participant edits only their own card/gem offer. Immutable offer versions and
per-version confirmations require both participants to approve identical terms;
an edit resets effective confirmations. Pending card reservations prevent
recycling or promising the same card elsewhere. Gems are checked on offers and
confirmation and moved only at settlement, not held in escrow. Both net wallet
entries, card transfers, zero-XP discovery markers, completion, and request
receipt commit under the same realm lock as other gameplay.

Cards retain their UUID, original opener, acquisition timestamp, and opening
reference while current ownership changes. A numbered transfer journal preserves
lineage. Trade acquisition awards no XP but marks a character known, preventing
recycle/reclaim farming. Receipts replay without moving assets again. Either
participant may cancel; fixed expiries release reservations lazily on later
mutations, with no scheduler dependency. Config v6 defaults to enabled trading,
5 cards/side, 1,000,000 gems/side, 10 pending trades/player, and 24-hour expiry.
Creation rules are snapshotted for pending trades; live edits affect new offers.
Player archive v6 and instance backups preserve trade state and transfer history;
old data migrates without transfers or balance changes. Settings audit snapshots
are compared through explicit config migrations rather than rewritten.

## Milestone 3B: signed Discord pack commands

The optional HTTP adapter verifies Ed25519 signatures over timestamp plus raw
request bytes, checks timestamp freshness and application ID, then maps a
server to one realm and an existing Discord identity to a realm member. Signing
in or using a command never creates membership. Replies are private and disable
mentions. No Discord tokens or submitted raw payloads are logged or persisted.

`/bakufu status` and `/bakufu packs` read that member's state. `/bakufu open` creates
a ten-minute, actor/server/realm/pack/revision-bound quote with a confirmation
button. The quote UUID is also the authoritative opening request key, so duplicate
interaction deliveries and repeated clicks cannot debit twice. Confirmation
locks the same realm row and calls the very same pack transaction as the web.
Configuration changes reject uncommitted quotes; purchased discounts may only
lower the quoted maximum cost. Guild unlink/relink invalidates old quotes.

Commands use a separate small PostgreSQL pool with bounded connection, lock,
statement, and whole-transaction timeouts to leave room for Discord's initial
response deadline, plus a client deadline that destroys a stalled connection.
Busy requests fail without a background task; retry the
same confirmation and inspect the website if delivery is uncertain. No follow-up
webhook token, worker, or always-running request handler is needed for this slice.
Server bindings survive encrypted recovery; transient quotes do not. Config and
player archive versions remain v6. Server-membership admission and member-name
lookup remain separate follow-ups.

## Milestone 3C: private realm member search

Cache only Discord username/display name from verified OAuth `/users/@me`,
after resolving an existing invitation/link or the configured first admin.
Names are presentation, never identity, membership proof, or account-merge keys.
No manual profile-write endpoint or provider token is added. Existing links
start without names and can refresh them through the next Discord sign-in.

Member lookup requires the caller's membership in the selected realm. Responses
contain only realm trade code and cached names, excluding the caller, account
IDs, provider IDs, emails, wallets, and collections. Bounded pages use stable
trade-code cursors; substring search treats wildcard characters literally.
The trade form selects an explicit result and still submits its stable trade
code to the unchanged transactional trade service. Duplicate names and renames
cannot redirect an existing offer. Unknown/local profiles retain code fallbacks.

The same realm-scoped projection labels existing trade counterparties in the
dashboard. Personal archive v7 adds only the exporting player's cached profile;
other members' names are not copied into personal archives. Encrypted backups
preserve profile names and refresh timestamps; earlier snapshots have no invented
names. Realm configuration remains v6. Server-based admission remains deferred.

## Milestone 3D: explicit Discord server admission

Invite-only remains the default. A realm admin can enable a join link for the
realm's linked Discord server; explicit operator/account invitations remain
valid. This policy controls joining, not continued access. Existing membership,
progress, and local sign-in are preserved when a server is left or joining closes.
Ongoing affiliation enforcement and role restrictions are outside this slice.

The join page reveals only the deliberately shared realm name and server ID.
Its OAuth flow stores the target code/revision/server in browser-bound, one-time
server state and requests `guilds.members.read` only for that join. The adapter
checks `/users/@me/guilds/{guild.id}/member` with the same user's short-lived token,
requires the matching identity and completed screening, and discards provider
tokens, roles, and unrelated guild data. It never lists all servers or members.

The login transaction takes the existing identity advisory lock, then the realm
lock. It rechecks the live policy revision/link and proof freshness before
creating an account or player membership. Membership, one starting grant,
admission receipt, optional profile refresh, and session commit together. Repeats
reuse identity/membership and cannot repeat grants or gain admin privileges.
Policy saves use revisions, durable audit receipts, and request keys. Disabling
or changing policy invalidates pending joins. Active admission must be disabled
before changing its linked server. Backups preserve policy/audit/admission rows;
OAuth state and proofs stay transient. Config remains v6; personal archive v8
adds only the player's own server-admission receipt, with legacy readers intact.

## Milestone 4A: independent scheduled snapshot jobs

Keep the existing encrypted snapshot/restore format and repeatable-read capture.
The optional worker runs outside HTTP handlers, using a versioned deployment
policy and a passphrase read from a separate private file. Default retention is
seven daily and four Monday-based weekly generations at a UTC daily boundary.
No scheduler, destination, or secret is enabled for an existing deployment.

The optional Compose entrypoint stages its read-only secret on a private tmpfs
with explicit mode 600. Docker Desktop reports broad synthetic Linux modes for
Windows bind mounts, which do not represent host ACLs. The staged copy preserves
strict POSIX checks without relaxing the normal host worker or writing the key
to the backup destination/image. The temporary mount is discarded with the
container. Its path and contents never enter logs or snapshots.

The destination interface separates exact-name listing/reading, exclusive atomic
publication, removal, and generic status from scheduling. The initial adapter
uses a deliberately initialized namespace on a mounted filesystem outside the
repository. A remote mount is an operator deployment choice. Direct cloud APIs
remain separate adapters. Final snapshots are encrypted, flushed, and linked
exclusively from private temporary files; existing generations never overwrite.
POSIX directory entries are also synced. Windows relies on file flush and atomic
filesystem publication. Interrupted encrypted temporary files are ignored.

A PostgreSQL session advisory lock excludes overlapping jobs across processes.
Retries authenticate current generations and finish partial daily/weekly output.
Only after both outputs authenticate may retention remove older matching files.
A changed passphrase or backwards clock stops the job instead of pruning.
Namespace markers prevent an empty replacement mount being initialized silently.
Status has generic outcome/times/counts only; health fails on failure or 36-hour
staleness. Monitoring/alerts are a host responsibility. Authentication of a file
does not establish restore correctness: integration tests restore a scheduled
snapshot into a fresh database and compare stable player exports.

## Milestone 4B: opt-in automated restore checks

Run restore drills independently of the game and backup capture. The verifier
reads an existing encrypted snapshot and uses only a separately configured
PostgreSQL control database named `card_engine_restore_control`. Initialization
requires a pristine control database and installs only versioned operator
metadata. The optional Compose deployment gives it a separate PostgreSQL service,
private network, and no live game connection or published database port.

Each drill reserves a random database name, creates it from template0, marks its
ownership with an unguessable job ID, migrates, restores, and compares all source
fields with PostgreSQL-typed values. This preserves timestamp microseconds and
handles documented legacy configuration migrations. Success also requires
discarded sessions/OAuth state to be empty and the temporary database to be
removed. Cleanup checks the registered name, database owner, and exact ownership
comment before dropping; unknown databases are never adopted. Interrupted owned
drills are cleaned on the next run. Ambiguous unmarked databases fail closed
and require operator investigation on the separate restore service.

Weekly scheduling and manual runs share an advisory lock and generic status,
separate from backup capture health. Recent readable ciphertext is insufficient:
the database restore and comparison must finish, followed by cleanup. Failed
checks preserve the last successful timestamp but remain unhealthy. This checks
the chosen destination and release, not disaster access to an offsite mount,
operator secrets, or the running website. No drill runs without explicit setup.

## Milestone 4C: portable HTTPS deployment and health

Keep the base localhost deployment. An optional Compose overlay adds Caddy and
an offline settings check before public ports start. Require one DNS hostname,
its exact HTTPS origin, and secure cookies. Persist certificates in proxy volumes.
The database has no host port; the app host port remains loopback-only. Core
services remain independent of the proxy and VPS/cloud provider.

Anonymous liveness reports only HTTP process availability. Readiness checks
PostgreSQL access and the release's migration-name manifest through a separate
bounded pool. Concurrent probes share one query; no account/gameplay data is
read or returned. Readiness does not establish ledger/backup integrity. Docker
and the proxy startup dependency use readiness. Preserve configured-origin
redirects, raw signed interaction bodies, and transactional retry boundaries.
Do not retry writes at the proxy. Access logs remain off; runtime proxy logs
drop request objects to avoid disclosing failed OAuth callback query strings.
Test the proxy on an isolated network with a local certificate authority.
Public DNS, ACME, hosting, and firewall changes remain operator deployment steps.

## Milestone 4D: optional encrypted offsite copies

Keep capture and local retention unchanged. A separate opt-in job copies retained
encrypted generations to an explicitly initialized S3-compatible namespace.
Use the official S3 SDK with an explicit HTTPS endpoint, region, bucket, prefix,
and credentials from a separate private file. Never use ambient AWS credentials.
No credential, passphrase, decrypted snapshot, or remote address enters status.

Use conditional creation and read back exact encrypted bytes before recording
success. Existing different content fails closed; no automatic overwrite,
remote deletion, bucket creation, or public ACL is requested. Share the capture
lease so retention cannot delete local inputs mid-copy. Cache only a completed
proof for the same source digests/destination, preserving its original success
time. This avoids cloud requests every polling interval while allowing stale
proofs to become unhealthy. Cloud retention/lifecycle remains an operator policy.

Download a named generation to a new private file outside the repository and
capture directory, authenticate it locally, and use the existing fresh-database
restore path. Automated tests exercise the real SDK with an in-process S3 HTTP
fixture and restore downloaded data into fresh PostgreSQL. Real storage accounts,
provider compatibility, billing, and disaster access require operator setup.


## Milestone 4E: independent durable backup alerts

Read only generic capture/restore/offsite proofs with no game database connection.
Persist observations and a bounded FIFO outbox in a private local SQLite file
using Node's built-in adapter (Node 22.13+; reference image remains Node 24).
This is operational state only; PostgreSQL remains authoritative for gameplay.
A transaction creates each transition and claims a 30-second delivery lease.
Retries keep the same event UUID; stale claimants cannot acknowledge a newer
lease. Receivers must deduplicate at-least-once delivery. Remove acknowledged
events and store no receiver credentials or private backup/account content.

Receiver configuration is a separate private file; HTTPS only, no redirects,
bounded timeout, optional Bearer authentication. Queue identity binds instance
and receiver URL hash. Optional checks require explicit selection. A healthy
initial state is quiet; an unhealthy transition emits failure, return to healthy
emits recovery. Database connection failures persist failed worker proofs without
waiting for freshness expiry. Monitor health measures observation and delivery,
not backup success. External supervision must detect a stopped monitor. This
adapter is opt-in and automated tests deliver only to fixtures.


## Milestone 5A: reviewed original catalogs at realm creation

Reuse JSON catalog v1 and the existing realm-scoped character/provenance schema.
Preview and installation share deterministic validation, tiering, pack generation,
and digesting of the complete config/catalog. Both service entry points enforce
instance-admin access. A custom install requires the reviewed digest and explicit
rights attestation, then revalidates and writes the realm, membership/grant,
characters, and packs atomically. No existing realm's catalog is mutated. Stable
UUIDs/source keys may recur across realms under existing composite constraints.

Bound HTTP uploads to 2 MiB and custom installations to 1,000 entries; retain
small body limits on unrelated writes. Validate source/key length and strict
unknown-field rules. No asset URLs, remote fetching, or provider integration.
Show actual initial rarity odds and require at least one playable starter pack.
Use a rank map to avoid repeated scans during percentile assignment, preserving
existing tie-break and tier semantics. Existing backup tables/formats already
preserve these definitions and provenance, verified with a fresh-database restore.
The preview digest binds a workflow; authorization remains server-side. Realm
creation still has no retry receipt, so ambiguous outcomes require checking the
realm list before retrying. Economy operations keep existing idempotency.


## Milestone 5B: original CSV catalogs at realm creation

Add a bounded CSV adapter before the existing JSON v1 validator. Require explicit
comma-separated columns, stable UUID/source keys, pipe-separated categories, and
an optional whole-number popularity cell. Source/version/revision/permission
metadata is supplied separately and validated with the same catalog contract.
Use csv-parse's strict quoted-field handling; do not infer types, delimiters,
IDs, permissions, or headers. Reject the whole file on malformed rows. Errors
identify a record/field without echoing submitted values or parser diagnostics.

The authenticated preview and transactional installation remain shared across
formats, with the same instance-admin authorization, rights attestation, realm
scoping, ownership constraints, complete-pack checks, and review digest. Bind the
chosen format as well as normalized content/settings to that digest. Preserve
original-csv-v1 in installed provenance and prove recovery with a fresh database.
No new gameplay state or migration is required. Initial installs only; no live
catalog merges, remote calls, artwork, or automatic retry after uncertain creation.


## Milestone 5C: reviewed starter pack selection for new realms

Use a separate version 1 creation plan for explicit category packs and display
names. Omitted plans retain the existing automatic ranking/near-duplicate logic.
Manual plans use exact catalog categories, configured minimum pool/maximum pack
limits, unique categories/names, and the fixed All Characters fallback. They may
explicitly include overlapping pools; ownership remains realm-wide. Price, pack
size, weights, and cooldown remain realm rules, without per-pack overrides.

Validate and preview through framework-free rules before installation. Bind the
normalized plan, catalog, and complete realm settings to the review digest. Both
preview and creation keep instance-admin service authorization. Persist only
existing realm-scoped pack rows (stable IDs, names, single-category filters) in
the same transaction as realm/catalog/membership creation. No live regeneration
or ownership transition is introduced. Existing backups already include these
fields; prove custom names/filters and player progress with a fresh restore.
No migration, new dependency, or realm config version is needed. Series,
combined-category, hand-picked filters, and live editing remain later slices.


## Milestone 5D: receipt-driven web pack reveals

Start presentation only from a successful opening response. The existing shared
transaction, random draw, authorization, and retry key remain authoritative.
Revealing, skipping, or dismissing cards performs no write and cannot change
prices, odds, cards, gems, XP, or ownership. Failed/uncertain requests show no
reveal; retry resolves the same immutable receipt before presentation. Historical
last-opening data never starts a reveal on load or refresh.

Use a native modal dialog for focus containment and Escape, following the HTML
standard: https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element .
Return focus to the opening control or the packs heading when it is unavailable.
Show real receipt characters in order, with manual advance and immediate show-all/
close. Reduced-motion users receive a static summary, including preference changes
during presentation. Use original CSS decoration, no sound, fake outcomes, or
external assets. A browser-local on/off preference stores only a versioned boolean,
never receipts or player/realm identifiers. This is presentation, not a new realm
rule, schema, backup format, or hosting dependency. Verify with real fixture HTTP
openings, lost-response retries, multi-card packs, keyboard/mobile, and motion tests.


## Milestone 5E: realm creation retry receipts

HTTP realm creation requires a client UUID retained with the complete reviewed
proposal after an uncertain response. Authorize instance-admin access, normalize
and fingerprint the proposal, and serialize an account/request pair with a
transaction-scoped advisory lock. The new realm and its receipt commit together.
Same key/proposal returns the original realm even after later play/settings;
changed proposals conflict. Never repeat the starting grant or partially install
content. Legacy trusted library calls may omit a key, without retry guarantees.

Add an append-only realm_creation_requests table with a creator/realm foreign key
and strict fingerprint constraint; migration 0012 changes no existing row. The
backup migration manifest includes it and omits it for older archives. Prove
migration from 0011, interrupted/retried/concurrent creations, and recovery in a
fresh database. Browser pending proposals remain only in page memory and cannot
be edited until their result is resolved. Reloads require checking the realm list.

## Milestone 5F: local password changes and session revocation

Require a valid current session, current password, and expected password revision.
Serialize changes on the account, increment a revision, update the existing scrypt
hash, and revoke other sessions atomically. Keep the initiating session. A stale
retry may confirm that the new password is already current, without rewriting
credentials or revoking newly issued sessions. Other stale requests fail, including
old payloads after password reuse. Store no password-change payload or raw secret.

Migration 0013 adds a nonnegative account password_revision with default zero;
older encrypted archives migrate it on restore. Share bounded login-attempt
storage with a separate account-specific password-change key. Login rechecks its
verified hash under the same account lock before issuing a session, preventing
an old-password login racing revocation. Discord-only accounts do not acquire a
local password through this flow. Core realm state/IDs/exports remain unchanged.


## Player experience rework: collector ranks, market and content adapters

Keep the existing realm, account and ownership boundaries while replacing the
presentation with a collector dashboard. Packs, collection, wishlist, ranks,
market, trades and administration use the same authorized services. Presentation
must use server-created opening receipts: three existing rarities stay unchanged;
rare may use the local silent cinematic, with static reduced-motion and skip.
No chat, paid subscription, external art service or client-selected outcome.

Config v7 introduces a separate gem-purchased collector ladder. Bronze through
Diamond are configurable defaults, independent of XP and old pack upgrades.
Sequential purchases lock the realm, reserve a unique account/request receipt,
debit once and record a wallet entry atomically. Apply cumulative discounts,
recycling credits, extra wishlist capacity and cooldown reduction consistently
in web/Discord quotes, actions and receipt snapshots. Purchased ladder rules are
protected during reviewed settings changes. Migration 0014 disables this new
ladder on old realms so existing economies keep their rules and progress; new
realms use the enabled default. A realm admin may review/enable the default ladder.

Fixed gem-price market listings reserve a currently owned card. Listing is the
seller's consent to that immutable price; purchase is the buyer's acceptance.
The same realm lock serializes list/buy/cancel with trade/recycle/open operations.
A sale materializes a completed two-party trade with both confirmations, balanced
wallet transfers, zero-XP received-character discovery and existing ownership
journals. This keeps the uniqueness and fresh-backup reconciliation authoritative.
Migration 0015 adds listing/request receipts; active listings prevent direct
trade or recycle until cancellation. No new currency, cash, auctions or price
oracle. Asking prices are seller choices. Dynamic character valuation remains a
separate future, versioned economy decision, never an automatic owned-tier change.

Player archive v9 includes own collector rules/purchases and own seller/buyer
listing history, with legacy readers v1-v8. Encrypted backups retain envelope v1
and use source-migration manifests to migrate old archives while keeping IDs,
immutable receipts and ownership history. Restore verifies rank grants/debits,
market consent/price/party journals and per-player effective wishlist limits.

Anime/manga is the first provider-focused flow. A portable canonical v1 catalog
continues to separate source adapters from realm game rules. The first flow,
explicit selection of at most 25 Wikidata item IDs (CC0 names only), has since
been removed; MyAnimeList and AniList rosters replaced it.
Require per-request opt-in, bounded response/time/host, no redirects/retries,
shared per-admin rate counters, validation and an ordinary creation preview.
Store stable source IDs/provenance, never remote images, biographies, tokens or
raw remote responses. AniList/Jikan bulk import is not implemented. Tests use
synthetic labels and injected fetchers, with no external API calls.


Creation receipts from config-v6 releases remain append-only. For an explicitly
legacy proposal, reproduce its ordered normalized-v6 digest internally and accept
only a matching review/receipt. Changed catalog, settings, name or pack plan still
conflicts. Tests independently reconstruct schema-0013 receipts, migrate, continue
gameplay and restore twice into fresh databases without changing the receipt row.
An entirely omitted config and omitted preview on a trusted library call cannot
identify which historical default the caller intended; actual web requests always
sent full config. Such internal callers should retain an explicit original config.

## Play screens, timed gem claims and provider adapters

Packs, collection, market, trades, ranks, wishlist, administration and account
settings have separate Next.js routes. The shared server loader authorizes the
account and realm; the client mounts only the selected screen. Realm IDs remain
in navigation URLs. Admin/player preview is a browser-local presentation setting
on the existing account. Hiding controls never changes authorization: ordinary
players are redirected from the admin route, and service/API permissions remain
authoritative for every write.

Config v8 adds bounded, per-realm timed gem claims. A claim locks the same realm
row as spending/trading, authorizes membership, replays a completed account/key
receipt, verifies the current settings revision and checks the server clock.
Success atomically records `gem_reward_claims`, credits the wallet and appends a
`gem_reward` ledger entry with a `gem-reward:` operation key. Realm/account/key
uniqueness protects retries; the realm lock prevents two fresh keys bypassing a
cooldown. The first claim is immediate. Later eligibility uses the last successful
claim plus the current interval; missed intervals never accumulate rewards.
Historical receipts and their config snapshots remain immutable.

Migration 0016 preserves existing economies by adding disabled 25-gem/six-hour
rules, while newly created realms use enabled defaults. Existing config-v7
creation receipts remain append-only: legacy review fingerprints are reproduced
only for matching old proposals, preserving ranks, IDs and original receipts.
Player archive v10 adds personal claim rules/receipts and retains v1-v9 readers.
Encrypted backups keep envelope/payload v1 and restore old manifests without
inventing claims. Restore reconciles both directions of receipt/ledger links and
recalculates each claimed amount and cooldown against its immutable rules.

Provider adapters normalize into the canonical catalog v1 before review and
transactional new-realm installation. The bounded AniList adapter requests up to
25 selected character IDs, names, favourites and limited series/genre metadata;
authorized AniList/Jikan JSON adapters perform the same normalization offline.
Stable namespaces keep AniList and MAL IDs distinct. Raw responses, images and
biographies are excluded. Explicit admin permission, fixed-host/time/size limits
and shared preparation rate limits apply before upstream access. There is no
automatic paging or full-database mirror. An original 1,000-character local
catalog exercises scale independently of external providers. Core gameplay and
automated tests require no live external API.

## Pack bundles, provider references and operator test credits

Migration 0017 adds `openings.pack_count` defaulting to one. A single realm lock
and transaction sample the full 1/5/10-pack bundle without replacement, debit its
per-pack discounted total, award first-collection XP and start one cooldown.
Retry identity includes count; historical single receipts are not rewritten.
Restore validates bundle quantities, unit prices, ownership and wallet journals.

Migration 0018 adds operator-only, self-wallet gem grant receipts. The service
requires an instance admin and realm membership, uses the same realm lock, and
atomically credits the wallet and `admin_grant` ledger entry. A stable key makes
requested test credits replay-safe. It has no public gameplay endpoint. Personal
archive v10 already carries these wallet entries; encrypted recovery additionally
reconciles grant receipts in both directions. It never invents XP or cards.

The optional API browser loads one requested series/character page per service
call. The selected fixed host is explicit: Tenrai is the working default, with
a legacy Jikan transport. A reviewed roster caches only gameplay metadata and
stable MAL identities; no API outage or arbitrary ID probe changes saved odds
or ownership. Provider artwork is a separate, validated reference with attribution
and permission metadata. Browsers load allowed CDN images lazily; the server
stores no image bytes. Imports, rendering, personal export and encrypted restore
validate the reference boundary. Core and automated tests remain provider-free.

## Discover and opening presentation follow-up (2026-11-06)

The large-pack catalog, URL-selected opening view and claimable-character banner
are read-only views of the existing realm. Shortlists use the same unclaimed
category pools and positive rarity weights as drawing; incomplete packs and
active claims are excluded. Stable source-qualified identities and the active
ownership constraint apply equally to provider and original characters.

The original Milestone 5D no-sound presentation choice is superseded by optional
original Web Audio scores. Only a user gesture can unlock them, a versioned
browser-local mute preference contains no player identifiers, and every cue
belongs to the actual saved rarity. Skip, close, backgrounding and reduced motion
stop scheduled notes. An immediate neutral loading animation may precede the
response, but no character appears before success and bounded artwork decoding.
These choices add no transaction, gameplay rule or preservation version.

## Leveled ranks and five rarity tiers (2026-11-06)

Config v10 supports common/uncommon/rare/epic/legendary and independent leveled
rank tracks with explicit prerequisite levels. Rank purchases authorize realm
membership, lock the realm, validate the expected revision, next level, prior
tracks and wallet, and append a receipt/debit atomically. Request identity binds
track and level. Benefits are cumulative within a track and additive across
tracks, with effective-rule bounds. Purchased levels and prerequisite rules are
protected from later edits. Legacy benefits and successful receipt retries stay
valid; retiring old purchases blocks new spending through their old endpoints.

Migrations add zero-weight extra tiers and disabled tracks to prior economies.
Only an explicit reviewed preset transaction changes existing prices and tiers.
Its hash includes the current cohort/settings; concurrent gameplay invalidates
stale previews. It may rerank only never-awarded characters, preserving all
historical rarity snapshots, including recycled cards. Configuration and tier
changes share a durable realm journal and restore validation. No live provider
call participates in drawing or rebalancing.

Player archive v11 carries track progression and immutable purchase receipts;
older archive readers remain strict. Encrypted instance payload/envelope stay
v1, with the migration manifest and both new journals retained through fresh
recovery. Public Discord avatar URLs use a fixed validated CDN shape, refresh
only from verified sign-in, and preserve legacy profiles without inventing data.

## Character values and direct play actions (2026-11-07)

Config v11 adds optional versioned character-value rules. Migration 0023 retains
nullable numeric popularity on character definitions; existing realms keep the
feature disabled until a reviewed settings change. New catalogs retain their
supplied source scores. An administrator may restore missing scores from a
matching saved catalog, requiring identical stable IDs, source keys, source and
revision. This fills null evidence without replacing definitions, tiers or prior
scores. A matching preview hash and the shared realm lock protect this operation.

Quotes compare popularity only within compatible source/tier cohorts, keep ties
equal and missing evidence neutral, and add bounded aggregate wishlist demand.
An active owner's own wish does not count toward that character's demand. The
quote and member's existing recycling bonus are evaluated under the same realm
lock as recycling, wallet credit, card release and receipt insertion. Retries
return their original result. A saved quote contains the evidence and formula
version; encrypted recovery validates it against the historical rule snapshot
and ledger, rather than recomputing it against today's wishes. Archive v12
includes the player's relevant current quotes and historical recycling evidence.
Market listings retain their explicit seller-selected asking price.

Web rank and recycling actions now submit on the first click. Pending-operation
locks, expected settings revisions, authentication and durable retry keys remain
in force. The default pack cooldown is zero; realm administrators can still
configure one. Removing presentation confirmations or changing that setting does
not relax transaction or unique-ownership constraints. The dedicated opening
room and read-only card inspection dialogs introduce no additional game writes.

## Pack presentation and inline opening stages (2026-11-07)

Preparation, rarity entrances and summaries now render in the selected opening
room as normal page sections. Card inspection retains its own dialog. These
stages consume only the saved server result; dismissing preparation preserves
an uncertain request key, and skipping or returning to the pack never opens a
new pack. Artwork still prepares after a successful response, with the existing
bounded decoding and fallback behavior. No new transaction boundary is added.

Themed pack labels describe their saved source categories. Current views may
present an untouched legacy genre label as a themed edition, while stored pack
IDs, categories, custom names and historical records remain unchanged. New
automatic packs start with those themed names. Ambiguous aliases are
disambiguated, and Discord accepts a saved name or current label only when it
identifies one pack. No demographic or Isekai tag is inferred from a genre.

Ordinary wrappers use original abstract artwork; character artwork requires an
explicit franchise presentation. Discover's character banner uses the same card
face and inspection components as the collection. Neither decoration nor label
mapping changes eligible pools, rarity weights, values, uniqueness or spending.

## Demographic browsing and Discord collection reads (2026-11-07)

New anime/manga pack generation uses actual saved demographic categories.
Current web and Discord listings apply one shared catalog grouping policy,
preserving stored legacy pack IDs and receipts while omitting automatic genre
packs from provider browsing. Custom pack names stay available. The fallback
includes characters without demographic evidence. No live catalog metadata,
ownership, price or rarity is modified by this projection. Existing confirmed
Discord pack reviews still resolve their stored pack and durable request key.

`/bakufu collection` authenticates the signed interaction, resolves the server's
realm binding and linked account, then reads only that member's active cards
under the existing realm transaction lock. A bounded page uses current ownership,
so web trades/recycling and Discord agree. It creates no gameplay record or
provider request. Replies are private unless the invoking member explicitly
requests `share:true` for their own nonempty collection page; errors stay private
and mention parsing is disabled. No other member's collection can be requested.
