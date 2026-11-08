# Running Card Engine

## Docker Compose (reference deployment)

Requires Docker Engine/Desktop with Compose v2. No cloud account, Discord,
external catalog, or system Node installation is needed for this path.

**First-time Windows setup:** install
[Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
before running the commands below. Use its WSL 2 backend and Linux containers.
Open Docker Desktop, finish its setup, and wait for the engine to start. Follow
any WSL setup or restart instructions shown by the installer. Then fully close
and reopen your IDE/PowerShell so it receives the updated PATH.

Check installation and engine readiness in the new terminal:

```powershell
docker --version
docker compose version
docker info
```

If PowerShell says `docker` is not recognized (`Die Benennung "docker" wurde
nicht ... erkannt`), Docker is missing or its executable is not on that
terminal's PATH. Install Docker Desktop and reopen the IDE before retrying.
If the version commands work but `docker info` cannot connect to the engine,
start Docker Desktop and wait until it is ready. These checks must succeed
before step 3; no application containers start when the command is unrecognized.

1. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell,
   or `cp .env.example .env` in a POSIX shell).
2. Replace the example database password. Use a long random **URL-safe** password
   (for example hexadecimal) for this Compose configuration. Update both
   `POSTGRES_PASSWORD` and the password in `DATABASE_URL`. Keep `.env` private.
3. Run:

   ```sh
   docker compose up --build -d
   docker compose exec web pnpm bootstrap
   ```

   The first command starts persistent PostgreSQL, runs migrations as a one-shot
   service, and then starts the web app. Bootstrap prompts for your email and a
   hidden password (at least 12 characters); it refuses a second admin bootstrap.
4. Open <http://localhost:3000>, sign in, open **Administration**, choose
   **New realm**, and give it a name. In **Characters**, either prepare an
   **Anime & manga roster** (MyAnimeList via Tenrai by default; pick the roster
   size with the slider) or choose **Your JSON file** / **Your CSV file**. For a
   quick offline try, download the **12-character demo catalog** from the JSON
   option and upload it. Confirm content rights, choose **Preview catalog and
   packs**, check the packs and rules, then **Create realm**. See
   [catalog format](../content/catalog.md).
   After the first preview, **Category pack selection** lets you choose categories
   and pack names for this new realm. Preview again before creating it. See
   [starter packs](../content/starter-packs.md).
   If creation loses its response, keep the page open and choose **Retry realm
   creation** to recover the original realm. After reloading, check your realm
   list before starting another creation.
   Choose a large pack on Discover, then select **1, 5 or 10 packs** on its
   dedicated opening view and check the total cost. The information bubble shows
   odds and availability by hover, keyboard or tap. Opening starts
   a preparation animation while awarded artwork is decoded. Use **Reveal card**
   or **Open 5/10 packs**, then **Next card**, **Skip animation**, **Show all cards**
   or **Close**. The complete results use a portrait gallery with pack labels.
   New realms start with 2,000 gems and charge 200 per pack, with no opening
   cooldown. Complete or close the reveal, then open another 1/5/10-pack bundle
   immediately. Existing realms retain their saved wait until an admin reviews
   **Game rules → Economy → Cooldown (seconds) → 0**. Five-tier base weights are
   65% common, 26% uncommon, 7% rare, 1.7% epic and 0.3% legendary; actual
   displayed odds account for unclaimed tiers and available characters.
   Reduced motion shows a static summary. Uncheck **Show card
   reveals** for direct results. See [pack reveals](../gameplay/pack-reveals.md).
   **Sound on / Sound off** controls original rarity-specific opening effects;
   reduced motion stays silent. Pack artwork follows mouse movement, while touch
   and keyboard work without motion. See [Discover](../gameplay/discovery.md).
   Use the navigation to open **Discover**, **Collection**, **Market**, **Trades**,
   **Collector ranks** and **Wishlist** as separate pages. Each URL retains the
   selected realm and browser Back/Forward works between screens. Administration
   and account settings have their own pages. Admins can switch **Admin view** off
   to see player navigation with their current inventory, then switch it on to
   restore admin controls. This preview does not change server permissions.
   **Account settings** contains realm selection and ownership information;
   regular play pages have no selector strip. Linked Discord profile pictures
   refresh when the player signs in through Discord again.
   The dedicated opening room uses compact navigation and a large floating pack,
   with no large footer. Collection search, rarity filters and sorting help
   organize cards. Faces use a fixed 5:7 portrait shape and colored rarity frames,
   without genre lists; click one for enlarged inspection and value evidence.
   A rare reveal plays an original local silent cinematic;
   reduced-motion users get a static summary. No remote art/video service is needed.
   View your collection and use **Export collection** for version-12 JSON,
   including timed gem claims, current character values and historical recycling
   evidence.
   New realms include six collector tracks, each with four levels. Improve
   Bronze, Silver and Gold independently to unlock Sapphire, Ruby and Emerald.
   Existing realms keep new tracks disabled until reviewed; a realm admin can
   choose **Game rules → Collector ranks → Use the recommended six ranks**,
   preview and apply. Old purchased benefits remain active. See
   [collector ranks](../gameplay/collector-ranks.md) and [market](../gameplay/market.md).
   New realms also enable **1,000 gems every six hours**. Claim from **Collector ranks**;
   the first claim is available immediately and later claims use a rolling wait.
   Existing realms keep claims disabled after migration. To enable them, open
   **Administration → Game rules → Economy → Free gem claims**, choose
   **Use recommended** (or switch on **Timed gem claims**), then preview and
   apply. Amount and interval can be customized.
   The header shows claim readiness/countdown and links to Collector ranks, which
   also shows the next claim's local time. Gems are claimed manually.
   See [timed gem claims](../gameplay/gem-claims.md) and [pack bundles](../gameplay/pack-bundles.md).
   For anime/manga metadata, choose **Anime & manga roster** during creation:
   **MyAnimeList** (popular roster or chosen series), **AniList** (chosen series)
   or **Other formats** (up to 25 AniList character IDs, authorized AniList/Jikan
   JSON). For a larger offline test, upload the downloadable 1,000-character test
   catalog through **Your JSON file**. Add missing characters later under
   **Administration → Characters**. See [providers and scale testing](../content/providers.md).
   Source imports require explicit
   permission/review. The Jikan-compatible API browser loads series pages as
   needed and can prepare a bounded 1,000-character roster. Remote artwork
   requires a separate permission statement and loads from provider CDNs only
   when displayed; original fallback art stays available offline.
   **Recycle** and rank **Level up** act on the first click. Pending requests
   retain their original retry key, so recovering a lost response cannot repeat
   the operation. Default base card values
   are 30/60/120/260/620 gems for common/uncommon/rare/epic/legendary; saved
   popularity and bounded other-collector wishlist demand produce character-specific
   values when enabled. See [character values](../gameplay/character-values.md). The realm creation form allows
   overrides. Exports include your recycling history. Existing realms retain
   their old rewards during migration; adopting the reviewed
   [economy preset](../gameplay/rarity-economy.md) changes future rewards without
   resetting collections or balances.
   Collector ranks also shows XP and levels. The separate XP-gated discount
   shop is retired; old purchases keep their benefits while the six rank tracks
   provide the upgrade path. See [rank rules](../gameplay/collector-ranks.md).
   **Your wishlist** lets you search and save characters, with three slots and
   2× within-tier weight by default. **Browse characters** opens a searchable
   illustrated picker; **Character glossary** browses the full realm catalog
   by rarity and ownership. Expand a wish to see its chances in each pack.
   Trades use the same visual selection approach for owned cards.
   Slots and weight can be changed when creating a realm. See
   [wishlist rules](../gameplay/wishlist.md).
   Realm admins can use **Administration → Game rules** to edit live rules, preview player
   and pack impacts, and apply the reviewed change. Protected ranks and occupied
   wishes cannot be invalidated. See [live settings](../gameplay/settings.md).
5. Invite another player with:

   ```sh
   docker compose exec web pnpm player:create
   ```

   Supply the realm UUID from its URL, email, and password. Give the account
   details to that player privately. Existing accounts retain their passwords;
   rerunning membership provisioning never repeats the starting gem grant.

Prefer Discord login? Follow [optional Discord sign-in](discord-login.md).
It supports first-admin setup without a separate website password and player
invitations from the realm dashboard. One-time Discord application setup is
required; local login remains available.

If you cannot sign in locally, bootstrap must finish with **Account ready**.
Passwords accept **12–256 characters**, not exactly 12. Terminal password entry
is intentionally hidden. Use the website email/password chosen there; the
PostgreSQL password in `.env` is only for the database connection.
Choose **Account settings** after signing in to change your local password and
revoke other sessions. See [password changes](account-settings.md). Forgotten-
password recovery is outside the current Discord-focused scope; Discord-only accounts keep using Discord.

The database volume persists across container restarts and `docker compose down`.
The PostgreSQL 18 mount targets `/var/lib/postgresql`, following the
[official image's version-specific data-directory layout](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata).
Do not remove its volume unless intentionally destroying the instance.
Changing `.env` does not change a password already initialized in PostgreSQL.
The image includes CLI and TypeScript tooling for this small initial release.

### Keeping `.env` private

The `.env` file is local configuration, not an encrypted secret store. This
project's `.gitignore` excludes `.env` and `.env.*` from normal Git additions,
and `.dockerignore` excludes them from Docker build uploads. Only
`.env.example`, containing placeholders, should be committed. Ignore rules do
not remove files that were already committed or protect copies made by other
tools.

Keep `.env` on your machine; do not paste its contents into chats, include it
in screenshots, or upload it with a project ZIP. Anyone with permission to
read the file on your computer can read its values. The supplied app does not
serve this root file to website visitors. You can edit it locally as needed.

Web port 3000 binds to loopback. For remote hosting, put an HTTPS reverse proxy
in front of it, set `APP_ORIGIN` to the exact external origin, and set
`COOKIE_SECURE=true`. Keep PostgreSQL private. The proxy must forward the
original Origin header. Configure firewall rules, backups, and TLS yourself;
the repository does not provision an offsite service.

## Host-based development

Requires Node 22.13+ (Node 24 recommended), pnpm 10.34.0, and PostgreSQL 18.
Use `corepack enable` and `corepack prepare pnpm@10.34.0 --activate` if pnpm is
not installed. On Windows these Corepack setup commands may need an elevated
terminal when Node is installed under Program Files.

After preparing `.env` as above:

```sh
pnpm install --frozen-lockfile
docker compose -f compose.yaml -f infra/docker/compose.dev.yaml up -d db
pnpm db:migrate
pnpm bootstrap
pnpm dev
```

Alternatively use your own persistent PostgreSQL and its `DATABASE_URL`.
The development overlay exposes the database on **loopback** port 5432 only.
Root commands load root `.env`; credentials never belong in shell arguments.

For a host production build:

```sh
pnpm build
pnpm start
```

Migrations must be applied separately before starting an existing deployment.
Take a tested backup before upgrading. SQL migrations carry checksums and fail
if a previously applied migration is edited.

## Verification commands

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Integration tests launch a real, temporary PostgreSQL 18 instance from the
development-only `embedded-postgres` package. They do not contact live content
APIs or use your configured production database. Installation downloads the
platform binary; test execution uses local fixtures only. Tests use isolated
directories under ignored `.test-data/` and delete their database after running.
The PostgreSQL test process must run as a normal, non-root OS user; do not enable
the package's system-user creation option. `pnpm install` permits build scripts
only for the explicitly listed binary packages, esbuild, and sharp.

The browser test starts a production web build and another temporary database.
On Windows it uses installed Microsoft Edge. On Linux/macOS install Chromium
once with `pnpm exec playwright install chromium`; this is a development tool,
not a runtime hosting dependency. Run `pnpm build` before `pnpm test:e2e`.
Browser screenshots are local, ignored test artifacts with fictional content.

This implementation was validated on Windows with Node 24, real PostgreSQL,
and Edge. Docker Desktop became available during the authentication follow-up:
`docker compose config --quiet` and `docker compose up --build -d` passed,
migrations completed, and the web container returned HTTP 200 with the expected
first-time setup notice. Real Discord consent still requires your configured
application; automated OAuth tests use fixtures.

## Optional Discord gameplay

[Discord pack commands](discord-gameplay.md) use the same inventory as the website.
Local play and OAuth sign-in need no interaction endpoint. Real Discord commands
require the additional public-key setting, public HTTPS endpoint, server installation,
realm link, and explicit `pnpm discord:commands` registration described in that guide.

Realm admins can also enable [verified Discord server joining](../gameplay/admission.md)
under **Realm joining**. This uses OAuth membership verification and needs no
slash-command endpoint. Invitation-only remains the default.

## Optional scheduled backups

The [scheduled backup guide](scheduled-backups.md) adds an independent worker
with encrypted snapshots, daily/weekly retention, and health status. Prepare a
private external destination and separate passphrase file, initialize it, and
run a fresh-database restore drill. The base Compose file leaves this off.

The optional [restore checker](restore-checks.md) verifies fresh-database recovery
on a separate disposable PostgreSQL service and reports weekly recovery health.
It requires its own explicit setup and never targets the live game database.

## Optional HTTPS hosting

[Portable HTTPS deployment](https.md) adds Caddy, a hostname/origin/cookie
settings check, and a Linux/VPS recipe. It remains off in the local setup.
Readiness at `/api/health/ready` checks database access and migration names;
liveness at `/api/health/live` checks HTTP handling only. Both return minimal
anonymous, uncached results. Health does not replace backup or restore checks.

Optional [encrypted offsite copies](offsite-backups.md) send retained encrypted
snapshots to an explicitly configured private S3-compatible bucket and provide
a download command for fresh-database recovery. This stays off by default and
uses a separate private credential file.
