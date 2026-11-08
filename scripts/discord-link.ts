import { z } from 'zod';
import { createDatabase, linkDiscordAccount } from '../packages/db/src/index';
import { GameError } from '../packages/core/src/index';
import { promptText } from './prompt';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first.');
const db = createDatabase(process.env.DATABASE_URL);
try {
  const email = await promptText('Existing local account email: ');
  const discordId = await promptText('Discord user ID (not username): ');
  await linkDiscordAccount(db, email, discordId);
  console.log('Discord sign-in linked. Your account, cards, and realm permissions are unchanged.');
} catch (error) {
  console.error(
    error instanceof GameError
      ? error.message
      : error instanceof z.ZodError
        ? 'Enter a valid email and a 17–20 digit Discord user ID.'
        : 'Could not link Discord. Check database access.',
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
