import { defaultConfig } from '../support/prototype-config';
import { parseRealmConfig } from '../../packages/config/src/index';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  authenticate,
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  inviteDiscordPlayer,
  linkDiscordAccount,
  listRealmMembers,
  loginDiscord,
  parsePlayerArchive,
  provisionPlayer,
  tradeCommand,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { installLegacySchema, seedLegacyRealm } from '../support/legacy';
import { startPostgres } from '../support/postgres';
let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex'),
  adminSubject = '100000000000000001';
let sequence = 1n;
const subject = () => String(200000000000000000n + sequence++);
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('member_profiles')).db;
  admin = await bootstrap(db, 'member-admin@example.test', password);
  await linkDiscordAccount(db, 'member-admin@example.test', adminSubject);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function setup() {
  const realm = await createRealm(db, admin, 'Member fixture', defaultConfig),
    id = subject(),
    player = await inviteDiscordPlayer(db, admin, realm, id);
  return { realm, id, player };
}
const profile = (
  id: string,
  username = 'atlas_player',
  displayName: string | null = 'Atlas Player',
) => loginDiscord(db, id, undefined, { username, displayName });
describe('private realm member search and profile recovery', () => {
  it('starts identities without invented names and keeps local players browsable', async () => {
    const r = await setup(),
      local = await provisionPlayer(db, r.realm, 'local-member@example.test', password),
      page = await listRealmMembers(db, admin, r.realm);
    expect(page.members).toHaveLength(2);
    page.members.forEach((member) =>
      expect(member).toMatchObject({ username: null, displayName: null }),
    );
    expect(page.members.map((m) => m.tradeCode)).toContain(
      (await getRealmView(db, local, r.realm)).tradeCode,
    );
  });
  it('refreshes verified names during login while preserving account, trade code, and progress', async () => {
    const r = await setup(),
      before = await exportPlayer(db, r.player, r.realm),
      token = await profile(r.id);
    expect((await authenticate(db, token))?.id).toBe(r.player);
    const after = await exportPlayer(db, r.player, r.realm);
    expect(after.discordProfile).toMatchObject({
      username: 'atlas_player',
      displayName: 'Atlas Player',
    });
    expect({
      ...after,
      discordProfile: before.discordProfile,
      exportedAt: before.exportedAt,
    }).toEqual(before);
    await profile(r.id, 'renamed', 'Renamed');
    expect((await getRealmView(db, r.player, r.realm)).discordProfile).toMatchObject({
      username: 'renamed',
      displayName: 'Renamed',
    });
  });
  it('does not cache profiles or create accounts for uninvited identities', async () => {
    const id = subject();
    await expect(profile(id, 'intruder')).rejects.toMatchObject({ code: 'DISCORD_NOT_INVITED' });
    expect(
      (await db.query('SELECT 1 FROM discord_profiles WHERE username=$1', ['intruder'])).rowCount,
    ).toBe(0);
    expect(
      (await db.query('SELECT 1 FROM account_identities WHERE subject=$1', [id])).rowCount,
    ).toBe(0);
  });
  it('enforces realm membership even for an instance admin and exposes only scoped codes and names', async () => {
    const r = await setup(),
      outside = await createRealm(db, admin, 'Outside fixture', defaultConfig);
    await profile(r.id);
    const stranger = await provisionPlayer(db, outside, 'stranger@example.test', password);
    await db.query('UPDATE accounts SET instance_admin=true WHERE id=$1', [stranger]);
    await expect(listRealmMembers(db, stranger, r.realm)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const page = await listRealmMembers(db, admin, r.realm);
    expect(page.members).toHaveLength(1);
    expect(Object.keys(page.members[0]).sort()).toEqual(['displayName', 'tradeCode', 'username']);
    expect(JSON.stringify(page)).not.toMatch(/email|password|subject|accountId|balance|cards/);
    expect(JSON.stringify(page)).not.toContain(r.id);
  });
  it('uses case-insensitive literal substring search and exact trade codes without SQL wildcard expansion', async () => {
    const r = await setup();
    await profile(r.id, 'Star_100%', 'Étoile <tag>');
    for (const query of ['STAR_100%', 'Étoile', 'E\u0301toile', '%'])
      expect((await listRealmMembers(db, admin, r.realm, { query })).members).toHaveLength(1);
    expect((await listRealmMembers(db, admin, r.realm, { query: "%' OR 1=1 --" })).members).toEqual(
      [],
    );
    const code = (await getRealmView(db, r.player, r.realm)).tradeCode;
    expect((await listRealmMembers(db, admin, r.realm, { query: code })).members[0].tradeCode).toBe(
      code,
    );
  });
  it('bounds pages, excludes the caller, and rejects invalid limits and cursors', async () => {
    const r = await setup();
    for (let n = 0; n < 24; n++) {
      const id = subject();
      await inviteDiscordPlayer(db, admin, r.realm, id);
      await profile(id, `page_${n}`, 'Same Display');
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listRealmMembers(db, admin, r.realm, cursor ? { cursor } : {});
      expect(page.members.length).toBeLessThanOrEqual(20);
      seen.push(...page.members.map((m) => m.tradeCode));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    for (const input of [
      { query: 'x'.repeat(81) },
      { cursor: 'bad' },
      { limit: 21 },
      { limit: 0 },
      { unknown: true },
    ])
      await expect(listRealmMembers(db, admin, r.realm, input)).rejects.toThrow();
  });
  it('keeps duplicate names distinct and preserves a selected recipient through a rename', async () => {
    const r = await setup(),
      id = subject(),
      second = await inviteDiscordPlayer(db, admin, r.realm, id);
    await profile(r.id, 'duplicate', 'Duplicate');
    await profile(id, 'duplicate', 'Duplicate');
    const choices = (await listRealmMembers(db, admin, r.realm, { query: 'duplicate' })).members;
    expect(choices).toHaveLength(2);
    expect(new Set(choices.map((c) => c.tradeCode)).size).toBe(2);
    const code = (await getRealmView(db, r.player, r.realm)).tradeCode,
      created = await tradeCommand(
        db,
        admin,
        r.realm,
        { action: 'create', counterpartyCode: code, offer: { cardIds: [], gems: 1 } },
        randomUUID(),
      );
    await profile(r.id, 'new_name', 'New Name');
    expect(
      (await getRealmView(db, admin, r.realm)).tradePartners.find((p) => p.tradeCode === code),
    ).toMatchObject({ username: 'new_name', displayName: 'New Name' });
    expect((await getRealmView(db, r.player, r.realm)).trades.map((t) => t.id)).toContain(
      created.tradeId,
    );
    expect((await getRealmView(db, second, r.realm)).trades).toEqual([]);
  });
  it('rejects out-of-realm codes at the actual trade service after lookup', async () => {
    const r = await setup(),
      other = await setup();
    await profile(other.id, 'outsider', 'Outside');
    const code = (await getRealmView(db, other.player, other.realm)).tradeCode;
    expect((await listRealmMembers(db, admin, r.realm, { query: 'outsider' })).members).toEqual([]);
    await expect(
      tradeCommand(
        db,
        admin,
        r.realm,
        { action: 'create', counterpartyCode: code, offer: { cardIds: [], gems: 1 } },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PARTNER' });
    expect((await getRealmView(db, admin, r.realm)).balance).toBe(100);
  });
  it('preserves a previous cached profile when a later login has no usable names', async () => {
    const r = await setup();
    await profile(r.id);
    await loginDiscord(db, r.id, undefined, null);
    expect((await exportPlayer(db, r.player, r.realm)).discordProfile?.username).toBe(
      'atlas_player',
    );
    await expect(
      loginDiscord(db, r.id, undefined, { username: ' ', displayName: null }),
    ).rejects.toThrow();
    expect((await exportPlayer(db, r.player, r.realm)).discordProfile?.username).toBe(
      'atlas_player',
    );
  });
  it("exports only the player's own profile in v7 and reads v6 without invented metadata", async () => {
    const r = await setup();
    await profile(r.id, 'private_player', 'Player Name');
    await profile(adminSubject, 'realm_admin', 'Admin Name');
    const archive = await exportPlayer(db, r.player, r.realm);
    expect(archive.schemaVersion).toBe(12);
    expect(archive.discordProfile?.username).toBe('private_player');
    expect(JSON.stringify(archive)).not.toContain('realm_admin');
    expect(JSON.stringify(archive)).not.toContain(r.id);
    const v6: Record<string, unknown> = { ...archive, schemaVersion: 6 };
    delete v6.discordProfile;
    delete v6.realmAdmission;
    for (const key of [
      'collectorRank',
      'rankRules',
      'rankPurchases',
      'marketListings',
      'gemRewardRules',
      'gemRewardClaims',
      'rankTrackRules',
      'rankTrackLevels',
      'rankTrackPurchases',
      'characterValueRules',
      'characterValues',
      'recyclingValuations',
    ])
      delete v6[key];
    expect(parsePlayerArchive(v6)).toEqual(v6);
    expect(parsePlayerArchive(JSON.parse(JSON.stringify(archive)))).toEqual(archive);
  });
  it('restores exact profile timestamps and private lookups into a fresh database', async () => {
    const r = await setup();
    await profile(r.id, 'backup_name', 'Backup Name');
    const before = await exportPlayer(db, r.player, r.realm),
      page = await listRealmMembers(db, admin, r.realm),
      backup = await makeBackup(db, password),
      target = (await server.database('member_restore')).db;
    try {
      await restoreBackup(target, backup, password);
      expect(await listRealmMembers(target, admin, r.realm)).toEqual(page);
      const after = await exportPlayer(target, r.player, r.realm);
      expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
      expect(
        (await target.query('SELECT * FROM discord_profiles ORDER BY account_id')).rows,
      ).toEqual((await db.query('SELECT * FROM discord_profiles ORDER BY account_id')).rows);
    } finally {
      await target.end();
    }
  });
  it('rejects noncanonical cached profile backups atomically', async () => {
    const r = await setup();
    await profile(r.id);
    const target = (await server.database('invalid_profile_restore')).db;
    let backup: string;
    await db.query('UPDATE discord_profiles SET username=$2 WHERE account_id=$1', [
      r.player,
      'bad\u202ename',
    ]);
    try {
      backup = await makeBackup(db, password);
    } finally {
      await db.query('UPDATE discord_profiles SET username=$2 WHERE account_id=$1', [
        r.player,
        'atlas_player',
      ]);
    }
    try {
      await expect(restoreBackup(target, backup!, password)).rejects.toThrow(
        'Discord profiles are invalid',
      );
      expect((await target.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    } finally {
      await target.end();
    }
  });
  it('migrates and restores the preceding release without changing existing records or guessing names', async () => {
    const source = (await server.database('before_profiles', false)).db,
      target = (await server.database('legacy_profile_restore')).db;
    try {
      await installLegacySchema(source, 9);
      const actor = await bootstrap(source, 'profile-legacy@example.test', password),
        old = await seedLegacyRealm(source, actor);
      await linkDiscordAccount(source, 'profile-legacy@example.test', subject());
      const query = `SELECT jsonb_build_object('members',(SELECT jsonb_agg(to_jsonb(m)) FROM memberships m),'cards',(SELECT jsonb_agg(to_jsonb(c)) FROM cards c),'links',(SELECT jsonb_agg(to_jsonb(i)) FROM account_identities i),'realms',(SELECT jsonb_agg(to_jsonb(r)) FROM realms r)) AS state`,
        before = (await source.query(query)).rows,
        backup = await makeBackup(source, password);
      const expected = structuredClone(before);
      for (const realm of expected[0].state.realms) realm.config = parseRealmConfig(realm.config);
      await migrate(source);
      expect((await source.query(query)).rows).toEqual(expected);
      expect((await source.query('SELECT 1 FROM discord_profiles')).rowCount).toBe(0);
      await restoreBackup(target, backup, password);
      expect((await target.query(query)).rows).toEqual(expected);
      expect((await exportPlayer(target, actor, old.realmId)).discordProfile).toBeNull();
    } finally {
      await source.end();
      await target.end();
    }
  });
});
