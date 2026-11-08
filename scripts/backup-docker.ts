import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { inside } from '../apps/worker/src/config';

// Optional Docker verification. Uses only new, isolated containers and fictional fixtures.
// Build the web image first. No .env loading, live database access, or remote provider calls.
const execute = promisify(execFile),
  suffix = randomUUID().replaceAll('-', ''),
  network = `card-backup-test-${suffix}`,
  database = `card-backup-db-${suffix}`,
  worker = `card-backup-worker-${suffix}`,
  restoreNetwork = `card-restore-test-${suffix}`,
  restoreDatabase = `card-restore-db-${suffix}`,
  restoreWorker = `card-restore-worker-${suffix}`,
  monitorVolume = `card-alert-state-${suffix}`,
  password = randomBytes(24).toString('hex'),
  passphrase = randomBytes(32).toString('hex');
let root: string | undefined;
const docker = async (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  (await execute('docker', args, { env, windowsHide: true, maxBuffer: 1024 * 1024 })).stdout.trim();
try {
  const image = await docker([
    'image',
    'inspect',
    '--format',
    '{{.Id}}',
    process.env.BACKUP_TEST_IMAGE ?? 'card-engine-web:latest',
  ]);
  assert.match(image, /^sha256:[a-f0-9]+$|^[a-f0-9]{12,64}$/);
  root = await mkdtemp(join(tmpdir(), 'card-engine-docker-backup-'));
  const destination = join(root, 'backups'),
    key = join(root, 'fixture.key');
  await mkdir(destination, { mode: 0o700 });
  await writeFile(key, passphrase, { mode: 0o600, flag: 'wx' });
  await docker(['network', 'create', '--internal', network]);
  await docker(
    [
      'run',
      '-d',
      '--pull=never',
      '--name',
      database,
      '--network',
      network,
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'POSTGRES_USER=fixture',
      '--env',
      'POSTGRES_DB=fixture',
      'postgres:18-bookworm',
    ],
    { ...process.env, POSTGRES_PASSWORD: password },
  );
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      await docker(['exec', database, 'pg_isready', '-U', 'fixture', '-d', 'fixture']);
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert.ok(ready, 'Fixture PostgreSQL readiness.');
  const url = (name: string) => `postgresql://fixture:${password}@${database}:5432/${name}`;
  const environment = { ...process.env, DATABASE_URL: url('fixture') };
  const mounts = [
    '--mount',
    `type=bind,source=${destination},target=/backups`,
    '--mount',
    `type=bind,source=${key},target=/run/secrets/backup_passphrase,readonly`,
  ];
  const common = ['--pull=never', '--network', network, '--env', 'DATABASE_URL', ...mounts];
  async function program(source: string, connection = url('fixture'), extraMounts: string[] = []) {
    const child = spawn(
      'docker',
      [
        'run',
        '--rm',
        '-i',
        ...common,
        ...extraMounts,
        image,
        'node',
        '--import',
        'tsx',
        '--input-type=module',
      ],
      {
        env: { ...environment, DATABASE_URL: connection },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.resume();
    const ended = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Fixture program failed.')),
      );
    });
    child.stdin.on('error', () => {});
    child.stdin.end(source);
    await ended;
    return output.trim();
  }
  const before = JSON.parse(
    await program(`
    import {randomBytes,randomUUID} from 'node:crypto';
    import {createDatabase,bootstrap,createRealm,getRealmView,openPack,exportPlayer} from './packages/db/src/index.ts';
    import {migrate} from './packages/db/src/migrate.ts';
    const db=createDatabase(process.env.DATABASE_URL);
    try { await migrate(db); const actor=await bootstrap(db,'docker-backup@example.test',randomBytes(24).toString('hex'));
      const realm=await createRealm(db,actor,'Docker backup fixture');
      await openPack(db,actor,realm,(await getRealmView(db,actor,realm)).packs[0].id,randomUUID());
      console.log(JSON.stringify({actor,realm,archive:await exportPlayer(db,actor,realm)}));
    } finally {await db.end();}
  `),
  );
  const jobArgs = [
    ...common,
    '--tmpfs',
    '/run/backup-key:rw,noexec,nosuid,size=1m,mode=0700,uid=1000,gid=1000',
    '--env',
    'BACKUP_DIRECTORY=/backups',
    '--env',
    'BACKUP_PASSPHRASE_FILE=/run/secrets/backup_passphrase',
    '--env',
    'BACKUP_INSTANCE_ID=fixture',
    '--env',
    'BACKUP_HOUR_UTC=0',
  ];
  const entry = [image, 'node', '--import', 'tsx', 'apps/worker/src/docker.ts'];
  const once = (mode: string) => docker(['run', '--rm', ...jobArgs, ...entry, mode], environment);
  await once('init');
  assert.match(await once('once'), /created/);
  assert.match(await once('once'), /current/);
  assert.match(await once('status'), /healthy/);
  await docker(
    [
      'run',
      '-d',
      '--name',
      worker,
      ...jobArgs,
      '--health-cmd',
      'node --import tsx apps/worker/src/main.ts status',
      '--health-interval=1s',
      '--health-timeout=5s',
      '--health-start-period=1s',
      ...entry,
      'serve',
    ],
    environment,
  );
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    if ((await docker(['inspect', '--format', '{{.State.Health.Status}}', worker])) === 'healthy') {
      healthy = true;
      break;
    }
    await delay(500);
  }
  assert.ok(healthy, 'Running worker health check.');
  await docker([
    'exec',
    database,
    'psql',
    '-U',
    'fixture',
    '-d',
    'fixture',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    'CREATE DATABASE recovered',
  ]);
  const after = JSON.parse(
    await program(
      `
    import {readFileSync,readdirSync} from 'node:fs';
    import {createDatabase,exportPlayer} from './packages/db/src/index.ts';
    import {migrate} from './packages/db/src/migrate.ts';
    import {restoreBackup} from './packages/db/src/backup.ts';
    const db=createDatabase(process.env.DATABASE_URL);
    try { await migrate(db); const path='/backups/card-engine-fixture/',file=readdirSync(path).filter(n=>n.startsWith('daily-')).sort().at(-1);
      await restoreBackup(db,readFileSync(path+file,'utf8'),readFileSync('/run/secrets/backup_passphrase','utf8'));
      console.log(JSON.stringify(await exportPlayer(db,${JSON.stringify(before.actor)},${JSON.stringify(before.realm)})));
    } finally {await db.end();}
  `,
      url('recovered'),
    ),
  );
  assert.deepEqual({ ...after, exportedAt: before.archive.exportedAt }, before.archive);
  // Test the real offsite CLI/container secret staging with a fixture-only SDK preload.
  const remoteStore = join(root, 'fixture-s3'),
    recovery = join(root, 'recovery'),
    credentials = join(root, 'storage.json');
  await mkdir(remoteStore, { mode: 0o700 });
  await mkdir(recovery, { mode: 0o700 });
  await writeFile(
    credentials,
    JSON.stringify({
      accessKeyId: 'FICTIONALACCESSKEY',
      secretAccessKey: 'fictional-storage-secret-key-for-tests',
    }),
    { mode: 0o600, flag: 'wx' },
  );
  const remoteArgs = [
    ...jobArgs,
    '--mount',
    `type=bind,source=${remoteStore},target=/fixture-s3`,
    '--mount',
    `type=bind,source=${recovery},target=/recovery`,
    '--mount',
    `type=bind,source=${credentials},target=/run/secrets/backup_s3_credentials,readonly`,
    '--env',
    'BACKUP_S3_ENDPOINT=https://s3.fixture.test',
    '--env',
    'BACKUP_S3_REGION=us-east-1',
    '--env',
    'BACKUP_S3_BUCKET=fixture-bucket',
    '--env',
    'BACKUP_S3_PREFIX=backups',
    '--env',
    'BACKUP_S3_CREDENTIALS_FILE=/run/secrets/backup_s3_credentials',
  ];
  const remote = (mode: string, ...args: string[]) =>
    docker(
      [
        'run',
        '--rm',
        ...remoteArgs,
        image,
        'node',
        '--import',
        './tests/support/s3-provider.mjs',
        '--import',
        'tsx',
        'apps/worker/src/docker.ts',
        `remote-${mode}`,
        ...args,
      ],
      environment,
    );
  assert.match(await remote('init'), /initialized/);
  assert.match(await remote('once'), /copied/);
  assert.match(await remote('status'), /healthy/);
  const generation = (await readdir(join(destination, 'card-engine-fixture')))
    .filter((name) => name.startsWith('daily-'))
    .sort()
    .at(-1)!;
  assert.match(await remote('fetch', generation, '/recovery/downloaded.backup'), /authenticated/);
  await docker([
    'exec',
    database,
    'psql',
    '-U',
    'fixture',
    '-d',
    'fixture',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    'CREATE DATABASE offsite_recovered',
  ]);
  // Recover the downloaded fixture independently of the capture directory.
  const offsiteAfter = JSON.parse(
    await program(
      `
    import {readFileSync} from 'node:fs'; import {createDatabase,exportPlayer} from './packages/db/src/index.ts';
    import {migrate} from './packages/db/src/migrate.ts'; import {restoreBackup} from './packages/db/src/backup.ts';
    const db=createDatabase(process.env.DATABASE_URL);
    try {await migrate(db);await restoreBackup(db,readFileSync('/downloaded.backup','utf8'),readFileSync('/run/secrets/backup_passphrase','utf8'));console.log(JSON.stringify(await exportPlayer(db,${JSON.stringify(before.actor)},${JSON.stringify(before.realm)})));}finally{await db.end();}
  `,
      url('offsite_recovered'),
      [
        '--mount',
        `type=bind,source=${join(recovery, 'downloaded.backup')},target=/downloaded.backup,readonly`,
      ],
    ),
  );
  assert.deepEqual({ ...offsiteAfter, exportedAt: before.archive.exportedAt }, before.archive);
  // The actual verifier can reach only its new control service, not the fixture game DB.
  await docker(['network', 'create', '--internal', restoreNetwork]);
  await docker(
    [
      'run',
      '-d',
      '--pull=never',
      '--name',
      restoreDatabase,
      '--network',
      restoreNetwork,
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'POSTGRES_USER=fixture',
      '--env',
      'POSTGRES_DB=card_engine_restore_control',
      '--tmpfs',
      '/var/lib/postgresql:rw,nosuid,size=1g',
      'postgres:18-bookworm',
      'postgres',
      '-c',
      'log_min_messages=fatal',
      '-c',
      'log_min_error_statement=panic',
      '-c',
      'log_error_verbosity=terse',
    ],
    { ...process.env, POSTGRES_PASSWORD: password },
  );
  let controlReady = false;
  for (let i = 0; i < 60; i++) {
    try {
      await docker([
        'exec',
        restoreDatabase,
        'pg_isready',
        '-U',
        'fixture',
        '-d',
        'card_engine_restore_control',
      ]);
      controlReady = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert.ok(controlReady, 'Separate restore service readiness.');
  const restoreEnvironment = {
    ...process.env,
    RESTORE_CHECK_DATABASE_URL: `postgresql://fixture:${password}@${restoreDatabase}:5432/card_engine_restore_control`,
  };
  const verifyArgs = [
    '--pull=never',
    '--network',
    restoreNetwork,
    '--env',
    'RESTORE_CHECK_DATABASE_URL',
    ...mounts,
    '--tmpfs',
    '/run/backup-key:rw,noexec,nosuid,size=1m,mode=0700,uid=1000,gid=1000',
    '--env',
    'BACKUP_DIRECTORY=/backups',
    '--env',
    'BACKUP_PASSPHRASE_FILE=/run/secrets/backup_passphrase',
    '--env',
    'BACKUP_INSTANCE_ID=fixture',
  ];
  const verify = (mode: string) =>
    docker(['run', '--rm', ...verifyArgs, ...entry, `verify-${mode}`], restoreEnvironment);
  await verify('init');
  assert.match(await verify('once'), /verified/);
  assert.match(await verify('status'), /healthy/);
  const temporaryCount = await docker([
    'exec',
    restoreDatabase,
    'psql',
    '-U',
    'fixture',
    '-d',
    'card_engine_restore_control',
    '-t',
    '-A',
    '-c',
    "SELECT count(*) FROM pg_database WHERE datname ~ '^card_engine_check_'",
  ]);
  assert.equal(temporaryCount, '0');
  await docker(
    [
      'run',
      '-d',
      '--name',
      restoreWorker,
      ...verifyArgs,
      '--health-cmd',
      'node --import tsx apps/worker/src/restore-main.ts status',
      '--health-interval=1s',
      '--health-timeout=5s',
      '--health-start-period=1s',
      ...entry,
      'verify-serve',
    ],
    restoreEnvironment,
  );
  let verifyHealthy = false;
  for (let i = 0; i < 30; i++) {
    if (
      (await docker(['inspect', '--format', '{{.State.Health.Status}}', restoreWorker])) ===
      'healthy'
    ) {
      verifyHealthy = true;
      break;
    }
    await delay(500);
  }
  assert.ok(verifyHealthy, 'Running restore verifier health check.');
  assert.equal(
    await docker([
      'exec',
      restoreDatabase,
      'psql',
      '-U',
      'fixture',
      '-d',
      'card_engine_restore_control',
      '-t',
      '-A',
      '-c',
      "SELECT to_regclass('public.accounts') IS NULL",
    ]),
    't',
  );
  // The monitor has no database URL/key/cloud credentials and no network access.
  await docker(['rm', '-f', worker]);
  const receiver = join(root, 'receiver.json'),
    alerts = join(root, 'alerts');
  await mkdir(alerts, { mode: 0o700 });
  await writeFile(
    receiver,
    JSON.stringify({
      schemaVersion: 1,
      url: 'https://alerts.fixture.test/hook',
      token: 'fictional-alert-token',
    }),
    { mode: 0o600 },
  );
  await docker(['volume', 'create', monitorVolume]);
  const monitorArgs = [
    '--pull=never',
    '--network=none',
    '--mount',
    `type=bind,source=${destination},target=/backups,readonly`,
    '--mount',
    `type=bind,source=${receiver},target=/run/secrets/backup_alert_receiver,readonly`,
    '--mount',
    `type=bind,source=${alerts},target=/fixture-alerts`,
    '--mount',
    `type=volume,source=${monitorVolume},target=/var/lib/card-engine-monitor`,
    '--tmpfs',
    '/run/backup-key:rw,noexec,nosuid,size=1m,mode=0700,uid=1000,gid=1000',
    '--env',
    'BACKUP_DIRECTORY=/backups',
    '--env',
    'BACKUP_INSTANCE_ID=fixture',
    '--env',
    'BACKUP_ALERT_STATE_DIRECTORY=/var/lib/card-engine-monitor',
    '--env',
    'BACKUP_ALERT_WEBHOOK_FILE=/run/secrets/backup_alert_receiver',
  ];
  const monitor = (mode: string) =>
    docker([
      'run',
      '--rm',
      ...monitorArgs,
      image,
      'node',
      '--import',
      './tests/support/alert-provider.mjs',
      '--import',
      'tsx',
      'apps/worker/src/docker.ts',
      `monitor-${mode}`,
    ]);
  assert.match(await monitor('init'), /initialized/);
  await monitor('once');
  assert.match(await monitor('status'), /healthy/);
  assert.deepEqual(await readdir(alerts), []);
  const statusPath = join(destination, 'card-engine-fixture', 'status.json'),
    savedStatus = await readFile(statusPath, 'utf8');
  await writeFile(statusPath, JSON.stringify({ ...JSON.parse(savedStatus), outcome: 'failed' }));
  await monitor('once');
  await monitor('once');
  assert.match(await monitor('status'), /healthy/);
  await writeFile(statusPath, savedStatus);
  await monitor('once');
  const events = (await readFile(join(alerts, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.type),
    ['backup.failure', 'backup.recovered'],
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [1, 2],
  );
  assert.ok(!JSON.stringify(events).includes('fictional-alert-token'));
  console.log(
    'Docker backup checks passed: private secret staging, encrypted capture/retry, offsite copy/download and fresh restore with storage fixtures, worker health, isolated restore verification, durable failure/recovery alerts without database or network, and cleanup. Live deployment untouched.',
  );
} catch {
  console.error(
    'Docker backup verification failed. Build the web image and ensure Docker and the local PostgreSQL image are available. Fixture containers are being cleaned up.',
  );
  process.exitCode = 1;
} finally {
  await docker(['volume', 'rm', monitorVolume]).catch(() => {});
  await docker(['rm', '-f', '-v', restoreWorker]).catch(() => {});
  await docker(['rm', '-f', '-v', restoreDatabase]).catch(() => {});
  await docker(['network', 'rm', restoreNetwork]).catch(() => {});
  await docker(['rm', '-f', '-v', worker]).catch(() => {});
  await docker(['rm', '-f', '-v', database]).catch(() => {});
  await docker(['network', 'rm', network]).catch(() => {});
  if (root && inside(tmpdir(), root) && root !== tmpdir())
    await rm(root, { recursive: true, force: true });
}
