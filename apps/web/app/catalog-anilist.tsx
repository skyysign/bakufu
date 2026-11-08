'use client';
import { useEffect, useRef, useState } from 'react';
import {
  aniListMaxSelectedSeries,
  mergeAniListCharacters,
} from '../../../packages/importers/src/anilist-state';
import type {
  AniListApiResult,
  AniListCatalog,
  AniListWork,
} from '../../../packages/importers/src/anilist';

type Props = {
  onStart: () => void;
  onEdit: () => void;
  onLoaded: (data: unknown) => void;
  onFailure: (message: string) => void;
};
type Medium = 'anime' | 'manga';
type Selected = AniListWork & { medium: Medium };
const emptyCatalog = (): AniListCatalog => ({
  schemaVersion: 1,
  source: 'anilist',
  revision: 'selected-series-1',
  license:
    'AniList selected-series metadata; operator-confirmed permitted use; artwork rights separate',
  characters: [],
});

/** Pick AniList series by hand; their characters become one reviewed catalog. */
export function CatalogAniList({ onStart, onEdit, onLoaded, onFailure }: Props) {
  const [medium, setMedium] = useState<Medium>('anime'),
    [consent, setConsent] = useState(false),
    [artwork, setArtwork] = useState(false),
    [permission, setPermission] = useState(''),
    [perWork, setPerWork] = useState(15),
    [query, setQuery] = useState(''),
    [works, setWorks] = useState<AniListWork[]>([]),
    [page, setPage] = useState(0),
    [hasNext, setHasNext] = useState(true),
    [selected, setSelected] = useState<Selected[]>([]),
    [queue, setQueue] = useState<Selected[]>([]),
    [catalog, setCatalog] = useState<AniListCatalog>(emptyCatalog),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const mounted = useRef(true),
    stopped = useRef(false),
    controller = useRef<AbortController | null>(null),
    lastRequest = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopped.current = true;
      controller.current?.abort();
    };
  }, []);
  async function step(stepMedium: Medium, input: Record<string, unknown>): Promise<AniListApiResult> {
    const remaining = Math.max(0, 2500 - (performance.now() - lastRequest.current));
    if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
    if (stopped.current) throw new Error('Preparation paused. Resume when ready.');
    controller.current = new AbortController();
    lastRequest.current = performance.now();
    const response = await fetch('/api/catalog/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.current.signal,
        body: JSON.stringify({
          provider: 'anilist-api',
          medium: stepMedium,
          revision: 'selected-series-1',
          providerConsent: consent,
          termsConfirmed: consent,
          ...input,
        }),
      }),
      result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'AniList could not return this page.');
    return result as AniListApiResult;
  }
  function edited() {
    setQueue([]);
    setCatalog(emptyCatalog());
    setMessage('');
    onEdit();
  }
  async function browse(nextPage: number) {
    stopped.current = false;
    setBusy(true);
    setMessage('Loading series from AniList…');
    try {
      const result = await step(medium, {
        step: 'works',
        page: nextPage,
        ...(query.trim() ? { query: query.trim() } : {}),
      });
      if (result.kind !== 'works') throw new Error('Unsupported AniList response.');
      if (mounted.current) {
        setWorks(result.works);
        setPage(result.page);
        setHasNext(result.hasNextPage);
        setMessage('');
      }
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'Could not browse AniList.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function prepare(resume: boolean) {
    stopped.current = false;
    setBusy(true);
    onStart();
    let pendingQueue = resume ? queue : selected,
      current = resume ? catalog : emptyCatalog();
    try {
      while (pendingQueue.length && !stopped.current) {
        const work = pendingQueue[0];
        const { medium: workMedium, ...plain } = work;
        const result = await step(workMedium, {
          step: 'characters',
          work: plain,
          perWork,
          ...(artwork ? { artworkPermission: permission.trim() } : {}),
        });
        if (result.kind !== 'characters') throw new Error('Unsupported AniList response.');
        current = mergeAniListCharacters(current, result.catalog);
        pendingQueue = pendingQueue.slice(1);
        if (!mounted.current) return;
        setQueue(pendingQueue);
        setCatalog(current);
        setMessage(
          `${current.characters.length.toLocaleString()} characters from ${(selected.length - pendingQueue.length).toLocaleString()} of ${selected.length.toLocaleString()} series.`,
        );
      }
      if (!mounted.current) return;
      if (current.characters.length) onLoaded(current);
      else onFailure('These series returned no characters. Choose other series.');
      setMessage(`${current.characters.length.toLocaleString()} characters ready for review.`);
    } catch (error) {
      if (!mounted.current) return;
      const reason = stopped.current
        ? 'Preparation paused.'
        : error instanceof Error
          ? error.message
          : 'Preparation paused.';
      setQueue(pendingQueue);
      setCatalog(current);
      setMessage(
        `${reason} ${current.characters.length.toLocaleString()} characters retained. Resume or download this selection.`,
      );
      if (current.characters.length) onLoaded(current);
      else onFailure(reason);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' }),
      ),
      link = document.createElement('a');
    link.href = url;
    link.download = `anilist-${catalog.characters.length}.catalog.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const allowed = consent && (!artwork || !!permission.trim());
  const done = selected.length - queue.length;
  return (
    <section aria-label="AniList series browser" className="provider-browser">
      <h3>Anime &amp; manga from AniList</h3>
      <p className="quiet">
        Search AniList or browse its most popular series, pick the ones your community loves, and
        import their characters — main cast first. AniList’s terms don’t allow bulk collection, so
        only the series you choose are requested.
      </p>
      <fieldset disabled={busy}>
        <label className="check-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              if (!event.target.checked) onEdit();
            }}
          />
          Use AniList for this setup; I reviewed AniList&apos;s terms of use.
        </label>
        <p className="field-help">
          <a href="https://docs.anilist.co/guide/terms-of-use" target="_blank" rel="noreferrer">
            AniList terms of use
          </a>
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={artwork}
            onChange={(event) => {
              setArtwork(event.target.checked);
              edited();
            }}
          />
          Include character artwork through API, permission needed.
        </label>
        <p className="field-help">
          {artwork
            ? 'Pictures load from the AniList CDN when a card is shown; nothing is copied.'
            : 'Without artwork, cards show the character’s initials instead of a picture.'}
        </p>
        {artwork && (
          <>
            <label htmlFor="anilist-artwork-permission">
              Artwork permission / permitted-use statement
            </label>
            <input
              id="anilist-artwork-permission"
              maxLength={200}
              value={permission}
              onChange={(event) => {
                setPermission(event.target.value);
                edited();
              }}
            />
          </>
        )}
        <div className="provider-grid">
          <div>
            <label htmlFor="anilist-medium">Search in</label>
            <select
              id="anilist-medium"
              value={medium}
              onChange={(event) => {
                setMedium(event.target.value as Medium);
                setWorks([]);
                setPage(0);
                setHasNext(true);
              }}
            >
              <option value="anime">Anime</option>
              <option value="manga">Manga</option>
            </select>
          </div>
          <div>
            <label htmlFor="anilist-per-series">Characters per series</label>
            <select
              id="anilist-per-series"
              value={perWork}
              onChange={(event) => {
                setPerWork(Number(event.target.value));
                edited();
              }}
            >
              {[10, 15, 25].map((size) => (
                <option key={size} value={size}>
                  Up to {size}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label htmlFor="anilist-search">Find series on AniList</label>
        <input
          id="anilist-search"
          value={query}
          maxLength={100}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="Search, or leave blank for the most popular"
        />
        <div className="recycle-actions">
          <button type="button" className="secondary" disabled={!allowed} onClick={() => browse(1)}>
            Browse AniList series
          </button>
          {page > 1 && (
            <button
              type="button"
              className="secondary"
              disabled={!allowed}
              onClick={() => browse(page - 1)}
            >
              Previous page
            </button>
          )}
          {page > 0 && hasNext && (
            <button
              type="button"
              className="secondary"
              disabled={!allowed}
              onClick={() => browse(page + 1)}
            >
              Next page
            </button>
          )}
        </div>
        {works.length > 0 && (
          <fieldset className="series-choices">
            <legend>
              {medium === 'anime' ? 'Anime' : 'Manga'} · page {page} · {selected.length} /{' '}
              {aniListMaxSelectedSeries} selected
            </legend>
            {works.map((work) => {
              const checked = selected.some((item) => item.id === work.id && item.medium === medium);
              return (
                <label className="check-label" key={work.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && selected.length >= aniListMaxSelectedSeries}
                    onChange={(event) => {
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, { ...work, medium }]
                          : current.filter((item) => !(item.id === work.id && item.medium === medium)),
                      );
                      edited();
                    }}
                  />
                  <span>
                    {work.title}
                    <small> · {work.categories.join(', ') || 'No tags'}</small>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {selected.length > 0 && (
          <p className="field-help">
            Selected: {selected.map((work) => work.title).join(', ')}
          </p>
        )}
        <button
          type="button"
          className="accent"
          disabled={!allowed || !selected.length}
          onClick={() => prepare(false)}
        >
          Prepare {selected.length || ''} selected {selected.length === 1 ? 'series' : 'series'}
        </button>
      </fieldset>
      {(busy || catalog.characters.length > 0) && selected.length > 0 && (
        <div className="provider-progress">
          <progress
            aria-label="Catalog preparation"
            value={done}
            max={selected.length}
            aria-valuetext={`${done} of ${selected.length} series`}
          />
          <span>
            {done} / {selected.length}
          </span>
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
        {!busy && queue.length > 0 && catalog.characters.length > 0 && (
          <button type="button" disabled={!allowed} onClick={() => prepare(true)}>
            Resume preparation
          </button>
        )}
        {catalog.characters.length > 0 && (
          <button type="button" className="secondary" onClick={download}>
            Download prepared catalog
          </button>
        )}
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
