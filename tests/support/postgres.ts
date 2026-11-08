import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { createDatabase } from '../../packages/db/src/connection';
import { migrate } from '../../packages/db/src/migrate';

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port.');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

export async function startPostgres() {
  const root = resolve('.test-data');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, 'postgres-'));
  if (!directory.startsWith(root + (process.platform === 'win32' ? '\\' : '/')))
    throw new Error('Unsafe test directory.');
  const port = await freePort();
  const password = randomBytes(24).toString('hex');
  const postgres = new EmbeddedPostgres({
    databaseDir: resolve(directory, 'cluster'),
    port,
    user: 'test_operator',
    password,
    persistent: true,
    authMethod: 'scram-sha-256',
    autoRehydrateSymlinks: true,
    initdbFlags: ['--encoding=UTF8'],
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {},
    onError: () => {},
  });
  try {
    await postgres.initialise();
    await postgres.start();
    const url = (name: string) =>
      `postgresql://test_operator:${password}@127.0.0.1:${port}/${name}`;
    return {
      async database(name: string, applyMigrations = true) {
        if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid test database name.');
        await postgres.createDatabase(name);
        const db = createDatabase(url(name));
        if (applyMigrations) await migrate(db);
        return { db, url: url(name) };
      },
      async stop() {
        await postgres.stop();
        // Windows may briefly retain a cluster handle after the server exits.
        // The absolute directory was verified inside the fixture root above.
        await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      },
    };
  } catch (error) {
    await postgres.stop().catch(() => {});
    throw error;
  }
}
