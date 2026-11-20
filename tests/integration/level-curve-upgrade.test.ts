import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defaultConfig,
  defaultLevelThresholds,
  legacyLevelThresholds,
} from '../../packages/config/src/index';
import {
  applyRealmSettings,
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  parsePlayerArchive,
  previewRealmSettings,
  provisionPlayer,
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

// What the update to config v14 does to realms already being played on the
// original five levels: players at the old cap kept earning XP, and now get
// the level that XP is worth. Migrated in place (docker compose up) and from a
// backup taken before the update.
describe('updating played realms to the 100-level curve (migration 0033)', () => {
  it('levels players by the XP they have, keeps everything else and custom levels', async () => {
    const db: Database = (await server.database('level_curve_upgrade')).db;
    const fresh: Database = (await server.database('level_curve_upgrade_restore')).db;
    try {
      const admin = await bootstrap(db, 'level-curve@example.test', password);
      // 100 XP per new character, so a few openings pass the old cap of 100.
      const original = { xpPerNewCharacter: 100, levelThresholds: legacyLevelThresholds };
      const realm = await createRealm(db, admin, 'Played on five levels', {
        ...defaultConfig,
        startingGems: 5_000,
        progression: original,
      });
      const custom = { xpPerNewCharacter: 10, levelThresholds: [0, 50, 500, 5000] };
      const customRealm = await createRealm(db, admin, 'Own level curve', {
        ...defaultConfig,
        progression: custom,
      });
      const veteran = await provisionPlayer(
          db,
          realm,
          `veteran-${randomUUID()}@example.test`,
          password,
        ),
        newcomer = await provisionPlayer(
          db,
          realm,
          `newcomer-${randomUUID()}@example.test`,
          password,
        );
      const open = async (player: string, packs: number) => {
        const view = await getRealmView(db, player, realm);
        const pack = view.packs.find((p) => p.name === 'All Characters')!;
        const opening = await openPack(
          db,
          player,
          realm,
          pack.id,
          randomUUID(),
          view.configRevision,
          packs,
        );
        if (!opening.ok) throw new Error('Fixture opening failed.');
      };
      await open(veteran, 5);
      await open(newcomer, 1);
      // Before the update: the veteran sits at the old cap with 500 XP.
      expect((await getRealmView(db, veteran, realm)).progression).toMatchObject({
        totalXp: 500,
        level: 5,
        maxLevel: 5,
        nextLevelAt: null,
      });
      // Settings history and an unsaved draft from before the update.
      const start = await getRealmView(db, admin, realm);
      const change = await previewRealmSettings(db, admin, realm, {
        ...start.config,
        startingGems: 3_000,
      });
      await applyRealmSettings(db, admin, realm, change.id, randomUUID());
      const draft = await previewRealmSettings(db, admin, realm, {
        ...(await getRealmView(db, admin, realm)).config,
        packPrice: 150,
      });
      const played = {
        veteran: await getRealmView(db, veteran, realm),
        newcomer: await getRealmView(db, newcomer, realm),
        admin: await getRealmView(db, admin, realm),
      };
      // Put the database back to how release 0032 left it: config v13 everywhere.
      await db.query(`ALTER TABLE realms DROP CONSTRAINT realms_config_check;
        UPDATE realms SET config=config||'{"schemaVersion":13}'::jsonb;
        UPDATE realm_config_changes SET before_config=before_config||'{"schemaVersion":13}'::jsonb,
          after_config=after_config||'{"schemaVersion":13}'::jsonb;
        UPDATE realm_config_previews SET proposed_config=proposed_config||'{"schemaVersion":13}'::jsonb;
        UPDATE openings SET config_snapshot=config_snapshot||'{"schemaVersion":13}'::jsonb;
        ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion'='13' AND config->>'ownership'='unique');
        DELETE FROM schema_migrations WHERE name='0033_level_curve.sql';`);
      const expectUpdated = async (target: Database) => {
        const veteranView = await getRealmView(target, veteran, realm);
        expect(veteranView.config.progression).toEqual({
          xpPerNewCharacter: 100,
          levelThresholds: defaultLevelThresholds,
        });
        expect(veteranView.progression).toMatchObject({
          totalXp: 500,
          level: 12,
          maxLevel: 100,
          nextLevelAt: 540,
        });
        expect(veteranView.balance).toBe(played.veteran.balance);
        expect(veteranView.cards.map((c) => c.cardId)).toEqual(
          played.veteran.cards.map((c) => c.cardId),
        );
        // 100 XP was level 5 on both curves.
        expect((await getRealmView(target, newcomer, realm)).progression).toMatchObject({
          totalXp: 100,
          level: 5,
          maxLevel: 100,
        });
        const adminView = await getRealmView(target, admin, realm);
        expect(adminView.config).toEqual({
          ...played.admin.config,
          progression: veteranView.config.progression,
        });
        expect(adminView.configRevision).toBe(played.admin.configRevision);
        expect((await getRealmView(target, admin, customRealm)).config.progression).toEqual(custom);
      };

      // A backup taken before the update restores into the new release.
      const backup = await makeBackup(db, passphrase);
      await restoreBackup(fresh, backup, passphrase);
      await assertBackupRestored(fresh, backup, passphrase);
      await expectUpdated(fresh);

      // Updating in place.
      await migrate(db);
      const raw = (await db.query('SELECT id,config FROM realms')).rows as {
        id: string;
        config: { schemaVersion: number; progression: unknown };
      }[];
      expect(raw.every((row) => row.config.schemaVersion === 14)).toBe(true);
      expect(raw.find((row) => row.id === realm)!.config.progression).toEqual({
        xpPerNewCharacter: 100,
        levelThresholds: defaultLevelThresholds,
      });
      expect(raw.find((row) => row.id === customRealm)!.config.progression).toEqual(custom);
      await expectUpdated(db);
      // The draft was made against the old rules; it has to be previewed again.
      await expect(
        applyRealmSettings(db, admin, realm, draft.id, randomUUID()),
      ).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
      // The player's archive agrees with the new levels.
      const archive = await exportPlayer(db, veteran, realm);
      expect(archive.progression.level).toBe(12);
      expect(parsePlayerArchive(JSON.parse(JSON.stringify(archive)))).toEqual(archive);
      // Playing on works, without a burst of level-ups from the old cap.
      await open(veteran, 1);
      expect((await getRealmView(db, veteran, realm)).progression).toMatchObject({
        totalXp: 600,
        level: 13,
      });
      // A backup taken after the update restores too.
      const after = await makeBackup(db, passphrase);
      const again: Database = (await server.database('level_curve_upgrade_again')).db;
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
