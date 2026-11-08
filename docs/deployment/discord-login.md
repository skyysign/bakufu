# Optional Discord sign-in

Players can use **Continue with Discord** instead of creating another password.
This is an optional website login method: it does not install a bot, add slash
commands, or make realm access public. Local accounts still work without Discord.
Optional [signed gameplay commands](discord-gameplay.md) have a separate setup.

## First administrator through Discord

1. Create or open your application in the [Discord Developer Portal](https://discord.com/developers/applications).
   **Client ID** means this application's ID. Open **General Information** and
   copy **Application ID**; put that number in `DISCORD_CLIENT_ID`. It is separate
   from the personal user ID you will copy later.

   For **Client Secret**, open **OAuth2** in the portal's left sidebar. If the
   secret is hidden, click **Reset Secret**, follow the confirmation prompts,
   then copy the newly generated value into `DISCORD_CLIENT_SECRET` in your local
   `.env`. Resetting replaces the previous secret; use the new value. This is
   the OAuth client secret, not a bot token. Keep it private and do not paste it
   into chat. The [discord.js setup guide](https://discordjs.guide/rpc/app-setup)
   illustrates this screen.
2. Register this exact OAuth2 redirect URL for the local quickstart:

   ```text
   http://localhost:3000/api/auth/discord/callback
   ```

   For another site URL, use your `APP_ORIGIN` followed by
   `/api/auth/discord/callback`. Scheme, hostname, port, and path must match.
3. Switch to the **regular Discord desktop app**, where your chats and servers
   are, or open [Discord in your browser](https://discord.com/app). You are
   leaving the Developer Portal for this part.
4. Click the **gear icon ⚙ next to your username at the bottom-left**. This opens
   **User Settings**. In its left sidebar, choose **Advanced**, then turn on
   **Developer Mode**.
5. Close settings and find a message you sent in a chat or server. Right-click
   **your name or profile picture beside that message**, then choose
   **Copy User ID**. The copied number identifies your personal Discord account.
   Use it for `DISCORD_ADMIN_USER_ID`, not the application's Client ID.
   Discord's [illustrated ID guide](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)
   also shows these controls.
6. Add these entries to your private root `.env`, replacing the example text:

   ```dotenv
   DISCORD_CLIENT_ID=your_application_client_id
   DISCORD_CLIENT_SECRET=your_oauth_client_secret
   DISCORD_ADMIN_USER_ID=your_own_discord_user_id
   ```

   Do not paste the secret into chat or commit `.env`. The checked-in
   `.env.example` has empty optional fields only.
7. Rebuild/restart from the project directory:

   ```powershell
   docker compose up --build -d
   ```

   Migrations upgrade the schema before the web service starts. Open
   <http://localhost:3000>, choose **Continue with Discord**, and authorize the
   application. If no admin exists, only the verified Discord account matching
   `DISCORD_ADMIN_USER_ID` can become the first admin. This path does not need
   a local website password or `pnpm bootstrap`.

Create a realm, then use **Administration → Players & access → Invite players**. Enter
that player's numeric user ID; they can then sign in through Discord. Repeating
the invitation does not repeat the starting gem grant. Other users are denied.
For HTTPS hosting, register the real HTTPS callback and set `COOKIE_SECURE=true`.

## Existing local accounts

If a local admin already exists, the environment setting cannot create another
admin or take over an account. Explicitly link an existing local account:

```powershell
docker compose exec web pnpm discord:link
```

Enter the existing website email and the correct Discord user ID. The trusted
operator command preserves account IDs, cards, gems, and realm permissions. It
refuses conflicting links and never merges accounts by matching an email or
username. Link existing players before inviting their Discord identity so you
do not create separate empty accounts for them.

For host development, configure the same `.env`, run `pnpm db:migrate`, and
restart `pnpm dev`. Use `pnpm discord:link` if needed.

## Realm access and member lookup

Private [realm member lookup](../gameplay/members.md) is implemented. Players
can browse/search admitted members by cached Discord username/display name
when choosing a trade partner. Names refresh on verified Discord sign-in;
existing accounts need to sign in again once. Stable realm trade IDs identify
selections, including duplicate or renamed profiles. Local accounts keep code
fallbacks. Public profile pictures refresh on the same sign-in; static Discord
CDN references contain the public user ID needed for that picture. No emails,
credential records, tokens or collections enter directory results. Pictures
load directly with no referrer, and failed images use initials. Old cached
profiles show initials until the player signs in through Discord again.

Optional [verified Discord server joining](../gameplay/admission.md) is implemented.
Realm admins can enable a join link for the linked Discord server. Only this
explicit joining flow requests membership permission and checks the selected
server. Specific-account approval still works through invitations. Ordinary
sign-in alone grants no realm access. Existing members retain access and progress
after leaving Discord or closing the link; continuous enforcement and role gates
remain future work. Web-only invitation-based realms remain supported.

## Troubleshooting

- **No administrator exists:** complete Discord setup above, or run
  `docker compose exec web pnpm bootstrap`. Local bootstrap must finish with
  **Account ready**; failed validation creates no account.
- **Password length:** local website passwords accept **12–256 characters**.
  Twelve is a minimum, not an exact length. Use the password chosen during
  bootstrap, separate from the PostgreSQL password in `.env`. Terminal password
  entry intentionally shows no characters while you type.
- **Discord button missing:** set both OAuth client fields, then rebuild/restart.
  Editing `.env` alone does not update a running container's environment.
- **Account not invited:** ask a realm admin for an invitation using your numeric
  user ID. For initial setup check `DISCORD_ADMIN_USER_ID`. Existing local
  accounts need the link command.
- **Expired/unverified login:** start again from the sign-in button. State is
  browser-bound, expires in ten minutes, and can be consumed only once. Do not
  reuse callback URLs or change hostnames during login.
- **Invalid redirect:** check the exact callback URL in the Developer Portal
  and `APP_ORIGIN`. The default uses `localhost`, not `127.0.0.1`.

## Implementation and verification

Uses the authorization-code flow, S256 PKCE, one-time database state, issuer
validation, and an HttpOnly browser-binding cookie. Ordinary sign-in requests only `identify`. Explicit server joining additionally
requests `guilds.members.read` for the configured server membership check. The server exchanges the code and reads `/users/@me`; only its
verified immutable user ID authenticates the account. Username/display name
are cached for private realm member lookup after successful admission/linking.
Provider tokens, avatars, and emails are not persisted. Game session cookies use SameSite=Lax for the return
navigation, HttpOnly, and the configured Secure flag. Form/API writes still
require the exact application Origin. Callback responses suppress referrers;
their URLs are excluded from development request logs.

Discord links have database uniqueness constraints and are included in encrypted
instance backups. OAuth flows and sessions are excluded. Player archive v9 includes only the exporting player's cached names/timestamp and nullable admission receipt,
without their raw provider ID or other members' names. The migration preserves existing accounts,
cards, wallets, and IDs. The current restore also explicitly supports backups
from the original and Discord schema revisions; see the [recovery guide](backups.md).

Tests use fixtures and a local provider implementation, never Discord's live
APIs. They cover bootstrap races, state replay/expiry/browser binding, invitation
RBAC, explicit linking, provider errors, recovery, schema upgrade, and browser
navigation from a fixture consent page on Discord's origin. A real sign-in
still requires your own configured application and consent.

References: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2),
[authorization server metadata](https://discord.com/.well-known/oauth-authorization-server).
