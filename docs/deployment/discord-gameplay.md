# Discord gameplay: collections and pack commands

The website and Discord now use the same pack-opening transaction and inventory.
This optional slice implements:

- `/bakufu status`: your gems, XP, level, active card count, and current pack price.
- `/bakufu packs`: pack names/IDs in the server's linked realm and your current price.
- `/bakufu collection`: your active cards, ten per page, with rarity and series.
- `/bakufu collection page:2`: the next collection page.
- `/bakufu collection share:true`: deliberately post this page of your collection
  in the current server channel. Repeat `share:true` for each page you want public.
- `/bakufu open pack:All Characters`: a private review with **Confirm pack opening**.
  Reviewing spends nothing. Confirming opens the pack once.

Messages are private to the invoking player unless that player explicitly uses
`share:true` for a collection page. Errors and empty collections remain private;
every response disables mentions. Collection pages show only the invoking
player's current active ownership in the linked realm, sorted by rarity from
Legendary to Common, then name and stable IDs. Recycled cards disappear and
transfers appear for their current owner. Long names/series are shortened to
fit Discord's message limit; the website keeps their full text. Public sharing
does not expose account IDs, email, balances, source credentials or another
player's inventory. Trading,
recycling, upgrades, wishlists, and exports remain available on the website;
their Discord commands are not implemented. There is no Gateway connection,
background worker, bot token, or live API dependency for ordinary gameplay.

`/bakufu collection` serves the collection-listing role of a command such as
Mudae's `$mm`, using Discord's slash-command interface. Type `/bakufu` in a server
channel and select **collection**; do not type `$mm`. No Message Content intent
or always-running Gateway bot is needed. Collection reads do not spend gems,
award XP, reserve cards or create a gameplay receipt. Listing a page again shows
current ownership rather than a permanently cached snapshot.

## Local development versus connecting real Discord

Your current `http://localhost:3000` website remains fully playable. Leave
`DISCORD_PUBLIC_KEY` blank to keep the interactions endpoint disabled. Automated
tests use local signed fixtures and never contact your Discord application.

To receive real commands, Discord must reach your web service through a public
HTTPS URL. This can be your eventual host or an HTTPS tunnel you control; the
deployment still uses the same persistent PostgreSQL database. If you change
`APP_ORIGIN`, update the Discord OAuth callback to match and use secure cookies
for HTTPS. See [the sign-in guide](discord-login.md). Endpoint setup and signature
verification follow [Discord's interaction endpoint documentation](https://docs.discord.com/developers/interactions/overview#setting-up-an-endpoint).

## Setup, step by step

1. Open your existing application in the [Discord Developer Portal](https://discord.com/developers/applications).
   In **General Information**, copy **Public Key**. This is different from the
   Application/Client ID and OAuth Client Secret. Add it to your private `.env`:

   ```dotenv
   DISCORD_PUBLIC_KEY=the_public_key_from_this_application
   ```

   Keep the existing `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`. All three
   must refer to the same application. Never paste the secret into chat.
2. Rebuild the deployment:

   ```powershell
   docker compose up --build -d
   ```

   This applies any pending migrations and passes the optional public key to the app.
3. In the Developer Portal, set **Interactions Endpoint URL** to your public
   HTTPS website address followed by `/api/discord/interactions`, for example:

   ```text
   https://your-game.example/api/discord/interactions
   ```

   This is a separate setting from the OAuth redirect URL. Discord tests a
   signed PING before accepting it. Do not enter `localhost` here.
4. Install the application's commands into your Discord server. The application
   must support server installation. One authorization URL form is:

   ```text
   https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=applications.commands&integration_type=0
   ```

   Replace `YOUR_APPLICATION_ID`, open the URL, choose your server, and authorize.
   This is separate from signing in to the website. The commands-only installation
   is supported by [Discord's command authorization flow](https://docs.discord.com/developers/interactions/application-commands#authorizing-your-application).
5. In the regular Discord app, turn on **User Settings → Advanced → Developer
   Mode**. Right-click your server's icon and choose **Copy Server ID**.
6. On the website, select the intended realm while signed in as a realm admin.
   Find **Discord gameplay**, paste that server ID, and choose **Link Discord
   server**. Each server links to one realm and each realm to one server.
   You can unlink or replace the server later without changing website progress.
   If **Realm joining** uses this server, switch it to **Invitation only** before
   changing the link. [Verified server joining](../gameplay/admission.md) is a
   separate optional OAuth flow and does not require slash-command registration.
7. Register the commands from your project terminal:

   ```powershell
   docker compose exec web pnpm discord:commands
   ```

   Paste the same server ID when prompted. For host development use
   `pnpm discord:commands`. This explicit operator command requests a short-lived
   application credential and creates/updates only `/bakufu` in that server;
   it does not replace unrelated commands. If the server still has the command's
   former name `/atlas` from an older release, the same run removes it. Until you
   re-run it after upgrading, `/atlas` keeps working. It uses the existing OAuth client
   secret, not a bot token. Its registration flow follows
   [Discord's client-credentials and command APIs](https://docs.discord.com/developers/topics/oauth2#client-credentials-grant).
8. Invite players through **Administration → Players & access → Invite players**. Existing
   local players should be linked with `pnpm discord:link` before inviting them.
   Server installation/linking does not grant anyone realm membership.
9. In that Discord server, try `/bakufu collection` to list your cards privately,
   then `/bakufu collection share:true` if you want that page visible to everyone
   in the channel. Try `/bakufu status`, `/bakufu packs`, then
   `/bakufu open pack:All Characters`. Review the price and choose **Confirm pack
   opening**. Refresh the website to see the same card, balance, and XP.

The code is tested locally; live Discord activation requires your public URL,
application configuration, and explicit command registration above. The agent
does not register commands or change Developer Portal settings automatically.
If `/bakufu` was installed before the collection command was added, rerun step 7
to update its subcommands. The existing realm, inventory and web login stay intact.

## Reviews, retries, and permissions

Reviews last ten minutes and belong to one linked account, server, realm, pack,
and configuration revision. Another user cannot confirm your review. A new
configuration revision requires a fresh review. Buying a pack discount may lower
the final charge; it cannot exceed the quoted maximum under the reviewed rules.
Availability, gems, cooldown, unique ownership, wishlist weights, and XP are all
checked by the same authoritative service used by the website.

Repeated delivery or clicking **the same confirmation button** replays the
opening receipt. It cannot spend twice. Failed empty-pool, insufficient-gem, and
cooldown attempts also have immutable receipts; run a new `/bakufu open` to make
a new attempt. If the response is lost or says the result is unconfirmed, retry
the same button and check the website before starting another review.

Reviews expired for more than one day are cleaned up when another review is
created in that realm. After cleanup, an old button reports that its review is
unavailable; the opening receipt and player progress remain durable. Expired
review rows may remain longer in inactive realms.

Unlinking, replacing, or unlinking/relinking a server invalidates its old
reviews. Re-saving the same link preserves them. Existing cards and receipts
remain unchanged. Server bindings are configured by realm admins through the
authenticated website; Discord role names or usernames do not grant access.
DMs and unlinked servers are rejected. Optional [verified server joining](../gameplay/admission.md)
and [name-based member search](../gameplay/members.md) are implemented;
see the [access notes](discord-login.md#realm-access-and-member-lookup).

The endpoint authenticates Ed25519 signatures against the exact raw body,
checks five-minute timestamp freshness and the configured application ID, and
limits request size to 16 KiB and body read time to 250 ms. It uses signatures
instead of browser cookies/Origin. Website mutations still require session,
Origin, and realm authorization. Interaction tokens and submitted raw payloads
are never stored or logged by the app.

Discord requires an initial response within three seconds. This slice responds
synchronously using a separate four-connection pool with 400 ms connection,
500 ms lock, 1,000 ms statement, and 1,500 ms PostgreSQL transaction timeouts.
An additional 1,700 ms client deadline closes a stalled transaction connection.
Busy work rolls back and returns a private retry message; no continuation is
left running after the response. Monitor actual latency on your host. Larger
workloads may need a durable deferred-job adapter in a future slice. See
[Discord response timing](https://docs.discord.com/developers/interactions/receiving-and-responding#responding-to-an-interaction)
and [PostgreSQL transaction limits](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-TRANSACTION-TIMEOUT).

## Recovery and troubleshooting

Config remains **v11** and player archives **v12**. Collection listing introduces
no migration or gameplay record. Encrypted backup envelope/payload remain v1 and
support migrations 0001-0026. Backups include server bindings and authoritative
opening receipts; transient Discord pack reviews are excluded. After recovery,
start a fresh review. Earlier snapshots restore with no server bindings.

- **Endpoint returns 503:** public key is blank or configuration is invalid.
  Check the same application's ID/key locally, then rebuild.
- **Endpoint validation fails:** check public HTTPS reachability, exact path,
  public key, application ID, and host clock. Unsigned requests return 401;
  a normal browser visit is not a valid Discord signature test.
- **Commands are missing:** complete server installation and run registration
  for the same server ID. Registration needs outbound access to Discord.
- **Server not linked:** link it to the intended realm on the website.
- **Not invited:** use the existing invitation/linking flow; commands never
  silently create accounts or memberships.
- **Review expired/changed:** run `/bakufu open` again. A restart keeps current
  reviews in PostgreSQL; restore or relinking requires fresh reviews.
- **Busy/unconfirmed:** retry the same button. Check the website before starting
  another opening, and investigate database/host latency if this persists.
