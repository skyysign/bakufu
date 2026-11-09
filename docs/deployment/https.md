# Put Bakufu online with HTTPS

Run Bakufu on a Linux server or VPS with your own domain, so players can reach
it from anywhere and sign in with Discord. [Caddy](https://caddyserver.com) in
front of the game gets and renews the HTTPS certificate automatically. It is the
same image and database as [self-hosting with Docker](quickstart.md); try that
guide first if you haven't run Bakufu yet. This guide does not rent a server or
change DNS or firewall rules for you.

The plain `docker compose up` keeps serving only `http://localhost:3000`; use
this setup only on the machine that should be public.

## Prepare the host

1. Install Docker Engine and the Compose plugin using the
   [official instructions for your Linux distribution](https://docs.docker.com/engine/install/).
   Verify `docker version` and `docker compose version`. Use persistent host
   storage for PostgreSQL and retain the matching source release/lockfile.
2. Copy this source release to a private directory on that host. The examples
   below run in the project root through an SSH shell. Copy `.env.example` to
   `.env` and edit it privately; restrict its permissions, for example `chmod
   600 .env`. Never commit or paste it into chat. Use a long URL-safe PostgreSQL
   password as described in [quickstart](quickstart.md).
3. Choose one DNS hostname you own, such as `cards.your-domain.net`. Point its A
   record to the host. Add an AAAA record only if the host is reachable over
   IPv6 too. Use the actual lowercase hostname in these settings:

   ```dotenv
   PUBLIC_HOSTNAME=cards.your-domain.net
   APP_ORIGIN=https://cards.your-domain.net
   COOKIE_SECURE=true
   ```

   `PUBLIC_HOSTNAME` has no scheme, port, path, comma, or wildcard. `APP_ORIGIN`
   must match exactly, without a trailing slash. The overlay forces secure app
   cookies and rejects inconsistent settings.

   Add your Discord sign-in settings (`DISCORD_CLIENT_ID`,
   `DISCORD_CLIENT_SECRET`, `DISCORD_ADMIN_USER_ID`) as in
   [step 2 of the Docker guide](quickstart.md#2-set-up-discord-sign-in). In the
   Discord Developer Portal, under **OAuth2 → Redirects**, add your public
   callback:

   ```text
   https://cards.your-domain.net/api/auth/discord/callback
   ```
4. Permit inbound TCP **80 and 443** in the provider network rules and host
   configuration. Preserve SSH access. Do not publish PostgreSQL or the app's
   port 3000 to the internet. Docker publishes ports through its own firewall
   rules; check the [Docker firewall documentation](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
   rather than assuming a host UFW rule filters published container ports.

The proxy publishes 80/443; the app's existing 3000 mapping stays bound to
127.0.0.1, and the database has no host port. This is a single directly reachable
host example. An extra CDN/load balancer, custom TLS issuer, or managed database
requires its own reviewed network configuration.

## Build and check settings before publishing

Use both files in this order for every deployment command:

```sh
docker compose -f compose.yaml -f infra/docker/compose.https.yaml build
docker compose -f compose.yaml -f infra/docker/compose.https.yaml run --rm --no-deps https-check
```

`https-check` checks only hostname/origin/cookie settings. It prints no submitted
values, reads no game records, and makes no external request. It does not prove
DNS reachability or public certificate issuance. The proxy also depends on this
check succeeding and the app passing readiness before it starts.

Start the private application components first:

```sh
docker compose -f compose.yaml -f infra/docker/compose.https.yaml up -d db migrate web
docker compose -f compose.yaml -f infra/docker/compose.https.yaml ps
```

Wait for web health to become healthy.

If moving an **existing game**, restore its encrypted instance backup into this
fresh database **before bootstrap**. Do not create replacement realms or users.
Mount a private external backup location into a one-off app container:

```sh
docker compose -f compose.yaml -f infra/docker/compose.https.yaml run --rm --no-deps --volume /srv/private-backups:/backups:ro web pnpm restore /backups/move.backup
```

The backup must be readable by the image's `node` user. Enter the original backup
passphrase privately and confirm the empty-target restore. See
[backup/recovery](backups.md) for migration compatibility and an independent
restore drill. Keep deployment settings and recovery secrets separately from
the encrypted snapshot. IDs, memberships, cards, gems, XP, and histories are
preserved by recovery; a player JSON archive alone cannot restore the instance.

Then start HTTPS:

```sh
docker compose -f compose.yaml -f infra/docker/compose.https.yaml up -d
curl --fail https://cards.your-domain.net/api/health/ready
```

The expected body is `{"ok":true}`. Open that HTTPS site and choose **Continue
with Discord**. On a **new instance**, the account matching
`DISCORD_ADMIN_USER_ID` becomes the admin (there is no default password; without
Discord, create a local admin with `docker compose exec web pnpm bootstrap`). For
a **moved game**, check your existing account, collection and export. Caddy obtains/renews the public certificate and
redirects HTTP to HTTPS once the domain and certificate challenge are reachable.
Its `caddy-data` and `caddy-config` volumes survive container replacement. Keep
those volumes and their private TLS keys protected; they are deployment state,
separate from application snapshots. This recipe does not enable HTTP/3 ports.

For configuration changes, rerun the settings check and recreate/restart the
proxy. Its admin API is disabled; do not use `caddy reload` or expose port 2019.
HSTS is one day, without subdomain/preload options. Use HTTPS consistently.

## Optional: slash commands and backup workers

For `/bakufu` slash commands in your Discord server, use
`https://cards.your-domain.net/api/discord/interactions` as the interactions
endpoint and follow [command setup](discord-gameplay.md). HTTPS alone does not
register commands, link a realm or change its joining rule.

Enable [scheduled encrypted backups](scheduled-backups.md) on the host using
an operator-prepared off-machine destination and separate private key. Add its
overlay after the HTTPS overlay. To add isolated weekly [restore checks](restore-checks.md)
as well, use this complete prefix:

```sh
docker compose -f compose.yaml -f infra/docker/compose.https.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.restore-checks.yaml up -d
```

Complete each worker's initialization guide first. Keep this same file list for
later updates. A local snapshot on the database disk is not offsite protection.
Monitor capture and restore status independently.

## Health, updates, and limitations

- `GET /api/health/live` returns HTTP 200 and `{"ok":true}` when HTTP handling
  works, independently of PostgreSQL. It performs no database operation.
- `GET /api/health/ready` returns 200/`{"ok":true}` only when a bounded database
  query sees this release's exact migration names. It returns 503/`{"ok":false}`
  on missing configuration, connection failure, missing/extra migrations, denied
  permission, or timeout. It uses a separate one-connection pool, with shared
  concurrent probes, 500 ms connection/statement limits and a 1 second client
  query timeout. It returns no database/version/instance/account details.

Both endpoints are anonymous, read-only, and uncached. Docker polls readiness;
an unhealthy status does not itself restart a running container. These probes
do not reconcile inventories/ledgers, validate migration checksums, test provider
consent, or establish backup health. Migrations validate their checksums on
startup; independent recovery checks exercise data integrity. Add your own
monitoring/alerting at the host boundary.

Before updating, capture an off-machine encrypted backup and test recovery.
Retain the prior release/image and matching recovery settings. Pull reviewed
base/proxy updates, rebuild, and use the same Compose files for `up --build -d`.
Migrations finish before the web starts; readiness gates proxy startup. This
single-host recipe does not promise zero downtime. Do not downgrade across an
incompatible schema; restore into a separate fresh project/database for recovery.
Never remove the live `postgres-data` volume while updating.

HTTP access logging is off. Runtime proxy error logs remove request objects and
URI fields so failed callbacks cannot log OAuth codes/state, cookies, or bearer
headers. The app retains its existing callback referrer suppression and Origin
checks. Do not turn on debug/access logs without reviewing data exposure. There
is no open account registration, password recovery, account deletion,
abuse-rate-limit service or automatic security-update service.

`pnpm test:https-docker` checks the built app image and real proxy snippets on a
new internal Docker network. It uses a local CA and verifies TLS trust, HTTP
redirects, secure login/export, Origin rejection, callback origin/referrer
behavior, signed raw PING, database outage/recovery, and error-log privacy. It
publishes no host ports, never loads `.env`, pulls no images,
and removes fictional fixture resources. Have the built web image,
`caddy:2.11-alpine`, and `postgres:18-bookworm` available locally first.

Local Docker verification is not a remote deployment or a public ACME test.
DNS, firewall reachability, public certificate issuance, offsite durability, and
host-specific monitoring still require operator verification on the chosen host.

References: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[proxy header behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[runtime logging](https://caddyserver.com/docs/caddyfile/options#log), and
[Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).
