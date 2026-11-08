# Let Discord server members join a realm

Realm joining is invitation-only until a realm administrator changes it. Existing
accounts, collections, and permissions are preserved. Specific-account invitations
continue to work in either joining mode.

## Enable a join link

1. Finish [Discord sign-in setup](../deployment/discord-login.md). Use the same
   application and callback URL; no new secret, bot token, or slash-command setup
   is required for joining.
2. Open the website, sign in as a realm administrator, and select the realm.
3. Under **Discord gameplay**, enter the Discord server ID and choose **Link
   Discord server**. To copy that ID, enable Developer Mode in Discord under
   **User Settings → Advanced**, then right-click the server icon and choose
   **Copy Server ID**. A server can be linked to only one realm.
4. Under **Realm joining**, select **Members of linked Discord server** and
   choose **Save joining settings**.
5. Choose **Copy join link** and share it with server members. They must be able
   to reach the website. A `localhost` address works only on your own computer;
   joining does not publish or host your website for you.

A recipient opens the link and chooses **Verify with Discord and join**. Discord
asks for identity and membership permission. The application checks membership
in that particular server, including completed membership screening. A verified
member joins as a player with the realm's current one-time starting gem grant.
Repeat joins preserve their account, cards, and balance without another grant.
Normal **Continue with Discord** sign-in does not admit someone to a realm.

If someone already has a local account, the operator should first run
`docker compose exec web pnpm discord:link` (or `pnpm discord:link` on the host)
to link it explicitly. Matching names or emails never merge accounts.

## Close or replace a link

Select **Invitation only** and save. The previous link and unfinished joins stop
working. Re-enabling server joining creates a new link. Saving an already-enabled
policy keeps its current link but invalidates unfinished OAuth flows through a
new policy revision. Disable server joining before changing or unlinking its
Discord server.

This is a rule for **joining**, not a continuous access check. Players keep their
membership and saved progress after leaving Discord, closing joining, or unlinking
the server. Continued affiliation enforcement, Discord role restrictions, and a
membership-revocation interface remain future work. Local-only realms remain
supported through operator provisioning and explicit invitations.

If a save loses its response, use **Retry joining settings save**. It repeats the
same request safely. A stale revision requires refreshing and reviewing the mode.

## Data and recovery

The deliberately shared public page exposes the realm name and required server
ID. It exposes no member directory, cards, balances, or account IDs. Treat the
link as an address; the membership check supplies authorization.

Only joining requests add `guilds.members.read` to the existing `identify` OAuth
scope. The server fetches the current user's membership in the configured server;
it does not fetch a roster or list all their servers. Provider tokens, roles, and
the membership response are discarded. The account and current Discord names
are retained as described in [privacy](../privacy.md).

Migration `0011_discord_admission.sql` adds versioned realm admission policies,
admin change receipts, and one receipt for each membership actually created by
this flow. Existing/manual memberships receive no invented receipts. Policy
changes and grants use the realm transaction lock. A failed join creates no
partial identity, wallet, membership, or session.

Player archive **v9** includes the exporting player's nullable `realmAdmission`
receipt: its stable ID, server ID, method, policy revision, granted gems, and time.
It includes no raw Discord user ID or another player's receipt. Readers retain
archives v1–v7. Realm gameplay config is **v7**. Encrypted backups preserve
policies, audit history, and admission receipts; restore validates their revision
chains and starting grants. Older databases restore invitation-only.

Tests use local OAuth fixtures and disposable PostgreSQL, including real browser
navigation. Connecting an actual Discord server still requires your configured
application and the player's consent.

Provider references: [OAuth2 scopes](https://docs.discord.com/developers/topics/oauth2),
[current user's guild membership](https://docs.discord.com/developers/resources/user#get-current-user-guild-member),
[membership screening field](https://docs.discord.com/developers/resources/guild#guild-member-object).
