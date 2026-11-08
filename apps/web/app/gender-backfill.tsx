'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealmGenderGaps } from '@card-engine/db';
import type { JikanApiResult } from '../../../packages/importers/src/jikan';
import { jikanPacing } from '../../../packages/importers/src/jikan-pacing';
import { post } from './api-client';

type Result = { sourceKey: string; gender: 'female' | 'male' | null };
function duration(seconds: number) {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds / 60))} minute`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} minutes` : `${(minutes / 60).toFixed(1)} hours`;
}

/**
 * "Waifus & husbandos" for MyAnimeList realms. MyAnimeList has no gender
 * field, so each character's profile is read once (paced, most popular first)
 * and only the detected gender is kept: it adds the Female or Male category,
 * which the Waifus and Husbandos packs draw from.
 */
export function GenderBackfill({
  realmId,
  service,
  consent,
  disabled,
  onBusyChange,
}: {
  realmId: string;
  service: 'tenrai' | 'jikan';
  consent: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [gaps, setGaps] = useState<RealmGenderGaps | null>(null),
    [running, setRunning] = useState(false),
    [checked, setChecked] = useState(0),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const stopped = useRef(false),
    mounted = useRef(true);
  const load = useCallback(async () => {
    const response = await fetch(`/api/realm-characters/genders?realmId=${encodeURIComponent(realmId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not check characters.');
    if (mounted.current) setGaps(body as RealmGenderGaps);
    return body as RealmGenderGaps;
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

  async function flush(pending: Result[]) {
    while (pending.length)
      await post('realm-characters/genders', {
        realmId,
        genders: pending.splice(0, 200),
        rightsConfirmed: true,
      });
  }
  async function run() {
    if (!gaps || running || !consent) return;
    stopped.current = false;
    setRunning(true);
    setError('');
    setMessage('');
    setChecked(0);
    const pending: Result[] = [];
    let last = 0,
      done = 0;
    try {
      const queue = (await load()).pending;
      for (const sourceKey of queue) {
        if (stopped.current || !mounted.current) break;
        const wait = Math.max(0, jikanPacing[service].delayMs - (performance.now() - last));
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        if (stopped.current) break;
        last = performance.now();
        const result = (await post('catalog/provider', {
          provider: 'jikan-api',
          service,
          medium: 'anime',
          revision: 'gender-profile-1',
          providerConsent: true,
          termsConfirmed: true,
          step: 'profile',
          characterId: Number(sourceKey.split(':')[1]),
        })) as JikanApiResult;
        if (result.kind !== 'profile') throw new Error('Unsupported provider response.');
        pending.push({ sourceKey, gender: result.gender });
        done++;
        if (pending.length >= 25) await flush(pending);
        if (mounted.current) setChecked(done);
      }
      await flush(pending);
      if (mounted.current)
        setMessage(stopped.current ? 'Paused. Start again any time to continue.' : 'All characters checked.');
    } catch (failure) {
      await flush(pending).catch(() => {});
      if (mounted.current)
        setError(`${(failure as Error).message} Checked characters are saved; start again to continue.`);
    } finally {
      if (mounted.current) {
        setRunning(false);
        await load().catch(() => {});
        router.refresh();
      }
    }
  }
  async function createPacks() {
    if (!gaps) return;
    setError('');
    setMessage('');
    try {
      const packs = [
        ...(gaps.female ? [{ category: 'Female', name: 'Waifus' }] : []),
        ...(gaps.male ? [{ category: 'Male', name: 'Husbandos' }] : []),
      ];
      const result = (await post('realm-packs', { realmId, packs })) as {
        added: unknown[];
        alreadyPresent: number;
      };
      setMessage(
        result.added.length
          ? 'Waifus and Husbandos packs are live. Players can open them now.'
          : 'Those packs were already live.',
      );
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  const remaining = gaps.pending.length;
  return (
    <section className="artwork-backfill" aria-labelledby="gender-backfill-title">
      <h3 id="gender-backfill-title">Waifus &amp; husbandos</h3>
      <p className="field-help">
        MyAnimeList has no gender field, so this reads each character&apos;s profile once and
        keeps only the result (an explicit “Gender:” line, or clearly agreeing he/she pronouns;
        otherwise unknown). Most popular characters go first; detected characters get the Female
        or Male category for the Waifus and Husbandos packs.
      </p>
      <p className="artwork-backfill-progress" role="status">
        {gaps.female.toLocaleString()} waifus · {gaps.male.toLocaleString()} husbandos found
        {remaining > 0 &&
          ` · ${remaining.toLocaleString()} characters not checked yet (about ${duration((remaining * jikanPacing[service].delayMs) / 1000)})`}
        {running && ` · checking… ${checked.toLocaleString()} done`}
      </p>
      <div className="artwork-backfill-row">
        {running ? (
          <button type="button" className="secondary" onClick={() => (stopped.current = true)}>
            Pause
          </button>
        ) : (
          remaining > 0 && (
            <button type="button" disabled={!consent || disabled} onClick={() => void run()}>
              {checked > 0 ? 'Continue detecting' : 'Detect waifus & husbandos'}
            </button>
          )
        )}
        <button
          type="button"
          className="secondary"
          disabled={running || disabled || (!gaps.female && !gaps.male)}
          onClick={() => void createPacks()}
        >
          Create Waifus &amp; Husbandos packs
        </button>
      </div>
      {!consent && remaining > 0 && (
        <p className="field-help">Confirm the lookup in step 1 above first.</p>
      )}
      {message && <p className="success-note">{message}</p>}
      <p className="error" role="alert">
        {error}
      </p>
    </section>
  );
}
