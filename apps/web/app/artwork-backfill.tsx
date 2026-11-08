'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealmArtworkGaps } from '@card-engine/db';
import {
  applyJikanWorks,
  mergeJikanCharacters,
  newJikanSeed,
  nextJikanStep,
  type JikanMedium,
  type JikanSeedState,
} from '../../../packages/importers/src/jikan-state';
import type { JikanApiResult } from '../../../packages/importers/src/jikan';
import { jikanPacing } from '../../../packages/importers/src/jikan-pacing';
import { post } from './api-client';

/** Series in a row without a single match before the walk gives up. */
const patience = 80;
type Match = { sourceKey: string; artwork: Record<string, unknown> };

/**
 * Adds artwork to characters already in a MyAnimeList realm (for realms created
 * without the artwork opt-in). Walks the most popular series again with artwork
 * enabled, paced like realm creation, and stores matches by stable source key.
 */
export function ArtworkBackfill({
  realmId,
  service,
  consent,
  permission,
  disabled,
  onBusyChange,
}: {
  realmId: string;
  service: 'tenrai' | 'jikan';
  consent: boolean;
  permission: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [gaps, setGaps] = useState<RealmArtworkGaps | null>(null),
    [medium, setMedium] = useState<JikanMedium | 'both'>('anime'),
    [running, setRunning] = useState(false),
    [progress, setProgress] = useState({ matched: 0, series: 0 }),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const stopped = useRef(false),
    mounted = useRef(true),
    resume = useRef<{ seed: JikanSeedState; missing: Set<string>; quiet: number } | null>(null);
  const load = useCallback(async () => {
    const response = await fetch(`/api/realm-characters/artwork?realmId=${encodeURIComponent(realmId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not check artwork.');
    if (mounted.current) setGaps(body as RealmArtworkGaps);
  }, [realmId]);
  useEffect(() => {
    mounted.current = true;
    void load().catch((failure) => setError((failure as Error).message));
    return () => {
      mounted.current = false;
      stopped.current = true;
    };
  }, [load]);
  useEffect(() => onBusyChange(running), [running, onBusyChange]);

  if (!gaps || !gaps.canFetch) return null;
  const ready = consent && !!permission.trim();
  async function flush(pending: Match[]) {
    while (pending.length) {
      const batch = pending.splice(0, 500);
      await post('realm-characters/artwork', { realmId, artwork: batch, rightsConfirmed: true });
    }
  }
  async function run(fresh: boolean) {
    if (!gaps || running || !ready) return;
    stopped.current = false;
    setRunning(true);
    setError('');
    const state =
      !fresh && resume.current
        ? resume.current
        : {
            seed: newJikanSeed(medium, 100000, service, 50),
            missing: new Set(gaps.missing),
            quiet: 0,
          };
    resume.current = state;
    if (fresh) setProgress({ matched: 0, series: 0 });
    const pending: Match[] = [];
    let last = 0;
    const call = async (input: Record<string, unknown>, stepMedium: JikanMedium) => {
      const wait = Math.max(0, jikanPacing[service].delayMs - (performance.now() - last));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (stopped.current) throw new Error('Paused.');
      last = performance.now();
      return (await post('catalog/provider', {
        provider: 'jikan-api',
        service,
        medium: stepMedium,
        revision: 'artwork-backfill-1',
        providerConsent: true,
        termsConfirmed: true,
        ...input,
      })) as JikanApiResult;
    };
    try {
      for (
        let next = nextJikanStep(state.seed);
        next && state.missing.size && state.quiet < patience && !stopped.current;
        next = nextJikanStep(state.seed)
      ) {
        if (next.step === 'works') {
          const result = await call({ step: 'works', page: next.page }, next.medium);
          if (result.kind !== 'works') throw new Error('Unsupported provider response.');
          state.seed = applyJikanWorks(state.seed, next.medium, result);
          continue;
        }
        const result = await call(
          { step: 'characters', work: next.work, perWork: 50, artworkPermission: permission.trim() },
          next.medium,
        );
        if (result.kind !== 'characters') throw new Error('Unsupported provider response.');
        state.seed = mergeJikanCharacters(state.seed, { ...result, medium: next.medium });
        let found = 0;
        for (const character of result.catalog.characters)
          if (state.missing.has(character.sourceKey) && character.artwork) {
            state.missing.delete(character.sourceKey);
            pending.push({ sourceKey: character.sourceKey, artwork: character.artwork });
            found++;
          }
        state.quiet = found ? 0 : state.quiet + 1;
        if (pending.length >= 100) await flush(pending);
        if (!mounted.current) return;
        setProgress((current) => ({ matched: current.matched + found, series: current.series + 1 }));
      }
      await flush(pending);
      if (!mounted.current) return;
      const left = state.missing.size;
      setMessage(
        left === 0
          ? 'Every character now has artwork.'
          : state.quiet >= patience
            ? `Finished: the next ${patience} popular series had no more matches. ${left.toLocaleString()} characters still have no artwork; they probably come from less popular series.`
            : stopped.current
              ? `Paused. ${left.toLocaleString()} characters still need artwork. Resume any time.`
              : `Finished. ${left.toLocaleString()} characters were not found in the popular series list.`,
      );
      if (left === 0 || state.quiet >= patience || !stopped.current) resume.current = null;
    } catch (failure) {
      await flush(pending).catch(() => {});
      if (mounted.current)
        setError(
          stopped.current
            ? ''
            : `${(failure as Error).message} Progress is saved; select Resume to continue.`,
        );
      if (mounted.current && stopped.current)
        setMessage(`Paused. ${state.missing.size.toLocaleString()} characters still need artwork.`);
    } finally {
      if (mounted.current) {
        setRunning(false);
        await load().catch(() => {});
        router.refresh();
      }
    }
  }
  const missing = gaps.missing.length;
  return (
    <section className="artwork-backfill" aria-labelledby="artwork-backfill-title">
      <h3 id="artwork-backfill-title">Add artwork to existing characters</h3>
      <p className="field-help">
        {missing === 0
          ? 'Every character in this realm already has artwork.'
          : `${missing.toLocaleString()} of ${gaps.characterCount.toLocaleString()} characters have no picture. This walks the most popular MyAnimeList series again with artwork enabled and adds pictures to matching characters; names, rarity and collections stay the same.`}
      </p>
      {missing > 0 && (
        <>
          <div className="artwork-backfill-row">
            <label htmlFor="artwork-backfill-medium">Walk popular</label>
            <select
              id="artwork-backfill-medium"
              value={medium}
              disabled={running || disabled}
              onChange={(event) => {
                setMedium(event.target.value as JikanMedium | 'both');
                resume.current = null;
              }}
            >
              <option value="anime">Anime</option>
              <option value="manga">Manga</option>
              <option value="both">Anime and manga</option>
            </select>
            {running ? (
              <button type="button" className="secondary" onClick={() => (stopped.current = true)}>
                Pause
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!ready || disabled}
                  onClick={() => void run(true)}
                >
                  Fetch missing artwork
                </button>
                {resume.current && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={!ready || disabled}
                    onClick={() => void run(false)}
                  >
                    Resume
                  </button>
                )}
              </>
            )}
          </div>
          {!ready && (
            <p className="field-help">
              In step 1 above, confirm the lookup and tick{' '}
              <strong>Include character artwork through API, permission needed</strong> with your
              permission statement.
            </p>
          )}
        </>
      )}
      {(running || progress.series > 0) && (
        <p role="status" className="artwork-backfill-progress">
          {running ? 'Working… ' : ''}
          {progress.matched.toLocaleString()} pictures added from {progress.series.toLocaleString()}{' '}
          series. Keep this page open; requests are paced like realm creation.
        </p>
      )}
      {message && <p className="success-note">{message}</p>}
      <p className="error" role="alert">
        {error}
      </p>
    </section>
  );
}
