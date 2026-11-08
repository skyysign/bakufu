import { bootstrap, createDatabase, provisionPlayer } from '../packages/db/src/index';
import { GameError } from '../packages/core/src/index';
import { promptSecret, promptText } from './prompt';
import { z } from 'zod';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first.');
const db = createDatabase(process.env.DATABASE_URL);
try {
  const mode = process.argv[2];
  if (!['bootstrap', 'player'].includes(mode)) throw new Error('Choose bootstrap or player.');
  const realmId =
    mode === 'player' ? await promptText('Realm ID (shown in the website address): ') : '';
  const email = await promptText('Email: ');
  const password = await promptSecret('Website password (12–256 characters; typing is hidden): ');
  const confirmation = await promptSecret('Repeat password: ');
  if (password !== confirmation) throw new Error('Passwords did not match.');
  const id =
    mode === 'bootstrap'
      ? await bootstrap(db, email, password)
      : await provisionPlayer(db, realmId, email, password);
  console.log(`Account ready: ${id}. Existing accounts keep their original password.`);
} catch (error) {
  console.error(
    error instanceof GameError
      ? error.message
      : error instanceof z.ZodError
        ? `Account setup failed: ${[...new Set(error.issues.map((issue) => issue.message))].join(' ')}`
        : 'Account setup failed. Check database access. No account was created.',
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
