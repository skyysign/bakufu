# Milestone 3C: find realm members for trading

Open **Trades → Start a trade**. Browse the member list or type in **Search realm
members** to filter by Discord username or display name. Choose a result, check
the displayed partner, add your offer, and send it. **Load more members** adds
the next page. A keyboard user can tab to a choice and select it with Space.

Each result shows a realm trade ID as well as its cached names. Names can repeat;
verify the code with the other player if unsure. The selection submits that
stable code, so renaming a Discord account cannot redirect an offer. Existing
trade rows display the current cached counterparty name alongside the code.
Asset ownership, reservations, confirmation versions, and settlement rules are
unchanged; see [trading](trading.md).

## Where names come from

Names are cached after a successful **Continue with Discord** sign-in using
the verified `/users/@me` response. The existing `identify` permission provides
username/display-name fields; no extra OAuth scope, provider token storage,
server roster download, or bot is required. These fields are presentation only,
as described in [Discord's user-object reference](https://docs.discord.com/developers/resources/user#user-object).

Existing users should sign out and sign back in through Discord once to populate
their names and public profile picture. Later Discord sign-ins refresh renamed
profiles and changed avatars. A local account
must already be explicitly linked to its Discord identity; names are never used
to merge accounts. See [account linking](../deployment/discord-login.md#existing-local-accounts).

Until then, the list labels an account **Player** with its realm trade ID. Local
accounts remain playable and discoverable by code. **Other player's trade ID**
is still available below the picker for pasted codes, including when lookup is
unavailable. No new environment settings or public hosting are needed for member
search. Unlike Discord gameplay interactions, OAuth sign-in works with the
existing local callback setup.

Cached names can be stale until the player signs in again. They are normalized
and stripped of invisible/control formatting, shown as text, and never treated
as proof of identity or permission. Missing or malformed optional name metadata
does not invalidate a verified identity login or erase a previously cached name.
Public Discord avatars are displayed after verified sign-in. Static canonical
CDN references load directly without a referrer; the server stores no picture
bytes. Missing or broken images fall back to initials. There are no local
nicknames, manual profile editing, automatic profile polling, or profile updates
from slash-command payloads in this slice.

## Privacy and API

Only authenticated members of the selected realm can browse/search its members.
The caller is excluded from choices. Results contain only `tradeCode`,
`username`, and `displayName`. They exclude account/provider IDs, email, roles,
wallets, XP, other realms, and collections. Instance-admin status does not grant
directory access to a realm the caller has not joined. This is a private realm
directory, not a Discord-wide or whole-server search.

`GET /api/members?realmId=<UUID>&query=<text>&cursor=<trade-code>` returns
`{members, nextCursor}` with private/no-store caching. Query/cursor are optional.
HTTP pages contain at most 20 members; the service supports smaller limits for
trusted callers. Search is case-insensitive using the database's text rules,
normalizes Unicode composition, and matches literal substrings of either name
or an exact trade code. `%` and `_` are ordinary characters, not wildcards.
Queries are limited to 80 characters; cursors must be UUIDs.

Pagination orders by stable realm trade code. Names and memberships can change
between pages; rerun the search for a fresh view. The client cancels stale
requests and clears the selected recipient when changing the search. Picking
someone does not grant access, create membership, reserve assets, or send a trade.
The trade service checks membership and the selected code again when submitted.

## Preservation and deployment

Migration `0010_member_profiles.sql` adds only the Discord profile cache. Existing
accounts, links, realm codes, cards, balances, XP, trades, server bindings, and
gameplay rules stay intact; no old names are guessed. Current realm config is v10.

Player archive **v12** retains nullable `discordProfile` (introduced in v7) containing only that player's
username, display name, optional public avatar URL, and last-refresh timestamp. Other members' cached names
are excluded; trade history continues to use stable counterpart codes. Readers
for v1–v10 retain the information those versions actually recorded. The current
archive also contains the player's own nullable server-admission receipt.

Encrypted backup envelope v1 recognizes migrations 0001–0023 and preserves
profile names, optional avatar URLs and PostgreSQL refresh timestamps. Fresh restore validates
canonical profile fields and identity references. Earlier snapshots restore with
no cached profiles; players refresh through Discord sign-in. Profile records are
retained with their linked accounts, with account deletion/retention tooling still
planned. Use a UTF-8 PostgreSQL database for Unicode names; the Compose reference
and disposable test databases use UTF-8.

Optional [server-based realm joining](admission.md) requires an explicit join link
and fresh membership check. Invitations remain supported; searching or ordinary
sign-in never silently enrolls someone in a realm.
