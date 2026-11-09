'use client';
import { useMemo, useState } from 'react';
import type { SeriesProgress } from '../lib/client-view';
import { GameIcon } from './game-art';

/**
 * Collection → Series: how much of each started series you own, and how many
 * of the rest can still be pulled. Choosing a series shows its cards.
 */
export function SeriesProgressList({
  progress,
  seriesCount,
  onOpen,
}: {
  progress: SeriesProgress[];
  seriesCount: number;
  onOpen: (series: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [sort, setSort] = useState<'progress' | 'owned' | 'name'>('progress');
  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = progress.filter((entry) => !text || entry.series.toLowerCase().includes(text));
    return sort === 'name'
      ? [...list].sort((a, b) => a.series.localeCompare(b.series))
      : sort === 'owned'
        ? [...list].sort((a, b) => b.owned - a.owned || a.series.localeCompare(b.series))
        : list;
  }, [progress, query, sort]);
  const complete = progress.filter((entry) => entry.owned === entry.total).length;
  return (
    <section className="series-progress" aria-labelledby="series-progress-title">
      <h2 id="series-progress-title" className="sr-only">
        Series
      </h2>
      <p className="quiet">
        You have cards from {progress.length.toLocaleString()} of {seriesCount.toLocaleString()}{' '}
        series{complete > 0 && ` · ${complete.toLocaleString()} complete`}.
      </p>
      <div className="collection-toolbar">
        <div className="search-field">
          <label className="sr-only" htmlFor="series-search">
            Search your series
          </label>
          <GameIcon name="search" />
          <input
            id="series-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search series"
          />
        </div>
        <div>
          <label className="sr-only" htmlFor="series-sort">
            Sort series
          </label>
          <select
            id="series-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
          >
            <option value="progress">Most complete</option>
            <option value="owned">Most cards</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </div>
      {shown.length ? (
        <ul className="series-list">
          {shown.map((entry) => {
            const share = entry.owned / entry.total;
            return (
              <li key={entry.series}>
                <button
                  type="button"
                  className="series-row"
                  aria-label={`${entry.series}: ${entry.owned} of ${entry.total} collected. Show these cards`}
                  onClick={() => onOpen(entry.series)}
                >
                  <span className="series-name">
                    <strong>{entry.series}</strong>
                    <small>
                      {entry.owned === entry.total
                        ? 'Complete'
                        : `${entry.available.toLocaleString()} still in packs · ${(
                            entry.total -
                            entry.owned -
                            entry.available
                          ).toLocaleString()} owned by others`}
                    </small>
                  </span>
                  <span className="series-count">
                    {entry.owned.toLocaleString()} / {entry.total.toLocaleString()}
                  </span>
                  <span
                    className={`series-bar ${entry.owned === entry.total ? 'complete' : ''}`}
                    aria-hidden="true"
                  >
                    <span style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty">
          <h3>No matching series.</h3>
          <p className="quiet">Try a different name.</p>
        </div>
      )}
    </section>
  );
}
