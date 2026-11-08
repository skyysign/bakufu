'use client';
import { useRef, useState } from 'react';
import { CatalogProvider } from './catalog-provider';
import { GameIcon, type IconName } from './game-art';

const catalogChoices: { value: string; title: string; description: string; icon: IconName }[] = [
  {
    value: 'provider',
    title: 'Anime & manga roster',
    description: 'Popular characters from MyAnimeList, or the series you pick. You choose how many.',
    icon: 'packs',
  },
  {
    value: 'custom',
    title: 'Your JSON file',
    description: 'Upload your own catalog, up to 1,000 characters.',
    icon: 'download',
  },
  {
    value: 'csv',
    title: 'Your CSV file',
    description: 'Build a catalog in a spreadsheet and upload it.',
    icon: 'collection',
  },
];
import type { CatalogPreview } from '@card-engine/db';

export type CatalogSelection = {
  custom: boolean;
  format?: 'json' | 'csv';
  metadata?: { schemaVersion: 1; source: string; revision: string; license: string };
  data?: unknown;
  rightsConfirmed: boolean;
  loading?: boolean;
  error?: string;
};
/** The creation wizard starts on the anime & manga roster. */
export const initialCatalogSelection: CatalogSelection = {
  custom: true,
  format: 'json',
  rightsConfirmed: false,
};
export function CatalogFields({
  value,
  onChange,
  disabled,
  onContentChange,
}: {
  value: CatalogSelection;
  onChange: (value: CatalogSelection | ((current: CatalogSelection) => CatalogSelection)) => void;
  disabled: boolean;
  onContentChange: () => void;
}) {
  const generation = useRef(0);
  const [sourceMode, setSourceMode] = useState<'provider' | null>('provider');
  const format = value.format ?? 'json';
  const current = sourceMode ?? (format === 'csv' ? 'csv' : 'custom');
  function choose(selected: string) {
    generation.current++;
    onContentChange();
    setSourceMode(selected === 'provider' ? 'provider' : null);
    onChange({
      custom: true,
      format: selected === 'csv' ? 'csv' : 'json',
      rightsConfirmed: false,
      ...(selected === 'csv'
        ? { metadata: { schemaVersion: 1, source: '', revision: '1', license: '' } }
        : {}),
    });
  }
  return (
    <fieldset className="catalog-choice-set" disabled={disabled}>
      <legend>Content for this new realm</legend>
      <div className="catalog-choices">
        {catalogChoices.map((choice) => (
          <label key={choice.value} className="catalog-choice" data-selected={current === choice.value}>
            <input
              type="radio"
              name="catalog-kind"
              value={choice.value}
              checked={current === choice.value}
              onChange={() => choose(choice.value)}
            />
            <span className="catalog-choice-icon" aria-hidden="true">
              <GameIcon name={choice.icon} />
            </span>
            <span className="catalog-choice-text">
              <strong>{choice.title}</strong>
              <small>{choice.description}</small>
            </span>
          </label>
        ))}
      </div>
      {value.custom && (
        <>
          {sourceMode ? (
            <CatalogProvider
              onEdit={() => {
                onContentChange();
                onChange((current) => ({
                  ...current,
                  data: undefined,
                  loading: false,
                  error: undefined,
                  rightsConfirmed: false,
                }));
              }}
              onStart={() => {
                onContentChange();
                onChange((current) => ({
                  ...current,
                  data: undefined,
                  loading: true,
                  error: undefined,
                  rightsConfirmed: false,
                }));
              }}
              onLoaded={(data) =>
                onChange((current) => ({
                  ...current,
                  data,
                  loading: false,
                  error: undefined,
                  rightsConfirmed: false,
                }))
              }
              onFailure={(error) =>
                onChange((current) => ({ ...current, data: undefined, loading: false, error }))
              }
            />
          ) : (
            <>
              <label htmlFor="catalog-file">
                Original catalog {format === 'csv' ? 'CSV' : 'JSON'} file
              </label>
              <input
                id="catalog-file"
                key={format}
                type="file"
                accept={format === 'csv' ? '.csv,text/csv' : '.json,application/json'}
                aria-describedby="catalog-help"
                onChange={async (event) => {
                  onContentChange();
                  const version = ++generation.current,
                    file = event.target.files?.[0];
                  onChange((current) => ({
                    ...current,
                    data: undefined,
                    loading: true,
                    error: undefined,
                  }));
                  try {
                    if (!file) throw new Error('Choose a catalog file.');
                    if (file.size > 2 * 1024 * 1024 - 16384)
                      throw new Error('Choose a file smaller than 2 MiB.');
                    const text = new TextDecoder('utf-8', { fatal: true }).decode(
                      await file.arrayBuffer(),
                    );
                    const data: unknown = format === 'csv' ? text : JSON.parse(text);
                    if (version === generation.current)
                      onChange((current) => ({
                        ...current,
                        data,
                        loading: false,
                        error: undefined,
                      }));
                  } catch {
                    if (version === generation.current)
                      onChange((current) => ({
                        ...current,
                        data: undefined,
                        loading: false,
                        error:
                          format === 'csv'
                            ? 'Choose a UTF-8 CSV file smaller than 2 MiB.'
                            : 'Choose a valid JSON file smaller than 2 MiB.',
                      }));
                  }
                }}
              />
              <p id="catalog-help" className="small quiet">
                Version 1 {format === 'csv' ? 'CSV' : 'JSON'}, up to 1,000 characters. Use your own
                original content. Character IDs stay stable; images and external downloads are not
                imported.
              </p>
              {format === 'json' && (
                <p className="small">
                  Need an example or test data? Download the{' '}
                  <a href="/catalog-demo.v1.json" download>
                    12-character demo catalog
                  </a>{' '}
                  or the{' '}
                  <a href="/catalog-scale.v1.json" download>
                    1,000-character test catalog
                  </a>{' '}
                  (both original and free to use), then upload it here.
                </p>
              )}
              {format === 'csv' && (
                <>
                  <p className="small">
                    <a href="/catalog-template.v1.csv" download>
                      Download CSV headers
                    </a>
                    . Save as UTF-8 with comma separators. Separate categories with |; leave
                    popularity blank if unknown.
                  </p>
                  {(
                    [
                      {
                        key: 'source',
                        label: 'CSV source namespace',
                        maximum: 64,
                        help: 'Lowercase letters, numbers, and hyphens; match the prefix of every sourceKey.',
                      },
                      {
                        key: 'revision',
                        label: 'CSV revision',
                        maximum: 100,
                        help: 'Your version label for this catalog.',
                      },
                      {
                        key: 'license',
                        label: 'CSV permission statement',
                        maximum: 200,
                        help: 'Describe your permission to use the original content.',
                      },
                    ] as const
                  ).map((field) => (
                    <div key={field.key}>
                      <label htmlFor={`catalog-${field.key}`}>{field.label}</label>
                      <input
                        id={`catalog-${field.key}`}
                        value={value.metadata?.[field.key] ?? ''}
                        maxLength={field.maximum}
                        required
                        aria-describedby={`catalog-${field.key}-help`}
                        pattern={field.key === 'source' ? '[a-z0-9-]+' : undefined}
                        onChange={(event) => {
                          const text = event.target.value;
                          onChange((current) => ({
                            ...current,
                            metadata: {
                              schemaVersion: 1,
                              source: '',
                              revision: '1',
                              license: '',
                              ...current.metadata,
                              [field.key]: text,
                            },
                          }));
                        }}
                      />
                      <p id={`catalog-${field.key}-help`} className="small quiet">
                        {field.help}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={value.rightsConfirmed}
              onChange={(event) => {
                const checked = event.target.checked;
                onChange((current) => ({ ...current, rightsConfirmed: checked }));
              }}
            />
            I created this content and have permission to use it, or have a license for this
            catalog.
          </label>
          {value.loading && <p role="status">Reading catalog...</p>}
          {value.error && (
            <p className="error" role="alert">
              {value.error}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
export function catalogSourceLabel(preview: CatalogPreview) {
  return preview.source === 'scale-demo'
    ? 'Original 1,000-character scale catalog'
    : preview.source === 'anilist'
      ? 'Selected AniList character metadata'
      : preview.source === 'mal'
        ? 'Authorized Jikan / MAL character metadata'
        : preview.kind === 'original-csv'
            ? 'Original CSV catalog'
            : preview.kind === 'original-json'
              ? 'Original JSON catalog'
              : 'Original demo catalog';
}
export function CatalogReview({ preview }: { preview: CatalogPreview }) {
  const providerRoster = preview.source === 'mal' || preview.source === 'anilist';
  return (
    <section className="catalog-review" aria-label="Catalog preview">
      <h3>Catalog preview</h3>
      <p className="small">{catalogSourceLabel(preview)}</p>
      {providerRoster && preview.artworkCount === 0 && (
        <p className="catalog-artwork-note" role="note">
          These characters have no pictures, so their cards will show initials. To show artwork, go
          back to step 2, tick <strong>Include character artwork through API</strong> and prepare
          the roster again.
        </p>
      )}
      {preview.artworkCount > 0 && preview.artworkCount < preview.characterCount && (
        <p className="small quiet">
          {preview.artworkCount.toLocaleString()} of{' '}
          {preview.characterCount.toLocaleString()} characters have artwork.
        </p>
      )}
      <p>
        {preview.characterCount} characters; {preview.packs.length} starter packs.{' '}
        {preview.packPrice} gems per pack, {preview.packSize} card(s) per opening.
      </p>
      <p className="small">
        Source: {preview.source} / {preview.revision}. Permission statement: {preview.license}
      </p>
      <p>
        Common: {preview.tiers.common}; uncommon: {preview.tiers.uncommon}; rare:{' '}
        {preview.tiers.rare}; epic: {preview.tiers.epic}; legendary: {preview.tiers.legendary}.
      </p>
      <p className="small quiet">
        Odds describe the first draw in an empty realm. Claims and wishlists change availability. At
        least one starter pack must be playable.
      </p>
      <div className="catalog-table" tabIndex={0} role="region" aria-label="Starter pack preview">
        <table>
          <caption>Generated starter packs</caption>
          <thead>
            <tr>
              <th scope="col">Pack</th>
              <th scope="col">Pool</th>
              <th scope="col">Playable</th>
              <th scope="col">Available rarity odds</th>
            </tr>
          </thead>
          <tbody>
            {preview.packs.map((pack) => (
              <tr key={JSON.stringify(pack.category)}>
                <th scope="row">{pack.name}</th>
                <td>{pack.poolSize}</td>
                <td>{pack.openable ? 'Yes' : 'No'}</td>
                <td>
                  {(['common', 'uncommon', 'rare', 'epic', 'legendary'] as const)
                    .map((tier) => `${tier}: ${(pack.odds[tier] * 100).toFixed(2)}%`)
                    .join(' / ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>
          Review characters and assigned tiers
          {preview.characterCount > preview.characters.length &&
            ` (first ${preview.characters.length.toLocaleString()} of ${preview.characterCount.toLocaleString()})`}
        </summary>
        <div className="catalog-table" tabIndex={0} role="region" aria-label="Character tiers">
          <table>
            <caption>Original character assignments</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Series</th>
                <th scope="col">Tier</th>
                <th scope="col">Stable source key</th>
              </tr>
            </thead>
            <tbody>
              {preview.characters.slice(0, 300).map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.name}</th>
                  <td>{c.series}</td>
                  <td>{c.tier}</td>
                  <td>{c.sourceKey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
