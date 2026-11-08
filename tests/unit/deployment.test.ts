import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { productionSettings } from '../../packages/config/src/deployment';

const valid = {
  PUBLIC_HOSTNAME: 'cards.example.test',
  APP_ORIGIN: 'https://cards.example.test',
  COOKIE_SECURE: 'true',
};
describe('portable HTTPS deployment settings', () => {
  it('accepts one DNS host and returns only its public origin', () => {
    expect(
      productionSettings({
        ...valid,
        DATABASE_URL: 'fixture-private-url',
        DISCORD_CLIENT_SECRET: 'fixture-private-key',
      }),
    ).toEqual({ hostname: valid.PUBLIC_HOSTNAME, origin: valid.APP_ORIGIN });
  });
  it('rejects hostnames that could become proxy syntax or change the listener', () => {
    for (const hostname of [
      '',
      'localhost',
      '127.0.0.1',
      '[::1]',
      'https://cards.test',
      'cards.test:443',
      'cards.test/path',
      '*.cards.test',
      'one.test,two.test',
      'cards.test\n:8080',
      ' cards.test',
      'CARDS.test',
      '-cards.test',
      'cards-.test',
      'cards..test',
      `${'x'.repeat(64)}.test`,
    ])
      expect(() => productionSettings({ ...valid, PUBLIC_HOSTNAME: hostname })).toThrow();
  });
  it('requires the exact HTTPS origin without user info, paths, ports, or alternate hosts', () => {
    for (const origin of [
      'http://cards.example.test',
      'https://cards.example.test/',
      'https://other.test',
      'https://user:pass@cards.example.test',
      'https://cards.example.test:8443',
      'https://cards.example.test?x=1',
    ])
      expect(() => productionSettings({ ...valid, APP_ORIGIN: origin })).toThrow();
  });
  it('requires explicit secure cookies', () => {
    for (const flag of [undefined, 'false', 'TRUE', '1'])
      expect(() => productionSettings({ ...valid, COOKIE_SECURE: flag })).toThrow();
  });
  it('runs the actual offline check without printing supplied values or loading .env', async () => {
    const run = promisify(execFile),
      entry = resolve('scripts/deployment-check.ts'),
      secret = 'fictional-canary-do-not-print';
    const result = await run(process.execPath, ['--import', 'tsx', entry], {
      env: { ...process.env, ...valid, DISCORD_CLIENT_SECRET: secret },
      windowsHide: true,
    });
    expect(result.stdout).toContain('passed');
    expect(result.stdout + result.stderr).not.toContain(secret);
    await expect(
      run(process.execPath, ['--import', 'tsx', entry], {
        env: { ...process.env, ...valid, PUBLIC_HOSTNAME: secret },
        windowsHide: true,
      }),
    ).rejects.toMatchObject({ code: 1, stderr: expect.not.stringContaining(secret) });
  });
});
