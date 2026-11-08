// Test-only Node preload. Production has no provider URL override or fake-login switch.
import { createHash, randomBytes } from 'node:crypto';
import { URLSearchParams } from 'node:url';
const { Headers, Response } = globalThis;

const originalFetch = globalThis.fetch;
const tokens = new Map();
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://discord.com/api/oauth2/token') {
    try {
      const body = new URLSearchParams(init.body);
      const code = JSON.parse(Buffer.from(body.get('code'), 'base64url').toString('utf8'));
      const challenge = createHash('sha256').update(body.get('code_verifier')).digest('base64url');
      if (challenge !== code.challenge || !/^[0-9]{17,20}$/.test(code.subject)) throw new Error();
      const accessToken = randomBytes(32).toString('hex');
      tokens.set(accessToken, code);
      return Response.json({
        access_token: accessToken,
        token_type: 'Bearer',
        scope: code.scope ?? 'identify',
      });
    } catch {
      return new Response(null, { status: 400 });
    }
  }
  if (url === 'https://discord.com/api/v10/users/@me') {
    const token = new Headers(init.headers).get('authorization')?.replace(/^Bearer /, '');
    const code = tokens.get(token);
    if (!code) return new Response(null, { status: 401 });
    const subject = code.subject;
    if (!code.scope?.includes('guilds.members.read')) tokens.delete(token);
    return Response.json({
      id: subject,
      username: subject === '100000000000000001' ? 'atlas_admin' : 'atlas_player',
      global_name: subject === '100000000000000001' ? 'Atlas Admin' : 'Atlas Player',
    });
  }
  const membership = /^https:\/\/discord.com\/api\/v10\/users\/@me\/guilds\/([0-9]+)\/member$/.exec(
    url,
  );
  if (membership) {
    const token = new Headers(init.headers).get('authorization')?.replace(/^Bearer /, '');
    const code = tokens.get(token);
    tokens.delete(token);
    if (!code?.scope?.includes('guilds.members.read') || code.guildId !== membership[1])
      return new Response(null, { status: 404 });
    return Response.json({ user: { id: code.subject }, pending: code.pending ?? false });
  }
  return originalFetch(input, init);
};
