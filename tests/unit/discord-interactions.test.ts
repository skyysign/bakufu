import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  discordCommandDefinition,
  discordInteractionSettings,
  discordMessage,
  discordQuoteId,
  parseDiscordInteraction,
  verifyDiscordSignature,
} from '../../packages/db/src/discord-protocol';
import { registerDiscordCommands } from '../../packages/db/src/discord-command-registration';
import { handleDiscordRequest } from '../../apps/web/lib/discord-interactions';
const keys = generateKeyPairSync('ed25519'),
  publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const app = '900000000000000001',
  guild = '800000000000000001',
  subject = '100000000000000001',
  timestamp = String(Math.floor(Date.now() / 1000));
const base = { id: '700000000000000001', application_id: app, type: 1 };
const command = {
  ...base,
  type: 2,
  guild_id: guild,
  member: { user: { id: subject } },
  data: { name: 'bakufu', type: 1, options: [{ name: 'status', type: 1 }] },
};
function request(body: string, signature?: string, time = timestamp) {
  return new Request('http://localhost/api/discord/interactions', {
    method: 'POST',
    headers: {
      'x-signature-ed25519':
        signature ?? sign(null, Buffer.from(time + body), keys.privateKey).toString('hex'),
      'x-signature-timestamp': time,
    },
    body,
  });
}
const database = () => {
  throw new Error('Database must not be reached.');
};
describe('Discord interaction boundary', () => {
  it('verifies the exact raw UTF-8 body, not a parsed/re-serialized version', () => {
    const body = Buffer.from('{ "name": "Étoile" }'),
      signature = sign(
        null,
        Buffer.concat([Buffer.from(timestamp), body]),
        keys.privateKey,
      ).toString('hex');
    expect(verifyDiscordSignature(body, signature, timestamp, publicKey)).toBe(true);
    expect(
      verifyDiscordSignature(
        Buffer.from(JSON.stringify(JSON.parse(body.toString()))),
        signature,
        timestamp,
        publicKey,
      ),
    ).toBe(false);
  });
  it('rejects bad signatures, keys, stale/future timestamps, and malformed headers', () => {
    const body = Buffer.from(JSON.stringify(base)),
      signature = sign(
        null,
        Buffer.concat([Buffer.from(timestamp), body]),
        keys.privateKey,
      ).toString('hex');
    for (const [sig, time, key, now] of [
      [null, timestamp, publicKey, Date.now()],
      ['0'.repeat(128), timestamp, publicKey, Date.now()],
      [signature, timestamp, randomBytes(32).toString('hex'), Date.now()],
      [signature, timestamp, publicKey, Number(timestamp) * 1000 + 301000],
      [signature, timestamp, publicKey, Number(timestamp) * 1000 - 301000],
      [signature, 'bad', publicKey, Date.now()],
      [signature, timestamp, 'bad', Date.now()],
    ] as const)
      expect(verifyDiscordSignature(body, sig, time, key, now)).toBe(false);
  });
  it('acknowledges only verified application PINGs without database or Origin/cookie requirements', async () => {
    const response = await handleDiscordRequest(
      request(JSON.stringify(base)),
      { applicationId: app, publicKey },
      database,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 1 });
    expect(response.headers.get('cache-control')).toContain('no-store');
    const wrong = await handleDiscordRequest(
      request(JSON.stringify({ ...base, application_id: '900000000000000002' })),
      { applicationId: app, publicKey },
      database,
    );
    expect(wrong.status).toBe(401);
  });
  it('fails closed when disabled, unsigned, invalid JSON, or oversized', async () => {
    const settings = { applicationId: app, publicKey };
    expect((await handleDiscordRequest(request('{}'), null, database)).status).toBe(503);
    expect(
      (await handleDiscordRequest(request('{}', '0'.repeat(128)), settings, database)).status,
    ).toBe(401);
    expect((await handleDiscordRequest(request('{bad'), settings, database)).status).toBe(400);
    expect(
      (await handleDiscordRequest(request('x'.repeat(16385)), settings, database)).status,
    ).toBe(413);
  });
  it('rejects a timed-out body even when its received prefix has a valid signature', async () => {
    const raw = JSON.stringify(base),
      signature = sign(null, Buffer.from(timestamp + raw), keys.privateKey).toString('hex');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from(raw));
      },
    });
    const pending = new Request('http://localhost/api/discord/interactions', {
      method: 'POST',
      headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: string });
    expect(
      (await handleDiscordRequest(pending, { applicationId: app, publicKey }, database)).status,
    ).toBe(408);
  });
  it('takes identity only from the invoking guild member and rejects DMs', () => {
    expect(
      parseDiscordInteraction({ ...command, user: { id: '200000000000000001' } }, app),
    ).toEqual({ id: base.id, guildId: guild, subject, kind: 'status' });
    expect(() =>
      parseDiscordInteraction(
        { ...command, guild_id: undefined, member: undefined, user: { id: subject } },
        app,
      ),
    ).toThrow('linked Discord server');
    expect(() =>
      parseDiscordInteraction(
        {
          ...command,
          data: {
            ...command.data,
            options: [
              { name: 'status', type: 1, options: [{ name: 'pack', type: 3, value: 'x' }] },
            ],
          },
        },
        app,
      ),
    ).toThrow();
  });
  it('parses exact supported commands and confirmation buttons', () => {
    expect(
      parseDiscordInteraction(
        {
          ...command,
          data: {
            ...command.data,
            options: [
              {
                name: 'open',
                type: 1,
                options: [{ name: 'pack', type: 3, value: ' All Characters ' }],
              },
            ],
          },
        },
        app,
      ),
    ).toMatchObject({ kind: 'quote', pack: 'All Characters' });
    const id = discordQuoteId(app, base.id);
    expect(
      parseDiscordInteraction(
        { ...command, type: 3, data: { component_type: 2, custom_id: `atlas:open:${id}` } },
        app,
      ),
    ).toMatchObject({ kind: 'confirm', quoteId: id });
    expect(() =>
      parseDiscordInteraction(
        { ...command, type: 3, data: { component_type: 2, custom_id: 'delete-account' } },
        app,
      ),
    ).toThrow();
    expect(() =>
      parseDiscordInteraction(
        { ...command, data: { ...command.data, options: [{ name: 'delete', type: 1 }] } },
        app,
      ),
    ).toThrow();
  });
  it('requires a public key and application ID only when interactions are enabled', () => {
    expect(discordInteractionSettings({})).toBeNull();
    expect(
      discordInteractionSettings({ DISCORD_PUBLIC_KEY: publicKey, DISCORD_CLIENT_ID: app }),
    ).toEqual({ applicationId: app, publicKey });
    expect(() => discordInteractionSettings({ DISCORD_PUBLIC_KEY: publicKey })).toThrow();
  });
  it('parses collection pages and requires explicit public sharing with no target user option', () => {
    const collection = (options?: unknown[]) => ({
      ...command,
      data: { ...command.data, options: [{ type: 1, name: 'collection', options }] },
    });
    expect(parseDiscordInteraction(collection(), app)).toEqual({
      id: base.id,
      guildId: guild,
      subject,
      kind: 'collection',
      page: 1,
      share: false,
    });
    expect(
      parseDiscordInteraction(
        collection([
          { type: 4, name: 'page', value: 2 },
          { type: 5, name: 'share', value: true },
        ]),
        app,
      ),
    ).toMatchObject({ kind: 'collection', page: 2, share: true });
    for (const options of [
      [{ type: 4, name: 'page', value: 0 }],
      [{ type: 4, name: 'page', value: -1 }],
      [{ type: 4, name: 'page', value: 1.5 }],
      [{ type: 4, name: 'page', value: 1000001 }],
      [{ type: 4, name: 'page', value: '2' }],
      [{ type: 5, name: 'share', value: 'true' }],
      [
        { type: 4, name: 'page', value: 1 },
        { type: 4, name: 'page', value: 2 },
      ],
      [{ type: 6, name: 'user', value: subject }],
      [{ type: 5, name: 'share', value: true, account: subject }],
    ])
      expect(() => parseDiscordInteraction(collection(options), app)).toThrow();
    const definition = discordCommandDefinition.options.find(
      (option) => option.name === 'collection',
    );
    expect(definition).toMatchObject({
      options: [
        { name: 'page', type: 4, min_value: 1 },
        { name: 'share', type: 5 },
      ],
    });
  });
  it('keeps public collection replies bounded and unable to ping users', () => {
    expect(discordMessage('Shared own collection', undefined, true)).toEqual({
      type: 4,
      data: { content: 'Shared own collection', flags: 0, allowed_mentions: { parse: [] } },
    });
    expect(discordMessage('Private again')).toMatchObject({ data: { flags: 64 } });
  });
  it('uses stable application-scoped quote IDs, private bounded replies, and disabled mentions', () => {
    const id = discordQuoteId(app, base.id);
    expect(id).toMatch(/^[a-f0-9-]{14}5[a-f0-9-]{21}$/);
    expect(discordQuoteId(app, base.id)).toBe(id);
    expect(discordQuoteId(guild, base.id)).not.toBe(id);
    const reply = discordMessage('x'.repeat(2500), id);
    expect(reply).toMatchObject({
      type: 4,
      data: {
        flags: 64,
        allowed_mentions: { parse: [] },
        components: [{ components: [{ custom_id: `atlas:open:${id}` }] }],
      },
    });
    if (reply.type !== 4) throw new Error('Fixture');
    expect(reply.data.content).toHaveLength(1900);
  });
});
describe('explicit Discord command registration', () => {
  it('requests scoped credentials, upserts /bakufu and removes the former /atlas', async () => {
    const legacyId = '300000000000000003';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'fixture-token', token_type: 'Bearer' }))
      .mockResolvedValueOnce(Response.json({ id: base.id }))
      .mockResolvedValueOnce(
        Response.json([
          { id: legacyId, name: 'atlas' },
          { id: base.id, name: 'bakufu' },
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await registerDiscordCommands(app, 'fixture-secret', guild, fetcher)).toEqual({
      legacyRemoved: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3][0]).toBe(
      `https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands/${legacyId}`,
    );
    expect(fetcher.mock.calls[3][1]).toMatchObject({ method: 'DELETE' });
    expect(discordCommandDefinition.name).toBe('bakufu');
    expect(fetcher.mock.calls[0][1]?.body?.toString()).toContain(
      'scope=applications.commands.update',
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      `https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`,
    );
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      body: JSON.stringify(discordCommandDefinition),
    });
  });
  it('does not expose provider error bodies or secrets', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private-provider-data', { status: 401 }));
    await expect(registerDiscordCommands(app, 'fixture-secret', guild, fetcher)).rejects.toThrow(
      'authorization failed',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
