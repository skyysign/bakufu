import { createDatabase } from '../packages/db/src/connection';
import { migrate } from '../packages/db/src/migrate';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first.');
const db = createDatabase(process.env.DATABASE_URL);
try {
  await migrate(db);
  console.log('Database migrations applied.');
} catch {
  console.error('Migration failed. Check database access and migration integrity.');
  process.exitCode = 1;
} finally {
  await db.end();
}
