import { describe, expect, it } from 'vitest';
import { discordAvatarUrl, discordAvatarUrlSchema } from '../../packages/config/src/discord-avatar';
import { exchangeDiscordCode } from '../../apps/web/lib/discord';

const id = '100000000000000001';
const hash = '0123456789abcdef0123456789abcdef';

describe('verified public Discord avatar references', () => {
  it('constructs static references from verified user IDs and normal or animated hashes', () => {
    expect(discordAvatarUrl(id, hash)).toBe(
      `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`,
    );
    expect(discordAvatarUrl(id, `a_${hash}`)).toBe(
      `https://cdn.discordapp.com/avatars/${id}/a_${hash}.png?size=128`,
    );
    for (const malformed of ['https://untrusted.example/picture', '../avatar', 'x'.repeat(32), 0])
      expect(discordAvatarUrl(id, malformed)).toBeNull();
    expect(discordAvatarUrl('../untrusted', hash)).toBeNull();
  });

  it('uses the correct modern or legacy default avatar without inventing missing metadata', () => {
    expect(discordAvatarUrl(id, null, '0312')).toBe(
      'https://cdn.discordapp.com/embed/avatars/2.png',
    );
    expect(discordAvatarUrl('4194304', null, '0')).toBeNull();
    expect(discordAvatarUrl(id, null, '0')).toBe('https://cdn.discordapp.com/embed/avatars/0.png');
    expect(discordAvatarUrl('100000000004194305', null, '0')).toBe(
      'https://cdn.discordapp.com/embed/avatars/1.png',
    );
    expect(discordAvatarUrl(id, undefined)).toBeNull();
  });

  it('rejects attachments, alternate hosts, query injection and noncanonical public paths', () => {
    const canonical = discordAvatarUrl(id, hash)!;
    expect(discordAvatarUrlSchema.safeParse(canonical).success).toBe(true);
    for (const url of [
      canonical.replace('cdn.discordapp.com', 'cdn.discordapp.com.attacker.test'),
      canonical.replace('https:', 'http:'),
      `${canonical}&token=private`,
      `${canonical}#fragment`,
      canonical.replace('?size=128', '?size=4096'),
      'https://cdn.discordapp.com/attachments/1/private.png',
      'https://cdn.discordapp.com/embed/avatars/6.png',
      'data:image/png;base64,ignored',
    ])
      expect(discordAvatarUrlSchema.safeParse(url).success).toBe(false);
  });

  it('retains only verified avatar presentation fields from the OAuth response', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () =>
      ++calls === 1
        ? Response.json({ access_token: 'fixture-token', token_type: 'Bearer', scope: 'identify' })
        : Response.json({
            id,
            username: 'fixture_avatar',
            global_name: 'Fixture Avatar',
            avatar: hash,
            email: 'private@example.test',
            token: 'ignored-credential',
          });
    const result = await exchangeDiscordCode(
      {
        clientId: '900000000000000001',
        clientSecret: 'fictional-fixture-secret',
        redirectUri: 'http://localhost:3000/api/auth/discord/callback',
      },
      'fixture',
      'fixture',
      fetcher,
    );
    expect(result).toEqual({
      id,
      profile: {
        username: 'fixture_avatar',
        displayName: 'Fixture Avatar',
        avatarUrl: discordAvatarUrl(id, hash),
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/private@example|fixture-token|ignored-credential/);
  });
});
