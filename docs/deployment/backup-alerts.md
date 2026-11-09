# Optional backup failure and recovery alerts

An optional, independent monitor reads the backup status files once
per minute and sends generic JSON to an operator-configured HTTPS receiver.
It is disabled by default. No Discord bot, game database, encryption passphrase,
or storage credentials are required by the monitor. Configure a receiver that
accepts this format; a Discord incoming webhook needs a separate format adapter.

Use Node **22.13 or later** for host commands: the durable operational queue uses
[Node's built-in SQLite](https://github.com/nodejs/node/blob/v22.x/doc/api/sqlite.md).
The reference container already uses Node 24. This SQLite file contains only
generic status and pending events. Gameplay and accounts remain in PostgreSQL.
Keep the monitor state on a persistent **local disk**, separate from the capture
directory and repository. Do not put its SQLite file on a network filesystem.

1. Finish [scheduled backup setup](scheduled-backups.md). Create a separate
   private receiver JSON file outside the repository, capture folder, and monitor
   state. Restrict its permissions (0600 on Linux; your account only on Windows):

   ```json
   {"schemaVersion":1,"url":"https://receiver.example/hook","token":"your-private-bearer-token"}
   ```

   The token is optional and must be 16 or more visible ASCII characters. URL
   credentials, query strings, fragments, HTTP, and redirects are rejected.
   The URL path may itself contain a secret: keep the entire file private.

2. Set `BACKUP_ALERT_WEBHOOK_FILE` to that absolute file path. Leave
   `BACKUP_ALERT_CHECKS=capture` unless the optional workers are configured.
   Use `capture,restore,offsite` only when all three run. Missing optional proofs
   count as failures when explicitly selected. Keep the existing
   `BACKUP_DIRECTORY` and `BACKUP_INSTANCE_ID`.

3. With Docker Compose, initialize the dedicated persistent state volume:

   ```sh
   docker compose -f compose.yaml -f infra/docker/compose.alerts.yaml run --rm --no-deps backup-alerts monitor-init
   docker compose -f compose.yaml -f infra/docker/compose.alerts.yaml run --rm --no-deps backup-alerts monitor-once
   docker compose -f compose.yaml -f infra/docker/compose.alerts.yaml up -d --no-deps backup-alerts
   docker compose -f compose.yaml -f infra/docker/compose.alerts.yaml exec backup-alerts pnpm backup:monitor:status
   ```

   Initialization sends nothing. The first observation can send a failure if
   backups are already unhealthy. The capture bind is read-only, and the monitor
   receives no database URL or backup keys. Keep the named alert state volume
   across upgrades; avoid Compose `down -v`.

   For host execution, create a private local directory, set its absolute path
   in `BACKUP_ALERT_STATE_DIRECTORY`, then run `pnpm backup:monitor:init`,
   `pnpm backup:monitor`, and `pnpm backup:monitor:worker` under your supervisor.
   `pnpm backup:monitor:status` reads state without opening the receiver file.

A healthy initial observation sends nothing. A changed unhealthy set sends
`backup.failure`; return to all healthy sends `backup.recovered`. Repeated
identical states produce no extra messages. Capture/offsite proofs expire after
36 hours; restore proofs after eight days. Missing, failed, stale, and unreadable
proofs have distinct generic states. Directory outages can also be reported.

The POST body has schema version 1, UUID `id`, UUID `monitorId`, monotonic
`sequence`, `type`, ISO `observedAt`, and selected `checks` (for example
`{"capture":"failed"}`). No account, realm, database address, path, raw error,
credential, or backup content is included. Optional authorization is Bearer.
Successful delivery requires HTTP 2xx within ten seconds. Redirects fail.

Delivery is **at least once**: a receiver must deduplicate the stable UUID in
`Idempotency-Key` (also `id` in the body), ideally with `(monitorId,sequence)`
ordering. A lost response may cause a repeat. One FIFO event is attempted each
minute, with a transactional 30-second lease; restarts retain pending events.
The queue holds 100 events. When full, observation fails visibly until delivery
frees space; transitions during an extended outage can be missed. Delivered
events are removed. State is bound to the instance and receiver URL hash.
Token rotation needs a restart; a receiver URL change needs a fresh initialized
state directory/volume. Drain the old queue first. Deleting state resets the
baseline and pending messages.

Monitor health means a recent observation (three minutes) and no pending
delivery. It can be healthy after successfully reporting failed backups. Use
the existing capture/restore/offsite health checks to assess preservation itself.
An external supervisor must detect monitor stoppage; this process cannot report
its own absence. Rejected receiver files or an unmounted Docker source can
prevent startup and need supervisor attention. No actual notifications are
sent by the automated tests: transports are isolated fixtures.
