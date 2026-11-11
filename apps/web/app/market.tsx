'use client';
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { MarketListing } from '@card-engine/db';
import type { ClientRealmView as RealmView } from '../lib/client-view';
import { GameIcon } from './game-art';
import { CardFace, CardPicker, InspectableCard } from './card-browser';
import { PageHeader } from './app-shell';
type Listing = MarketListing;
type MarketPage = {
  listings: Listing[];
  tradingEnabled: boolean;
  balance: number;
  nextOffset: number | null;
  maxPrice: number;
};
type Command =
  | { action: 'list'; cardId: string; price: number }
  | { action: 'buy' | 'cancel'; listingId: string };
export function Market({
  view,
  disabled,
  onLockChange,
}: {
  view: RealmView;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const router = useRouter(),
    [data, setData] = useState<MarketPage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''),
    [scope, setScope] = useState<'all' | 'mine'>('all'),
    [offset, setOffset] = useState(0),
    [confirm, setConfirm] = useState<Listing | null>(null);
  const [pending, setPending] = useState<{
    command: Command;
    requestKey: string;
    expectedRevision: number;
  } | null>(null);
  const [card, setCard] = useState(''),
    [price, setPrice] = useState(String(view.config.recycleRewards.common));
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/market?realmId=${encodeURIComponent(view.id)}&scope=${scope}&offset=${offset}&query=${encodeURIComponent(query)}`,
          { signal, cache: 'no-store' },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not load the market.');
        setData(result);
      } catch (failure) {
        if (!signal?.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load the market.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [view.id, scope, offset, query],
  );
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => void load(controller.signal), 150);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [load, view.configRevision, view.balance, view.cards.length]);
  useEffect(() => {
    onLockChange(busy || !!pending);
  }, [busy, pending, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);
  async function execute(command: Command) {
    if (busy || disabled) return;
    const attempt = pending ?? {
      command,
      requestKey: crypto.randomUUID(),
      expectedRevision: view.configRevision,
    };
    setPending(attempt);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realmId: view.id, ...attempt }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) {
          setPending(null);
          setConfirm(null);
          router.refresh();
          void load();
        }
        throw new Error(result.error ?? 'Could not update the market.');
      }
      setPending(null);
      setConfirm(null);
      setCard('');
      setMessage(result.message ?? 'Market action saved.');
      router.refresh();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update the market.');
    } finally {
      setBusy(false);
    }
  }
  function sell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (card) void execute({ action: 'list', cardId: card, price: Number(price) });
  }
  const available = view.cards.filter((item) => !item.lockedForTrade && !item.listedForSale);
  const selectedCard = view.cards.find((entry) => entry.cardId === card);
  return (
    <section id="market" className="section market-section" aria-label="Realm market">
      <PageHeader
        title="Market"
        lede="Buy and sell cards for gems with the collectors in your realm."
        actions={
          <button
            className="secondary"
            disabled={busy || !!pending || loading}
            onClick={() => {
              setError('');
              void load();
              router.refresh();
            }}
          >
            <GameIcon name="refresh" />
            Refresh market
          </button>
        }
      />
      <div className="market-layout">
        <div className="market-main">
          <div className="market-toolbar">
            <div className="search-field">
              <label className="sr-only" htmlFor="market-search">
                Search market
              </label>
              <GameIcon name="search" />
              <input
                id="market-search"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOffset(0);
                }}
                placeholder="Search characters, series or sellers"
              />
            </div>
            <div>
              <label className="sr-only" htmlFor="market-scope">
                Show listings
              </label>
              <select
                id="market-scope"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as 'all' | 'mine');
                  setOffset(0);
                }}
              >
                <option value="all">For sale now</option>
                <option value="mine">My listings &amp; history</option>
              </select>
            </div>
          </div>
          {data?.tradingEnabled === false && (
            <p className="notice">
              Trading and new purchases are disabled in this realm. You can still cancel your own
              listings.
            </p>
          )}
          {pending && (
            <button disabled={busy || disabled} onClick={() => execute(pending.command)}>
              Retry market action
            </button>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="success-note toast-line" role="status">
              {message}
            </p>
          )}
          {confirm && (
            <div className="purchase-confirm" role="group" aria-label="Confirm market purchase">
              <p>
                Buy <strong>{confirm.name}</strong> for{' '}
                <strong className="gem-text">
                  <GameIcon name="gem" />
                  {confirm.price.toLocaleString()}
                </strong>{' '}
                from {confirm.sellerName ?? `Collector ${confirm.sellerCode.slice(0, 8)}`}?
              </p>
              <div className="purchase-confirm-actions">
                <button
                  className="accent"
                  disabled={busy || disabled}
                  onClick={() => execute({ action: 'buy', listingId: confirm.id })}
                >
                  Confirm market purchase
                </button>
                <button
                  className="secondary"
                  disabled={busy || !!pending}
                  onClick={() => setConfirm(null)}
                >
                  Cancel purchase
                </button>
              </div>
            </div>
          )}
          {loading && !data ? (
            <p className="loading-line" role="status">
              Loading listings…
            </p>
          ) : data?.listings.length ? (
            <div className="market-grid">
              {data.listings.map((listing) => (
                <article className={`market-card card-listing ${listing.tier}`} key={listing.id}>
                  <InspectableCard
                    card={{
                      id: listing.characterId,
                      name: listing.name,
                      series: listing.series,
                      tier: listing.tier,
                      categories: listing.categories ?? [],
                      sourceKey: listing.sourceKey,
                      ...(listing.artwork ? { artwork: listing.artwork } : {}),
                      valuation: listing.valuation ?? view.characterValues[listing.characterId],
                    }}
                  />
                  <div className="character-body">
                    <div className="market-price">
                      <GameIcon name="gem" />
                      <strong>{listing.price.toLocaleString()}</strong>
                      <small>asking price</small>
                    </div>
                    <p className="seller-name">
                      {listing.isMine ? (
                        'Your listing'
                      ) : (
                        <>
                          Sold by{' '}
                          <Link
                            scroll={false}
                            href={`/profile?realm=${encodeURIComponent(view.id)}&player=${encodeURIComponent(listing.sellerCode)}`}
                          >
                            {listing.sellerName ?? `Collector ${listing.sellerCode.slice(0, 8)}`}
                          </Link>
                        </>
                      )}
                    </p>
                    {listing.status !== 'active' ? (
                      <span className={`badge listing-${listing.status}`}>{listing.status}</span>
                    ) : listing.isMine ? (
                      <button
                        className="secondary wide"
                        disabled={busy || disabled || !!pending}
                        onClick={() => execute({ action: 'cancel', listingId: listing.id })}
                      >
                        Cancel listing
                      </button>
                    ) : (
                      <button
                        className="wide"
                        disabled={
                          busy ||
                          disabled ||
                          !!pending ||
                          !data.tradingEnabled ||
                          data.balance < listing.price ||
                          listing.price > data.maxPrice
                        }
                        onClick={() => setConfirm(listing)}
                      >
                        {listing.price > data.maxPrice
                          ? 'Exceeds realm price limit'
                          : data.balance < listing.price
                            ? 'Not enough gems'
                            : 'Buy card'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty panel">
              <span className="empty-icon" aria-hidden="true">
                <GameIcon name="market" />
              </span>
              <h3>{query ? 'No matching listings.' : 'Nothing for sale yet.'}</h3>
              <p className="quiet">
                {query
                  ? 'Try another character, series or seller.'
                  : 'List a card from your collection to get the market started.'}
              </p>
            </div>
          )}
          <div className="market-pagination">
            {offset > 0 && (
              <button className="secondary" onClick={() => setOffset(Math.max(0, offset - 30))}>
                Previous listings
              </button>
            )}
            {data?.nextOffset !== null && data?.nextOffset !== undefined && (
              <button className="secondary" onClick={() => setOffset(data.nextOffset!)}>
                More listings
              </button>
            )}
          </div>
        </div>
        <aside className="sell-panel panel" aria-labelledby="sell-title">
          <h2 id="sell-title">Sell a card</h2>
          <form onSubmit={sell}>
            <fieldset
              className="sell-fields"
              disabled={busy || disabled || !!pending || data?.tradingEnabled === false}
            >
              <div className="sell-step">
                <span className="sell-step-label" aria-hidden="true">
                  1 · Card
                </span>
                {selectedCard ? (
                  <div className="sell-selected">
                    <CardFace
                      card={{
                        ...selectedCard,
                        id: selectedCard.cardId,
                        characterId: selectedCard.id,
                        valuation: view.characterValues[selectedCard.id],
                      }}
                    />
                  </div>
                ) : (
                  <p className="sell-empty">
                    {available.length
                      ? 'Pick one of your cards. You can search by name, series or category.'
                      : 'No cards to sell right now. Cards in a trade or already listed are reserved.'}
                  </p>
                )}
                <CardPicker
                  title="Choose a card to sell"
                  trigger={selectedCard ? 'Change card' : 'Choose a card to sell'}
                  confirmLabel="Choose card"
                  single
                  maximum={1}
                  selected={card ? [card] : []}
                  disabled={
                    busy ||
                    disabled ||
                    !!pending ||
                    data?.tradingEnabled === false ||
                    !available.length
                  }
                  cards={available.map((item) => ({
                    ...item,
                    id: item.cardId,
                    characterId: item.id,
                    valuation: view.characterValues[item.id],
                  }))}
                  onChange={(ids) => {
                    const id = ids[0] ?? '';
                    setCard(id);
                    const chosen = view.cards.find((entry) => entry.cardId === id);
                    if (chosen)
                      setPrice(
                        String(Math.max(1, view.characterValues[chosen.id]?.marketValue ?? 1)),
                      );
                  }}
                />
              </div>
              <div className="sell-step">
                <span className="sell-step-label" aria-hidden="true">
                  2 · Price
                </span>
                <label htmlFor="market-price">Asking price (gems)</label>
                <input
                  id="market-price"
                  type="number"
                  min={1}
                  max={data?.maxPrice ?? 1000000}
                  step={1}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                />
                {selectedCard && (
                  <p className="field-help">
                    Suggested value:{' '}
                    <button
                      type="button"
                      className="text-button gem-text"
                      onClick={() =>
                        setPrice(
                          String(
                            Math.max(1, view.characterValues[selectedCard.id]?.marketValue ?? 1),
                          ),
                        )
                      }
                    >
                      <GameIcon name="gem" />
                      {(view.characterValues[selectedCard.id]?.marketValue ?? 0).toLocaleString()}
                      <span className="sr-only"> gems, use as price</span>
                    </button>
                  </p>
                )}
              </div>
              <button className="wide accent" disabled={!card}>
                List card · {price || 0} gems
              </button>
              <p className="field-help">
                Listed cards can’t be recycled or traded until they sell or you cancel the listing.
              </p>
            </fieldset>
          </form>
        </aside>
      </div>
    </section>
  );
}
