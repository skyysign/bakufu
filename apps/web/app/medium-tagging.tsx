'use client';
import { useEffect, useRef, useState } from 'react';
import type { JikanApiResult } from '../../../packages/importers/src/jikan';
import { jikanPacing } from '../../../packages/importers/src/jikan-pacing';
import { jikanMediumInfo, type JikanMedium } from '../../../packages/importers/src/media';
import { post } from './api-client';
import { MediumPicker, malMediumOptions } from './medium-picker';

/** Pages of a kind in a row without any match before that kind stops (25 series each). */
const missLimit = 20;

/**
 * Administration → Characters → Tag series by medium (MyAnimeList realms).
 * Characters imported before medium packs carry no Anime/Manga/… category.
 * This reads MyAnimeList's popular series lists (series titles only, 25 per
 * request) and tags every realm series whose title matches, so Anime, Manga
 * or Manhwa packs can be added under Packs.
 */
export function MediumTagging({
  realmId,
  service,
  consent,
  untaggedSeries,
  seriesCount,
  disabled,
  onBusyChange,
  onTagged,
}: {
  realmId: string;
  service: 'tenrai' | 'jikan';
  consent: boolean;
  untaggedSeries: number;
  seriesCount: number;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onTagged: () => void;
}) {
  const [media, setMedia] = useState<JikanMedium[]>(['anime', 'manga']),
    [busy, setBusy] = useState(false),
    [remaining, setRemaining] = useState(untaggedSeries),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const stopped = useRef(false),
    mounted = useRef(true),
    lastRequest = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopped.current = true;
    };
  }, []);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(() => setRemaining(untaggedSeries), [untaggedSeries]);

  async function run() {
    stopped.current = false;
    setBusy(true);
    setError('');
    const pages = Object.fromEntries(media.map((kind) => [kind, 0])) as Record<JikanMedium, number>,
      misses = { ...pages },
      open = new Set(media);
    let tagged = 0,
      left = remaining;
    try {
      while (open.size && left > 0) {
        for (const kind of [...open]) {
          if (stopped.current) throw new Error('stopped');
          const wait = Math.max(
            0,
            jikanPacing[service].delayMs - (performance.now() - lastRequest.current),
          );
          if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
          lastRequest.current = performance.now();
          pages[kind]++;
          const result = (await post('catalog/provider', {
            provider: 'jikan-api',
            service,
            medium: kind,
            revision: 'realm-medium-tags-1',
            providerConsent: true,
            termsConfirmed: true,
            step: 'works',
            page: pages[kind],
          })) as JikanApiResult;
          if (result.kind !== 'works') throw new Error('Unsupported provider response.');
          const tags = result.works.flatMap((work) =>
            jikanMediumInfo[kind].categories.map((category) => ({ series: work.title, category })),
          );
          if (tags.length) {
            const saved = (await post('realm-characters/series-tags', { realmId, tags })) as {
              seriesTagged: number;
              untaggedSeries: number;
            };
            tagged += saved.seriesTagged;
            left = saved.untaggedSeries;
            misses[kind] = saved.seriesTagged ? 0 : misses[kind] + 1;
            if (saved.seriesTagged) onTagged();
          } else misses[kind]++;
          if (!result.hasNextPage || misses[kind] >= missLimit) open.delete(kind);
          if (!mounted.current) return;
          setRemaining(left);
          setMessage(
            `${tagged.toLocaleString()} series tagged · ${left.toLocaleString()} still without a medium.`,
          );
          if (left <= 0) break;
        }
      }
      if (!mounted.current) return;
      setMessage(
        left <= 0
          ? `Done: every series has a medium (${tagged.toLocaleString()} tagged).`
          : `${tagged.toLocaleString()} series tagged. ${left.toLocaleString()} series weren't found in the popular lists of the chosen kinds.`,
      );
    } catch (failure) {
      if (!mounted.current) return;
      if ((failure as Error).message === 'stopped')
        setMessage(`Paused after ${tagged.toLocaleString()} series. Tags so far are saved.`);
      else setError((failure as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="artwork-backfill" aria-labelledby="medium-tagging-title">
      <h3 id="medium-tagging-title">Tag series by medium</h3>
      <p className="field-help">
        New imports tag every series as Anime, Manga, Manhwa and so on, so you can add a pack per
        medium under Packs. Characters imported earlier have no medium yet:{' '}
        {remaining.toLocaleString()} of {seriesCount.toLocaleString()} series. This reads
        MyAnimeList&apos;s popular series lists of the chosen kinds (titles only, 25 per request)
        and tags every series whose title matches.
      </p>
      <MediumPicker
        name="tagging-medium"
        legend="Look in"
        options={malMediumOptions}
        value={media}
        disabled={disabled || busy}
        onChange={setMedia}
      />
      <div className="collection-admin-buttons">
        {busy ? (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              stopped.current = true;
            }}
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled || !consent || remaining === 0}
            onClick={() => void run()}
          >
            {remaining === 0 ? 'Every series has a medium' : 'Tag series'}
          </button>
        )}
      </div>
      {!consent && remaining > 0 && (
        <p className="field-help">Confirm the lookup above (provider use) to start.</p>
      )}
      {message && (
        <p className="field-help" role="status">
          {message}
        </p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
    </section>
  );
}
