import { defaultConfig } from '../support/prototype-config';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authenticate,
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  inviteDiscordPlayer,
  listRealmMembers,
  loginDiscord,
  parsePlayerArchive,
  provisionPlayer,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { discordAvatarUrl } from '../../packages/config/src/discord-avatar';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
const subject = '100000000000000099';
const avatar = discordAvatarUrl(subject, '0123456789abcdef0123456789abcdef')!;
let realm: string, player: string;

beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('discord_avatar')).db;
  admin = await bootstrap(db, 'avatar-admin@example.test', password);
  realm = await createRealm(db, admin, 'Original avatar fixture', defaultConfig);
  player = await inviteDiscordPlayer(db, admin, realm, subject);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

describe('verified Discord avatars and preservation', () => {
  it('refreshes a verified image without changing identity, wallet or collection', async () => {
    const before = await exportPlayer(db, player, realm);
    const token = await loginDiscord(db, subject, undefined, {
      username: 'original_avatar',
      displayName: 'Original Avatar',
      avatarUrl: avatar,
    });
    expect((await authenticate(db, token))?.id).toBe(player);
    const after = await exportPlayer(db, player, realm);
    expect(after.discordProfile?.avatarUrl).toBe(avatar);
    expect({
      ...after,
      discordProfile: before.discordProfile,
      exportedAt: before.exportedAt,
    }).toEqual(before);
    expect(parsePlayerArchive(JSON.parse(JSON.stringify(after)))).toEqual(after);
    const updated = discordAvatarUrl(subject, 'abcdef0123456789abcdef0123456789')!;
    await loginDiscord(db, subject, undefined, {
      username: 'original_avatar',
      displayName: 'Original Avatar',
      avatarUrl: updated,
    });
    expect((await getRealmView(db, player, realm)).discordProfile?.avatarUrl).toBe(updated);
    expect((await getRealmView(db, player, realm)).balance).toBe(before.gems);
  });

  it('exposes public images only with authenticated realm-scoped member lookup', async () => {
    const page = await listRealmMembers(db, admin, realm, { query: 'original_avatar' });
    expect(page.members).toHaveLength(1);
    expect(page.members[0].avatarUrl).toMatch(/^https:\/\/cdn\.discordapp\.com\/avatars\//);
    expect(Object.keys(page.members[0]).sort()).toEqual([
      'avatarUrl',
      'displayName',
      'tradeCode',
      'username',
    ]);
    const outside = await createRealm(db, admin, 'Outside avatar fixture', defaultConfig);
    const outsider = await provisionPlayer(db, outside, 'avatar-other@example.test', password);
    await expect(listRealmMembers(db, outsider, realm)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(JSON.stringify(page)).not.toMatch(/email|password|access_token|clientSecret/);
  });

  it('rejects arbitrary remote images at service and database boundaries', async () => {
    const before = (await getRealmView(db, player, realm)).discordProfile;
    await expect(
      loginDiscord(db, subject, undefined, {
        username: 'forged',
        displayName: null,
        avatarUrl: 'https://untrusted.example/private.png',
      }),
    ).rejects.toThrow();
    await expect(
      db.query('UPDATE discord_profiles SET avatar_url=$2 WHERE account_id=$1', [
        player,
        'https://cdn.discordapp.com/attachments/1/private.png',
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    expect((await getRealmView(db, player, realm)).discordProfile).toEqual(before);
  });

  it('restores the exact public avatar and profile timestamp into fresh PostgreSQL', async () => {
    const before = await exportPlayer(db, player, realm);
    const members = await listRealmMembers(db, admin, realm);
    const encrypted = await makeBackup(db, password);
    const target = (await server.database('avatar_restore')).db;
    try {
      await restoreBackup(target, encrypted, password);
      const after = await exportPlayer(target, player, realm);
      expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
      expect(await listRealmMembers(target, admin, realm)).toEqual(members);
      expect(
        (await target.query('SELECT * FROM discord_profiles ORDER BY account_id')).rows,
      ).toEqual((await db.query('SELECT * FROM discord_profiles ORDER BY account_id')).rows);
    } finally {
      await target.end();
    }
  });
});
