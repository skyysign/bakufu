# Automated restore checks

Optional weekly recovery checks for the encrypted snapshots
created by [scheduled backups](scheduled-backups.md). Each check creates a fresh
temporary database on a **separate PostgreSQL service**, migrates it, restores the
snapshot, compares the saved fields, and removes the database. Success requires
all these steps. It never restores into your running game database.

Both backup capture and restore checking remain off in base Compose. No new game
schema migration, realm config change, or player archive version is needed.
Gameplay config is v7 and player archives are v9.

## Setup with Docker

First finish [scheduled backup setup](scheduled-backups.md): prepare the private
external destination and separate passphrase file, initialize the destination,
and capture a successful snapshot. Keep its `BACKUP_INSTANCE_ID` stable. The
checker uses that same encrypted destination and passphrase.

Add a **different**, long, URL-safe password to your private `.env` for the
disposable restore service. Store it in your password manager. Do not reuse the
game database password. No Discord settings change.

```dotenv
RESTORE_CHECK_PASSWORD=replace-with-a-separate-long-random-password
RESTORE_CHECK_POLICY_VERSION=1
RESTORE_CHECK_DAY_UTC=1
RESTORE_CHECK_HOUR_UTC=4
RESTORE_CHECK_MAX_BACKUP_AGE_HOURS=36
```

Use all three Compose files. This starts the separate restore database,
initializes its control metadata, and starts the weekly checker. Your existing
backup destination must already contain a fresh snapshot.

```sh
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.restore-checks.yaml up --build -d restore-check
```

Run an additional check now and inspect status:

```sh
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.restore-checks.yaml run --rm --no-deps restore-check verify-once
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.restore-checks.yaml exec restore-check pnpm backup:verify:status
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.restore-checks.yaml ps
```

The default boundary is **Monday 04:00 UTC**, one hour after the default daily
backup boundary. Day numbers are 0=Sunday through 6=Saturday. Hours are 0–23.
Maximum snapshot age is configurable from 1–168 hours; the default rejects
snapshots older than 36 hours. Five minutes of future clock skew is tolerated.
Keep the backup/checker hosts' clocks synchronized.

The checker runs immediately if the current weekly period has not succeeded,
then checks each minute. Restarting in an already verified period skips another
restore. Failures retry. Explicit `verify-once` always attempts a fresh restore,
even in an already verified week. Downtime does not invent historical checks.

To stop the optional services, use the same three-file Compose prefix followed
by `stop restore-check restore-check-init restore-check-db`.

The restore database uses a 1 GiB tmpfs with no published port or game network
connection. Restored account records and password hashes exist privately during
the drill and are removed with its temporary database. The cluster is disposable;
its contents disappear when its temporary mount is discarded. On restart, the
initializer safely recreates pristine control metadata when the Compose services
are started again. If only the restore database restarts while its checker keeps
running, rerun the three-file `run --rm --no-deps restore-check verify-init`
command; the checker then retries. PostgreSQL error logging
is restricted to avoid failed row contents and SQL values. Large instances may
exhaust this MVP tmpfs; use a suitably sized separate service for larger drills.

## Status and what it establishes

The checker prefers the latest named daily snapshot; if none exists it uses the
latest weekly snapshot. It authenticates capture time rather than trusting the
filename. Wrong keys, unreadable/corrupt/stale files, migration errors,
constraint/ledger failures, comparison mismatches, and failed cleanup fail the
check. Backup files and retention are untouched by verification.

After recovery, PostgreSQL compares all fields present in the snapshot, including
stable IDs and timestamp microseconds. Expected values use PostgreSQL types so
timezone formatting does not create false differences. Legacy configuration
migrations are normalized; new IDs/baselines absent from old formats are not
invented for comparison. Sessions, OAuth flows, login limits, and transient
gameplay reviews must be empty.

`restore-status.json` is separate from capture's `status.json`. It contains only
version, outcome, attempt/success times, weekly period, verified snapshot capture
time, and SHA-256 of the encrypted file. It contains no account data, database
name, URL, key, or decrypted payload. A failure retains prior verification
metadata but stays unhealthy. The status command exits nonzero for missing or
failed status, or no successful check in **eight days**. Docker uses it as the
checker's health check. Monitor both capture and restore health: weekly recovery
does not establish that later daily captures succeed. Alert delivery remains
an operator responsibility.

The result establishes that this release can recover the selected snapshot with
the configured key and restore service. Continue **off-machine operator drills**
to prove disaster access to the mount, secrets, source release, and website
setup. There is no automatic restore into a live economy or claim that an offsite
destination/cloud provider has been configured for you.

## Host alternative and cleanup safeguards

Use a separate PostgreSQL 18 instance with a pristine database named exactly
`card_engine_restore_control`. Configure it not to log statement parameters or
failing row details. The dedicated operator role must own the database and have
`CREATEDB`, plus permission to remove its own drill databases. It needs no role
or connection on the game server.

Put the private URL in `RESTORE_CHECK_DATABASE_URL` in `.env`, for example:

```dotenv
RESTORE_CHECK_DATABASE_URL=postgresql://restore_checker:URL_SAFE_PASSWORD@localhost:5544/card_engine_restore_control
```

Only PostgreSQL URLs with this exact database name are accepted. Query options
that could redirect a generated target are rejected; `sslmode` is supported.
Prepare the backup destination/key as before, then run:

```sh
pnpm backup:verify:init
pnpm backup:verify
pnpm backup:verify:status
pnpm backup:verify:worker
```

Use a process supervisor, or schedule `pnpm backup:verify` externally.
Initialization refuses unrelated tables or another instance's marker. An
advisory lock prevents overlap. There is no `DATABASE_URL` fallback: only the
dedicated restore URL is used.

Each drill registers a random `card_engine_check_...` name before creation and
adds an exact ownership marker before restoring any data. Cleanup requires the
registration, matching name/job ID, current database owner, and exact marker.
It never deletes arbitrary databases with a matching prefix. The next run cleans
interrupted, verifiably owned drill databases before proceeding.

If creation or a manual ownership change leaves an ambiguous unmarked database,
the checker fails closed. An operator must inspect the separate restore service,
its `card_engine_restore_jobs` records, and database owners/comments. It will not
adopt or drop an unknown database. In Docker, stopping and recreating only the
disposable restore database service discards its tmpfs. Keep the live `db`
service and `postgres-data` volume intact.

Tests use fictional fixtures, disposable PostgreSQL, and isolated Docker networks.
`pnpm test:integration` covers successful/failed restores, ownership/interruption
handling, legacy recovery, and source comparisons. `pnpm test:backup-docker`
also checks the real entrypoint, separate restore service/network, private key
staging, verifier health, and cleanup. Neither test loads your private `.env`
or performs a live-player action. Temporary databases revoke public access before
any restore; the dedicated operator role and trusted server administrators remain
able to inspect them. Tmpfs can use host swap, so protect host disks/swap as well.

References: PostgreSQL [pristine database creation](https://www.postgresql.org/docs/18/sql-createdatabase.html)
and [database removal](https://www.postgresql.org/docs/18/sql-dropdatabase.html),
Docker [tmpfs storage](https://docs.docker.com/engine/storage/tmpfs/), and
[Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/).
