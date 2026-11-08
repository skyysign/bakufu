# Small public test (Windows, Cloudflare quick tunnel)

This runs a short public test from the Docker game on your PC. Testers reach it
through a temporary `https://….trycloudflare.com` address; the database stays on
your PC. For the full background (and a permanent address) see
[the Discord playtest guide](discord-playtest.md).

`scripts/public-test.ps1` automates the parts that must stay consistent: it
starts the tunnel, waits for its address and switches `APP_ORIGIN` and
`COOKIE_SECURE` in `.env` (remembering the old values). It never prints secrets,
never rebuilds or restarts Docker and never edits Discord settings. It expects
`.tools\cloudflared.exe` (from the
[cloudflared releases](https://github.com/cloudflare/cloudflared/releases)).

## Before the test

1. **Deploy the current version** (only if you changed code since the last build):

   ```powershell
   docker compose build web
   docker image tag card-engine-web:latest card-engine-migrate:latest
   docker compose up -d --no-build --wait
   ```

   If the build fails with "snapshot … does not exist", use
   `docker compose build --no-cache web` instead.
2. **Back up** the database first, for example:

   ```powershell
   docker compose run --rm --no-deps --volume C:\PrivateBackups:/backups web pnpm backup /backups/before-public-test.backup
   ```

   See [backups](backups.md); keep the passphrase somewhere safe.
3. **Choose who can join** in **Administration → Players & access**: link your
   Discord server and set **Members of your Discord server** so testers can join
   with the join link, or keep invitation-only and invite each tester.
4. Optionally adjust **Game rules** for the test (for example more starting gems).

## Start

```powershell
powershell -ExecutionPolicy Bypass -File scripts\public-test.ps1 -Start
docker compose up -d --no-build --wait
```

Then, in the [Discord Developer Portal](https://discord.com/developers/applications)
for your application, use the two URLs the script printed:

- **OAuth2 → Redirects:** `https://<address>/api/auth/discord/callback`
- **General Information → Interactions Endpoint URL:** `https://<address>/api/discord/interactions`

If the server still shows `/atlas`, register the renamed command once:
`docker compose exec web pnpm discord:commands` (paste the server ID). Share the
address (or the realm's join link) with your testers. Keep the PC awake and the
tunnel window open; closing it ends the test.

`-Status` shows the active address and whether the tunnel is still running.

## Stop

```powershell
powershell -ExecutionPolicy Bypass -File scripts\public-test.ps1 -Stop
docker compose up -d --no-build --wait
```

This stops the tunnel and restores your previous `APP_ORIGIN`/`COOKIE_SECURE`.
Set the Discord redirect back to `http://localhost:3000/api/auth/discord/callback`
if you sign in locally with Discord. Quick-tunnel addresses change on every
start, so a new test needs the two Discord URLs updated again.

## Things to know

- Quick tunnels are meant for short tests: no uptime guarantee, and the address
  is public to anyone who has it. Realm membership still requires an invitation
  or your Discord server, and every write is authorized on the server.
- Everything runs on your PC: when it sleeps or Docker stops, the game is offline.
- Testers' Discord display names are visible to other members of their realm.
