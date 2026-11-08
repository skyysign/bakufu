import { describe, expect, it } from 'vitest';
import { discordNamesSchema, discordProfileSchema } from '../../packages/db/src/member-profiles';
import { exchangeDiscordCode } from '../../apps/web/lib/discord';
const settings = {
  clientId: '900000000000000001',
  clientSecret: 'fictional-fixture-secret',
  redirectUri: 'http://localhost:3000/api/auth/discord/callback',
};
describe('verified Discord profile fields', () => {
  it('normalizes names and removes invisible/control formatting without changing identity', () => {
    expect(
      discordNamesSchema.parse({ username: '  e\u0301toile  ', displayName: 'A\u202e\nB' }),
    ).toEqual({ username: 'étoile', displayName: 'A  B' });
    expect(discordNamesSchema.parse({ username: 'atlas_player', displayName: null })).toEqual({
      username: 'atlas_player',
      displayName: null,
    });
  });
  it('rejects empty or excessive metadata and rejects noncanonical stored profiles', () => {
    for (const username of ['', ' '.repeat(4), 'x'.repeat(129)])
      expect(discordNamesSchema.safeParse({ username, displayName: null }).success).toBe(false);
    expect(
      discordProfileSchema.safeParse({
        username: ' name ',
        displayName: null,
        updatedAt: '2026-11-04T00:00:00Z',
      }).success,
    ).toBe(false);
  });
  it('retains only verified names and ID from the OAuth response, never credential or email fields', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () =>
      ++calls === 1
        ? Response.json({ access_token: 'fixture-token', token_type: 'Bearer', scope: 'identify' })
        : Response.json({
            id: '100000000000000001',
            username: 'fixture_name',
            global_name: 'Fixture Name',
            email: 'private@example.test',
            avatar: 'unused',
            roles: ['ignored'],
          });
    expect(await exchangeDiscordCode(settings, 'fixture', 'fixture', fetcher)).toEqual({
      id: '100000000000000001',
      profile: { username: 'fixture_name', displayName: 'Fixture Name' },
    });
  });
  it('allows verified identity login when optional presentation metadata is absent or malformed', async () => {
    for (const fields of [
      {},
      { username: 23 },
      { username: 'x'.repeat(200) },
      { username: 'known', global_name: { unexpected: true } },
    ]) {
      let calls = 0;
      const fetcher: typeof fetch = async () =>
        ++calls === 1
          ? Response.json({
              access_token: 'fixture-token',
              token_type: 'Bearer',
              scope: 'identify',
            })
          : Response.json({ id: '100000000000000001', ...fields });
      expect(await exchangeDiscordCode(settings, 'fixture', 'fixture', fetcher)).toEqual({
        id: '100000000000000001',
        profile: null,
      });
    }
  });
});
