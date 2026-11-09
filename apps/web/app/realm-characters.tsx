'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Tier } from '@card-engine/config';
import type {
  RealmCharacterAddition,
  RealmCharacterCheck,
  RealmCharacterSummary,
} from '@card-engine/db';
import { post } from './api-client';
import { GameIcon } from './game-art';
import { GenderBackfill } from './gender-backfill';
import { RosterGrowth } from './roster-growth';
import { CharacterRemoval } from './character-removal';
import { MediumTagging } from './medium-tagging';
import { aniListMediumOptions, malMediumOptions } from './medium-picker';

type Work = { id: number; title: string; categories: string[] };
type Entry = {
  id: string;
  sourceKey: string;
  name: string;
  series: string;
  categories: string[];
  popularity: number | null;
  artwork?: { url: string };
};
type Candidate = Entry & { present: boolean; tier: Tier };

const tierLabel = (tier: Tier) => tier[0].toUpperCase() + tier.slice(1);

/**
 * Administration → Characters. Looks up one series at a time on the realm's
 * own provider and adds the characters it is missing. Nothing is collected in
 * the background: each lookup is one explicit request by the admin.
 */
export function RealmCharacters({
  realmId,
  disabled,
  onLockChange,
}: {
  realmId: string;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState<RealmCharacterSummary | null>(null),
    [loadError, setLoadError] = useState(''),
    [service, setService] = useState<'tenrai' | 'jikan'>('tenrai'),
    [medium, setMedium] = useState<string>('anime'),
    [consent, setConsent] = useState(false),
    [artwork, setArtwork] = useState(false),
    [permission, setPermission] = useState(''),
    [query, setQuery] = useState(''),
    [works, setWorks] = useState<Work[] | null>(null),
    [page, setPage] = useState(1),
    [hasNext, setHasNext] = useState(false),
    [work, setWork] = useState<Work | null>(null),
    [candidates, setCandidates] = useState<Candidate[] | null>(null),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState<'search' | 'cast' | 'add' | null>(null),
    [error, setError] = useState(''),
    [result, setResult] = useState<RealmCharacterAddition | null>(null),
    [genderBusy, setGenderBusy] = useState(false),
    [growthBusy, setGrowthBusy] = useState(false),
    [removalBusy, setRemovalBusy] = useState(false),
    [taggingBusy, setTaggingBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => onLockChange(busy === 'add' || genderBusy || growthBusy || removalBusy || taggingBusy),
    [busy, genderBusy, growthBusy, removalBusy, taggingBusy, onLockChange],
  );
  useEffect(() => () => onLockChange(false), [onLockChange]);

  const loadSummary = useCallback(async () => {
    try {
      const response = await fetch(`/api/realm-characters?realmId=${encodeURIComponent(realmId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not load this realm’s characters.');
      if (!mounted.current) return;
      setSummary(body as RealmCharacterSummary);
      setArtwork((current) => current || (body as RealmCharacterSummary).artworkCount > 0);
      setPermission(
        (current) => current || (body as RealmCharacterSummary).artworkPermission || '',
      );
    } catch (failure) {
      if (mounted.current) setLoadError((failure as Error).message);
    }
  }, [realmId]);
  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const provider = summary?.source === 'anilist' ? 'anilist' : 'mal';
  const providerName =
    provider === 'anilist' ? 'AniList' : service === 'tenrai' ? 'Tenrai' : 'Jikan';
  const ready = consent && (!artwork || !!permission.trim());

  async function lookup(input: Record<string, unknown>) {
    return post('catalog/provider', {
      ...(provider === 'anilist'
        ? { provider: 'anilist-api' }
        : { provider: 'jikan-api', service }),
      medium,
      revision: 'realm-addition-1',
      providerConsent: true,
      termsConfirmed: true,
      ...input,
    });
  }
  async function search(nextPage: number, event?: FormEvent) {
    event?.preventDefault();
    if (!ready || busy) return;
    setBusy('search');
    setError('');
    try {
      const found = (await lookup({
        step: 'works',
        page: nextPage,
        ...(query.trim() ? { query: query.trim() } : {}),
      })) as { works: Work[]; page: number; hasNextPage: boolean };
      if (!mounted.current) return;
      setWorks(found.works);
      setPage(found.page);
      setHasNext(found.hasNextPage);
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message);
    } finally {
      if (mounted.current) setBusy(null);
    }
  }
  async function refreshStatus(entries: Entry[]) {
    const checked = (await post('realm-characters/check', {
      realmId,
      characters: entries.map((entry) => ({
        sourceKey: entry.sourceKey,
        popularity: entry.popularity,
      })),
    })) as RealmCharacterCheck;
    const status = new Map(checked.results.map((item) => [item.sourceKey, item]));
    return entries.map((entry) => ({
      ...entry,
      present: status.get(entry.sourceKey)?.present ?? false,
      tier: status.get(entry.sourceKey)?.tier ?? 'common',
    }));
  }
  async function openCast(next: Work) {
    if (!ready || busy) return;
    setBusy('cast');
    setError('');
    setResult(null);
    setWork(next);
    setCandidates(null);
    setSelected(new Set());
    try {
      const cast = (await lookup({
        step: 'characters',
        work: next,
        perWork: 100,
        ...(artwork ? { artworkPermission: permission.trim() } : {}),
      })) as { catalog: { characters: Entry[] } };
      const list = await refreshStatus(cast.catalog.characters);
      if (!mounted.current) return;
      setCandidates(list);
      setSelected(new Set(list.filter((item) => !item.present).map((item) => item.sourceKey)));
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message);
    } finally {
      if (mounted.current) setBusy(null);
    }
  }
  async function add() {
    if (!candidates || busy || !selected.size) return;
    setBusy('add');
    setError('');
    try {
      const chosen = candidates
        .filter((item) => selected.has(item.sourceKey) && !item.present)
        .map(({ present: _present, tier: _tier, ...entry }) => {
          void _present;
          void _tier;
          return entry;
        });
      const added = (await post('realm-characters', {
        realmId,
        characters: chosen,
        rightsConfirmed: true,
      })) as RealmCharacterAddition;
      if (!mounted.current) return;
      setResult(added);
      setCandidates(await refreshStatus(candidates));
      setSelected(new Set());
      await loadSummary();
      router.refresh();
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message);
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  if (loadError)
    return (
      <section className="panel" aria-label="Characters">
        <h2>Characters</h2>
        <p className="error" role="alert">
          {loadError}
        </p>
      </section>
    );
  if (!summary)
    return (
      <section className="panel" aria-label="Characters">
        <h2>Characters</h2>
        <p role="status">Loading…</p>
      </section>
    );
  const missing = candidates?.filter((item) => !item.present) ?? [];
  return (
    <section className="panel realm-characters" aria-labelledby="realm-characters-title">
      <div className="section-heading">
        <div>
          <h2 id="realm-characters-title">Characters</h2>
          <p className="section-intro">
            {summary.characterCount.toLocaleString()} characters
            {summary.artworkCount > 0
              ? ` · ${summary.artworkCount.toLocaleString()} with artwork`
              : ' · no artwork'}
            .
            {summary.canAdd &&
              ' Missing someone? Look up their series and add them; they join All Characters and every pack of their genres right away.'}
          </p>
        </div>
      </div>
      {!summary.canAdd ? (
        <div className="wizard-gate">
          <GameIcon name="info" />
          <p>{summary.reason}</p>
        </div>
      ) : (
        <>
          <ol className="lookup-steps">
            <li>
              <h3>Set up the lookup</h3>
              <fieldset className="lookup-setup" disabled={disabled || !!busy}>
                <div className="provider-grid">
                  {provider === 'mal' && (
                    <div>
                      <label htmlFor="addition-service">API service</label>
                      <select
                        id="addition-service"
                        value={service}
                        onChange={(event) => {
                          setService(event.target.value as 'tenrai' | 'jikan');
                          setConsent(false);
                        }}
                      >
                        <option value="tenrai">Tenrai (Jikan-compatible API)</option>
                        <option value="jikan">Jikan legacy public API</option>
                      </select>
                    </div>
                  )}
                  <div>
                    <label htmlFor="addition-medium">Search in</label>
                    <select
                      id="addition-medium"
                      value={medium}
                      onChange={(event) => {
                        setMedium(event.target.value);
                        setWorks(null);
                        setWork(null);
                        setCandidates(null);
                      }}
                    >
                      {(provider === 'anilist' ? aniListMediumOptions : malMediumOptions).map(
                        (option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  Use {providerName} for this lookup; I reviewed its usage requirements and may use
                  this metadata.
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={artwork}
                    onChange={(event) => setArtwork(event.target.checked)}
                  />
                  Include character artwork through API, permission needed.
                </label>
                {artwork && (
                  <>
                    <label htmlFor="addition-artwork-permission">
                      Artwork permission / permitted-use statement
                    </label>
                    <input
                      id="addition-artwork-permission"
                      maxLength={200}
                      value={permission}
                      onChange={(event) => setPermission(event.target.value)}
                    />
                  </>
                )}
              </fieldset>
            </li>
            <li>
              <h3>Find the series</h3>
              <form className="inline-form" onSubmit={(event) => void search(1, event)}>
                <label className="sr-only" htmlFor="addition-search">
                  Series name
                </label>
                <input
                  id="addition-search"
                  type="search"
                  value={query}
                  maxLength={100}
                  placeholder="Series name, or leave blank for popular series"
                  disabled={disabled || !!busy}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button disabled={disabled || !!busy || !ready}>
                  {busy === 'search' ? 'Searching…' : 'Search series'}
                </button>
              </form>
              {!ready && <p className="field-help">Confirm the lookup above to search.</p>}
              {works && (
                <>
                  {works.length === 0 ? (
                    <p className="field-help">No series found. Try another spelling.</p>
                  ) : (
                    <ul className="series-results" aria-label="Series results">
                      {works.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="series-result"
                            aria-pressed={work?.id === item.id}
                            disabled={disabled || !!busy}
                            onClick={() => void openCast(item)}
                          >
                            <strong>{item.title}</strong>
                            <small>{item.categories.slice(0, 4).join(' · ') || 'No genres'}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(page > 1 || hasNext) && (
                    <div className="recycle-actions">
                      {page > 1 && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={disabled || !!busy}
                          onClick={() => void search(page - 1)}
                        >
                          Previous results
                        </button>
                      )}
                      {hasNext && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={disabled || !!busy}
                          onClick={() => void search(page + 1)}
                        >
                          More results
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </li>
            <li>
              <h3>Pick the characters to add</h3>
              {busy === 'cast' && <p role="status">Loading the cast of {work?.title}…</p>}
              {!candidates && busy !== 'cast' && (
                <p className="field-help">Choose a series to see its cast.</p>
              )}
              {candidates && work && (
                <fieldset className="cast-list" disabled={disabled || !!busy}>
                  <legend>
                    {work.title} · {candidates.length} characters ·{' '}
                    {missing.length
                      ? `${missing.length} not in this realm yet`
                      : 'all already in this realm'}
                  </legend>
                  {missing.length > 1 && (
                    <div className="cast-tools">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelected(new Set(missing.map((item) => item.sourceKey)))}
                      >
                        Select all missing
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelected(new Set())}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                  <ul>
                    {candidates.map((item) => (
                      <li key={item.sourceKey} data-present={item.present}>
                        <label className="cast-item">
                          <input
                            type="checkbox"
                            checked={!item.present && selected.has(item.sourceKey)}
                            disabled={item.present}
                            onChange={(event) =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(item.sourceKey);
                                else next.delete(item.sourceKey);
                                return next;
                              })
                            }
                          />
                          {item.artwork ? (
                            <img
                              src={item.artwork.url}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="cast-initials" aria-hidden="true">
                              {item.name
                                .split(/\s+/)
                                .slice(0, 2)
                                .map((part) => part[0])
                                .join('')}
                            </span>
                          )}
                          <span className="cast-text">
                            <strong>{item.name}</strong>
                            <small>
                              {item.present ? (
                                'Already in this realm'
                              ) : (
                                <>
                                  Joins as{' '}
                                  <span className="tier-name" data-tier={item.tier}>
                                    {tierLabel(item.tier)}
                                  </span>
                                </>
                              )}
                            </small>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="cast-actions">
                    <button
                      type="button"
                      className="accent"
                      disabled={disabled || !!busy || !selected.size}
                      onClick={() => void add()}
                    >
                      {busy === 'add'
                        ? 'Adding…'
                        : `Add ${selected.size} character${selected.size === 1 ? '' : 's'}`}
                    </button>
                    <span className="field-help">
                      Rarity follows the popularity ranking of the characters already in this realm.
                    </span>
                  </div>
                </fieldset>
              )}
            </li>
          </ol>
          {provider === 'mal' && (
            <RosterGrowth
              realmId={realmId}
              service={service}
              consent={consent}
              permission={artwork ? permission.trim() : ''}
              disabled={disabled || !!busy || genderBusy}
              currentCount={summary.characterCount}
              onBusyChange={setGrowthBusy}
              onAdded={() => {
                void loadSummary();
                router.refresh();
              }}
            />
          )}
          {provider === 'mal' && (
            <MediumTagging
              realmId={realmId}
              service={service}
              consent={consent}
              untaggedSeries={summary.untaggedSeries}
              seriesCount={summary.seriesCount}
              disabled={disabled || !!busy || genderBusy || growthBusy}
              onBusyChange={setTaggingBusy}
              onTagged={() => router.refresh()}
            />
          )}
          {provider === 'anilist' && (
            <p className="field-help roster-growth-note">
              AniList rosters grow series by series with the lookup above (up to 100 characters per
              series); AniList has no bulk walk.
            </p>
          )}
          {provider === 'mal' && (
            <GenderBackfill
              realmId={realmId}
              service={service}
              consent={consent}
              disabled={disabled || !!busy || growthBusy}
              onBusyChange={setGenderBusy}
            />
          )}
          <p className="error" role="alert">
            {error}
          </p>
          {result && (
            <div className="notice addition-result" role="status">
              <GameIcon name="check" />
              <div>
                <p>
                  {result.added.length
                    ? `Added ${result.added.length} character${result.added.length === 1 ? '' : 's'}: ${result.added
                        .slice(0, 6)
                        .map((item) => `${item.name} (${item.tier})`)
                        .join(', ')}${result.added.length > 6 ? '…' : ''}.`
                    : 'These characters were already in this realm.'}
                </p>
                {result.newCategories.length > 0 && (
                  <p className="small">
                    New in this realm: {result.newCategories.slice(0, 5).join(', ')}
                    {result.newCategories.length > 5 ? '…' : ''}. You can add a pack for them under
                    Packs.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
      <CharacterRemoval
        realmId={realmId}
        withoutArtwork={summary.characterCount - summary.artworkCount}
        disabled={disabled || !!busy || genderBusy || growthBusy}
        onBusyChange={setRemovalBusy}
        onRemoved={() => {
          void loadSummary();
          router.refresh();
        }}
      />
    </section>
  );
}
