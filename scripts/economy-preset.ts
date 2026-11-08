import { z } from 'zod';
import { createDatabase } from '../packages/db/src/connection';
import { previewEconomyPreset, applyEconomyPreset } from '../packages/db/src/economy-preset';

const [realmInput, keyInput, hashInput] = process.argv.slice(2);
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first.');
const realm = z.uuid().parse(realmInput),
  db = createDatabase(process.env.DATABASE_URL);
try {
  const admins = (await db.query('SELECT id FROM accounts WHERE instance_admin=true')).rows;
  if (admins.length !== 1) throw new Error('Select an administrator explicitly using the service.');
  const result =
    keyInput && hashInput
      ? await applyEconomyPreset(db, admins[0].id, realm, z.uuid().parse(keyInput), hashInput)
      : await previewEconomyPreset(db, admins[0].id, realm);
  console.log(JSON.stringify(result));
} finally {
  await db.end();
}
