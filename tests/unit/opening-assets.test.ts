import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAssetPreloader,
  demoPortraitAtlas,
  portraitAssetSource,
} from '../../apps/web/app/opening-assets';

afterEach(() => vi.useRealTimers());
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('opening artwork preparation', () => {
  it('deduplicates images and starts no more than the bounded number of decodes', async () => {
    const resolve = new Map<string, (image: object) => void>();
    let active = 0,
      maximum = 0;
    const load = vi.fn((url: string) => {
      active++;
      maximum = Math.max(maximum, active);
      return new Promise<object>((done) =>
        resolve.set(url, (resource) => {
          active--;
          done(resource);
        }),
      );
    });
    const cache = createAssetPreloader(load, { concurrency: 2 });
    const progress = vi.fn(),
      ready = cache.prepare(['one', 'two', 'one', 'three'], progress);
    await flush();
    expect(load.mock.calls.map(([url]) => url)).toEqual(['one', 'two']);
    resolve.get('one')!({ id: 'decoded-one' });
    await flush();
    expect(load.mock.calls.map(([url]) => url)).toEqual(['one', 'two', 'three']);
    resolve.get('two')!({ id: 'decoded-two' });
    resolve.get('three')!({ id: 'decoded-three' });
    expect(await ready).toEqual({ total: 3, failed: 0 });
    expect(maximum).toBe(2);
    expect(progress.mock.calls.map(([value]) => value.loaded)).toEqual([0, 1, 2, 3]);
  });

  it('retains the decoded resource identity and shares a pending image between preparations', async () => {
    let decode!: (image: object) => void;
    const image = { pixels: 'original decoded image fixture' },
      load = vi.fn(() => new Promise<object>((done) => (decode = done))),
      cache = createAssetPreloader(load),
      first = cache.prepare(['shared']),
      second = cache.prepare(['shared']);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.state('shared')).toBe('pending');
    expect(cache.resource('shared')).toBeUndefined();
    decode(image);
    await Promise.all([first, second]);
    expect(cache.resource('shared')).toBe(image);
    await cache.prepare(['shared']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('remembers failed artwork so revealing or preparing it again cannot start a late retry', async () => {
    const load = vi.fn(async () => {
        throw new Error('original unavailable image fixture');
      }),
      cache = createAssetPreloader(load);
    expect(await cache.prepare(['missing', 'missing'])).toEqual({ total: 1, failed: 1 });
    expect(cache.state('missing')).toBe('failed');
    expect(cache.resource('missing')).toBeUndefined();
    expect(await cache.prepare(['missing'])).toEqual({ total: 1, failed: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    cache.fail('render-failure');
    expect(await cache.prepare(['render-failure'])).toEqual({ total: 1, failed: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('bounds the entire queue deadline and ignores a late successful image after fallback', async () => {
    vi.useFakeTimers();
    let late!: (image: object) => void;
    const signals: AbortSignal[] = [],
      load = vi.fn((_url: string, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<object>((resolve) => (late = resolve));
      }),
      cache = createAssetPreloader(load, { concurrency: 1, deadlineMs: 6000 }),
      done = cache.prepare(['slow', 'queued']);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await done).toEqual({ total: 2, failed: 2 });
    expect(signals[0].aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    late({ pixels: 'too late' });
    await flush();
    expect(cache.state('slow')).toBe('failed');
    expect(cache.resource('slow')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('evicts old resources to a memory budget while protecting artwork still mounted in a reveal', async () => {
    const held = new Set<object>(),
      cache = createAssetPreloader(async (url) => ({ url }), {
        capacity: 2,
        retained: (resource) => held.has(resource),
      });
    await cache.prepare(['one']);
    const mounted = cache.resource('one')!;
    held.add(mounted);
    await cache.prepare(['two']);
    await cache.prepare(['three']);
    expect(cache.size).toBe(2);
    expect(cache.resource('one')).toBe(mounted);
    expect(cache.resource('two')).toBeUndefined();
    expect(cache.resource('three')).toEqual({ url: 'three' });
    held.delete(mounted);
    await cache.prepare(['four']);
    expect(cache.size).toBe(2);
    expect(cache.resource('one')).toBeUndefined();
  });

  it('prepares only validated provider references or the exact original demo atlas', () => {
    const art = {
      url: 'https://cdn.myanimelist.net/images/characters/1/original-fixture.jpg',
      sourceUrl: 'https://myanimelist.net/character/910000001',
      permission: 'Original fixture reference; no live requests',
    };
    expect(portraitAssetSource('10000000-0000-4000-8000-000000000001')).toBe(demoPortraitAtlas);
    expect(portraitAssetSource('10000000-0000-4000-8000-000000000012')).toBe(demoPortraitAtlas);
    expect(portraitAssetSource('10000000-0000-4000-8000-000000000013')).toBeNull();
    expect(portraitAssetSource(undefined, art)).toBe(art.url);
    expect(portraitAssetSource(undefined, { ...art, sourceUrl: 'javascript:alert(1)' })).toBeNull();
    expect(
      portraitAssetSource(undefined, { ...art, url: 'https://unrelated.example/image.jpg' }),
    ).toBeNull();
    expect(portraitAssetSource()).toBeNull();
  });
});
