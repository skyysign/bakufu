import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../packages/config/src/index';
import {
  applyRealmSettings,
  bootstrap,
  createRealm,
  getRealmView,
  openPack,
  previewRealmSettings,
  type Database,
} from '../../packages/db/src/index';
import { assertBackupRestored, makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>;
const password = randomBytes(24).toString('hex'),
  passphrase = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
});
afterAll(async () => {
  await server?.stop();
});

// What an update to config v13 does to a realm that is already being played:
// the database is migrated in place (docker compose up runs migrations), and a
// backup taken before the update still restores into the new release.
describe('updating a played realm to the recycling safeguard (migration 0031)', () => {
  it('keeps every card, balance and setting, and restores backups taken before the update', async () => {
    const db: Database = (await server.database('safeguard_upgrade')).db;
    const fresh: Database = (await server.database('safeguard_upgrade_restore')).db;
    try {
      const admin = await bootstrap(db, 'safeguard-upgrade@example.test', password);
      const realm = await createRealm(db, admin, 'Played before the update', {
        ...defaultConfig,
        startingGems: 5_000,
      });
      // The admin changed a rule before the update (a 6-hour cooldown), so the
      // realm has settings history in the old shape.
      const start = await getRealmView(db, admin, realm);
      const preview = await previewRealmSettings(db, admin, realm, {
        ...start.config,
        cooldownSeconds: 6 * 3600,
      });
      await applyRealmSettings(db, admin, realm, preview.id, randomUUID());
      const view = await getRealmView(db, admin, realm);
      const pack = view.packs.find((p) => p.name === 'All Characters')!;
      const opening = await openPack(
        db,
        admin,
        realm,
        pack.id,
        randomUUID(),
        view.configRevision,
        5,
      );
      if (!opening.ok) throw new Error('Fixture opening failed.');
      const played = await getRealmView(db, admin, realm);
      // Put the database back to how release 0030 left it: config v12 everywhere.
      await db.query(`ALTER TABLE realms DROP CONSTRAINT realms_config_check;
        UPDATE realms SET config=(config-'recycleSafeguard')||'{"schemaVersion":12}'::jsonb;
        UPDATE realm_config_changes SET before_config=(before_config-'recycleSafeguard')||'{"schemaVersion":12}'::jsonb,
          after_config=(after_config-'recycleSafeguard')||'{"schemaVersion":12}'::jsonb;
        ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion'='12' AND config->>'ownership'='unique');
        DROP TABLE profile_pages;
        DELETE FROM schema_migrations WHERE name IN ('0031_recycle_safeguard.sql','0032_profile_pages.sql');`);
      expect(
        (await db.query('SELECT config FROM realms WHERE id=$1', [realm])).rows[0].config,
      ).not.toHaveProperty('recycleSafeguard');

      // A backup taken before the update restores into the new release.
      const backup = await makeBackup(db, passphrase);
      await restoreBackup(fresh, backup, passphrase);
      await assertBackupRestored(fresh, backup, passphrase);
      const restored = await getRealmView(fresh, admin, realm);
      expect(restored.config).toEqual(played.config);
      expect(restored.config).toMatchObject({ recycleSafeguard: true, cooldownSeconds: 21_600 });
      expect(restored.cards.map((card) => card.cardId).sort()).toEqual([...opening.cardIds].sort());
      expect(restored.balance).toBe(played.balance);

      // Updating in place: the migration adds the safeguard and changes nothing else.
      await migrate(db);
      const raw = (await db.query('SELECT config,config_revision FROM realms WHERE id=$1', [realm]))
        .rows[0];
      expect(raw.config).toEqual(played.config);
      expect(raw.config_revision).toBe(played.configRevision);
      const updated = await getRealmView(db, admin, realm);
      expect(updated.cards.map((card) => card.cardId).sort()).toEqual([...opening.cardIds].sort());
      expect(updated.balance).toBe(played.balance);
      expect(updated.rankTracks).toEqual(played.rankTracks);
      // A backup taken after the update restores too.
      const after = await makeBackup(db, passphrase);
      const again: Database = (await server.database('safeguard_upgrade_again')).db;
      try {
        await restoreBackup(again, after, passphrase);
        await assertBackupRestored(again, after, passphrase);
      } finally {
        await again.end();
      }
    } finally {
      await fresh.end();
      await db.end();
    }
  });
});
