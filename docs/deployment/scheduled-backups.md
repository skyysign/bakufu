# Optional scheduled encrypted backups

An optional, independent backup worker invokes the same encrypted
snapshot format and restore path as [manual backups](backups.md), without a web
request, Discord, cron vendor, or cloud account. Default policy v1 keeps **7 daily
and 4 weekly snapshots**, with a daily boundary at **03:00 UTC**. A mounted remote
drive can be the destination. A second folder on the database disk is not offsite
protection; configure the remote mount yourself before enabling the worker.

The worker is off by default. Ordinary `docker compose up` does not enable it,
create a passphrase, or change your private `.env`.

## Prepare the destination and passphrase

1. Choose an existing private destination outside the repository, preferably on
   another machine through a mounted drive. Give this instance exclusive use of
   its namespace. The filesystem must support atomic renames and hard links.
2. Create a separate private text file containing a new 16–256 character backup
   passphrase. Use your password manager or editor; do not pass the secret as a
   shell argument. One trailing newline is accepted. Store a recovery copy in
   your password manager. Keep this file outside both the repository and backup
   destination. Losing the passphrase makes the snapshots unrecoverable.
3. Restrict the file to the account running the worker. On Linux use mode `600`
   and ownership readable by the image's `node` user (UID 1000). The destination
   must be writable by that user. On Windows restrict the file's Security/ACL
   permissions and ensure Docker Desktop can access both selected paths. The
   Compose entrypoint copies the read-only key into a private memory filesystem
   with mode `600`; this handles Docker Desktop's synthetic Linux permissions
   without weakening the host worker's checks. The copy disappears with the
   container's temporary mount.
4. Add the following **paths and policy**, not the passphrase itself, to your
   private `.env`. These Windows paths are examples; create your own locations.

```dotenv
BACKUP_POLICY_VERSION=1
BACKUP_INSTANCE_ID=main
BACKUP_DIRECTORY=C:/PrivateBackups
BACKUP_PASSPHRASE_FILE=C:/PrivateSecrets/card-engine-backup-key.txt
BACKUP_HOUR_UTC=3
BACKUP_RETAIN_DAILY=7
BACKUP_RETAIN_WEEKLY=4
```

On Linux use absolute paths such as `/mnt/private-backups` and
`/srv/private-secrets/card-engine-backup-key`. Keep the instance ID stable and
unique within a destination; allowed IDs are 1–40 lowercase letters, digits,
and hyphens, starting with a letter or digit. Retention limits are 1–366 daily
and 1–260 weekly. UTC scheduling does not shift at daylight saving changes.

## Initialize, run, and check with Docker

Use both Compose files for every command below. Initialization creates only
`card-engine-main/.destination.json` inside the chosen existing destination.
The marker prevents the worker from silently using a replacement empty mount.
Neither Compose nor the worker creates missing host mount paths.

```sh
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml build backups
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml run --rm --no-deps backups init
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml run --rm --no-deps backups once
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml run --rm --no-deps backups status
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml up -d backups
```

Start the normal app/database first if they are not already running. The one-off
`backup:run` exits unsuccessfully if another job owns the lock or a backup fails.
Initialization and repeat runs are safe to repeat. Files are never overwritten.
To stop the scheduler, run the two-file Compose command with `stop backups`.

Host alternative with the same `.env`: `pnpm backup:init`, `pnpm backup:run`,
`pnpm backup:status`, then `pnpm backup:worker` under your process supervisor.
An external cron or scheduled task may run `pnpm backup:run` instead. Use one
scheduling approach per instance; PostgreSQL also prevents overlapping jobs.

## Timing, retention, and failure handling

The worker checks every minute and immediately checks on startup. It creates a
snapshot for the latest daily boundary already reached. Before 03:00 UTC that
is the previous date. After downtime it captures current state once; it does
not invent historical snapshots for missed days. The date is the scheduled
period; the encrypted payload records the actual capture time.

Each UTC Monday-based week retains its first successfully published daily
snapshot as a separate weekly file. For example:

```text
card-engine-main/
  .destination.json
  daily-2026-11-04.backup
  weekly-2026-11-02.backup
  status.json
```

Encrypted content is flushed to a private temporary file and published with an
exclusive hard link, so retries cannot expose a partially written final file or
overwrite a prior generation. Current daily/weekly files must authenticate with
the passphrase before retention removes older exact-name backup files. Unrelated
files are untouched. A partial weekly failure preserves the daily file and older
generations; retry finishes that generation. Corruption, a changed passphrase,
or a clock earlier than an existing generation fails closed. For key rotation,
stop the worker, preserve the old key and snapshots, and initialize a separate
namespace/destination with the new key. Do not replace the key in place.

`status.json` contains only version, generic success/failure, attempt/success
times, scheduled date, and retained file counts. No identities, paths, secrets,
or decrypted data enter it or worker logs. `backup:status` exits nonzero for
missing/failed status or no successful check in 36 hours. The optional Compose
service uses this as its health check. Configure your own supervisor/monitor to
alert on an unhealthy or stopped worker; no email or chat alert is sent.

The worker retries failed jobs each minute while running. Startup configuration
errors exit and are handled by Docker's restart policy. If a drive is unavailable,
restore the intended mount rather than initializing a new local destination.
An interrupted write may leave an encrypted `.pending-*` temporary file. These
are ignored and never treated as backups; remove confirmed leftovers manually
while the worker is stopped. A failure during retention can leave extra older
files until the next successful run.

## Prove recovery

A healthy status proves a successful capture/authentication check, not a completed
restore drill. Periodically restore one of these exact `.backup` files to a
**fresh, separate database**, using `pnpm restore <path>` and the same passphrase,
then compare player exports and inventories. Follow the [recovery guide](backups.md#restore-into-a-fresh-database).
Keep the matching source release, deployment configuration, and secrets separately.
Optional [automated restore checks](restore-checks.md) can now perform weekly
fresh-database recovery on a separate PostgreSQL service and report independent
health. They supplement off-machine operator drills.

Automated tests run the actual worker CLI against disposable PostgreSQL and
restore a scheduled snapshot to a new database, comparing stable player progress.
They also exercise retention, retries, concurrent exclusion, partial failure,
corruption, wrong keys, and boundary checks. No tests contact a remote drive or
cloud API. `pnpm test:backup-docker` additionally checks the built Docker image
against new isolated fixture containers, including a real read-only key mount,
private tmpfs, running worker health check, and fresh-database restore. Build the
web image first and have `postgres:18-bookworm` available locally. The check does
not load `.env` or touch the live deployment, removes its fixture containers and
network afterward, and does not pull images. Your remote mount and offsite
durability still require an operator restore drill.

Limits: snapshots still load into memory. This adapter uses a mounted filesystem;
automatic remote mounting, managed immutable-storage policies, and alerts remain
future work. Optional [S3-compatible encrypted copies](offsite-backups.md) now
provide direct upload, read-back verification, and authenticated recovery downloads. Optional isolated restore checks are implemented separately.
No cloud deployment has been performed by enabling this code.

For a bucket instead of a mounted offsite drive, add the separate
[encrypted offsite copy worker](offsite-backups.md). Local capture and its
retention remain authoritative; copying reports separate health and never
deletes remote objects.
