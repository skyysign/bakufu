import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { createDatabase } from '../packages/db/src/connection';
import {
  previewCharacterPopularity,
  applyCharacterPopularity,
} from '../packages/db/src/character-values';
import { GameError } from '../packages/core/src/errors';

// Restore numerical evidence from an already permitted, matching saved catalog.
// This command never imports characters, downloads artwork or calls a provider.
const [realmInput, catalogPath, previewHash] = process.argv.slice(2);
async function run() {
  if (!process.env.DATABASE_URL || !realmInput || !catalogPath || process.argv.length > 5) {
    console.error(
      'Usage: pnpm exec tsx scripts/character-popularity.ts REALM_UUID CATALOG_JSON_PATH_OR_- [PREVIEW_HASH]. Set DATABASE_URL first.',
    );
    process.exitCode = 1;
    return;
  }
  const realmId = z.uuid().parse(realmInput);
  const source = catalogPath === '-' ? process.stdin : createReadStream(catalogPath);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of source) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw new Error('CATALOG_TOO_LARGE');
    chunks.push(chunk);
  }
  const catalog: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    const administrators = (await db.query('SELECT id FROM accounts WHERE instance_admin=true'))
      .rows;
    if (administrators.length !== 1) throw new Error('AMBIGUOUS_ADMIN');
    const summary = previewHash
      ? await applyCharacterPopularity(db, administrators[0].id, realmId, catalog, previewHash)
      : await previewCharacterPopularity(db, administrators[0].id, realmId, catalog);
    console.log(JSON.stringify(summary));
  } finally {
    await db.end();
  }
}
await run().catch((error: unknown) => {
  console.error(
    error instanceof GameError
      ? error.message
      : 'Popularity update failed. Check the database connection, realm, matching permitted JSON catalog and preview hash. No private records were logged.',
  );
  process.exitCode = 1;
});
