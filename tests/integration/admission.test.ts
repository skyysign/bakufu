import { defaultConfig } from '../support/prototype-config';
import { parseRealmConfig } from '../../packages/config/src/index';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  createRealm,
  configureAdmission,
  publicJoinTarget,
  inviteDiscordPlayer,
  linkDiscordAccount,
  loginDiscord,
  authenticate,
  provisionPlayer,
  getRealmView,
  exportPlayer,
  parsePlayerArchive,
  setDiscordGuild,
  consumeDiscordFlowContext,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { defaultAdmission, type VerifiedAdmission } from '../../packages/db/src/admission';
import { startDiscordLogin, finishDiscordLoginResult } from '../../apps/web/lib/discord';
import { startPostgres } from '../support/postgres';
import { installLegacySchema, seedLegacyRealm } from '../support/legacy';
let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex'),
  settings = {
    clientId: '900000000000000001',
    clientSecret: 'fixture-secret',
    redirectUri: 'http://localhost:3000/api/auth/discord/callback',
  };
let sequence = 1n;
const nextSubject = () => String(800000000000000000n + sequence++);
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('admission_test')).db;
  admin = await bootstrap(db, 'admission-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function setup() {
  const realm = await createRealm(db, admin, 'Admission fixture', defaultConfig),
    guildId = nextSubject();
  await setDiscordGuild(db, admin, realm, guildId);
  const result = await configureAdmission(
    db,
    admin,
    realm,
    { mode: 'discord_server', guildId },
    0,
    randomUUID(),
  );
  return { realm, guildId, code: result.policy.joinCode!, revision: result.policy.revision };
}
type Realm = Awaited<ReturnType<typeof setup>>;
const proof = (r: Realm): VerifiedAdmission => ({
  realmId: r.realm,
  guildId: r.guildId,
  revision: r.revision,
  joinCode: r.code,
  verifiedAt: Date.now(),
});
const join = (r: Realm, id = nextSubject()) =>
  loginDiscord(
    db,
    id,
    undefined,
    { username: 'fixture_member', displayName: 'Fixture Member' },
    proof(r),
  );
const memberAccount = async (id: string) =>
  (
    await db.query(
      "SELECT account_id FROM account_identities WHERE provider='discord' AND subject=$1",
      [id],
    )
  ).rows[0]?.account_id as string | undefined;
function provider(id: string, pending = false, status = 200) {
  const fetcher: typeof fetch = async (input) =>
    String(input).endsWith('/oauth2/token')
      ? Response.json({
          access_token: 'fixture-token',
          token_type: 'Bearer',
          scope: 'identify guilds.members.read',
        })
      : String(input).endsWith('/users/@me')
        ? Response.json({ id, username: 'fixture_member', global_name: 'Fixture Member' })
        : status === 200
          ? Response.json({ user: { id }, pending })
          : new Response('fixture', { status });
  return fetcher;
}
async function flow(r: Realm) {
  const started = await startDiscordLogin(db, settings, r.code),
    url = new URL(started.url),
    query = new URLSearchParams({
      state: url.searchParams.get('state')!,
      code: 'fixture',
      iss: 'https://discord.com',
    });
  return { started, url, query };
}
describe('verified Discord server admission', () => {
  it('keeps untouched realms invite-only and requires admin membership plus the linked server to configure joining', async () => {
    const realm = await createRealm(db, admin, 'Invite default', defaultConfig),
      player = await provisionPlayer(db, realm, 'invited@example.test', password);
    expect((await getRealmView(db, admin, realm)).admission).toEqual(defaultAdmission);
    expect((await getRealmView(db, player, realm)).admission).toBeNull();
    await expect(
      configureAdmission(
        db,
        player,
        realm,
        { mode: 'discord_server', guildId: nextSubject() },
        0,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      configureAdmission(
        db,
        admin,
        realm,
        { mode: 'discord_server', guildId: nextSubject() },
        0,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'GUILD_NOT_LINKED' });
  });
  it('deduplicates concurrent policy saves, rejects reused keys and stale competing admins', async () => {
    const r = await setup(),
      key = randomUUID(),
      command = { mode: 'discord_server', guildId: r.guildId };
    const results = await Promise.all([
      configureAdmission(db, admin, r.realm, command, 1, key),
      configureAdmission(db, admin, r.realm, command, 1, key),
    ]);
    expect(results[0]).toEqual(results[1]);
    await expect(
      configureAdmission(db, admin, r.realm, { mode: 'invite_only' }, 2, key),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      configureAdmission(db, admin, r.realm, { mode: 'invite_only' }, 1, randomUUID()),
    ).rejects.toMatchObject({ code: 'ADMISSION_CHANGED' });
  });
  it('publishes only one deliberately shared realm target and binds it to one-time OAuth state', async () => {
    const r = await setup(),
      f = await flow(r),
      target = await publicJoinTarget(db, r.code);
    expect(Object.keys(target).sort()).toEqual([
      'guildId',
      'joinCode',
      'name',
      'realmId',
      'revision',
    ]);
    expect(f.url.searchParams.get('scope')).toBe('identify guilds.members.read');
    const context = await consumeDiscordFlowContext(
      db,
      f.query.get('state')!,
      f.started.browserToken,
    );
    expect(context.admission).toEqual({
      realmId: r.realm,
      guildId: r.guildId,
      joinCode: r.code,
      revision: 1,
    });
    await expect(
      consumeDiscordFlowContext(db, f.query.get('state')!, f.started.browserToken),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE' });
    await expect(publicJoinTarget(db, randomUUID())).rejects.toMatchObject({
      code: 'JOIN_UNAVAILABLE',
    });
  });
  it('admits a freshly verified server member as a player with one starting grant and source receipt', async () => {
    const r = await setup(),
      id = nextSubject(),
      f = await flow(r),
      result = await finishDiscordLoginResult(
        db,
        settings,
        f.query,
        f.started.browserToken,
        provider(id),
      ),
      actor = await authenticate(db, result.token);
    expect(result.realmId).toBe(r.realm);
    expect(actor?.instanceAdmin).toBe(false);
    const view = await getRealmView(db, actor!.id, r.realm);
    expect(view).toMatchObject({ balance: 100, role: 'player' });
    const archive = await exportPlayer(db, actor!.id, r.realm);
    expect(archive).toMatchObject({
      schemaVersion: 12,
      realmAdmission: {
        method: 'discord_server',
        guildId: r.guildId,
        policyRevision: 1,
        startingGems: 100,
      },
    });
    expect(
      (
        await db.query('SELECT 1 FROM realm_admissions WHERE realm_id=$1 AND account_id=$2', [
          r.realm,
          actor!.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it('serializes repeated/concurrent joins without duplicating identity, membership, or starting gems', async () => {
    const r = await setup(),
      id = nextSubject(),
      tokens = await Promise.all(Array.from({ length: 5 }, () => join(r, id))),
      actors = await Promise.all(tokens.map((token) => authenticate(db, token)));
    expect(new Set(actors.map((a) => a!.id)).size).toBe(1);
    const account = actors[0]!.id;
    expect((await getRealmView(db, account, r.realm)).balance).toBe(100);
    expect(
      (
        await db.query(
          "SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND account_id=$2 AND reason='starting_grant'",
          [r.realm, account],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await db.query('SELECT 1 FROM realm_admissions WHERE realm_id=$1 AND account_id=$2', [
          r.realm,
          account,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it('reuses explicitly linked local accounts while keeping realm economies isolated', async () => {
    const first = await createRealm(db, admin, 'Old realm', defaultConfig),
      local = await provisionPlayer(db, first, 'linked-local@example.test', password),
      id = nextSubject();
    await linkDiscordAccount(db, 'linked-local@example.test', id);
    const r = await setup();
    expect((await authenticate(db, await join(r, id)))!.id).toBe(local);
    expect((await getRealmView(db, local, first)).balance).toBe(100);
    expect((await getRealmView(db, local, r.realm)).balance).toBe(100);
  });
  it('does not merge by matching names or turn server joins into administrators', async () => {
    const r = await setup(),
      id = nextSubject();
    const actor = await authenticate(
      db,
      await loginDiscord(
        db,
        id,
        id,
        { username: 'admission-admin', displayName: 'Administrator' },
        proof(r),
      ),
    );
    expect(actor?.instanceAdmin).toBe(false);
    expect((await getRealmView(db, actor!.id, r.realm)).role).toBe('player');
    expect(actor?.id).not.toBe(admin);
  });
  it('keeps explicit account invitations valid and does not repeat their grants during a server join', async () => {
    const r = await setup(),
      id = nextSubject(),
      account = await inviteDiscordPlayer(db, admin, r.realm, id);
    await join(r, id);
    expect((await getRealmView(db, account, r.realm)).balance).toBe(100);
    expect(
      (
        await db.query('SELECT 1 FROM realm_admissions WHERE realm_id=$1 AND account_id=$2', [
          r.realm,
          account,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it('races explicit invitations against server joining without double registration or grant', async () => {
    const r = await setup(),
      id = nextSubject();
    await Promise.all([inviteDiscordPlayer(db, admin, r.realm, id), join(r, id)]);
    const account = await memberAccount(id);
    expect((await getRealmView(db, account!, r.realm)).balance).toBe(100);
    expect(
      (
        await db.query(
          "SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND account_id=$2 AND operation_key='starting-grant'",
          [r.realm, account],
        )
      ).rowCount,
    ).toBe(1);
  });
  it('rejects nonmembers and pending screening without creating accounts, profiles, sessions, or grants', async () => {
    const r = await setup();
    for (const options of [
      { pending: false, status: 404 },
      { pending: true, status: 200 },
    ]) {
      const id = nextSubject(),
        f = await flow(r);
      await expect(
        finishDiscordLoginResult(
          db,
          settings,
          f.query,
          f.started.browserToken,
          provider(id, options.pending, options.status),
        ),
      ).rejects.toMatchObject({ code: 'JOIN_UNVERIFIED' });
      expect(await memberAccount(id)).toBeUndefined();
    }
    expect(
      (await db.query('SELECT 1 FROM memberships WHERE realm_id=$1', [r.realm])).rowCount,
    ).toBe(1);
  });
  it('fails a policy changed during OAuth, rejects stale proof, and ignores callback target injection', async () => {
    const r = await setup(),
      f = await flow(r),
      id = nextSubject();
    await configureAdmission(
      db,
      admin,
      r.realm,
      { mode: 'discord_server', guildId: r.guildId },
      1,
      randomUUID(),
    );
    await expect(
      finishDiscordLoginResult(db, settings, f.query, f.started.browserToken, provider(id)),
    ).rejects.toMatchObject({ code: 'JOIN_UNAVAILABLE' });
    expect(await memberAccount(id)).toBeUndefined();
    await expect(
      loginDiscord(db, nextSubject(), undefined, null, {
        ...proof(r),
        verifiedAt: Date.now() - 61000,
      }),
    ).rejects.toMatchObject({ code: 'JOIN_UNVERIFIED' });
    const original = await setup(),
      other = await setup(),
      fresh = await flow(original),
      subject = nextSubject();
    fresh.query.set('joinCode', other.code);
    const joined = await finishDiscordLoginResult(
      db,
      settings,
      fresh.query,
      fresh.started.browserToken,
      provider(subject),
    );
    expect(joined.realmId).toBe(original.realm);
    await expect(
      getRealmView(db, (await memberAccount(subject))!, other.realm),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('closes old links, rotates re-enabled links, and prevents unlinking an active admission server', async () => {
    const r = await setup();
    await expect(setDiscordGuild(db, admin, r.realm, null)).rejects.toMatchObject({
      code: 'ADMISSION_ACTIVE',
    });
    await expect(setDiscordGuild(db, admin, r.realm, nextSubject())).rejects.toMatchObject({
      code: 'ADMISSION_ACTIVE',
    });
    await configureAdmission(db, admin, r.realm, { mode: 'invite_only' }, 1, randomUUID());
    await expect(publicJoinTarget(db, r.code)).rejects.toMatchObject({ code: 'JOIN_UNAVAILABLE' });
    const enabled = await configureAdmission(
      db,
      admin,
      r.realm,
      { mode: 'discord_server', guildId: r.guildId },
      2,
      randomUUID(),
    );
    expect(enabled.policy.joinCode).not.toBe(r.code);
    await expect(join(r)).rejects.toMatchObject({ code: 'JOIN_UNAVAILABLE' });
  });
  it('preserves existing access and progress after closing joins without requiring continued affiliation', async () => {
    const r = await setup(),
      id = nextSubject(),
      token = await join(r, id),
      account = (await authenticate(db, token))!.id,
      before = await exportPlayer(db, account, r.realm);
    await configureAdmission(db, admin, r.realm, { mode: 'invite_only' }, 1, randomUUID());
    await setDiscordGuild(db, admin, r.realm, null);
    const nextToken = await loginDiscord(db, id);
    expect((await authenticate(db, nextToken))?.id).toBe(account);
    const after = await exportPlayer(db, account, r.realm);
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  });
  it('rolls back the whole registration if session creation fails, then retries once safely', async () => {
    const r = await setup(),
      id = nextSubject();
    await db.query(
      `CREATE FUNCTION reject_join_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM account_identities WHERE account_id=NEW.account_id AND subject='${id}') THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_join_fixture BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION reject_join_fixture()`,
    );
    try {
      await expect(join(r, id)).rejects.toThrow('fixture');
    } finally {
      await db.query(
        'DROP TRIGGER reject_join_fixture ON sessions; DROP FUNCTION reject_join_fixture()',
      );
    }
    expect(await memberAccount(id)).toBeUndefined();
    expect(
      (await db.query('SELECT 1 FROM realm_admissions WHERE realm_id=$1', [r.realm])).rowCount,
    ).toBe(0);
    await join(r, id);
    expect((await getRealmView(db, (await memberAccount(id))!, r.realm)).balance).toBe(100);
  });
  it('exports only own admission in v8 and reads older v7 without inventing receipts', async () => {
    const r = await setup(),
      id = nextSubject();
    await join(r, id);
    const archive = await exportPlayer(db, (await memberAccount(id))!, r.realm);
    expect(archive.realmAdmission?.guildId).toBe(r.guildId);
    const old: Record<string, unknown> = { ...archive, schemaVersion: 7 };
    delete old.realmAdmission;
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
      delete old[key];
    expect(parsePlayerArchive(old)).toEqual(old);
    expect((await exportPlayer(db, admin, r.realm)).realmAdmission).toBeNull();
  });
  it('restores policy, audit, and admission history exactly while excluding OAuth joining state', async () => {
    const r = await setup(),
      id = nextSubject();
    await join(r, id);
    await flow(r);
    const before = await exportPlayer(db, (await memberAccount(id))!, r.realm),
      backup = await makeBackup(db, password),
      target = (await server.database('admission_restored')).db;
    try {
      await restoreBackup(target, backup, password);
      for (const table of [
        'realm_admission_policies',
        'realm_admission_changes',
        'realm_admissions',
      ]) {
        const sql = `SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t`;
        expect((await target.query(sql)).rows).toEqual((await db.query(sql)).rows);
      }
      expect((await target.query('SELECT 1 FROM oauth_flows')).rowCount).toBe(0);
      const after = await exportPlayer(target, (await memberAccount(id))!, r.realm);
      expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
    } finally {
      await target.end();
    }
  });
  it('rejects a mismatched admission grant and leaves the restore target empty', async () => {
    const r = await setup(),
      id = nextSubject();
    await join(r, id);
    const account = await memberAccount(id),
      target = (await server.database('admission_invalid')).db;
    let backup: string;
    try {
      await db.query(
        'UPDATE realm_admissions SET starting_gems=starting_gems+1 WHERE realm_id=$1 AND account_id=$2',
        [r.realm, account],
      );
      try {
        backup = await makeBackup(db, password);
      } finally {
        await db.query(
          'UPDATE realm_admissions SET starting_gems=starting_gems-1 WHERE realm_id=$1 AND account_id=$2',
          [r.realm, account],
        );
      }
      await expect(restoreBackup(target, backup!, password)).rejects.toThrow(
        'admission history does not reconcile',
      );
      expect((await target.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    } finally {
      await target.end();
    }
  });
  it('migrates/restores the preceding release without enabling joins or changing existing records', async () => {
    const source = (await server.database('before_admission', false)).db,
      target = (await server.database('old_admission_restore')).db;
    try {
      await installLegacySchema(source, 10);
      const actor = await bootstrap(source, 'old-admission@example.test', password),
        r = await seedLegacyRealm(source, actor);
      const sql = `SELECT jsonb_build_object('realms',(SELECT jsonb_agg(to_jsonb(r)) FROM realms r),'members',(SELECT jsonb_agg(to_jsonb(m)) FROM memberships m),'cards',(SELECT jsonb_agg(to_jsonb(c)) FROM cards c)) AS state`,
        before = (await source.query(sql)).rows,
        backup = await makeBackup(source, password);
      const expected = structuredClone(before);
      for (const realm of expected[0].state.realms) realm.config = parseRealmConfig(realm.config);
      await migrate(source);
      expect((await source.query(sql)).rows).toEqual(expected);
      await restoreBackup(target, backup, password);
      expect((await target.query(sql)).rows).toEqual(expected);
      expect((await getRealmView(target, actor, r.realmId)).admission).toEqual(defaultAdmission);
      expect((await exportPlayer(target, actor, r.realmId)).realmAdmission).toBeNull();
    } finally {
      await source.end();
      await target.end();
    }
  });
});
