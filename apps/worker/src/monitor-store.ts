import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { lstat, open, realpath } from 'node:fs/promises';
import { inside } from './config';
import { alertEventSchema, type AlertEvent } from './monitor';
import { checkName, checkState, type Checks } from './monitor-config';
import { z } from 'zod';

const checksSchema = z
  .partialRecord(checkName, checkState)
  .refine((value) => value.capture !== undefined, 'Capture state is required.');
export class MonitorStore {
  constructor(
    private database: DatabaseSync,
    private monitorId: string,
  ) {}
  private transaction<T>(action: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  observe(input: Checks, now: Date) {
    const checks = checksSchema.parse(input),
      serialized = JSON.stringify(
        Object.fromEntries(Object.entries(checks).sort(([a], [b]) => a.localeCompare(b))),
      );
    this.transaction(() => {
      const meta = this.database
        .prepare('SELECT last_checks,next_sequence FROM monitor_meta WHERE singleton=1')
        .get()!;
      const previous = meta.last_checks
        ? checksSchema.parse(JSON.parse(String(meta.last_checks)))
        : null;
      const failed = Object.values(checks).some((value) => value !== 'healthy'),
        wasFailed = previous && Object.values(previous).some((value) => value !== 'healthy');
      if (meta.last_checks !== serialized && (failed || wasFailed)) {
        if (this.pending() >= 100) throw new Error('Alert queue is full.');
        const event: AlertEvent = {
          schemaVersion: 1,
          id: randomUUID(),
          monitorId: this.monitorId,
          sequence: Number(meta.next_sequence),
          type: failed ? 'backup.failure' : 'backup.recovered',
          observedAt: now.toISOString(),
          checks,
        };
        this.database
          .prepare('INSERT INTO monitor_events(id,sequence,payload) VALUES(?,?,?)')
          .run(event.id, event.sequence, JSON.stringify(alertEventSchema.parse(event)));
        this.database
          .prepare('UPDATE monitor_meta SET next_sequence=next_sequence+1 WHERE singleton=1')
          .run();
      }
      this.database
        .prepare('UPDATE monitor_meta SET last_checks=?,last_observed_at=? WHERE singleton=1')
        .run(serialized, now.toISOString());
    });
  }
  claim(now: Date): { event: AlertEvent; token: string } | null {
    return this.transaction(() => {
      const first = this.database
        .prepare('SELECT id,payload,lease_until FROM monitor_events ORDER BY sequence LIMIT 1')
        .get();
      if (!first || Number(first.lease_until ?? 0) > now.getTime()) return null;
      const token = randomUUID();
      this.database
        .prepare('UPDATE monitor_events SET lease_token=?,lease_until=? WHERE id=?')
        .run(token, now.getTime() + 30000, String(first.id));
      return { event: alertEventSchema.parse(JSON.parse(String(first.payload))), token };
    });
  }
  acknowledge(id: string, token: string, now: Date) {
    this.transaction(() => {
      const result = this.database
        .prepare('DELETE FROM monitor_events WHERE id=? AND lease_token=?')
        .run(id, token);
      if (Number(result.changes))
        this.database
          .prepare('UPDATE monitor_meta SET last_delivered_at=? WHERE singleton=1')
          .run(now.toISOString());
    });
  }
  release(id: string, token: string) {
    this.database
      .prepare(
        'UPDATE monitor_events SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?',
      )
      .run(id, token);
  }
  pending() {
    return Number(
      this.database.prepare('SELECT count(*) AS count FROM monitor_events').get()!.count,
    );
  }
  healthy(now = new Date()) {
    const meta = this.database
      .prepare('SELECT last_observed_at FROM monitor_meta WHERE singleton=1')
      .get()!;
    if (!meta.last_observed_at || this.pending()) return false;
    const age = now.getTime() - new Date(String(meta.last_observed_at)).getTime();
    return age >= -300000 && age <= 180000;
  }
  close() {
    this.database.close();
  }
}
export async function monitorStore(
  directory: string,
  workspace: string,
  captureDirectory: string,
  instanceId: string,
  recipient: string | undefined,
  initialize = false,
  readOnly = false,
): Promise<MonitorStore> {
  const root = await realpath(directory);
  const capture = await realpath(captureDirectory).catch(() => resolve(captureDirectory));
  if (inside(await realpath(workspace), root) || inside(capture, root))
    throw new Error('Use a separate local monitor state directory.');
  const path = join(root, 'monitor.sqlite');
  if (initialize) {
    try {
      const file = await open(path, 'wx', 0o600);
      await file.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' && stat.mode & 0o077)
  )
    throw new Error('Monitor state must be a private regular file.');
  const database = new DatabaseSync(path, { readOnly });
  try {
    database.exec('PRAGMA busy_timeout=1000;');
    if (!readOnly) database.exec('PRAGMA synchronous=FULL;');
    const objects = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    if (!objects.length && initialize) {
      database.exec(
        `BEGIN IMMEDIATE;CREATE TABLE monitor_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_version INTEGER NOT NULL CHECK(schema_version=1),instance_id TEXT NOT NULL,recipient_hash TEXT NOT NULL,monitor_id TEXT NOT NULL,last_checks TEXT,last_observed_at TEXT,last_delivered_at TEXT,next_sequence INTEGER NOT NULL DEFAULT 1);CREATE TABLE monitor_events(id TEXT PRIMARY KEY,sequence INTEGER NOT NULL UNIQUE,payload TEXT NOT NULL,lease_token TEXT,lease_until INTEGER);`,
      );
      database
        .prepare(
          'INSERT INTO monitor_meta(singleton,schema_version,instance_id,recipient_hash,monitor_id) VALUES(1,1,?,?,?)',
        )
        .run(instanceId, recipient!, randomUUID());
      database.exec('COMMIT');
    } else if (
      objects.length !== 2 ||
      objects.some((row) => !['monitor_meta', 'monitor_events'].includes(String(row.name)))
    )
      throw new Error('Use initialized monitor state only.');
    const meta = database
      .prepare(
        'SELECT schema_version,instance_id,recipient_hash,monitor_id FROM monitor_meta WHERE singleton=1',
      )
      .get();
    if (
      !meta ||
      meta.schema_version !== 1 ||
      meta.instance_id !== instanceId ||
      (recipient !== undefined && meta.recipient_hash !== recipient)
    )
      throw new Error('Monitor state belongs to another instance or receiver.');
    return new MonitorStore(database, z.uuid().parse(meta.monitor_id));
  } catch (error) {
    database.close();
    throw error;
  }
}
