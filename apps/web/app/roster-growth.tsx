'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RealmCharacterAddition, RealmCharacterCheck } from '@card-engine/db';
import {
  applyJikanWorks,
  jikanSeedLimits,
  mergeJikanCharacters,
  newJikanSeed,
  nextJikanStep,
  type JikanMedium,
  type JikanSeedState,
} from '../../../packages/importers/src/jikan-state';
import type { JikanApiResult } from '../../../packages/importers/src/jikan';
import { jikanPacing } from '../../../packages/importers/src/jikan-pacing';
import { post } from './api-client';
import { MediumPicker, malMediumOptions } from './medium-picker';

const growthStops = [50, 100, 250, 500, 1000, 1500, 2000, 3000, 5000, 7500, 10000];
const perSeriesChoices = [10, 15, 25, 50, 100];
/** The realm services accept at most 200 characters per check or addition. */
const batchSize = 200;

/**
 * Administration → Characters → Grow the roster (MyAnimeList realms). Walks
 * the most popular series of the chosen kinds, like the realm wizard, and adds
 * only characters the realm doesn't have yet: new series, and more of a
 * series' cast when the per-series count is higher than before. Each batch is
 * saved as it goes, so stopping keeps what was added.
 */
export function RosterGrowth({
  realmId,
  service,
  consent,
  permission,
  disabled,
  onBusyChange,
  onAdded,
}: {
  realmId: string;
  service: 'tenrai' | 'jikan';
  consent: boolean;
  /** Artwork permission statement; empty means no artwork. */
  permission: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAdded: () => void;
}) {
  const [media, setMedia] = useState<JikanMedium[]>(['anime']),
    [goal, setGoal] = useState(500),
    [goalText, setGoalText] = useState('500'),
    [perWork, setPerWork] = useState(25),
    [busy, setBusy] = useState(false),
    [added, setAdded] = useState(0),
    [checkedSeries, setCheckedSeries] = useState(0),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [seed, setSeed] = useState<JikanSeedState | null>(null);
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

  function restart() {
    setSeed(null);
    setAdded(0);
    setCheckedSeries(0);
    setMessage('');
  }
  async function step(medium: JikanMedium, input: Record<string, unknown>) {
    const wait = Math.max(
      0,
      jikanPacing[service].delayMs - (performance.now() - lastRequest.current),
    );
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    if (stopped.current) throw new Error('stopped');
    lastRequest.current = performance.now();
    return (await post('catalog/provider', {
      provider: 'jikan-api',
      service,
      medium,
      revision: 'realm-growth-1',
      providerConsent: true,
      termsConfirmed: true,
      ...input,
    })) as JikanApiResult;
  }
  async function run() {
    stopped.current = false;
    setBusy(true);
    setError('');
    // A walk without a character target: it ends when enough new characters were added.
    let current = seed ?? newJikanSeed(media, jikanSeedLimits.maxTarget, service, perWork),
      total = seed ? added : 0,
      series = seed ? checkedSeries : 0;
    try {
      for (let next = nextJikanStep(current); next && total < goal; next = nextJikanStep(current)) {
        if (next.step === 'works') {
          const result = await step(next.medium, { step: 'works', page: next.page });
          if (result.kind !== 'works') throw new Error('Unsupported provider response.');
          current = applyJikanWorks(current, next.medium, result);
        } else {
          const result = await step(next.medium, {
            step: 'characters',
            work: next.work,
            perWork: current.perWork,
            ...(permission ? { artworkPermission: permission } : {}),
          });
          if (result.kind !== 'characters') throw new Error('Unsupported provider response.');
          const seen = new Set(current.catalog.characters.map((c) => c.sourceKey));
          current = mergeJikanCharacters(current, { ...result, medium: next.medium });
          series++;
          const fresh = result.catalog.characters.filter((c) => !seen.has(c.sourceKey));
          for (let start = 0; start < fresh.length && total < goal; start += batchSize) {
            const batch = fresh.slice(start, start + batchSize);
            const checked = (await post('realm-characters/check', {
              realmId,
              characters: batch.map((c) => ({ sourceKey: c.sourceKey, popularity: c.popularity })),
            })) as RealmCharacterCheck;
            const present = new Set(
              checked.results.filter((item) => item.present).map((item) => item.sourceKey),
            );
            const missing = batch.filter((c) => !present.has(c.sourceKey)).slice(0, goal - total);
            if (!missing.length) continue;
            const saved = (await post('realm-characters', {
              realmId,
              characters: missing,
              rightsConfirmed: true,
            })) as RealmCharacterAddition;
            total += saved.added.length;
            onAdded();
          }
        }
        if (!mounted.current) return;
        setSeed(current);
        setAdded(total);
        setCheckedSeries(series);
        setMessage(
          `Added ${total.toLocaleString()} of ${goal.toLocaleString()} characters · ${series.toLocaleString()} series checked.`,
        );
      }
      if (!mounted.current) return;
      setSeed(null);
      setMessage(
        total >= goal
          ? `Done: ${total.toLocaleString()} characters added from ${series.toLocaleString()} series.`
          : `No more series to walk: ${total.toLocaleString()} characters added.`,
      );
    } catch (failure) {
      if (!mounted.current) return;
      setSeed(current);
      setAdded(total);
      setCheckedSeries(series);
      if ((failure as Error).message === 'stopped')
        setMessage(
          `Paused after ${total.toLocaleString()} characters. Everything added so far is saved.`,
        );
      else setError((failure as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const stopIndex = growthStops.reduce(
    (best, stop, index) =>
      Math.abs(stop - goal) < Math.abs(growthStops[best] - goal) ? index : best,
    0,
  );
  const locked = disabled || busy;
  return (
    <section className="artwork-backfill roster-growth" aria-labelledby="roster-growth-title">
      <h3 id="roster-growth-title">Grow the roster</h3>
      <p className="field-help">
        Walks the most popular series like the realm wizard and adds characters this realm
        doesn&apos;t have yet: new series, and more of each series&apos; cast when you choose more
        characters per series than before. Rarity follows the realm&apos;s ranking and fame floors.
        Uses the lookup setup above (service, permission and artwork).
      </p>
      <MediumPicker
        name="growth-medium"
        legend="Kinds of series"
        options={malMediumOptions}
        value={media}
        disabled={locked}
        onChange={(next) => {
          setMedia(next);
          restart();
        }}
      />
      <div className="provider-grid">
        <div className="roster-size">
          <div className="roster-size-head">
            <label htmlFor="growth-goal">Characters to add</label>
            <span className="unit-input roster-size-number">
              <input
                type="number"
                aria-label="Exact number of characters to add"
                min={1}
                max={growthStops[growthStops.length - 1]}
                value={goalText}
                disabled={locked}
                onChange={(event) => {
                  setGoalText(event.target.value);
                  const next = Number(event.target.value);
                  if (Number.isInteger(next) && next >= 1 && next <= 10000) {
                    setGoal(next);
                    restart();
                  }
                }}
                onBlur={() => setGoalText(String(goal))}
              />
              <span className="unit-input-unit" aria-hidden="true">
                characters
              </span>
            </span>
          </div>
          <input
            id="growth-goal"
            type="range"
            min={0}
            max={growthStops.length - 1}
            step={1}
            value={stopIndex}
            disabled={locked}
            aria-valuetext={`${goal.toLocaleString()} characters`}
            style={
              { '--fill': `${(stopIndex / (growthStops.length - 1)) * 100}%` } as CSSProperties
            }
            onChange={(event) => {
              const next = growthStops[Number(event.target.value)];
              setGoal(next);
              setGoalText(String(next));
              restart();
            }}
          />
        </div>
        <div>
          <label htmlFor="growth-per-series">Characters per series</label>
          <select
            id="growth-per-series"
            value={perWork}
            disabled={locked}
            onChange={(event) => {
              setPerWork(Number(event.target.value));
              restart();
            }}
          >
            {perSeriesChoices.map((size) => (
              <option key={size} value={size}>
                Up to {size}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!consent && <p className="field-help">Confirm the lookup above (provider use) to start.</p>}
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
          <button type="button" disabled={locked || !consent} onClick={() => void run()}>
            {seed ? 'Resume' : `Add up to ${goal.toLocaleString()} characters`}
          </button>
        )}
      </div>
      {(busy || added > 0) && (
        <progress max={goal} value={added} aria-label="Characters added">
          {added} of {goal}
        </progress>
      )}
      {message && (
        <p className="field-help" role="status">
          {message}
          {!busy &&
            added > 0 &&
            ' New characters join All Characters and the packs of their genres right away. Run “Detect genders” below to add them to Waifus/Husbandos packs.'}
        </p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
    </section>
  );
}
