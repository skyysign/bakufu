# Self-hosting with Docker

Run Bakufu on your own computer or server. Players sign in with **Discord**; the
game, its database and everyone's progress stay on your machine. This guide gets
it running at `http://localhost:3000`. To let players reach it over the
internet, continue with [HTTPS hosting](https.md) afterwards.

## What you need

- **Docker:** [Docker Desktop](https://docs.docker.com/desktop/) on Windows or
  macOS (on Windows with the WSL 2 backend), or Docker Engine with the Compose
  plugin on Linux. In a new terminal, `docker compose version` and `docker info`
  must both work. If `docker` is not recognized, reopen the terminal after
  installing; if `docker info` can't connect, start Docker Desktop and wait.
- **A Discord application** for sign-in. It's free and takes a few minutes
  (step 2).
- **This repository:** `git clone https://github.com/skyysign/bakufu.git`, or
  download it as a ZIP from GitHub.

## 1. Create `.env`

In the project folder, copy the example settings:

```sh
cp .env.example .env              # PowerShell: Copy-Item .env.example .env
```

Replace the example database password with one long random value made of
letters and digits. It appears twice: in `POSTGRES_PASSWORD` and inside
`DATABASE_URL`. Keep `.env` private: never commit it, paste it into a chat or
show it in a screenshot.

## 2. Set up Discord sign-in

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. **New Application**, give it your game's name.
2. **General Information:** copy the **Application ID** into
   `DISCORD_CLIENT_ID`.
3. **OAuth2:** choose **Reset Secret** and copy the new secret into
   `DISCORD_CLIENT_SECRET`.
4. **OAuth2 → Redirects:** add exactly
   `http://localhost:3000/api/auth/discord/callback`.

Then your own Discord user ID: in the Discord app open **User Settings →
Advanced**, turn on **Developer Mode**, right-click your name next to any message
and choose **Copy User ID**. Put it in `DISCORD_ADMIN_USER_ID`.

```dotenv
DISCORD_CLIENT_ID=your_application_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_ADMIN_USER_ID=your_own_user_id
```

More detail and pictures: [Discord sign-in](discord-login.md).

## 3. Start Bakufu

```sh
docker compose up --build -d
```

The first build takes a few minutes. This starts PostgreSQL, applies the
database migrations and starts the website at <http://localhost:3000>. Port 3000
is reachable only from this computer.

## 4. Sign in and create a realm

Open <http://localhost:3000> and choose **Continue with Discord**. Your account
becomes the admin because its user ID matches `DISCORD_ADMIN_USER_ID` and no
admin exists yet; nobody else can claim that.

Go to **Administration → New realm**. Name it, choose its characters (an anime &
manga roster from MyAnimeList or AniList, or your own JSON/CSV file; the
12-character demo works offline), review the packs and rules, and create it. See
[providers](../content/providers.md) and [catalog format](../content/catalog.md).

## 5. Invite players

Under **Administration → Players & access**:

- **Invite players** by their Discord user ID, or
- link your Discord server and turn on **Realm joining**, so its members can
  join with a link ([realm joining](../gameplay/admission.md)).

Players sign in with Discord; nobody needs a password. Other people can reach
your game once it's online: see [HTTPS hosting](https.md) (a small Linux server
or VPS with your own domain). Register that address's callback in Discord too.

## Everyday operation

| Task | Command |
| --- | --- |
| Stop / start | `docker compose stop` / `docker compose start` |
| Status and logs | `docker compose ps`, `docker compose logs web --tail 100` |
| Apply changed `.env` settings | `docker compose up -d` |
| Update to a new version | back up first, then `git pull` and `docker compose up --build -d` (migrations run automatically) |
| Back up | see below |

Back up into a private folder outside the project (it asks for a passphrase;
keep it safe, a backup can't be restored without it):

```sh
docker compose run --rm --no-deps --volume /private/backups:/backups web pnpm backup /backups/bakufu-2026-11-09.backup
```

On Windows use a folder such as `C:\PrivateBackups` in place of
`/private/backups`. Restoring and automatic backups: [backups](backups.md).

All game data lives in the `postgres-data` Docker volume. `docker compose down`
keeps it; `docker compose down -v` **deletes it**. Changing the database password
in `.env` later does not change it inside PostgreSQL.

## Without Discord: local accounts

Discord is the intended sign-in, but local email-and-password accounts work too,
for example for an offline test:

```sh
docker compose exec web pnpm bootstrap       # first admin (password 12–256 characters)
docker compose exec web pnpm player:create   # a player for one realm (realm ID from the URL)
```

Local accounts can change their password under **Account settings**; there is no
password recovery. A local account can be linked to Discord later with
`docker compose exec web pnpm discord:link`
([details](discord-login.md#existing-local-accounts)).

## Optional extras

- [`/bakufu` slash commands](discord-gameplay.md) in your Discord server (needs
  HTTPS hosting).
- [Scheduled backups](scheduled-backups.md), [restore checks](restore-checks.md),
  [offsite copies](offsite-backups.md) and [backup alerts](backup-alerts.md).

## Troubleshooting

- **No "Continue with Discord" button:** set `DISCORD_CLIENT_ID` and
  `DISCORD_CLIENT_SECRET`, then `docker compose up -d`. A running container keeps
  its old settings until it is recreated.
- **"Invalid redirect" at Discord:** the redirect must match exactly; use
  `localhost`, not `127.0.0.1`.
- **Signed in but not an admin:** check `DISCORD_ADMIN_USER_ID` (your user ID,
  not the application ID). It only works while no admin exists yet.
- **"Bakufu is temporarily unavailable":** check `docker compose ps` (database
  and web should be healthy) and `docker compose logs migrate`.

Developing Bakufu itself? See the README's
[Development](../../README.md#development) section and
[CONTRIBUTING.md](../../CONTRIBUTING.md).
