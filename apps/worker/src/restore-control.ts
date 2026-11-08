import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Database, Transaction } from '../../../packages/db/src/connection';

const controlName = 'card_engine_restore_control',
  databaseName = /^card_engine_check_[a-f0-9]{32}$/;
const metadataTables = ['card_engine_restore_control', 'card_engine_restore_jobs'];
export function restoreControlUrl(input: string): URL {
  const url = new URL(input);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    decodeURIComponent(url.pathname) !== `/${controlName}` ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => key !== 'sslmode')
  )
    throw new Error('Use the dedicated restore control database URL.');
  return url;
}
export class RestoreControl {
  readonly db: Database;
  private readonly url: URL;
  constructor(input: string) {
    this.url = restoreControlUrl(input);
    this.db = this.connect(this.url.href);
  }
  private connect(url: string): Database {
    const db = new pg.Pool({
      connectionString: url,
      max: 2,
      connectionTimeoutMillis: 10000,
      query_timeout: 125000,
      options: '-c statement_timeout=120000',
    });
    db.on('error', () => {});
    return db;
  }
  async validate(tx: Transaction, instanceId: string, initialize = false) {
    const actual = (await tx.query('SELECT current_database() AS name')).rows[0].name;
    if (actual !== controlName) throw new Error('Invalid restore control database.');
    const objects = (
      await tx.query(
        `SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','S','f')`,
      )
    ).rows;
    if (objects.some((row) => row.schema !== 'public' || !metadataTables.includes(row.name)))
      throw new Error('Restore control must contain only dedicated verifier metadata.');
    if (!objects.length && initialize) {
      await tx.query(`CREATE TABLE public.card_engine_restore_control(singleton boolean PRIMARY KEY CHECK(singleton),schema_version integer NOT NULL CHECK(schema_version=1),instance_id text NOT NULL);
        CREATE TABLE public.card_engine_restore_jobs(id uuid PRIMARY KEY,database_name text UNIQUE NOT NULL CHECK(database_name ~ '^card_engine_check_[a-f0-9]{32}$'),created_at timestamptz NOT NULL DEFAULT now())`);
      await tx.query('INSERT INTO public.card_engine_restore_control VALUES(true,1,$1)', [
        instanceId,
      ]);
    } else if (objects.length !== 2)
      throw new Error('Initialize the dedicated restore control first.');
    const rows = (
      await tx.query('SELECT schema_version,instance_id FROM public.card_engine_restore_control')
    ).rows;
    if (rows.length !== 1 || rows[0].schema_version !== 1 || rows[0].instance_id !== instanceId)
      throw new Error('Restore control belongs to another instance or policy.');
  }
  async initialize(instanceId: string) {
    const tx = await this.db.connect();
    try {
      await tx.query('BEGIN');
      await tx.query('SELECT pg_advisory_xact_lock(73103505)');
      await this.validate(tx, instanceId, true);
      await tx.query('COMMIT');
    } catch {
      await tx.query('ROLLBACK').catch(() => {});
      throw new Error('Restore control initialization failed.');
    } finally {
      tx.release();
    }
  }
  async reserve(tx: Transaction): Promise<{ id: string; name: string }> {
    const id = randomUUID(),
      name = `card_engine_check_${id.replaceAll('-', '')}`;
    // Never adopt an existing database, even on the negligible UUID collision path.
    if ((await tx.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
      throw new Error('Temporary database already exists.');
    await tx.query('INSERT INTO public.card_engine_restore_jobs(id,database_name) VALUES($1,$2)', [
      id,
      name,
    ]);
    await tx.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
    await tx.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await tx.query(`COMMENT ON DATABASE "${name}" IS 'card-engine-restore-check:${id}'`);
    return { id, name };
  }
  target(name: string): Database {
    if (!databaseName.test(name)) throw new Error('Invalid temporary database name.');
    const url = new URL(this.url);
    url.pathname = `/${name}`;
    return this.connect(url.href);
  }
  async cleanup(tx: Transaction) {
    const jobs = (
      await tx.query(
        'SELECT id,database_name FROM public.card_engine_restore_jobs ORDER BY created_at,id',
      )
    ).rows;
    for (const job of jobs) {
      const name = job.database_name as string,
        id = job.id as string;
      if (
        !databaseName.test(name) ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) ||
        name !== `card_engine_check_${id.replaceAll('-', '')}`
      )
        throw new Error('Unknown restore database registration.');
      const database = (
        await tx.query(
          `SELECT pg_get_userbyid(datdba)=current_user AS owned,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1`,
          [name],
        )
      ).rows[0];
      if (database) {
        if (!database.owned || database.marker !== `card-engine-restore-check:${id}`)
          throw new Error('Temporary database ownership cannot be verified.');
        await tx.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      }
      await tx.query('DELETE FROM public.card_engine_restore_jobs WHERE id=$1', [id]);
    }
  }
  async close() {
    await this.db.end();
  }
}
