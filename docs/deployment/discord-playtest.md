# Try your realm with a Discord server

Keep Docker. It already runs the website and persistent game database; hosting
means giving that same application a reachable HTTPS address. Discord commands
and players' browsers then use the same realm and collection as localhost.

For a first evening of testing, use a temporary HTTPS tunnel on your Windows PC.
For regular play, use a stable hostname; for availability while your PC is off,
move the existing instance to a Linux VPS with Docker Compose.

| Option | Best use | What needs to stay running |
| --- | --- | --- |
| Existing PC + Cloudflare Quick Tunnel | A short trial without a domain or Cloudflare account | Your PC, Docker Desktop and the tunnel terminal |
| Existing PC + named Cloudflare Tunnel | Repeated trials at one stable address; needs a Cloudflare account and domain | Your PC, Docker Desktop and the tunnel connector |
| Linux VPS + this project's Docker Compose/Caddy setup | An ongoing game independent of your PC; paid server and domain | The rented server; your PC can be off |

Quick Tunnels use a different hostname on each launch and are intended for
development. Cloudflare documents no uptime guarantee, a 200-request concurrency
limit and no Server-Sent Events. The current game uses ordinary HTTP requests.
See [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

The following steps are instructions for publishing your instance. Reading this
guide does not create a tunnel, change your Discord application or register a
command.

## 1. Preserve the existing game

Use the existing realm; do not create replacement accounts or a replacement
database. Make an encrypted instance backup following [backup and recovery](backups.md)
before inviting testers. A player's **Export collection** JSON is a personal
archive and cannot restore the whole server.

Keep the database's Docker volume. Changing the public website address does not
reset collections, balances, ranks or trades. Do not run `docker compose down -v`.

## 2. Get a temporary HTTPS address on Windows

1. Start Docker Desktop. In the project terminal, check the existing deployment:

   ```powershell
   docker compose ps
   ```

   `web` and `db` should be running and healthy. If necessary, start the existing
   deployment with `docker compose up --build -d`.
2. Download the **Windows 64-bit executable** from
   [Cloudflare's official downloads](https://developers.cloudflare.com/tunnel/downloads/#windows).
   Save it in your Downloads folder as **cloudflared.exe**. This example uses the
   downloaded executable directly, so no PATH change is needed.
3. Open a separate PowerShell terminal and run:

   ```powershell
   & "$env:USERPROFILE\Downloads\cloudflared.exe" tunnel --url http://localhost:3000
   ```

4. Wait for an address ending in `.trycloudflare.com`, such as
   `https://your-random-name.trycloudflare.com`. Keep this terminal open.
   Use the exact HTTPS address it prints in the next steps.

The tunnel forwards the website's existing loopback port. You do not need to
open a router port or publish PostgreSQL. Anyone with the address can reach the
sign-in page; realm membership still uses the application's invitation rules.
Do not enable Cloudflare email/Access challenges on the interactions route:
Discord's request cannot complete an interactive browser sign-in.

## 3. Point the game and Discord login at that address

Edit your existing private `.env` locally. Change only these two values, replacing
the example hostname with the one from your tunnel:

```dotenv
APP_ORIGIN=https://your-random-name.trycloudflare.com
COOKIE_SECURE=true
```

Keep the existing database and Discord OAuth credentials. `APP_ORIGIN` has no
trailing slash or path. Do not paste the file or secret into Discord/chat.

In your existing application in the
[Discord Developer Portal](https://discord.com/developers/applications), open
**OAuth2** and add this redirect:

```text
https://your-random-name.trycloudflare.com/api/auth/discord/callback
```

This is the public replacement for the localhost callback. You can retain the
localhost redirect for later development. Apply the environment changes:

```powershell
docker compose up -d --no-build
```

Open the **HTTPS tunnel address**, sign in again, and confirm that your existing
realm and cards are present. Use this address throughout the trial, including on
your own PC. Secure cookies will not work over the old plain-HTTP address.
See [Discord sign-in](discord-login.md) if an existing local admin account still
needs linking.

## 4. Enable the collection command in your Discord server

1. In your Discord application's **General Information**, copy **Public Key**.
   Add it to the existing `.env` as `DISCORD_PUBLIC_KEY`. It must come from the
   same application as your existing Client ID and Client Secret. The public key
   is a separate value from both of them. Run `docker compose up -d --no-build`
   again to apply it.
2. Set **Interactions Endpoint URL** in that application's General Information to:

   ```text
   https://your-random-name.trycloudflare.com/api/discord/interactions
   ```

   Save it. Discord must accept its signed validation request. This setting is
   separate from the OAuth2 redirect; a browser GET is not a signature test.
3. Install the application into your test server with the
   `applications.commands` scope using the commands-only installation described
   in [Discord gameplay setup](discord-gameplay.md#setup-step-by-step). This
   implementation uses slash commands over HTTP, so it needs neither the
   Message Content privileged intent nor an always-connected Gateway bot.
4. In the regular Discord app, open **User Settings → Advanced → Developer Mode**.
   Turn it on, then right-click your server icon and select **Copy Server ID**.
5. Sign in to the website as the realm admin. In **Administration → Players & access →
   Connect your Discord server**, paste that ID and select **Link Discord server**. Select the
   existing realm in Account settings first if necessary.
6. From the project terminal, register/update this server's commands:

   ```powershell
   docker compose exec web pnpm discord:commands
   ```

   Enter that same server ID at the prompt. Run this again after installing a
   release that adds a command. It updates `/bakufu` for the chosen server without
   replacing other applications' commands.
7. In your test server, enter `/bakufu collection`. It lists your currently owned
   cards from the linked realm privately, ten per page, ordered by rarity and
   name. Use `/bakufu collection page:2` for the next page. To deliberately show
   your selected page to the channel, use `/bakufu collection share:true`.
   The slash-command form serves the collection purpose of `$mm`; the app does
   not listen for a literal `$mm` chat message.

Installing the Discord application and linking the server do not grant realm
membership. Invite testers using **Administration → Players & access → Invite players**,
then have them sign in at the same public website address. You may instead
configure [verified server joining](../gameplay/admission.md) if that is the
admission rule you want.

## 5. Try one real trade

Use two different invited Discord accounts in the same realm:

1. Both sign in to the public website and open packs using their own balances.
2. Run `/bakufu collection` from each account; compare its entries with Collection
   on the website. This is read-only and does not spend gems or award cards.
3. Open **Trades** on the website. Find the other collector by name, choose cards
   and optionally gems, submit the offer, then have both participants confirm.
4. Refresh Collection and run `/bakufu collection` again for each account. The
   transferred cards should appear only under their new owner in this realm.

Trading remains a website action in this release. This trial verifies that the
Discord collection view and the web trade operate on the same saved inventory;
it does not add a Discord trade command.

## Finishing the temporary trial

Stop the tunnel with **Ctrl+C** when testing ends. Your game data remains in the
Docker database. A newly started Quick Tunnel gets a different hostname: update
`APP_ORIGIN`, the OAuth redirect and Interactions Endpoint URL together before
using it again.

To return to localhost-only development, stop the tunnel, restore
`APP_ORIGIN=http://localhost:3000` and `COOKIE_SECURE=false`, run
`docker compose up -d --no-build`, and sign in through localhost again. Leave the
localhost OAuth redirect registered. Discord commands require a reachable public
endpoint and will stop working while the tunnel is off.

## Keeping one address or moving to a server

For a stable address on this PC, follow
[Cloudflare's named tunnel setup](https://developers.cloudflare.com/tunnel/get-started/).
Connect a domain you control and route its chosen hostname to
`http://localhost:3000` using the Windows connector. Keep that hostname in
`APP_ORIGIN` and the two Discord URLs above. The database stays on your PC;
the tunnel is the route to it, not a separate game host.

For ongoing availability, the recommended portable path is a Linux VPS with
persistent storage, Docker Compose and the existing Caddy HTTPS overlay. Follow
[the VPS/HTTPS guide](https.md). A VPS is a rented computer; Docker remains the
deployment tool on it. Compare current server, storage, backup and domain costs
when choosing a provider. No particular provider is required; Docker supports
[production Compose deployment](https://docs.docker.com/compose/how-tos/production/).

Move the game using an **encrypted instance backup restored into the new empty
database**, not by starting a fresh realm or uploading a player archive. Restore
before bootstrap, retain the original PC database until recovery is verified,
then update the public address and Discord settings. The
[recovery guide](backups.md#restore-into-a-fresh-database) describes this process.
The local tunnel and rented-server options use the same engine and saved format.

## Troubleshooting

- **Website works but Discord login does not:** the exact HTTPS hostname must
  match `APP_ORIGIN` and the OAuth redirect. Recreate the app containers after
  changing `.env`; use the public HTTPS address instead of localhost.
- **Discord will not save the endpoint:** check that the tunnel is still running,
  the same application's Public Key is configured, and the path ends in
  `/api/discord/interactions`. An external login challenge can block validation.
- **The collection command is missing:** install commands for that server and
  rerun `pnpm discord:commands` from its Docker container.
- **The command says the server is unlinked or you are not invited:** link the
  server to the intended realm and complete membership/account linking on the
  website. Discord usernames alone do not authenticate an account.
- **Everything becomes unreachable after sleep or closing PowerShell:** keep the
  PC, Docker and connector running during a PC-hosted test. Use a VPS if that
  availability requirement becomes inconvenient.

This guide was checked against the repository and official documentation on
2026-11-07. Actual public reachability, Discord consent/installation and server
permissions must be verified on the operator's selected hostname. Nothing here
claims that a public deployment has already been created. Discord's
[HTTP interaction documentation](https://docs.discord.com/developers/interactions/receiving-and-responding)
and [command authorization documentation](https://docs.discord.com/developers/interactions/application-commands#authorizing-your-application)
describe the protocol used by the existing setup.
