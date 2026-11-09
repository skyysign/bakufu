# Optional encrypted copies to S3-compatible storage

This optional setup copies the encrypted snapshots from [scheduled backups](scheduled-backups.md)
to an existing private S3-compatible bucket. Every copied generation is read
back and compared byte-for-byte before success is recorded. The application
never uploads a decrypted snapshot, backup passphrase, or storage credentials.
Local capture and retention remain unchanged. This feature is off by default.

The adapter uses the official AWS S3 SDK with an explicit HTTPS endpoint and
private credential file. It supports providers implementing conditional
`PutObject` and `GetObject`; compatibility must be checked on your chosen service.
It does not create a bucket, set a public ACL, list the bucket, delete objects,
configure lifecycle rules, or provision a cloud account. Provider charges and
retention are operator choices.

## Prepare storage and private files

1. Complete local backup setup and run a successful `backup:run`. Keep its
   passphrase separately in your password manager. A recent healthy local
   capture is required before copying generations.
2. Create a **private bucket** through your storage provider and choose a
   dedicated prefix for this instance. Give the engine access only to that
   prefix. Required operations are `GetObject` and `PutObject`; neither deletion
   nor bucket administration is required. Keep public access disabled.
3. Create a separate private UTF-8 JSON credential file outside the repository and
   the capture directory. Its fields are:

   ```json
   {
     "accessKeyId": "YOUR_STORAGE_ACCESS_KEY",
     "secretAccessKey": "YOUR_STORAGE_SECRET_KEY"
   }
   ```

   Temporary credentials may also include `sessionToken`. These are storage
   credentials, separate from the backup encryption passphrase and Discord keys.
   Restrict the file's Windows ACL or use POSIX mode `600`. Keep it readable by
   the worker account; Docker's image uses UID 1000. Do not paste its contents
   into chat or put its values in shell arguments.
4. Add only paths and destination settings to your private `.env`. For example:

   ```dotenv
   BACKUP_REMOTE_POLICY_VERSION=1
   BACKUP_S3_ENDPOINT=https://s3.us-east-1.amazonaws.com
   BACKUP_S3_REGION=us-east-1
   BACKUP_S3_BUCKET=your-private-bucket
   BACKUP_S3_PREFIX=card-engine-production
   BACKUP_S3_CREDENTIALS_FILE=C:/PrivateSecrets/card-engine-storage.json
   BACKUP_REMOTE_MAX_BYTES=67108864
   ```

   Use your provider's HTTPS **API endpoint**, signing region, and bucket name.
   Do not use a public object URL or put credentials in the endpoint. Endpoint
   paths, queries, fragments, and user info are rejected. Prefix components may
   use letters, numbers, hyphens, and underscores, separated by `/`. The adapter
   uses path-style bucket addressing. Ambient AWS profiles, environment access
   keys, and machine-role credential discovery are not used.

The default maximum object size is 64 MiB, configurable from 1 KiB to 512 MiB.
Capture/encryption still load snapshots into memory; copying authenticates one
generation at a time. Retrieval is size-bounded, with request/body deadlines.
Large instances may need a streaming preservation adapter in a later slice.

## Initialize, copy, and monitor

Build the optional service, then explicitly initialize the remote namespace:

```sh
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.offsite.yaml build offsite
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.offsite.yaml run --rm --no-deps offsite remote-init
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.offsite.yaml run --rm --no-deps offsite remote-once
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.offsite.yaml run --rm --no-deps offsite remote-status
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.offsite.yaml up -d offsite
```

Keep the normal database running for the shared capture lease. Initialization
checks conditional writes using a new random control object, then creates/verifies
the instance marker. If the provider ignores conditional creation, initialization
fails before uploading snapshots. Small `.conditional-probe-*` control objects
remain because this adapter never requests deletion. Repeating initialization
creates another probe and safely rechecks the marker.

The worker checks every five minutes. It authenticates retained local generations,
copies changed/unproven sources, and verifies returned bytes. A completed proof
for unchanged local digests and the same destination avoids cloud requests on
each poll, without refreshing its original success time. Explicit `remote-once`
always rechecks the remote objects. Keys and credentials are loaded at startup;
restart after rotating files, then use `remote-once` to test the new credentials.

For host operation use `pnpm backup:remote:init`, `pnpm backup:remote`,
`pnpm backup:remote:status`, and `pnpm backup:remote:worker`. The Docker entrypoint
stages both read-only private files on a mode-600 tmpfs to handle Windows bind
mount permissions. Neither key is written into the image or backup destination.
Add the HTTPS overlay to the command prefix when using public hosting.

Objects are stored under:

```text
<BACKUP_S3_PREFIX>/card-engine-<BACKUP_INSTANCE_ID>/
  .destination.json
  .conditional-probe-<random-id>
  daily-2026-11-04.backup
  weekly-2026-11-02.backup
```

Conditional creation prevents overwrites. Existing identical bytes are accepted
on retry; different content fails and stays intact. A lost response after upload
is recovered by retrying the same immutable key. Copying holds the local capture
lease so retention cannot remove an input mid-copy; ordinary gameplay does not
use that lease. No remote deletion or pruning takes place.

Configure remote lifecycle/retention yourself. Use separate rules matching the
`daily-` and `weekly-` key prefixes, keeping enough history for your recovery
needs. Do not expire the namespace marker or control prefix. Keep the original
namespace for recovery; after rebuilding a capture timeline, use a fresh remote
prefix if a dated key would otherwise have different encrypted bytes.

`remote-status.json` is local and separate from capture/restore health. It records
only version, outcome, times, verified generation count, capture time, and hashes
of source/destination identity. No raw endpoint, bucket, object key, account data,
credentials, or passphrase is stored in it or CLI logs. Missing/failed status,
changed destination, stale local capture, or a proof older than 36 hours is
unhealthy. Docker uses this status check. It describes a past verified copy,
not continuous remote availability; run `remote-once` for a fresh check and
monitor capture, offsite copy, and restore health separately. Alerts remain an
operator responsibility.

Read-back proves encrypted-byte preservation. It does not reconcile the game's
ledgers or replace a fresh-database restore check.

## Download and prove recovery

Choose an existing generation name from your saved records or storage console.
Create a private recovery folder outside the repository **and** capture directory.
For Docker, mount that folder separately and request a new file:

```sh
docker compose -f compose.yaml -f infra/docker/compose.backups.yaml -f infra/docker/compose.offsite.yaml run --rm --no-deps --volume /srv/private-recovery:/recovery offsite remote-fetch daily-2026-11-04.backup /recovery/recovered.backup
```

On Windows use an existing absolute Windows folder as the volume source.
Host alternative:

```sh
pnpm backup:remote:fetch daily-2026-11-04.backup /private/recovery/recovered.backup
```

The download authenticates the encrypted file using the original backup passphrase
before publishing it with private permissions. It refuses existing target files,
relative paths, and output inside the source repository/capture directory. The
file remains encrypted. Run `pnpm restore <path>` against a **fresh separate
database**, following [recovery](backups.md), and compare player exports. A player
archive alone cannot replace this instance snapshot.

If the original capture directory was lost, prepare a new empty private local
directory and run `backup:init` with the original instance ID before fetching.
That initializes only local filesystem metadata; download needs no live game
database. Retain the original remote endpoint, prefix, instance ID, and encryption
passphrase in your recovery plan. New storage credentials may be issued by your
provider. No command restores into the live economy automatically.

Automated tests exercise the actual S3 SDK/signing with an in-process protocol
fixture, including unsupported conditional writes, conflicts, read-back corruption,
lost responses, bounds, credential separation, and a fresh PostgreSQL restore
from a downloaded file. `pnpm test:backup-docker` also checks the real CLI and
two-file secret staging using a test-only storage preload. Tests make no real
cloud request. Your provider's conditional-write/checksum compatibility, lifecycle,
permissions, durability, and billing need an explicit operator check.

References: [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
and [S3 SDK checksums](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html).
