'use client';
import { useEffect, useRef, useState } from 'react';
import { CatalogJikan } from './catalog-jikan';
import { CatalogAniList } from './catalog-anilist';
type Props = {
  onStart: () => void;
  onEdit: () => void;
  onLoaded: (data: unknown) => void;
  onFailure: (message: string) => void;
};
const sources = [
  {
    id: 'mal',
    label: 'MyAnimeList',
    hint: 'A popular roster of any size, or the series you choose. Uses the Tenrai API with MyAnimeList IDs.',
  },
  {
    id: 'anilist',
    label: 'AniList',
    hint: 'Pick specific AniList series. AniList does not allow bulk collection, so there is no popular roster here.',
  },
  {
    id: 'other',
    label: 'Other formats',
    hint: 'Look up AniList character IDs, or upload a saved AniList or Jikan response.',
  },
] as const;

/** Anime & manga roster sources. MyAnimeList (via Tenrai) is the default. */
export function CatalogProvider(props: Props) {
  const [source, setSource] = useState<(typeof sources)[number]['id']>('mal');
  const active = sources.find((item) => item.id === source)!;
  return (
    <div className="provider-source">
      <div className="segmented provider-switch" role="group" aria-label="Data source">
        {sources.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={source === item.id}
            onClick={() => {
              if (source === item.id) return;
              setSource(item.id);
              props.onEdit();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="field-help">{active.hint}</p>
      {source === 'mal' ? (
        <CatalogJikan {...props} />
      ) : source === 'anilist' ? (
        <CatalogAniList {...props} />
      ) : (
        <ProviderFormats {...props} />
      )}
    </div>
  );
}

function ProviderFormats({ onStart, onEdit, onLoaded, onFailure }: Props) {
  const [provider, setProvider] = useState('anilist'),
    [ids, setIds] = useState(''),
    [medium, setMedium] = useState('anime'),
    [series, setSeries] = useState(''),
    [genres, setGenres] = useState(''),
    [license, setLicense] = useState(''),
    [consent, setConsent] = useState(false),
    [terms, setTerms] = useState(false),
    [busy, setBusy] = useState(false),
    [data, setData] = useState<unknown>();
  const mounted = useRef(true);
  const fileGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function load() {
    if (busy) return;
    onStart();
    setBusy(true);
    try {
      let input: Record<string, unknown> = {
        provider,
        medium,
        revision: 'selection-1',
        providerConsent: consent,
        termsConfirmed: terms,
      };
      if (provider === 'anilist') {
        const selected = ids
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean);
        if (
          !selected.length ||
          selected.length > 25 ||
          selected.some((id) => !/^[1-9][0-9]{0,9}$/.test(id))
        )
          throw new Error('Choose 1 to 25 numeric AniList character IDs.');
        input = { ...input, ids: selected.map(Number) };
      } else {
        if (!data) throw new Error('Choose a provider JSON response file first.');
        input = {
          ...input,
          data,
          license,
          ...(provider === 'jikan'
            ? {
                series,
                categories: genres
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              }
            : {}),
        };
      }
      const response = await fetch('/api/catalog/provider', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
        result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not prepare this provider catalog.');
      if (mounted.current) onLoaded(result);
    } catch (error) {
      if (mounted.current)
        onFailure(error instanceof Error ? error.message : 'Could not load provider metadata.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <fieldset className="reward-settings" disabled={busy}>
      <legend>Other provider formats</legend>
      <div className="source-tabs" role="group" aria-label="Provider format">
        <button
          type="button"
          className={provider === 'anilist' ? 'primary' : 'secondary'}
          aria-pressed={provider === 'anilist'}
          onClick={() => {
            setProvider('anilist');
            fileGeneration.current++;
            setData(undefined);
            onEdit();
          }}
        >
          AniList lookup
        </button>
        <button
          type="button"
          className={provider === 'anilist-json' ? 'primary' : 'secondary'}
          aria-pressed={provider === 'anilist-json'}
          onClick={() => {
            setProvider('anilist-json');
            fileGeneration.current++;
            setData(undefined);
            onEdit();
          }}
        >
          AniList JSON
        </button>
        <button
          type="button"
          className={provider === 'jikan' ? 'primary' : 'secondary'}
          aria-pressed={provider === 'jikan'}
          onClick={() => {
            setProvider('jikan');
            fileGeneration.current++;
            setData(undefined);
            onEdit();
          }}
        >
          Jikan JSON
        </button>
      </div>
      <label htmlFor="provider-medium">Provider medium</label>
      <select
        id="provider-medium"
        value={medium}
        onChange={(event) => {
          setMedium(event.target.value);
          onEdit();
        }}
      >
        <option value="anime">Anime</option>
        <option value="manga">Manga</option>
      </select>
      {provider === 'anilist' ? (
        <>
          <label htmlFor="provider-ids">Selected AniList character IDs</label>
          <input
            id="provider-ids"
            value={ids}
            maxLength={275}
            placeholder="Numeric IDs, separated by commas"
            onChange={(event) => {
              setIds(event.target.value);
              onEdit();
            }}
          />
          <p className="small quiet">
            One request for up to 25 selected characters. Genres and favourites create category
            packs and relative tiers; images are excluded. No catalog-wide search, automatic paging
            or background collection.
          </p>
        </>
      ) : (
        <>
          <label htmlFor="provider-file">Provider response JSON file</label>
          <input
            id="provider-file"
            type="file"
            accept=".json,application/json"
            onChange={async (event) => {
              onEdit();
              setData(undefined);
              const version = ++fileGeneration.current;
              try {
                const file = event.target.files?.[0];
                if (!file || file.size > 2 * 1024 * 1024 - 16384) throw new Error();
                const parsed: unknown = JSON.parse(
                  new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()),
                );
                if (mounted.current && fileGeneration.current === version) setData(parsed);
              } catch {
                if (mounted.current && fileGeneration.current === version)
                  onFailure('Choose a UTF-8 provider JSON response smaller than 2 MiB.');
              }
            }}
          />
          <label htmlFor="provider-license">Metadata permission statement</label>
          <input
            id="provider-license"
            value={license}
            maxLength={200}
            onChange={(event) => {
              setLicense(event.target.value);
              onEdit();
            }}
          />
          {provider === 'jikan' && (
            <>
              <label htmlFor="provider-series">Series for these Jikan characters</label>
              <input
                id="provider-series"
                value={series}
                maxLength={100}
                onChange={(event) => {
                  setSeries(event.target.value);
                  onEdit();
                }}
              />
              <label htmlFor="provider-genres">Major categories (comma-separated)</label>
              <input
                id="provider-genres"
                value={genres}
                maxLength={600}
                placeholder="Action, Fantasy, Adventure"
                onChange={(event) => {
                  setGenres(event.target.value);
                  onEdit();
                }}
              />
            </>
          )}
          <p className="small quiet">
            Normalize an authorized character response to this engine's portable catalog. Jikan data
            uses MAL IDs; neither the API software license nor a returned image licenses the
            artwork.
          </p>
        </>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={terms}
          onChange={(event) => {
            setTerms(event.target.checked);
            if (!event.target.checked) onEdit();
          }}
        />
        I reviewed the provider's terms and have permission to use this selected metadata.
      </label>
      <p className="small quiet">
        <a
          href={
            provider === 'jikan'
              ? 'https://jikan.moe/terms'
              : 'https://docs.anilist.co/guide/terms-of-use'
          }
          target="_blank"
          rel="noreferrer"
        >
          Read provider terms
        </a>
        . AniList prohibits mass collection; for large rosters use MyAnimeList.
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        {provider === 'anilist'
          ? 'Send these selected IDs to AniList.'
          : 'Prepare this uploaded provider metadata.'}
      </label>
      <button
        type="button"
        onClick={load}
        disabled={
          busy ||
          !consent ||
          !terms ||
          (provider === 'anilist'
            ? !ids.trim()
            : !data || !license.trim() || (provider === 'jikan' && !series.trim()))
        }
      >
        {busy ? 'Preparing metadata...' : 'Prepare provider catalog'}
      </button>
    </fieldset>
  );
}
