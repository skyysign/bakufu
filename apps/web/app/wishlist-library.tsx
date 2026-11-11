'use client';
import { useCallback, useEffect, useState } from 'react';
import type { CatalogBrowsePage } from '@card-engine/db';
import type { ClientRealmView as RealmView } from '../lib/client-view';
import { tiers } from '@card-engine/config';
import { InspectableCard, CardPicker, type CardLoader } from './card-browser';
import { PageHeader } from './app-shell';
import { GameIcon } from './game-art';

const statusName = (status: string) =>
  status === 'yours'
    ? 'In your collection'
    : status === 'claimed'
      ? 'Owned by another collector'
      : 'Unclaimed';
const glossaryPageSize = 24;

async function fetchCatalog(
  realmId: string,
  input: Record<string, string | number | boolean>,
  signal?: AbortSignal,
): Promise<CatalogBrowsePage> {
  const parameters = new URLSearchParams({ realmId });
  for (const [key, value] of Object.entries(input)) parameters.set(key, String(value));
  const response = await fetch(`/api/catalog?${parameters}`, { signal, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Could not load characters.');
  return result as CatalogBrowsePage;
}

export function WishlistLibrary({
  view,
  disabled,
  onWish,
  onAdd,
}: {
  view: RealmView;
  disabled: boolean;
  onWish: (id: string, present: boolean) => void;
  /** Adds the characters picked together in the browser. */
  onAdd: (ids: string[]) => void;
}) {
  const [tab, setTab] = useState<'wishes' | 'glossary'>('wishes'),
    [search, setSearch] = useState(''),
    [tier, setTier] = useState('all'),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(0),
    [glossary, setGlossary] = useState<CatalogBrowsePage | null>(null),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState('');
  const wished = new Set(view.wishlist.map((character) => character.id));
  const free = Math.max(0, view.effectiveWishlistSlots - view.wishlist.length);
  const full = free === 0;
  const refreshKey = `${view.cards.length}:${view.wishlist.map((entry) => entry.id).join(',')}:${view.configRevision}`;
  useEffect(() => {
    if (tab !== 'glossary') return;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await fetchCatalog(
          view.id,
          {
            query: search.trim(),
            tier,
            status,
            offset: page * glossaryPageSize,
            limit: glossaryPageSize,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setGlossary(result);
          setLoadError('');
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setLoadError(failure instanceof Error ? failure.message : 'Could not load characters.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tab, view.id, search, tier, status, page, refreshKey]);
  const loadWishCandidates = useCallback<CardLoader>(
    async ({ query, tier: rarity, offset, limit, signal }) => {
      const result = await fetchCatalog(
        view.id,
        { query, tier: rarity, offset, limit, excludeWished: true },
        signal,
      );
      return {
        total: result.total,
        cards: result.characters.map((character) => ({
          ...character,
          note: statusName(character.status),
        })),
      };
    },
    [view.id],
  );
  const total = glossary?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / glossaryPageSize)),
    shown = Math.min(page, pages - 1),
    // Labels describe the cards on screen and change together with them;
    // Previous/Next keep using the requested page so quick clicks still advance.
    loadedPage = glossary ? Math.min(Math.floor(glossary.offset / glossaryPageSize), pages - 1) : 0;
  const emptySlots = Math.max(0, Math.min(12, view.effectiveWishlistSlots) - view.wishlist.length);
  return (
    <section
      id="wishlist"
      className="wishlist-library"
      aria-label="Wishlist and character glossary"
    >
      <PageHeader
        title="Wishlist"
        lede={
          view.effectiveWishlistSlots === 0
            ? 'Wishlists are turned off in this realm.'
            : `Wished characters are ${view.config.wishlist.weightMultiplier}× as likely within their rarity. Rarity odds never change.`
        }
        actions={
          tab === 'wishes' ? (
            // Pick as many characters as there are free slots, then add them together.
            <CardPicker
              title="Choose wishlist characters"
              trigger={
                full
                  ? 'Browse characters'
                  : `Browse characters (${free} free ${free === 1 ? 'slot' : 'slots'})`
              }
              maximum={free}
              selected={[]}
              disabled={disabled || full}
              load={loadWishCandidates}
              confirmManyLabel={(count) =>
                count ? `Add ${count} to wishlist` : 'Choose characters to add'
              }
              onChange={(ids) => {
                if (ids.length) onAdd(ids);
              }}
            />
          ) : undefined
        }
      />
      <div className="library-tabs segmented" role="group" aria-label="Wishlist view">
        <button aria-pressed={tab === 'wishes'} onClick={() => setTab('wishes')}>
          Your wishlist · {view.wishlist.length}/{view.effectiveWishlistSlots}
        </button>
        <button aria-pressed={tab === 'glossary'} onClick={() => setTab('glossary')}>
          Character glossary · {view.catalogSize.toLocaleString()}
        </button>
      </div>
      {tab === 'wishes' ? (
        <>
          <div className="card-browser-grid wishlist-card-grid">
            {view.wishlist.map((character) => (
              <article className={`wishlist-character ${character.tier}`} key={character.entryId}>
                <InspectableCard
                  card={{
                    ...character,
                    note: statusName(character.status),
                    valuation: view.characterValues[character.id],
                  }}
                />
                <p className={`library-card-status status-${character.status}`}>
                  {statusName(character.status)}
                </p>
                <details className="card-chances">
                  <summary>
                    Next-draw chances<span className="sr-only"> for {character.name}</span>
                  </summary>
                  <dl>
                    {view.packs.map((pack) => (
                      <div key={pack.id}>
                        <dt>{pack.name}</dt>
                        <dd>{((pack.wishlistOdds[character.id] ?? 0) * 100).toFixed(3)}%</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                <button
                  className="secondary"
                  aria-label={`Remove ${character.name} from wishlist`}
                  disabled={disabled}
                  onClick={() => onWish(character.id, false)}
                >
                  Remove wish
                </button>
              </article>
            ))}
            {Array.from({ length: emptySlots }, (_, index) => (
              <div className="wish-slot" key={`slot-${index}`} aria-hidden="true">
                <GameIcon name="wishlist" />
                <span>Empty slot</span>
              </div>
            ))}
          </div>
          {!view.wishlist.length && view.effectiveWishlistSlots > 0 && (
            <p className="empty">
              Your wishlist is empty. Browse the characters to find a favorite.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="card-browser-toolbar">
            <label className="search-field">
              <span className="sr-only">Search character glossary</span>
              <GameIcon name="search" />
              <input
                type="search"
                value={search}
                placeholder="Search characters, series or categories"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              <span className="sr-only">Filter glossary rarity</span>
              <select
                value={tier}
                onChange={(event) => {
                  setTier(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All rarities</option>
                {tiers.map((value) => (
                  <option key={value} value={value}>
                    {value[0].toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter character ownership</span>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All characters</option>
                <option value="available">Unclaimed</option>
                <option value="yours">Your collection</option>
                <option value="claimed">Claimed by others</option>
              </select>
            </label>
          </div>
          <p className="card-browser-count" role="status">
            {!glossary && loading
              ? 'Loading characters…'
              : `${total.toLocaleString()} characters · Page ${loadedPage + 1} of ${pages}`}
          </p>
          {loadError && (
            <p className="error" role="alert">
              {loadError}
            </p>
          )}
          <div className="card-browser-grid glossary-grid" aria-busy={loading || undefined}>
            {(glossary?.characters ?? []).map((character) => (
              <article key={character.id} className={character.tier}>
                <InspectableCard
                  card={{
                    ...character,
                    note: statusName(character.status),
                  }}
                />
                <p className={`library-card-status status-${character.status}`}>
                  {statusName(character.status)}
                </p>
                <button
                  className="secondary"
                  aria-label={`Add ${character.name} to wishlist`}
                  disabled={disabled || full || wished.has(character.id)}
                  onClick={() => onWish(character.id, true)}
                >
                  {wished.has(character.id) ? (
                    <>
                      <GameIcon name="check" /> On your wishlist
                    </>
                  ) : (
                    <>
                      <GameIcon name="wishlist" /> Add to wishlist
                    </>
                  )}
                </button>
              </article>
            ))}
          </div>
          {glossary && !glossary.characters.length && !loading && (
            <p className="empty">No matching characters. Try another filter.</p>
          )}
          <div className="library-pagination">
            <button className="secondary" disabled={shown === 0} onClick={() => setPage(shown - 1)}>
              Previous page
            </button>
            <span>
              {loadedPage + 1} / {pages}
            </span>
            <button
              className="secondary"
              disabled={shown + 1 >= pages}
              onClick={() => setPage(shown + 1)}
            >
              Next page
            </button>
          </div>
        </>
      )}
    </section>
  );
}
