# Privacy and access in the initial slice

Instances and realms are private by default. There is no unrestricted public registration or content API. A realm admin can
deliberately share a join link requiring fresh Discord server membership; the
public page reveals only the realm name and required server ID. A local operator provisions accounts, and game services check
realm membership in the database. Instance administrators can create realms;
ordinary players cannot. Bootstrap uses an operator-only local command or a
provider-verified Discord ID explicitly configured by the operator.

Local accounts store email, salted scrypt password hash, password revision and creation timestamp.
Authenticated [password changes](deployment/account-settings.md) require the
current password and revoke other sessions while preserving the initiating one.
Pending passwords remain only in page memory; no password payload/history or
password-change receipt is persisted. Verification has separate per-account
eight-attempt/fifteen-minute limits using hashed throttle keys.
Discord-only accounts have no local password or email. Optional Discord links
store the provider user ID and internal account ID; usernames and Discord email
addresses are not used for automatic linking. Verified Discord sign-in also
caches username, display name, an optional public avatar reference, and refresh time for realm member lookup. These
names are shared only with members of the same realms, used for presentation,
and never treated as proof of identity.
Avatar references use only canonical static Discord CDN user/default-avatar
paths; they are built from verified provider fields, not arbitrary user URLs.
Browsers request the picture directly with no referrer, so Discord's CDN receives
the ordinary image request. No avatar image bytes or provider tokens are stored.
Missing or broken pictures use an initial; existing profiles refresh on the next
Discord sign-in. Personal archives contain only the player's own public reference,
and encrypted backups preserve it with the existing profile cache.
Opaque session tokens are random, stored only as SHA-256 digests in PostgreSQL,
expire after seven days, and are revoked on logout. Cookies are HttpOnly and
SameSite=Lax for the return from Discord. Operators must enable Secure cookies
and HTTPS outside local development. Form/API writes require the configured
exact Origin. The OAuth callback uses browser-bound one-time state, PKCE, and
issuer validation. Provider tokens are discarded after verification. OAuth
flows expire in ten minutes and are deleted on consumption or a later login's
expired-flow cleanup. Local login is
limited to eight attempts per normalized email in fifteen minutes using shared
database counters. Operators should add perimeter limits for hostile traffic;
distributed abuse prevention and password recovery are not in this slice.

Gameplay records retain ownership, ledger operations, idempotency receipts, and
timestamps. First-collection XP history retains per-realm character/card IDs,
award amounts, rule versions, and timestamps to prevent repeat rewards.
Recycling retires a card and releases its active claim while keeping
its acquisition/recycling history for audit and recovery. Player exports include
only that player's active collection, recycling history, and progression/XP
history within one realm.
Upgrade purchase history retains the player's realm-scoped rank, cost/effect,
request and purchase IDs, and timestamp for spending audits and safe retries.
Wishlist entries and their change receipts are private to the player and realm,
unless the player turns on **Show my wishlist** on their
[profile page](gameplay/profiles.md); then members of that realm see the
wished characters there (never the receipts).
Profile pages are visible only to members of the same realm. They show the
player's Discord name and picture, level, owned collector ranks, collection
statistics and cards (which trading already shows to members), and what the
player chose to add: a text of up to 280 characters, a page colour and up to
six showcased cards. Gems, email addresses and provider IDs are never part of
a profile or of the players directory. The chosen page is stored per realm,
included in that player's archive and in encrypted backups.
They retain chosen character IDs, entry/request IDs, desired states, and
timestamps for retries and recovery. Personal exports include only that
player's current entries and rules; encrypted backups also preserve receipts.
Realm-admin settings previews expose aggregate player impacts and public pack
metadata, excluding player identities and private wish entries. Short-lived
previews retain proposed rules and a state fingerprint; expired previews are
cleaned up on later reviews. Permanent configuration audits retain the acting
admin's internal ID, rule snapshots, revision, request ID, and timestamp inside
encrypted backups. Transient previews are excluded from backups and player exports.
Per-realm trade IDs address offers without revealing account email or provider IDs.
Only the two participants can see their trade, including both offered sides,
confirmation state, and counterparty trade ID. Cards not offered remain private.
Personal archives include those trades. Encrypted backups retain participant IDs,
all versions, confirmations, reservations, replay receipts, and ownership transfers.
Trading grants no XP but records a zero-XP known-character marker on first receipt.
There is no public player directory or trade notification service. The private
realm directory exposes only realm trade codes and cached names, with no provider
IDs, emails, roles, balances, or collections. Personal archive v9 contains only
the exporting player's cached profile; encrypted backups preserve all profiles.
Names remain until refreshed or their linked account is removed; automatic
account deletion and retention tooling remain planned.
Optional Discord commands verify signatures and use the existing linked user ID
and realm membership. Replies are private with mentions disabled. A player can
explicitly use `/bakufu collection share:true` to post one page of their own
current collection in the channel. This shares character names, series, rarity,
collection size and realm name; it does not expose account IDs, gems, credentials
or another player's collection. Empty collections and errors remain private.
The application does not persist a separate sharing record; Discord handles the
posted message under its own retention and channel permissions. Server bindings
retain server ID, realm ID, binding ID, acting admin, and timestamp in encrypted
backups. Short-lived pack reviews bind player/server/realm/pack/revision and
quoted price; they contain no interaction tokens and are excluded from backups.
The app does not log raw interaction requests or use their names/roles to refresh
the profile cache. Provider tokens are discarded. Ordinary Discord gameplay
makes no outbound provider calls.
Reviews expire after ten minutes; rows more than one day past expiry are removed
on the next review in the same realm and may remain longer in inactive realms.
Optional server joining adds `guilds.members.read` only to its explicit join flow.
It checks the current user's membership in the configured server, rejects
incomplete screening, and discards provider tokens, roles, and membership data.
Browser-bound transient OAuth state stores only the intended realm/server/code
and policy revision. Persistent admission receipts retain account/realm IDs,
server ID, policy revision, starting gems, stable receipt ID, and time. Personal
archives include only the exporting player's receipt. Encrypted backups include
policy audits and all admission receipts. These are joining rules; existing
access is retained after leaving the server. Ongoing enforcement is not implemented.
No analytics, third-party fonts, live catalog calls, or artwork downloads are
required. Next.js telemetry is disabled in the Docker image and browser test;
developers can set `NEXT_TELEMETRY_DISABLED=1` locally as well.

Encrypted admin backups include private account records, linked Discord IDs,
and authentication hashes but exclude live sessions and OAuth flows.
Protect backup destinations and the separate
passphrase, define a retention policy, and test deletion/recovery procedures.
The optional worker applies daily/weekly file retention in its dedicated
namespace and writes only generic times, outcome, scheduled date, and file counts
to status metadata. Its passphrase comes from a separate private file, never an
argument or a stored snapshot field. No alert or remote API request is sent.
Automatic account deletion/anonymization, session-management UI, password
reset/change, configurable data-retention jobs, and recovery of a lost admin
password are **not implemented**. A public community rollout should add these
flows and perform a security review first.

Optional automated restore checks decrypt an existing snapshot into a fresh
database on a separate operator-configured PostgreSQL service. Account emails,
linked identities, password hashes, and gameplay data temporarily exist there
for verification; sessions and provider tokens are not restored. Successful
checks remove their databases before recording success. Interrupted, verifiably
owned databases are cleaned on the next check; ambiguous ownership fails closed.
The Docker example isolates this service from the game network, publishes no
port, stores it on tmpfs, and suppresses statement/row error logging. Host
operators must configure equivalent privacy protections. Recovery status stores
only outcome, times, weekly period, and encrypted file digest. No decrypted
payload, key, connection URL, or account identifiers enter status or CLI logs.
See [restore checks](deployment/restore-checks.md).

Optional HTTPS deployment adds a proxy with persistent certificate volumes.
These volumes contain deployment TLS keys and are separate from game snapshots.
Proxy access logs are off; runtime logs remove request objects and URI fields
to avoid disclosing failed callback codes/state or credentials. Do not enable
debug/access logging without reviewing private data exposure. The callback has
a specific no-referrer header rule. Anonymous health endpoints expose only
process/database readiness booleans; they read no account/gameplay records and
return no schema names, versions, connection details, or private errors.

Optional S3-compatible copying sends only existing encrypted instance snapshots
and minimal namespace/control objects to the operator-selected HTTPS endpoint.
The bucket/prefix must be private and dedicated. Storage credentials come from
a separate private JSON file; the official SDK receives them explicitly, with
no ambient profile or machine-role discovery. Credentials and encryption keys
never enter the uploaded object, local status, or CLI logs. Offsite-copy status
contains only outcome, times, generation count, and source/destination hashes.
No automatic remote deletion or lifecycle policy is configured; the operator
controls remote retention and storage-provider access. Authenticated downloads
stay encrypted and refuse overwriting existing recovery files.


Optional backup alerts send only versioned generic check states, event/monitor
UUIDs, sequence, and observation time to the operator's private HTTPS receiver.
They contain no players, realms, database addresses, file paths, credentials,
raw errors, or snapshot content. The receiver URL/token remain in a separate
private file; logs are generic. A separate local SQLite queue keeps pending
messages and the last observation, deleting delivered messages. Receiver
retention/access is the operator's responsibility. See
[setup and delivery limits](deployment/backup-alerts.md).


Original JSON/CSV catalogs are submitted by an instance admin to this deployment for
preview and new-realm creation. The app does not contact source sites or fetch
images. Installed names/series/source keys/tiers are visible to realm members;
source revision/license and original-import format and attestation are preserved in private
encrypted instance backups. Keep personal data and secrets out of catalog files.
The raw uploaded file is not retained separately. See [catalog creation](content/catalog.md).


The optional web pack reveal stores only an on/off value under
`card-engine:pack-reveals:v1` in browser local storage. It is shared across
accounts/realms/tabs using that browser; it contains no IDs, receipts, tokens,
wallets, or character data. Reveal contents stay in the current page's ordinary
memory and are not sent to an analytics/asset service. Original CSS decoration
needs no remote artwork or audio. See [pack reveals](gameplay/pack-reveals.md).

Realm creation retains the creator ID, request UUID, resulting realm ID, proposal
fingerprint and timestamp for retry safety and encrypted instance recovery. Raw
import files are not stored in these receipts. Player archives exclude them.


The collector rework adds realm-scoped rank purchase and market listing/request
receipts. Market members see character metadata, asking prices, status and public
realm seller names/codes; no emails or private account IDs are published. Sales
use the existing completed trade, wallet and ownership journals. Personal archive
v9 includes only the player's own rank/listing participation. Encrypted backups
contain the authoritative histories and validate them during fresh restore.

Character-value estimates use saved numeric source popularity and aggregate
realm wishlist demand, excluding an active owner's own wish. They expose counts,
not who wished for a character. Current player archive v12 includes value quotes
only for that player's cards and wishes, plus their own recycling evidence.
No live provider request or new OAuth token is needed to calculate a value.

The optional MyAnimeList and AniList roster flows run only after instance-admin
authentication and explicit opt-in, and only for the selected series or
characters. Raw provider responses and biographies are not retained (a profile
check keeps only the detected gender); character artwork is kept as a reference
URL, never as a copied image. There is no background crawl and no live upstream
request from automated tests. (The earlier Wikidata lookup has been removed.) Original demo
art and the silent rare video are served locally with no analytics or remote CDN.
