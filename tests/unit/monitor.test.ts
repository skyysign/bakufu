import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import {
  monitorPolicy,
  recipientHash,
  webhookSchema,
  webhookSettings,
  type Checks,
} from '../../apps/worker/src/monitor-config';
import { monitorStore, type MonitorStore } from '../../apps/worker/src/monitor-store';
import {
  readBackupChecks,
  runMonitor,
  webhookSender,
  type AlertEvent,
} from '../../apps/worker/src/monitor';
import { backupPolicy, inside } from '../../apps/worker/src/config';
import { fileDestination } from '../../apps/worker/src/destination';
import { runBackupJob } from '../../apps/worker/src/backups';
import { runRemoteCopy } from '../../apps/worker/src/remote-copy';
import { runRestoreCheck } from '../../apps/worker/src/restore-check';
import { RestoreControl } from '../../apps/worker/src/restore-control';
import type { RemoteCopies } from '../../apps/worker/src/s3-copy';
import type { RemotePolicy } from '../../apps/worker/src/remote-config';
import type { RestorePolicy } from '../../apps/worker/src/restore-config';

const workspace = resolve('.'),
  now = new Date('2026-11-04T12:00:00Z');
let root: string | undefined;
const opened: MonitorStore[] = [];
afterEach(async () => {
  for (const store of opened.splice(0)) store.close();
  if (root && inside(tmpdir(), root) && root !== tmpdir())
    await rm(root, { recursive: true, force: true });
  root = undefined;
});
async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'card-alert-test-'));
  const state = join(root, 'state'),
    capture = join(root, 'capture'),
    receiver = join(root, 'receiver.json');
  await mkdir(state, { mode: 0o700 });
  await mkdir(capture, { mode: 0o700 });
  await writeFile(
    receiver,
    JSON.stringify({
      schemaVersion: 1,
      url: 'https://alerts.example.test/hook',
      token: 'fictional-alert-token',
    }),
    { mode: 0o600 },
  );
  const backup = backupPolicy({
      BACKUP_DIRECTORY: capture,
      BACKUP_PASSPHRASE_FILE: join(root, 'unused'),
    }),
    policy = monitorPolicy({
      BACKUP_ALERT_STATE_DIRECTORY: state,
      BACKUP_ALERT_WEBHOOK_FILE: receiver,
    });
  async function open(initialize = true, recipient = 'a'.repeat(64)) {
    const store = await monitorStore(state, workspace, capture, 'main', recipient, initialize);
    opened.push(store);
    return store;
  }
  return { state, capture, receiver, backup, policy, open };
}

describe('independent durable backup alerts', () => {
  it('validates selected checks, private absolute paths, and bounded HTTPS receiver settings', async () => {
    const f = await fixture();
    expect(f.policy.checks).toEqual(['capture']);
    for (const checks of ['restore', 'capture,capture', 'capture,other'])
      expect(() =>
        monitorPolicy({
          BACKUP_ALERT_STATE_DIRECTORY: f.state,
          BACKUP_ALERT_WEBHOOK_FILE: f.receiver,
          BACKUP_ALERT_CHECKS: checks,
        }),
      ).toThrow();
    expect(() =>
      monitorPolicy({
        BACKUP_ALERT_STATE_DIRECTORY: 'relative',
        BACKUP_ALERT_WEBHOOK_FILE: f.receiver,
      }),
    ).toThrow();
    for (const url of [
      'http://example.test/hook',
      'https://user:pass@example.test/hook',
      'https://example.test/?token=secret',
      'https://example.test/#secret',
    ])
      expect(() => webhookSchema.parse({ schemaVersion: 1, url })).toThrow();
    const settings = await webhookSettings(f.policy, f.backup, workspace);
    expect(recipientHash(settings)).toBe(
      recipientHash({ ...settings, token: 'rotated-fixture-token' }),
    );
    await expect(
      webhookSettings(
        { ...f.policy, webhookFile: join(workspace, 'package.json') },
        f.backup,
        workspace,
      ),
    ).rejects.toThrow();
    await rm(f.capture, { recursive: true });
    expect(await webhookSettings(f.policy, f.backup, workspace)).toEqual(settings);
    expect(await readBackupChecks(f.backup, f.policy, workspace, now)).toEqual({
      capture: 'unavailable',
    });
  });
  it('requires explicit initialized state bound to the instance and receiver', async () => {
    const f = await fixture();
    await expect(f.open(false)).rejects.toThrow();
    await f.open();
    await f.open();
    await expect(f.open(false, 'b'.repeat(64))).rejects.toThrow('another');
    await expect(monitorStore(f.state, workspace, f.capture, 'other', undefined)).rejects.toThrow(
      'another',
    );
    await expect(monitorStore(workspace, workspace, f.capture, 'main', undefined)).rejects.toThrow(
      'separate',
    );
    expect(
      (await readFile(join(f.state, 'monitor.sqlite'))).includes(
        Buffer.from('fictional-alert-token'),
      ),
    ).toBe(false);
  });
  it('starts quietly when healthy and emits one failure and recovery for a transition', async () => {
    const f = await fixture(),
      store = await f.open(),
      send = vi.fn(async (event: AlertEvent) => {
        void event;
      });
    await runMonitor(store, { capture: 'healthy' }, send, now);
    expect(send).not.toHaveBeenCalled();
    await runMonitor(store, { capture: 'failed' }, send, now);
    await runMonitor(store, { capture: 'failed' }, send, now);
    await runMonitor(store, { capture: 'healthy' }, send, now);
    expect(send.mock.calls.map(([event]) => event.type)).toEqual([
      'backup.failure',
      'backup.recovered',
    ]);
    expect(send.mock.calls.map(([event]) => event.sequence)).toEqual([1, 2]);
    expect(store.healthy(now)).toBe(true);
    expect(store.healthy(new Date(now.getTime() + 180001))).toBe(false);
  });
  it('retains the same event ID after failed delivery and reopening, with FIFO recovery', async () => {
    const f = await fixture(),
      store = await f.open(),
      failed: AlertEvent[] = [];
    await runMonitor(
      store,
      { capture: 'missing' },
      async (event) => {
        failed.push(event);
        throw new Error('private receiver error');
      },
      now,
    );
    expect(store.healthy(now)).toBe(false);
    const restarted = await f.open(false),
      sent: AlertEvent[] = [];
    await runMonitor(
      restarted,
      { capture: 'healthy' },
      async (event) => {
        sent.push(event);
      },
      now,
    );
    expect(sent[0]).toEqual(failed[0]);
    expect(restarted.pending()).toBe(1);
    await runMonitor(
      restarted,
      { capture: 'healthy' },
      async (event) => {
        sent.push(event);
      },
      now,
    );
    expect(sent.map((event) => event.type)).toEqual(['backup.failure', 'backup.recovered']);
    expect(restarted.pending()).toBe(0);
  });
  it('serializes concurrent monitors, recovers abandoned leases, and rejects stale acknowledgement', async () => {
    const f = await fixture(),
      a = await f.open(),
      b = await f.open(false);
    a.observe({ capture: 'stale' }, now);
    b.observe({ capture: 'stale' }, now);
    expect(a.pending()).toBe(1);
    const first = a.claim(now)!;
    expect(b.claim(now)).toBeNull();
    const second = b.claim(new Date(now.getTime() + 30001))!;
    expect(second.event.id).toBe(first.event.id);
    a.acknowledge(first.event.id, first.token, now);
    expect(a.pending()).toBe(1);
    b.acknowledge(second.event.id, second.token, now);
    expect(a.pending()).toBe(0);
  });
  it('bounds the durable queue without silently dropping a state transition', async () => {
    const f = await fixture(),
      store = await f.open();
    for (let i = 0; i < 100; i++) store.observe({ capture: i % 2 ? 'healthy' : 'failed' }, now);
    expect(() => store.observe({ capture: 'failed' }, now)).toThrow('full');
    expect(store.pending()).toBe(100);
    const first = store.claim(now)!;
    store.acknowledge(first.event.id, first.token, now);
    store.observe({ capture: 'failed' }, now);
    expect(store.pending()).toBe(100);
  });
  it('distinguishes missing, failed, stale, and corrupt proofs without reading snapshots', async () => {
    const f = await fixture(),
      source = await fileDestination(f.backup, workspace, true);
    const selected = {
      ...f.policy,
      checks: ['capture', 'restore', 'offsite'] as ('capture' | 'restore' | 'offsite')[],
    };
    expect(await readBackupChecks(f.backup, selected, workspace, now)).toEqual({
      capture: 'missing',
      restore: 'missing',
      offsite: 'missing',
    });
    const status = {
      schemaVersion: 1 as const,
      outcome: 'success' as const,
      lastAttemptAt: now.toISOString(),
      lastSuccessAt: now.toISOString(),
      scheduledDate: '2026-11-04',
      dailyRetained: 1,
      weeklyRetained: 1,
    };
    await source.writeStatus(status);
    expect(await readBackupChecks(f.backup, f.policy, workspace, now)).toEqual({
      capture: 'healthy',
    });
    expect(
      await readBackupChecks(f.backup, f.policy, workspace, new Date('2026-11-06T12:00:00Z')),
    ).toEqual({ capture: 'stale' });
    await source.writeStatus({ ...status, outcome: 'failed' });
    expect(await readBackupChecks(f.backup, f.policy, workspace, now)).toEqual({
      capture: 'failed',
    });
    await writeFile(
      join(f.capture, 'card-engine-main', 'status.json'),
      '{"private":"must not appear"}',
    );
    expect(await readBackupChecks(f.backup, f.policy, workspace, now)).toEqual({
      capture: 'unavailable',
    });
  });
  it('uses generic JSON with stable delivery ID, bounded requests, and refuses failed delivery', async () => {
    const f = await fixture(),
      store = await f.open();
    store.observe({ capture: 'failed' }, now);
    const event = store.claim(now)!.event;
    let request: RequestInit | undefined;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      request = init;
      return new Response(null, { status: 202 });
    });
    await webhookSender(
      { schemaVersion: 1, url: 'https://alerts.example.test/hook', token: 'fictional-alert-token' },
      fetcher,
    )(event);
    expect(request).toMatchObject({
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: { 'Idempotency-Key': event.id, Authorization: 'Bearer fictional-alert-token' },
    });
    expect(JSON.parse(String(request?.body))).toEqual(event);
    expect(JSON.stringify(event)).not.toMatch(/fictional|password|https|DATABASE/);
    await expect(
      webhookSender(
        { schemaVersion: 1, url: 'https://alerts.example.test/hook' },
        async () => new Response(null, { status: 302 }),
      )(event),
    ).rejects.toThrow('delivery');
  });
  it('records database connection failures immediately for capture, restore, and offsite jobs', async () => {
    const f = await fixture(),
      source = await fileDestination(f.backup, workspace, true),
      db = new pg.Pool();
    await db.end();
    await expect(runBackupJob(db, source, f.backup, 'unused-fixture-key', now)).rejects.toThrow(
      'backup failed',
    );
    const control = { db } as RestoreControl;
    await expect(
      runRestoreCheck(
        control,
        source,
        'main',
        { schemaVersion: 1, dayUtc: 0, hourUtc: 4, maxBackupAgeHours: 48 } as RestorePolicy,
        'unused',
        now,
      ),
    ).rejects.toThrow('failed');
    await expect(
      runRemoteCopy(db, source, {} as RemoteCopies, {} as RemotePolicy, 'main', 'unused', now),
    ).rejects.toThrow('failed');
    expect(
      await readBackupChecks(
        f.backup,
        { ...f.policy, checks: ['capture', 'restore', 'offsite'] },
        workspace,
        now,
      ),
    ).toEqual({ capture: 'failed', restore: 'failed', offsite: 'failed' } satisfies Checks);
  });
});
