import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { discordSettings, exchangeDiscordCode } from '../../apps/web/lib/discord';
import { hashPassword } from '../../packages/db/src/auth';

const settings = {
  clientId: '100000000000000001',
  clientSecret: randomBytes(24).toString('hex'),
  redirectUri: 'http://localhost:3000/api/auth/discord/callback',
};
describe('password rules and Discord provider boundary', () => {
  it('accepts 12 and longer passwords, with an explicit 256-character maximum', async () => {
    await expect(hashPassword('a'.repeat(11))).rejects.toThrow('at least 12');
    await expect(hashPassword('a'.repeat(12))).resolves.toMatch(/^scrypt-v1:/);
    await expect(hashPassword('a'.repeat(64))).resolves.toMatch(/^scrypt-v1:/);
    await expect(hashPassword('a'.repeat(256))).resolves.toMatch(/^scrypt-v1:/);
    await expect(hashPassword('a'.repeat(257))).rejects.toThrow('no more than 256');
  });
  it('keeps Discord optional and builds a fixed callback from the configured origin', () => {
    expect(discordSettings({})).toBeNull();
    expect(discordSettings({ DISCORD_CLIENT_ID: settings.clientId })).toBeNull();
    expect(
      discordSettings({
        DISCORD_CLIENT_ID: settings.clientId,
        DISCORD_CLIENT_SECRET: settings.clientSecret,
        APP_ORIGIN: 'https://cards.example.test',
      })?.redirectUri,
    ).toBe('https://cards.example.test/api/auth/discord/callback');
  });
  it('uses the code verifier and retains verified ID and names without provider credentials', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/oauth2/token'))
        return Response.json({
          access_token: 'fixture-access',
          refresh_token: 'fixture-refresh',
          token_type: 'Bearer',
          scope: 'identify',
        });
      return Response.json({
        id: '200000000000000001',
        username: 'untrusted-name',
        email: 'untrusted@example.test',
      });
    };
    expect(
      await exchangeDiscordCode(settings, 'fixture-code', 'fixture-verifier', fetcher),
    ).toEqual({
      id: '200000000000000001',
      profile: { username: 'untrusted-name', displayName: null },
    });
    const body = calls[0].init?.body as URLSearchParams;
    expect(body.get('code_verifier')).toBe('fixture-verifier');
    expect(body.get('client_secret')).toBe(settings.clientSecret);
    expect(body.get('redirect_uri')).toBe(settings.redirectUri);
    expect(calls[1].url).toBe('https://discord.com/api/v10/users/@me');
    expect(calls[0].init?.redirect).toBe('error');
  });
  it('returns safe errors for provider failure and malformed identities', async () => {
    const rejected: typeof fetch = async () =>
      new Response('sensitive upstream body', { status: 401 });
    await expect(
      exchangeDiscordCode(settings, 'fixture', 'fixture', rejected),
    ).rejects.toMatchObject({ code: 'DISCORD_PROVIDER' });
    let calls = 0;
    const malformed: typeof fetch = async () =>
      ++calls === 1
        ? Response.json({ access_token: 'fixture', token_type: 'Bearer', scope: 'identify' })
        : Response.json({ id: 'a-username-is-not-an-identity' });
    await expect(exchangeDiscordCode(settings, 'fixture', 'fixture', malformed)).rejects.toThrow(
      'could not be completed',
    );
  });
});
