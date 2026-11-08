'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  jikanSeedLimits,
  applyJikanWorks,
  mergeJikanCharacters,
  newJikanSeed,
  nextJikanStep,
  type JikanMedium,
  type JikanQueuedWork,
  type JikanSeedState,
} from '../../../packages/importers/src/jikan-state';
import type {
  CharacterGender,
  JikanApiResult,
  JikanWork,
} from '../../../packages/importers/src/jikan';
import { jikanPacing } from '../../../packages/importers/src/jikan-pacing';

type Props = {
  onStart: () => void;
  onEdit: () => void;
  onLoaded: (data: unknown) => void;
  onFailure: (message: string) => void;
};
type Medium = JikanMedium | 'both';
/** Slider stops: fine steps for small rosters, coarse steps for huge ones. */
const rosterStops = [
  100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7500, 10000, 12500, 15000,
  20000, 25000, 30000, 40000, 50000, 60000, 75000, 100000,
].filter((value) => value <= jikanSeedLimits.maxTarget);
const minimumRoster = 50;
const perSeriesChoices = [10, 15, 25, 50];
function nearestStop(value: number) {
  let best = 0;
  rosterStops.forEach((stop, index) => {
    if (Math.abs(stop - value) < Math.abs(rosterStops[best] - value)) best = index;
  });
  return best;
}
function duration(minutes: number) {
  if (minutes < 1.5) return '1 minute';
  if (minutes < 90) return `${Math.round(minutes)} minutes`;
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hours`;
}

export function CatalogJikan({ onStart, onEdit, onLoaded, onFailure }: Props) {
  const [medium, setMedium] = useState<Medium>('anime'),
    [browseMedium, setBrowseMedium] = useState<JikanMedium>('anime'),
    [service, setService] = useState<'tenrai' | 'jikan'>('tenrai'),
    [consent, setConsent] = useState(false),
    [artwork, setArtwork] = useState(false),
    [permission, setPermission] = useState(''),
    [target, setTarget] = useState(1000),
    [targetText, setTargetText] = useState('1000'),
    [perWork, setPerWork] = useState(25),
    [detectGender, setDetectGender] = useState(true),
    [query, setQuery] = useState(''),
    [works, setWorks] = useState<JikanWork[]>([]),
    [selected, setSelected] = useState<JikanQueuedWork[]>([]),
    [page, setPage] = useState(0),
    [hasNext, setHasNext] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [seed, setSeed] = useState<JikanSeedState>(() => newJikanSeed('anime', 1000, 'tenrai', 25));
  const mounted = useRef(true),
    stopped = useRef(false),
    controller = useRef<AbortController | null>(null),
    lastRequest = useRef(0),
    // Detected genders by source key (Waifus/Husbandos); kept across pause/resume.
    genders = useRef(new Map<string, CharacterGender | null>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopped.current = true;
      controller.current?.abort();
    };
  }, []);
  async function step(
    stepMedium: JikanMedium,
    input: Record<string, unknown>,
  ): Promise<JikanApiResult> {
    const remaining = Math.max(
      0,
      jikanPacing[service].delayMs - (performance.now() - lastRequest.current),
    );
    if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
    if (stopped.current) throw new Error('Preparation paused. Resume when ready.');
    controller.current = new AbortController();
    lastRequest.current = performance.now();
    const response = await fetch('/api/catalog/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.current.signal,
        body: JSON.stringify({
          provider: 'jikan-api',
          service,
          medium: stepMedium,
          revision: 'selected-api-1',
          providerConsent: consent,
          termsConfirmed: consent,
          ...input,
        }),
      }),
      result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'The provider could not return this page.');
    return result as JikanApiResult;
  }
  function freshSeed(nextMedium = medium, nextTarget = target, nextPerWork = perWork) {
    return newJikanSeed(nextMedium, nextTarget, service, nextPerWork);
  }
  async function browse(nextPage: number) {
    stopped.current = false;
    setBusy(true);
    setMessage(`Loading a page from ${service === 'tenrai' ? 'Tenrai' : 'Jikan'}…`);
    try {
      const result = await step(browseMedium, {
        step: 'works',
        page: nextPage,
        ...(query.trim() ? { query: query.trim() } : {}),
      });
      if (result.kind !== 'works') throw new Error('Unsupported provider response.');
      if (mounted.current) {
        setWorks(result.works);
        setPage(result.page);
        setHasNext(result.hasNextPage);
        setMessage('Choose series below, or prepare a popular roster.');
      }
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'Could not browse the provider.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function prepare(mode: 'popular' | 'selected' | 'resume') {
    stopped.current = false;
    setBusy(true);
    onStart();
    let current: JikanSeedState =
      mode === 'resume'
        ? seed
        : mode === 'selected'
          ? {
              ...freshSeed(),
              // Selected series only: no popular pages are requested.
              cursors: Object.fromEntries(
                (medium === 'both' ? (['anime', 'manga'] as const) : [medium]).map((value) => [
                  value,
                  { page: 0, hasNextPage: false },
                ]),
              ),
              queue: selected,
            }
          : freshSeed();
    setSeed(current);
    try {
      for (let next = nextJikanStep(current); next && !stopped.current; next = nextJikanStep(current)) {
        if (next.step === 'works') {
          const result = await step(next.medium, { step: 'works', page: next.page });
          if (result.kind !== 'works') throw new Error('Unsupported provider response.');
          current = applyJikanWorks(current, next.medium, result);
        } else {
          const result = await step(next.medium, {
            step: 'characters',
            work: next.work,
            perWork: current.perWork,
            ...(artwork ? { artworkPermission: permission.trim() } : {}),
          });
          if (result.kind !== 'characters') throw new Error('Unsupported provider response.');
          current = mergeJikanCharacters(current, { ...result, medium: next.medium });
          if (detectGender)
            await checkGenders(
              current,
              result.catalog.characters.map((character) => character.sourceKey),
              next.medium,
            );
        }
        if (!mounted.current) return;
        setSeed(current);
        setMessage(
          `${current.catalog.characters.length.toLocaleString()} / ${current.target.toLocaleString()} characters prepared from ${current.completed.length.toLocaleString()} series.`,
        );
      }
      if (!mounted.current) return;
      // Characters skipped by an earlier pause are checked before review.
      if (detectGender && !stopped.current)
        await checkGenders(
          current,
          current.catalog.characters.map((character) => character.sourceKey),
          'anime',
        );
      if (!mounted.current) return;
      if (current.catalog.characters.length) onLoaded(withGenders(current.catalog));
      else onFailure('No characters were available from this selection. Choose other series.');
      setMessage(
        `${current.catalog.characters.length.toLocaleString()} characters ready for review${current.catalog.characters.length === current.target ? '.' : '; this is a partial selection.'}`,
      );
    } catch (error) {
      if (!mounted.current) return;
      const reason = stopped.current
        ? 'Preparation paused.'
        : error instanceof Error
          ? error.message
          : 'Preparation paused.';
      setMessage(
        `${reason} ${current.catalog.characters.length.toLocaleString()} characters retained. Resume or download this selection.`,
      );
      if (current.catalog.characters.length) onLoaded(withGenders(current.catalog));
      else onFailure(reason);
    } finally {
      if (mounted.current) {
        setSeed(current);
        setBusy(false);
      }
    }
  }
  /** One profile lookup per new character in the roster; only the gender is kept. */
  async function checkGenders(current: JikanSeedState, keys: string[], stepMedium: JikanMedium) {
    const included = new Set(current.catalog.characters.map((character) => character.sourceKey));
    for (const key of keys) {
      if (stopped.current || !mounted.current) return;
      if (!included.has(key) || genders.current.has(key)) continue;
      const result = await step(stepMedium, {
        step: 'profile',
        characterId: Number(key.split(':')[1]),
      });
      if (result.kind !== 'profile') throw new Error('Unsupported provider response.');
      genders.current.set(key, result.gender);
      if (mounted.current)
        setMessage(
          `${current.catalog.characters.length.toLocaleString()} / ${current.target.toLocaleString()} characters prepared · ${genders.current.size.toLocaleString()} checked for waifus & husbandos.`,
        );
    }
  }
  /** Adds the Female/Male category (Waifus/Husbandos packs) to detected characters. */
  function withGenders(catalog: JikanSeedState['catalog']): JikanSeedState['catalog'] {
    return {
      ...catalog,
      characters: catalog.characters.map((character) => {
        const gender = genders.current.get(character.sourceKey);
        const category = gender === 'female' ? 'Female' : gender === 'male' ? 'Male' : null;
        return category && !character.categories.includes(category)
          ? { ...character, categories: [category, ...character.categories].slice(0, 20) }
          : character;
      }),
    };
  }
  function reset(nextMedium = medium, nextTarget = target, nextPerWork = perWork) {
    genders.current = new Map();
    setSeed(freshSeed(nextMedium, nextTarget, nextPerWork));
    setMessage('');
    onEdit();
  }
  function download() {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(withGenders(seed.catalog), null, 2)], { type: 'application/json' }),
      ),
      link = document.createElement('a');
    link.href = url;
    link.download = `mal-${medium}-${seed.catalog.characters.length}.catalog.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const allowed = consent && (!artwork || !!permission.trim());
  const prepared = seed.catalog.characters.length;
  const progress = Math.min(1, prepared / seed.target);
  return (
    <section aria-label="MyAnimeList browser" className="provider-browser">
      <h3>Anime &amp; manga from MyAnimeList</h3>
      <p className="quiet">
        Build a roster from the most popular series, or pick specific ones. Every character keeps a
        stable ID; images load from the provider only when a card is shown.
      </p>
      <fieldset disabled={busy}>
        <div className="provider-grid">
          <div>
            <label htmlFor="jikan-service">API service</label>
            <select
              id="jikan-service"
              value={service}
              onChange={(event) => {
                const next = event.target.value as 'tenrai' | 'jikan';
                setService(next);
                setConsent(false);
                setWorks([]);
                setSelected([]);
                setPage(0);
                setHasNext(true);
                setSeed(newJikanSeed(medium, target, next, perWork));
                setMessage('');
                onEdit();
              }}
            >
              <option value="tenrai">Tenrai (Jikan-compatible API)</option>
              <option value="jikan">Jikan legacy public API</option>
            </select>
          </div>
          <div>
            <label htmlFor="jikan-medium">Catalog medium</label>
            <select
              id="jikan-medium"
              value={medium}
              onChange={(event) => {
                const next = event.target.value as Medium;
                setMedium(next);
                setBrowseMedium(next === 'manga' ? 'manga' : 'anime');
                setWorks([]);
                setSelected([]);
                setPage(0);
                setHasNext(true);
                reset(next);
              }}
            >
              <option value="anime">Anime</option>
              <option value="manga">Manga</option>
              <option value="both">Anime and manga</option>
            </select>
          </div>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              if (!event.target.checked) onEdit();
            }}
          />
          Use {service === 'tenrai' ? 'Tenrai' : 'Jikan'} for this setup; I reviewed the provider&apos;s
          usage requirements.
        </label>
        <p className="field-help">
          <a
            href={
              service === 'tenrai'
                ? 'https://api.tenrai.org/documentation'
                : 'https://docs.api.jikan.moe/'
            }
            target="_blank"
            rel="noreferrer"
          >
            {service === 'tenrai' ? 'Tenrai' : 'Jikan'} API documentation
          </a>
          {service === 'tenrai' && (
            <>
              {' · '}
              <a href="https://tenrai.org/terms" target="_blank" rel="noreferrer">
                Tenrai terms
              </a>
            </>
          )}
          {' · '}
          <a href="https://myanimelist.net/about/terms_of_use" target="_blank" rel="noreferrer">
            MyAnimeList terms
          </a>
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={artwork}
            onChange={(event) => {
              setArtwork(event.target.checked);
              reset();
            }}
          />
          Include character artwork through API, permission needed.
        </label>
        <p className="field-help">
          {artwork
            ? 'Pictures load from the MyAnimeList CDN when a card is shown; nothing is copied.'
            : 'Without artwork, cards show the character’s initials instead of a picture.'}
        </p>
        {artwork && (
          <>
            <label htmlFor="jikan-artwork-permission">
              Artwork permission / permitted-use statement
            </label>
            <input
              id="jikan-artwork-permission"
              maxLength={200}
              value={permission}
              onChange={(event) => {
                setPermission(event.target.value);
                reset();
              }}
            />
            <p className="field-help">
              API access is not an artwork license. Images stay on the provider CDN and are never
              copied into this engine or its backups.
            </p>
          </>
        )}
        <div className="provider-mode">
          <h4>Popular roster</h4>
          <p className="field-help">
            Walks the most popular {medium === 'both' ? 'anime and manga' : medium} series in order
            and takes each series’ main characters first. Fewer characters per series means more
            series — and more variety.
          </p>
          <div className="provider-grid">
            <div className="roster-size">
              <div className="roster-size-head">
                <label htmlFor="jikan-target">Roster size</label>
                <span className="unit-input roster-size-number">
                  <input
                    type="number"
                    aria-label="Exact roster size"
                    min={minimumRoster}
                    max={jikanSeedLimits.maxTarget}
                    step={1}
                    value={targetText}
                    onChange={(event) => {
                      setTargetText(event.target.value);
                      const next = Number(event.target.value);
                      if (
                        Number.isInteger(next) &&
                        next >= minimumRoster &&
                        next <= jikanSeedLimits.maxTarget
                      ) {
                        setTarget(next);
                        reset(medium, next);
                      }
                    }}
                    onBlur={() => setTargetText(String(target))}
                  />
                  <span className="unit-input-unit" aria-hidden="true">
                    characters
                  </span>
                </span>
              </div>
              <input
                id="jikan-target"
                type="range"
                min={0}
                max={rosterStops.length - 1}
                step={1}
                value={nearestStop(target)}
                aria-valuetext={`${target.toLocaleString()} characters`}
                style={
                  {
                    '--fill': `${(nearestStop(target) / (rosterStops.length - 1)) * 100}%`,
                  } as CSSProperties
                }
                onChange={(event) => {
                  const next = rosterStops[Number(event.target.value)];
                  setTarget(next);
                  setTargetText(String(next));
                  reset(medium, next);
                }}
              />
              <div className="roster-size-scale" aria-hidden="true">
                <span>100</span>
                <span>{(1000).toLocaleString()}</span>
                <span>{(10000).toLocaleString()}</span>
                <span>{rosterStops[rosterStops.length - 1].toLocaleString()}</span>
              </div>
            </div>
            <div>
              <label htmlFor="jikan-per-series">Characters per series</label>
              <select
                id="jikan-per-series"
                value={perWork}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setPerWork(next);
                  reset(medium, target, next);
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
          <label className="check-label">
            <input
              type="checkbox"
              checked={detectGender}
              onChange={(event) => {
                setDetectGender(event.target.checked);
                reset();
              }}
            />
            <span>
              Detect waifus &amp; husbandos
              <small>
                Adds one profile lookup per character so the realm gets Waifus and Husbandos packs
                right away. MyAnimeList has no gender field, so it is read from each profile.
              </small>
            </span>
          </label>
          <button
            type="button"
            className="accent"
            disabled={!allowed}
            onClick={() => prepare('popular')}
          >
            Prepare popular roster
          </button>
        </div>
        <div className="provider-mode">
          <h4>Choose series</h4>
          {medium === 'both' && (
            <div className="segmented" role="group" aria-label="Search in">
              {(['anime', 'manga'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={browseMedium === value}
                  onClick={() => {
                    setBrowseMedium(value);
                    setWorks([]);
                    setPage(0);
                    setHasNext(true);
                  }}
                >
                  {value === 'anime' ? 'Anime' : 'Manga'}
                </button>
              ))}
            </div>
          )}
          <label htmlFor="jikan-search">Find anime or manga series</label>
          <input
            id="jikan-search"
            value={query}
            maxLength={100}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Search, or leave blank for popular series"
          />
          <div className="recycle-actions">
            <button type="button" className="secondary" disabled={!allowed} onClick={() => browse(1)}>
              Browse series
            </button>
            {page > 1 && (
              <button
                type="button"
                className="secondary"
                disabled={!allowed}
                onClick={() => browse(page - 1)}
              >
                Previous series page
              </button>
            )}
            {page > 0 && hasNext && (
              <button
                type="button"
                className="secondary"
                disabled={!allowed}
                onClick={() => browse(page + 1)}
              >
                Next series page
              </button>
            )}
          </div>
          {works.length > 0 && (
            <fieldset className="series-choices">
              <legend>
                Choose series · page {page} · {selected.length} selected
              </legend>
              {works.map((work) => (
                <label className="check-label" key={work.id}>
                  <input
                    type="checkbox"
                    checked={selected.some(
                      (item) => item.id === work.id && item.medium === browseMedium,
                    )}
                    onChange={(event) => {
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, { ...work, medium: browseMedium }]
                          : current.filter(
                              (item) => !(item.id === work.id && item.medium === browseMedium),
                            ),
                      );
                      reset();
                    }}
                  />
                  <span>
                    {work.title}
                    <small> · {work.categories.join(', ')}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <button
            type="button"
            disabled={!allowed || !selected.length}
            onClick={() => prepare('selected')}
          >
            Prepare selected series
          </button>
        </div>
      </fieldset>
      {(busy || prepared > 0) && (
        <div className="provider-progress">
          <progress
            aria-label="Catalog preparation"
            value={prepared}
            max={seed.target}
            aria-valuetext={`${prepared} of ${seed.target} characters`}
          />
          <span>{Math.round(progress * 100)}%</span>
        </div>
      )}
      <div className="recycle-actions">
        {busy && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              stopped.current = true;
              controller.current?.abort();
            }}
          >
            Pause preparation
          </button>
        )}
        {!busy && prepared > 0 && prepared < seed.target && nextJikanStep(seed) && (
          <button type="button" disabled={!allowed} onClick={() => prepare('resume')}>
            Resume preparation
          </button>
        )}
        {prepared > 0 && (
          <button type="button" className="secondary" onClick={download}>
            Download prepared catalog
          </button>
        )}
      </div>
      <p role="status">{message}</p>
      <p className="field-help">
        Requests are paced below {service === 'tenrai' ? 'Tenrai' : 'Jikan'}&apos;s published
        limits (one every {(jikanPacing[service].delayMs / 1000).toFixed(2)} s, at most{' '}
        {jikanPacing[service].perMinute} per minute shared across admins), stop on errors or rate
        limits and never run in the background — keep this page open while preparing; you can
        pause and resume. A {target.toLocaleString()}-character roster takes roughly{' '}
        {duration(
          (((target / Math.max(5, perWork * 0.8)) * 1.05 + (detectGender ? target : 0)) *
            jikanPacing[service].delayMs) /
            60000,
        )}
        {detectGender && ' including the waifu & husbando check'}.
        {target > 25000 &&
          ' Beyond about 25,000 characters, realm pages load more slowly (around 1.3 seconds at 100,000 on a desktop PC; longer on small servers).'}{' '}
        The installed roster keeps categories and odds stable during an API outage.
      </p>
    </section>
  );
}
