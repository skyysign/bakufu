import type { Character } from '@card-engine/core';
import { providerArtworkSchema, providerArtworkUrl } from '../../../packages/importers/src/artwork';

export type AssetProgress = { loaded: number; total: number };
type AssetState = 'pending' | 'ready' | 'failed';
type Entry<T> = {
  state: AssetState;
  controller: AbortController;
  promise: Promise<'ready' | 'failed'>;
  finish: (state: 'ready' | 'failed', resource?: T) => void;
  resource?: T;
  active: boolean;
};

// A short-lived browser cache. It holds decoded resources, not player/realm IDs,
// and never writes to persistent storage or the server.
export function createAssetPreloader<T>(
  load: (url: string, signal: AbortSignal) => Promise<T>,
  {
    concurrency = 4,
    deadlineMs = 6000,
    capacity = 200,
    retained = () => false,
  }: {
    concurrency?: number;
    deadlineMs?: number;
    capacity?: number;
    retained?: (resource: T) => boolean;
  } = {},
) {
  const entries = new Map<string, Entry<T>>(),
    queue: { url: string; entry: Entry<T> }[] = [];
  let active = 0;
  function trim() {
    for (const [url, entry] of entries) {
      if (entries.size <= capacity) break;
      if (entry.state !== 'pending' && !(entry.resource && retained(entry.resource)))
        entries.delete(url);
    }
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift()!;
      if (job.entry.state !== 'pending') continue;
      active++;
      job.entry.active = true;
      Promise.resolve()
        .then(() => {
          if (job.entry.controller.signal.aborted) throw new Error('Preparation expired.');
          return load(job.url, job.entry.controller.signal);
        })
        .then(
          (resource) => job.entry.finish('ready', resource),
          () => job.entry.finish('failed'),
        );
    }
  }
  function entryFor(url: string) {
    const previous = entries.get(url);
    if (previous) {
      entries.delete(url);
      entries.set(url, previous);
      return previous;
    }
    let resolve!: (state: 'ready' | 'failed') => void;
    const controller = new AbortController();
    const entry: Entry<T> = {
      state: 'pending',
      controller,
      active: false,
      promise: new Promise((done) => (resolve = done)),
      finish(state, resource) {
        if (entry.state !== 'pending') return;
        entry.state = state;
        entry.resource = resource;
        controller.signal.removeEventListener('abort', abort);
        if (entry.active) {
          active--;
          entry.active = false;
        }
        resolve(state);
        trim();
        pump();
      },
    };
    const abort = () => entry.finish('failed');
    controller.signal.addEventListener('abort', abort, { once: true });
    entries.set(url, entry);
    queue.push({ url, entry });
    trim();
    pump();
    return entry;
  }
  return {
    async prepare(urls: string[], onProgress?: (progress: AssetProgress) => void) {
      const unique = [...new Set(urls)],
        jobs = unique.map(entryFor);
      let loaded = 0;
      onProgress?.({ loaded, total: unique.length });
      const deadline = setTimeout(() => {
        for (const entry of jobs) if (entry.state === 'pending') entry.controller.abort();
      }, deadlineMs);
      try {
        const states = await Promise.all(
          jobs.map(async (entry) => {
            const state = await entry.promise;
            loaded++;
            onProgress?.({ loaded, total: unique.length });
            return state;
          }),
        );
        return {
          total: unique.length,
          failed: states.filter((state) => state === 'failed').length,
        };
      } finally {
        clearTimeout(deadline);
        trim();
      }
    },
    state(url: string) {
      return entries.get(url)?.state;
    },
    resource(url: string) {
      const entry = entries.get(url);
      return entry?.state === 'ready' ? entry.resource : undefined;
    },
    fail(url: string) {
      const entry = entries.get(url);
      if (!entry)
        entries.set(url, {
          state: 'failed',
          controller: new AbortController(),
          promise: Promise.resolve('failed'),
          finish: () => undefined,
          active: false,
        });
      else if (entry.state === 'pending') entry.controller.abort();
      else {
        entry.state = 'failed';
        entry.resource = undefined;
      }
      trim();
    },
    trim,
    get size() {
      return entries.size;
    },
  };
}

export const demoPortraitAtlas = '/media/lantern-portraits.png';
export function portraitAssetSource(characterId?: string, artwork?: unknown): string | null {
  const allowed = providerArtworkSchema.safeParse(artwork);
  if (allowed.success) return providerArtworkUrl(allowed.data.url);
  const id = characterId?.toLowerCase();
  return id && /^10000000-0000-4000-8000-0000000000(?:0[1-9]|1[0-2])$/.test(id)
    ? demoPortraitAtlas
    : null;
}

function loadBrowserImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.loading = 'eager';
    image.fetchPriority = 'high';
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(image);
    }
    function abort() {
      finish(new Error('Image preparation timed out.'));
      image.removeAttribute('src');
    }
    image.onload = () => {
      if (!image.naturalWidth) finish(new Error('Image has no pixels.'));
      else
        void image.decode().then(
          () => finish(),
          () => finish(new Error('Image decoding failed.')),
        );
    };
    image.onerror = () => finish(new Error('Image unavailable.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else image.src = url;
  });
}

const heldImages = new WeakMap<HTMLImageElement, number>();
const images = createAssetPreloader(loadBrowserImage, {
  retained: (image) => image.isConnected || (heldImages.get(image) ?? 0) > 0,
});
export const preparedArtworkState = (url: string) => images.state(url);
export const preparedArtworkImage = (url: string) => images.resource(url);
export function artworkFailed(url: string) {
  // An unrelated ordinary image request must not discard a decoded resource or
  // cancel the preparation request that owns its own error/timeout handling.
  if (!images.state(url)) images.fail(url);
}
export function holdPreparedArtwork(image: HTMLImageElement) {
  heldImages.set(image, (heldImages.get(image) ?? 0) + 1);
  return () => {
    heldImages.set(image, Math.max(0, (heldImages.get(image) ?? 0) - 1));
    images.trim();
  };
}

let rareVideo: HTMLVideoElement | undefined;
export async function prepareOpeningArtwork(
  characters: Character[],
  onProgress?: (progress: AssetProgress) => void,
) {
  // HTMLImageElement and video access happen only after a client-side opening.
  const urls = characters
    .map((character) => portraitAssetSource(character.id, character.artwork))
    .filter((url): url is string => !!url);
  if (
    characters.some((character) => ['rare', 'epic', 'legendary'].includes(character.tier)) &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !rareVideo
  ) {
    rareVideo = document.createElement('video');
    rareVideo.preload = 'auto';
    rareVideo.muted = true;
    rareVideo.playsInline = true;
    rareVideo.src = '/media/rare-reveal.webm';
    rareVideo.load();
  }
  return images.prepare(urls, onProgress);
}
