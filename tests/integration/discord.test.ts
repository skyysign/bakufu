import { defaultConfig } from '../support/prototype-config';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authenticate,
  beginDiscordFlow,
  bootstrap,
  consumeDiscordFlow,
  createRealm,
  exportPlayer,
  getRealmView,
  inviteDiscordPlayer,
  linkDiscordAccount,
  loginDiscord,
  needsBootstrap,
  openPack,
  provisionPlayer,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { login } from '../../packages/db/src/auth';
import {
  finishDiscordLogin,
  startDiscordLogin,
  type DiscordSettings,
} from '../../apps/web/lib/discord';
import { startPostgres } from '../support/postgres';
import { installLegacySchema, seedLegacyRealm } from '../support/legacy';

let postgres: Awaited<ReturnType<typeof startPostgres>>;
let db: Database;
let admin: string;
let realmId: string;
const adminDiscord = '100000000000000001';
const playerDiscord = '200000000000000001';
const linkedDiscord = '300000000000000001';
const settings: DiscordSettings = {
  clientId: '900000000000000001',
  clientSecret: randomBytes(24).toString('hex'),
  redirectUri: 'http://localhost:3000/api/auth/discord/callback',
  adminId: adminDiscord,
};

function provider(subject: string, challenge: string): typeof fetch {
  return async (input, init) => {
    if (String(input).endsWith('/oauth2/token')) {
      const body = init?.body as URLSearchParams;
      expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(
        challenge,
      );
      return Response.json({
        access_token: 'fixture-access',
        token_type: 'Bearer',
        scope: 'identify',
      });
    }
    return Response.json({
      id: subject,
      email: 'local@example.test',
      username: 'not-used-for-linking',
    });
  };
}
async function oauth(subject: string) {
  const flow = await startDiscordLogin(db, settings);
  const url = new URL(flow.url);
  expect(url.searchParams.get('scope')).toBe('identify');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  const query = new URLSearchParams({
    state: url.searchParams.get('state')!,
    code: 'fixture-code',
    iss: 'https://discord.com',
  });
  return finishDiscordLogin(
    db,
    settings,
    query,
    flow.browserToken,
    provider(subject, url.searchParams.get('code_challenge')!),
  );
}
beforeAll(async () => {
  postgres = await startPostgres();
  db = (await postgres.database('discord_test')).db;
});
afterAll(async () => {
  await db?.end();
  await postgres?.stop();
});

describe('Discord identity, OAuth state, private access, and recovery', () => {
  it('bootstraps only the configured, provider-verified Discord user', async () => {
    expect(await needsBootstrap(db)).toBe(true);
    await expect(
      login(db, 'not-created@example.test', randomBytes(24).toString('hex')),
    ).rejects.toMatchObject({ code: 'SETUP_REQUIRED' });
    expect((await db.query('SELECT 1 FROM login_limits')).rowCount).toBe(0);
    await expect(oauth(playerDiscord)).rejects.toMatchObject({ code: 'DISCORD_NOT_INVITED' });
    expect((await db.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    const token = await oauth(adminDiscord);
    const account = await authenticate(db, token);
    expect(account).toMatchObject({ email: null, instanceAdmin: true });
    admin = account!.id;
    expect(await needsBootstrap(db)).toBe(false);
    await expect(
      bootstrap(db, 'another@example.test', randomBytes(24).toString('hex')),
    ).rejects.toMatchObject({ code: 'ALREADY_BOOTSTRAPPED' });
    realmId = await createRealm(db, admin, 'Discord realm', defaultConfig);
  });
  it('binds state to a browser and consumes it once, including concurrent callbacks', async () => {
    const flow = await beginDiscordFlow(db);
    await expect(
      consumeDiscordFlow(db, flow.state, randomBytes(32).toString('base64url')),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE' });
    const races = await Promise.allSettled([
      consumeDiscordFlow(db, flow.state, flow.browserToken),
      consumeDiscordFlow(db, flow.state, flow.browserToken),
    ]);
    expect(races.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const expired = await beginDiscordFlow(db);
    await db.query(
      "UPDATE oauth_flows SET expires_at=now()-interval '1 second' WHERE state_hash=$1",
      [createHash('sha256').update(expired.state).digest('hex')],
    );
    await expect(consumeDiscordFlow(db, expired.state, expired.browserToken)).rejects.toMatchObject(
      { code: 'OAUTH_STATE' },
    );
    expect(
      (await db.query('SELECT state_hash,browser_hash FROM oauth_flows')).rows.some(
        (row) => row.state_hash === expired.state || row.browser_hash === expired.browserToken,
      ),
    ).toBe(false);
  });
  it('rejects cancellation and wrong issuer before contacting the provider', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      throw new Error('Must not contact provider');
    };
    const invalidQueries: Record<string, string>[] = [
      { error: 'access_denied' },
      { code: 'fixture', iss: 'https://wrong.example.test' },
    ];
    for (const extra of invalidQueries) {
      const flow = await beginDiscordFlow(db);
      const query = new URLSearchParams({ state: flow.state, ...extra });
      await expect(
        finishDiscordLogin(db, settings, query, flow.browserToken, fetcher),
      ).rejects.toBeInstanceOf(Error);
      await expect(consumeDiscordFlow(db, flow.state, flow.browserToken)).rejects.toMatchObject({
        code: 'OAUTH_STATE',
      });
    }
    expect(calls).toBe(0);
  });
  it('invites without passwords, grants once under retries, and enforces realm RBAC', async () => {
    const ids = await Promise.all([
      inviteDiscordPlayer(db, admin, realmId, playerDiscord),
      inviteDiscordPlayer(db, admin, realmId, playerDiscord),
    ]);
    expect(ids[0]).toBe(ids[1]);
    const account = await authenticate(db, await oauth(playerDiscord));
    expect(account).toMatchObject({ id: ids[0], instanceAdmin: false });
    expect((await getRealmView(db, ids[0], realmId)).balance).toBe(100);
    expect(
      (await db.query('SELECT 1 FROM wallet_ledger WHERE account_id=$1', [ids[0]])).rowCount,
    ).toBe(1);
    await expect(inviteDiscordPlayer(db, ids[0], realmId, linkedDiscord)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(createRealm(db, ids[0], 'Denied', defaultConfig)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      loginDiscord(db, '400000000000000001', '400000000000000001'),
    ).rejects.toMatchObject({ code: 'DISCORD_NOT_INVITED' });
  });
  it('links an existing local account explicitly without losing progress or merging by email', async () => {
    const localId = await provisionPlayer(
      db,
      realmId,
      'local@example.test',
      randomBytes(24).toString('hex'),
    );
    const view = await getRealmView(db, localId, realmId);
    await openPack(db, localId, realmId, view.packs[0].id, '11111111-1111-4111-8111-111111111111');
    await expect(oauth(linkedDiscord)).rejects.toMatchObject({ code: 'DISCORD_NOT_INVITED' });
    await linkDiscordAccount(db, 'local@example.test', linkedDiscord);
    await linkDiscordAccount(db, 'local@example.test', linkedDiscord);
    expect((await authenticate(db, await oauth(linkedDiscord)))?.id).toBe(localId);
    expect((await getRealmView(db, localId, realmId)).cards).toHaveLength(1);
    await expect(linkDiscordAccount(db, 'local@example.test', playerDiscord)).rejects.toMatchObject(
      { code: 'IDENTITY_CONFLICT' },
    );
    expect((await getRealmView(db, localId, realmId)).balance).toBe(90);
  });
  it('serializes Discord and password bootstrap attempts so only one first admin exists', async () => {
    const fresh = (await postgres.database('bootstrap_race')).db;
    try {
      const results = await Promise.allSettled([
        loginDiscord(fresh, adminDiscord, adminDiscord),
        bootstrap(fresh, 'race@example.test', randomBytes(24).toString('hex')),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect((await fresh.query('SELECT 1 FROM accounts WHERE instance_admin')).rowCount).toBe(1);
    } finally {
      await fresh.end();
    }
  });
  it('restores Discord links and account IDs but excludes OAuth flows and provider credentials', async () => {
    const player = (await authenticate(db, await oauth(linkedDiscord)))!;
    const exported = await exportPlayer(db, player.id, realmId);
    expect(JSON.stringify(exported)).not.toMatch(
      /password_hash|access_token|code_verifier|account_identities|email/,
    );
    expect(JSON.stringify(exported)).not.toContain(linkedDiscord);
    await beginDiscordFlow(db);
    const passphrase = randomBytes(24).toString('hex');
    const backup = await makeBackup(db, passphrase);
    expect(backup).not.toContain('fixture-access');
    expect(backup).not.toContain(settings.clientSecret);
    const restored = (await postgres.database('discord_restore')).db;
    try {
      await restoreBackup(restored, backup, passphrase);
      expect((await restored.query('SELECT 1 FROM oauth_flows')).rowCount).toBe(0);
      expect((await restored.query('SELECT 1 FROM sessions')).rowCount).toBe(0);
      const query =
        'SELECT jsonb_agg(to_jsonb(i) ORDER BY subject) AS data FROM account_identities i';
      expect((await restored.query(query)).rows).toEqual((await db.query(query)).rows);
      expect((await authenticate(restored, await loginDiscord(restored, linkedDiscord)))?.id).toBe(
        player.id,
      );
      expect((await getRealmView(restored, player.id, realmId)).cards).toHaveLength(1);
    } finally {
      await restored.end();
    }
  });
  it('upgrades the original schema without changing existing accounts or collections', async () => {
    const legacy = (await postgres.database('legacy_upgrade', false)).db;
    try {
      await installLegacySchema(legacy);
      const password = randomBytes(24).toString('hex');
      const accountId = await bootstrap(legacy, 'legacy@example.test', password);
      const previous = await seedLegacyRealm(legacy, accountId);
      const token = await login(legacy, 'legacy@example.test', password);
      await migrate(legacy);
      const collection = await getRealmView(legacy, accountId, previous.realmId);
      expect(collection.balance).toBe(previous.result.balance);
      expect(collection.cards).toHaveLength(1);
      expect(collection.cards[0]).toMatchObject({
        cardId: previous.cardId,
        id: previous.character.id,
      });
      expect((await authenticate(legacy, token))?.id).toBe(accountId);
      await linkDiscordAccount(legacy, 'legacy@example.test', linkedDiscord);
      expect((await authenticate(legacy, await loginDiscord(legacy, linkedDiscord)))?.id).toBe(
        accountId,
      );
    } finally {
      await legacy.end();
    }
  });
});
