import { createDatabase } from '../packages/db/src/connection';
import { grantAdminGems } from '../packages/db/src/admin-gems';
import { z } from 'zod';

// Run inside the trusted operator container. Never reads or prints account identities.
const [realmInput, keyInput, amountInput = '100000'] = process.argv.slice(2);
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first.');
const realm = z.uuid().parse(realmInput),
  key = z.uuid().parse(keyInput),
  amount = z.coerce.number().int().min(1).max(1_000_000).parse(amountInput),
  db = createDatabase(process.env.DATABASE_URL);
try {
  const admins = (await db.query('SELECT id FROM accounts WHERE instance_admin=true')).rows;
  if (admins.length !== 1) throw new Error('Select an administrator explicitly using the service.');
  const result = await grantAdminGems(
    db,
    admins[0].id,
    realm,
    key,
    amount,
    'Operator gameplay test credit',
  );
  console.log(JSON.stringify({ granted: result.amount, walletBalance: result.balance }));
} finally {
  await db.end();
}
