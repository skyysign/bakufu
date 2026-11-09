import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  createDatabase,
  createRealm,
  getRealmView,
  openPack,
  previewRealmCatalog,
  provisionPlayer,
  pullFeedChanged,
  recentPulls,
  tagRealmSeries,
  type Database,
} from '../../packages/db/src/index';
import { defaultConfig } from '../../packages/config/src/index';
import { providerCharacterId } from '../../packages/importers/src/providers';
import { startPostgres } from '../support/postgres';

// Hosted PostgreSQL (Neon) caps data transfer. These budgets keep ordinary
// requests from downloading the whole roster again: before the roster cache a
// warm page view of this realm moved about 1.4 MB from the database.
const rosterSize = 3000;
function providerCatalog() {
  return {
    schemaVersion: 1,
    source: 'mal',
    revision: 'original-transfer-fixture',
    license: 'Original fictional provider-shaped fixture, MIT',
    characters: Array.from({ length: rosterSize }, (_, index) => ({
      id: providerCharacterId('mal', 910000000 + index),
      sourceKey: `mal:${910000000 + index}`,
      name: `Original Transfer Courier ${String(index).padStart(5, '0')}`,
      series: `Original Transfer Series ${index % 120}`,
      categories: ['Shounen', 'Action', '2010s'],
      popularity: rosterSize - index,
      artwork: {
        url: `https://cdn.myanimelist.net/images/characters/1/original-transfer-${index}.jpg`,
        sourceUrl: `https://myanimelist.net/character/${910000000 + index}`,
        permission: 'Original fixture reference; never fetched',
      },
    })),
  };
}
const config = { ...defaultConfig, packSize: 5, startingGems: 1_000_000, cooldownSeconds: 0 };

let server: Awaited<ReturnType<typeof startPostgres>>,
  db: Database,
  measured: Database,
  admin: string,
  player: string,
  realm: string;
let received = 0;
async function bytes(action: () => Promise<unknown>) {
  received = 0;
  await action();
  return received;
}
beforeAll(async () => {
  server = await startPostgres();
  const created = await server.database('transfer_budget');
  db = created.db;
  // Counts every byte PostgreSQL sends to this pool's connections.
  measured = createDatabase(created.url);
  measured.on('connect', (client) => {
    (client as unknown as { connection: { stream: NodeJS.EventEmitter } }).connection.stream.on(
      'data',
      (chunk: Buffer) => (received += chunk.length),
    );
  });
  admin = await bootstrap(db, 'transfer-admin@example.test', randomBytes(24).toString('hex'));
  const catalog = { data: providerCatalog(), rightsConfirmed: true };
  const preview = await previewRealmCatalog(db, admin, config, catalog);
  realm = await createRealm(
    db,
    admin,
    'Original transfer realm',
    config,
    catalog,
    preview.fingerprint,
  );
  player = await provisionPlayer(
    db,
    realm,
    'transfer-player@example.test',
    randomBytes(24).toString('hex'),
  );
});
afterAll(async () => {
  await measured?.end();
  await db?.end();
  await server?.stop();
});

const catalogSql = `SELECT c.id,c.source_key AS "sourceKey",c.name,c.series,c.categories,c.tier,c.provenance->'artwork' AS artwork,
  CASE WHEN owned.owner_id=$2 THEN 'yours' WHEN owned.id IS NOT NULL THEN 'claimed' ELSE 'available' END AS status
  FROM characters c LEFT JOIN cards owned ON owned.realm_id=c.realm_id AND owned.character_id=c.id AND owned.recycled_at IS NULL
  WHERE c.realm_id=$1 AND c.retired_at IS NULL ORDER BY c.name,c.id`;
async function catalogFromDatabase(actor: string) {
  return (await db.query(catalogSql, [realm, actor])).rows.map(({ artwork, ...character }) => ({
    ...character,
    ...(artwork ? { artwork } : {}),
  }));
}

describe('database transfer budget', () => {
  it('keeps page views, openings and the pull feed small for a large roster', async () => {
    const view = await getRealmView(measured, player, realm);
    const pack = view.packs.find((candidate) => candidate.category === null)!;
    for (let opening = 0; opening < 3; opening++) {
      const result = await openPack(
        measured,
        player,
        realm,
        pack.id,
        randomUUID(),
        view.configRevision,
        10,
      );
      expect(result.ok).toBe(true);
    }
    const openingBytes = await bytes(async () => {
      const result = await openPack(
        measured,
        player,
        realm,
        pack.id,
        randomUUID(),
        view.configRevision,
        10,
      );
      expect(result.ok).toBe(true);
    });
    const viewBytes = await bytes(() => getRealmView(measured, player, realm));
    const pullBytes = await bytes(() => recentPulls(measured, player, realm));
    expect(viewBytes).toBeLessThan(80_000);
    expect(openingBytes).toBeLessThan(40_000);
    expect(pullBytes).toBeLessThan(25_000);

    // The 15-second poll only asks whether anything newer was pulled.
    const feed = await recentPulls(measured, player, realm);
    const newest = feed.pulls[0]!.openingId;
    let changed = true;
    const pollBytes = await bytes(async () => {
      changed = await pullFeedChanged(measured, player, realm, newest);
    });
    expect(changed).toBe(false);
    expect(pollBytes).toBeLessThan(2_000);
    const older = feed.pulls.find((pull) => pull.openingId !== newest)?.openingId ?? randomUUID();
    expect(await pullFeedChanged(measured, player, realm, older)).toBe(true);
    await expect(pullFeedChanged(measured, player, realm, 'not-an-id')).rejects.toThrow();

    // The cached roster gives exactly what the database holds.
    const after = await getRealmView(measured, player, realm);
    expect(after.catalog).toEqual(await catalogFromDatabase(player));
    expect(after.cards).toHaveLength(200);
    expect(after.catalog.filter((character) => character.status === 'yours')).toHaveLength(200);
    expect((await getRealmView(measured, admin, realm)).catalog).toEqual(
      await catalogFromDatabase(admin),
    );
  });

  it('notices roster changes made by another server process at once', async () => {
    await getRealmView(measured, player, realm);
    // Written through a different pool, like another web instance.
    await tagRealmSeries(db, admin, realm, {
      tags: [{ series: 'Original Transfer Series 7', category: 'Anime' }],
    });
    const changedBytes = await bytes(() => getRealmView(measured, player, realm));
    const view = await getRealmView(measured, player, realm);
    expect(changedBytes).toBeGreaterThan(500_000);
    expect(view.catalog).toEqual(await catalogFromDatabase(player));
    expect(view.catalog.filter((character) => character.categories.includes('Anime'))).toHaveLength(
      rosterSize / 120,
    );
    expect(await bytes(() => getRealmView(measured, player, realm))).toBeLessThan(80_000);
  });
});
