import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyRealmSettings,
  bootstrap,
  createRealm,
  getRealmView,
  listRealmAdmins,
  previewRealmSettings,
  provisionPlayer,
  setRealmMemberRole,
  type Database,
} from '../../packages/db/src/index';
import { assertBackupRestored, makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, creator: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('realm_admins')).db;
  creator = await bootstrap(db, 'realm-admins@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
const member = (realm: string) =>
  provisionPlayer(db, realm, `admin-member-${randomUUID()}@example.test`, password);
const code = async (realm: string, account: string) =>
  (await getRealmView(db, account, realm)).tradeCode;
const role = async (realm: string, account: string) =>
  (await getRealmView(db, account, realm)).role;
async function changeRules(realm: string, actor: string) {
  const view = await getRealmView(db, actor, realm);
  const preview = await previewRealmSettings(db, actor, realm, {
    ...view.config,
    packPrice: view.config.packPrice + 1,
  });
  return applyRealmSettings(db, actor, realm, preview.id, randomUUID());
}

describe('realm admins', () => {
  it('lets an admin make a member an admin, who can then change the game rules', async () => {
    const realm = await createRealm(db, creator, 'Admin promotion fixture'),
      friend = await member(realm);
    expect(await listRealmAdmins(db, creator, realm)).toEqual({
      admins: [
        expect.objectContaining({
          tradeCode: await code(realm, creator),
          creator: true,
          self: true,
        }),
      ],
    });
    // Players can neither see nor change the admin list, nor the rules.
    await expect(listRealmAdmins(db, friend, realm)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      setRealmMemberRole(db, friend, realm, {
        tradeCode: await code(realm, friend),
        role: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(changeRules(realm, friend)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const friendCode = await code(realm, friend);
    const promoted = await setRealmMemberRole(db, creator, realm, {
      tradeCode: friendCode,
      role: 'admin',
    });
    expect(promoted).toMatchObject({ tradeCode: friendCode, role: 'admin', changed: true });
    expect(promoted.admins.map((admin) => [admin.tradeCode, admin.creator, admin.self])).toEqual([
      [await code(realm, creator), true, true],
      [friendCode, false, false],
    ]);
    // A retried request changes nothing more.
    expect(
      await setRealmMemberRole(db, creator, realm, { tradeCode: friendCode, role: 'admin' }),
    ).toMatchObject({ changed: false, admins: promoted.admins });
    expect(await role(realm, friend)).toBe('admin');
    const before = (await getRealmView(db, friend, realm)).packPrice;
    await changeRules(realm, friend);
    expect((await getRealmView(db, creator, realm)).packPrice).toBe(before + 1);
    expect(
      (await listRealmAdmins(db, friend, realm)).admins.find((admin) => admin.self)?.tradeCode,
    ).toBe(friendCode);
  });

  it('keeps the creator an admin and only accepts members of the same realm', async () => {
    const realm = await createRealm(db, creator, 'Admin creator fixture'),
      other = await createRealm(db, creator, 'Admin other realm'),
      friend = await member(realm),
      stranger = await member(other);
    const creatorCode = await code(realm, creator);
    await setRealmMemberRole(db, creator, realm, {
      tradeCode: await code(realm, friend),
      role: 'admin',
    });
    for (const actor of [friend, creator])
      await expect(
        setRealmMemberRole(db, actor, realm, { tradeCode: creatorCode, role: 'player' }),
      ).rejects.toMatchObject({ code: 'REALM_CREATOR' });
    expect(await role(realm, creator)).toBe('admin');
    // Trade IDs belong to one realm.
    await expect(
      setRealmMemberRole(db, creator, realm, {
        tradeCode: await code(other, stranger),
        role: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await role(other, stranger)).toBe('player');
    // Being an admin in one realm gives nothing in another.
    await expect(listRealmAdmins(db, friend, other)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      setRealmMemberRole(db, creator, realm, { tradeCode: 'not-a-code', role: 'admin' }),
    ).rejects.toThrow();
    await expect(
      setRealmMemberRole(db, creator, realm, {
        tradeCode: await code(realm, friend),
        role: 'owner',
      }),
    ).rejects.toThrow();
  });

  it('removes admins, lets them step down and serializes admins removing each other', async () => {
    const realm = await createRealm(db, creator, 'Admin removal fixture'),
      first = await member(realm),
      second = await member(realm);
    const firstCode = await code(realm, first),
      secondCode = await code(realm, second);
    for (const tradeCode of [firstCode, secondCode])
      await setRealmMemberRole(db, creator, realm, { tradeCode, role: 'admin' });
    // Two admins remove each other at once: one goes first, and the other is
    // then no longer an admin, so exactly one change happens.
    const outcomes = await Promise.allSettled([
      setRealmMemberRole(db, first, realm, { tradeCode: secondCode, role: 'player' }),
      setRealmMemberRole(db, second, realm, { tradeCode: firstCode, role: 'player' }),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((item) => item.status === 'rejected')).toMatchObject({
      reason: { code: 'FORBIDDEN' },
    });
    expect([await role(realm, first), await role(realm, second)].sort()).toEqual([
      'admin',
      'player',
    ]);
    const remaining = (await role(realm, first)) === 'admin' ? first : second,
      remainingCode = remaining === first ? firstCode : secondCode;
    // Stepping down: the former admin keeps playing but loses the rules.
    const balance = (await getRealmView(db, remaining, realm)).balance;
    const stepped = await setRealmMemberRole(db, remaining, realm, {
      tradeCode: remainingCode,
      role: 'player',
    });
    expect(stepped.admins.map((admin) => admin.tradeCode)).toEqual([await code(realm, creator)]);
    expect(await getRealmView(db, remaining, realm)).toMatchObject({ role: 'player', balance });
    await expect(changeRules(realm, remaining)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('never removes the last admin of a realm whose creator is not one', async () => {
    const realm = await createRealm(db, creator, 'Admin legacy fixture'),
      friend = await member(realm);
    await setRealmMemberRole(db, creator, realm, {
      tradeCode: await code(realm, friend),
      role: 'admin',
    });
    // Data from outside this feature (a hand-edited database) can leave the
    // creator without the role; the realm still keeps one admin.
    await db.query("UPDATE memberships SET role='player' WHERE realm_id=$1 AND account_id=$2", [
      realm,
      creator,
    ]);
    await expect(
      setRealmMemberRole(db, friend, realm, {
        tradeCode: await code(realm, friend),
        role: 'player',
      }),
    ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(await role(realm, friend)).toBe('admin');
  });

  it('keeps added admins through an encrypted backup restored to a fresh database', async () => {
    const realm = await createRealm(db, creator, 'Admin backup fixture'),
      friend = await member(realm);
    await setRealmMemberRole(db, creator, realm, {
      tradeCode: await code(realm, friend),
      role: 'admin',
    });
    const admins = await listRealmAdmins(db, creator, realm),
      passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase),
      fresh = (await server.database('realm_admins_restored')).db;
    try {
      await restoreBackup(fresh, backup, passphrase);
      await assertBackupRestored(fresh, backup, passphrase);
      expect(await listRealmAdmins(fresh, creator, realm)).toEqual(admins);
      expect((await listRealmAdmins(fresh, friend, realm)).admins).toHaveLength(2);
    } finally {
      await fresh.end();
    }
  });
});
