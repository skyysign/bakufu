import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { readJsonBody } from '../../apps/web/lib/request-body';
import { removeDiscordCommands } from '../../packages/db/src/discord-command-registration';

const request = (body: BodyInit) =>
  new Request('http://localhost/api/realms', { method: 'POST', body });

describe('compressed request bodies', () => {
  const payload = {
    characters: Array.from({ length: 2000 }, (_, i) => ({ name: `Original ${i}` })),
  };
  const json = JSON.stringify(payload);

  it('reads plain and gzip compressed JSON the same way', async () => {
    expect(await readJsonBody(request(json), 1_000_000)).toEqual(payload);
    const compressed = gzipSync(json);
    expect(compressed.length).toBeLessThan(json.length / 5);
    expect(await readJsonBody(request(compressed), 1_000_000)).toEqual(payload);
  });

  it('applies the cap to the decompressed size too', async () => {
    // A small upload that expands far beyond the cap is refused.
    const bomb = gzipSync(JSON.stringify({ padding: 'x'.repeat(5_000_000) }));
    expect(bomb.length).toBeLessThan(20_000);
    await expect(readJsonBody(request(bomb), 1_000_000)).rejects.toMatchObject({
      code: 'TOO_LARGE',
      status: 413,
    });
    await expect(readJsonBody(request(json), 1_000)).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('rejects broken compression and non-object bodies', async () => {
    const broken = Buffer.concat([gzipSync(json).subarray(0, 40)]);
    await expect(readJsonBody(request(broken), 1_000_000)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(readJsonBody(request(gzipSync('[1,2]')), 1_000)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('removing slash commands for hosting without them', () => {
  it('removes /bakufu and the old /atlas, and nothing else', async () => {
    const app = '100000000000000001',
      guild = '900000000000000001';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'fixture-token', token_type: 'Bearer' }))
      .mockResolvedValueOnce(
        Response.json([
          { id: '300000000000000001', name: 'bakufu' },
          { id: '300000000000000002', name: 'atlas' },
          { id: '300000000000000003', name: 'other-command' },
        ]),
      )
      .mockResolvedValue(new Response(null, { status: 204 }));
    expect(await removeDiscordCommands(app, 'fixture-secret', guild, fetcher)).toEqual({
      removed: 2,
    });
    const deleted = fetcher.mock.calls
      .filter(([, init]) => init?.method === 'DELETE')
      .map(([url]) => String(url).split('/').at(-1));
    expect(deleted).toEqual(['300000000000000001', '300000000000000002']);
  });
});
