import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { defaultConfig } from '../../packages/config/src/index';
import {
  bootstrap,
  createRealm,
  buyRankTrackLevel,
  getRealmView,
  previewRealmSettings,
  exportPlayer,
  parsePlayerArchive,
  openPack,
  buyUpgrade,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { transaction } from '../../packages/db/src/connection';
import { validateRankTrackBackup } from '../../packages/db/src/rank-track-backup';
import { startPostgres } from '../support/postgres';
let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('rank_tracks')).db;
  admin = await bootstrap(db, 'rank-tracks@example.test', randomBytes(24).toString('hex'));
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
const buy = (
  realm: string,
  track = 'bronze',
  level = 1,
  key = randomUUID(),
  actor = admin,
  revision?: number,
) => buyRankTrackLevel(db, actor, realm, track, level, key, revision);
const realm = () =>
  createRealm(db, admin, 'Rank progression fixture', { ...defaultConfig, startingGems: 100000 });
describe('transactional rank progression and recovery', () => {
  it('deduplicates concurrent retries and rejects changed proposals, forged prerequisites and membership', async () => {
    const id = await realm(),
      key = randomUUID();
    const results = await Promise.all([
      buy(id, 'bronze', 1, key),
      buy(id, 'bronze', 1, key),
      buy(id, 'bronze', 1, key),
    ]);
    expect(results[1]).toEqual(results[0]);
    expect((await getRealmView(db, admin, id)).balance).toBe(99500);
    await expect(buy(id, 'silver', 1, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(buy(id, 'sapphire', 1)).rejects.toMatchObject({ code: 'RANK_PREREQUISITES' });
    await expect(buy(id, 'bronze', 2, randomUUID(), randomUUID())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(buy(id, 'bronze', 2, randomUUID(), admin, 0)).rejects.toMatchObject({
      code: 'SETTINGS_CHANGED',
    });
    expect(await buy(id, 'bronze', 1, key, admin, 0)).toEqual(results[0]);
  });
  it('serializes fresh keys and rolls back journal failures without spending', async () => {
    const id = await realm(),
      outcomes = await Promise.allSettled([buy(id), buy(id)]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    await db.query(
      "CREATE FUNCTION deny_track_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='rank_track_purchase' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER deny_track_fixture BEFORE INSERT ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION deny_track_fixture();",
    );
    const key = randomUUID();
    try {
      await expect(buy(id, 'bronze', 2, key)).rejects.toThrow();
    } finally {
      await db.query(
        'DROP TRIGGER deny_track_fixture ON wallet_ledger;DROP FUNCTION deny_track_fixture();',
      );
    }
    expect((await getRealmView(db, admin, id)).rankTracks.levels).toEqual({ bronze: 1 });
    expect((await getRealmView(db, admin, id)).balance).toBe(99500);
    expect(await buy(id, 'bronze', 2, key)).toMatchObject({ level: 2, balance: 98000 });
  });
  it('unlocks advanced tracks, applies benefits to draws and protects purchased settings', async () => {
    const id = await realm();
    for (const track of ['bronze', 'silver', 'gold'])
      for (let level = 1; level <= 2; level++) await buy(id, track, level);
    await buy(id, 'sapphire', 1);
    const view = await getRealmView(db, admin, id);
    expect(view.rankTracks.levels).toEqual({ bronze: 2, gold: 2, sapphire: 1, silver: 2 });
    expect(view.packPrice).toBe(170);
    expect(view.effectiveWishlistSlots).toBe(5);
    const pack = view.packs.find((item) => item.name === 'All Characters')!;
    expect(await openPack(db, admin, id, pack.id, randomUUID())).toMatchObject({
      ok: true,
      charged: 170,
    });
    const changed = structuredClone(view.config);
    changed.rankTracks.tracks[0].levels[0].cost++;
    expect(
      (await previewRealmSettings(db, admin, id, changed)).impact.blockers.join(' '),
    ).toContain('purchased levels');
    await expect(buyUpgrade(db, admin, id, 'pack_discount', 1, randomUUID())).rejects.toMatchObject(
      { code: 'LEGACY_PURCHASES_RETIRED' },
    );
  });
  it('exports strict version11 history and restores encrypted progression to a fresh database', async () => {
    const id = await realm(),
      key = randomUUID(),
      receipt = await buy(id, 'bronze', 1, key);
    await buy(id, 'gold', 1);
    const archive = await exportPlayer(db, admin, id);
    expect(archive.schemaVersion).toBe(12);
    expect(archive.rankTrackLevels).toEqual({ bronze: 1, gold: 1 });
    expect(parsePlayerArchive(JSON.parse(JSON.stringify(archive)))).toEqual(archive);
    const forged = structuredClone(archive);
    forged.rankTrackPurchases[0].charged++;
    expect(() => parsePlayerArchive(forged)).toThrow();
    await transaction(db, validateRankTrackBackup);
    const passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase),
      fresh = (await server.database('rank_tracks_restored')).db;
    try {
      await restoreBackup(fresh, backup, passphrase);
      await assertBackupRestored(fresh, backup, passphrase);
      expect(await buyRankTrackLevel(fresh, admin, id, 'bronze', 1, key)).toEqual(receipt);
      expect((await getRealmView(fresh, admin, id)).rankTracks.levels).toEqual({
        bronze: 1,
        gold: 1,
      });
    } finally {
      await fresh.end();
    }
  });
});
