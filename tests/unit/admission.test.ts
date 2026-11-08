import { describe, expect, it } from 'vitest';
import {
  admissionPolicySchema,
  admissionTargetSchema,
  defaultAdmission,
} from '../../packages/db/src/admission';
import { exchangeDiscordCode } from '../../apps/web/lib/discord';
const settings = {
  clientId: '900000000000000001',
  clientSecret: 'fixture-secret',
  redirectUri: 'http://localhost:3000/api/auth/discord/callback',
};
const id = '100000000000000001',
  target = {
    realmId: '10000000-0000-4000-8000-000000000001',
    guildId: '800000000000000001',
    revision: 1,
    joinCode: '10000000-0000-4000-8000-000000000002',
  };
function provider({
  scope = 'identify guilds.members.read',
  status = 200,
  pending = false,
  memberId = id,
  malformed = false,
}: {
  scope?: string;
  status?: number;
  pending?: boolean;
  memberId?: string;
  malformed?: boolean;
} = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/oauth2/token'))
      return Response.json({ access_token: 'fixture-access', token_type: 'Bearer', scope });
    if (url.endsWith('/users/@me'))
      return Response.json({ id, username: 'fixture_name', global_name: 'Fixture Name' });
    return status === 200
      ? Response.json(
          malformed
            ? { unexpected: true }
            : { user: { id: memberId }, pending, roles: ['discard-me'], nick: 'discard-me' },
        )
      : new Response('private-upstream-data', { status });
  };
  return { fetcher, calls };
}
describe('Discord server admission boundary', () => {
  it('defaults to invitation-only and validates a complete server policy', () => {
    expect(admissionPolicySchema.parse(defaultAdmission)).toEqual(defaultAdmission);
    expect(
      admissionPolicySchema.safeParse({ ...defaultAdmission, mode: 'discord_server' }).success,
    ).toBe(false);
    expect(admissionTargetSchema.safeParse({ ...target, guildId: 'not-a-server-id' }).success).toBe(
      false,
    );
  });
  it('checks exactly the targeted server using the verified user token and discards other member data', async () => {
    const fixture = provider(),
      result = await exchangeDiscordCode(settings, 'fixture', 'fixture', fixture.fetcher, target);
    expect(result).toMatchObject({ id, admission: { ...target } });
    expect(result.admission!.verifiedAt).toBeLessThanOrEqual(Date.now());
    expect(fixture.calls.map((c) => c.url)).toEqual([
      'https://discord.com/api/oauth2/token',
      'https://discord.com/api/v10/users/@me',
      `https://discord.com/api/v10/users/@me/guilds/${target.guildId}/member`,
    ]);
    expect(fixture.calls[2].init).toMatchObject({
      headers: { Authorization: 'Bearer fixture-access' },
      redirect: 'error',
      cache: 'no-store',
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture-access|roles|nick|discard-me/);
  });
  it('leaves ordinary sign-in on identify alone without a membership API request', async () => {
    const fixture = provider({ scope: 'identify' });
    expect(await exchangeDiscordCode(settings, 'fixture', 'fixture', fixture.fetcher)).toEqual({
      id,
      profile: { username: 'fixture_name', displayName: 'Fixture Name' },
    });
    expect(fixture.calls).toHaveLength(2);
  });
  it('fails closed when membership permission was not granted', async () => {
    const fixture = provider({ scope: 'identify' });
    await expect(
      exchangeDiscordCode(settings, 'fixture', 'fixture', fixture.fetcher, target),
    ).rejects.toMatchObject({ code: 'JOIN_UNVERIFIED' });
    expect(fixture.calls).toHaveLength(1);
  });
  it('rejects missing membership, pending screening, mismatched identity, and malformed members', async () => {
    for (const options of [
      { status: 403 },
      { status: 404 },
      { pending: true },
      { memberId: '200000000000000001' },
      { malformed: true },
    ])
      await expect(
        exchangeDiscordCode(settings, 'fixture', 'fixture', provider(options).fetcher, target),
      ).rejects.toThrow();
  });
  it('does not mistake rate limits or provider outages for eligibility or expose provider response bodies', async () => {
    for (const status of [429, 500])
      await expect(
        exchangeDiscordCode(settings, 'fixture', 'fixture', provider({ status }).fetcher, target),
      ).rejects.toMatchObject({
        code: 'DISCORD_PROVIDER',
        message: 'Discord sign-in could not be completed. Please try again.',
      });
  });
});
