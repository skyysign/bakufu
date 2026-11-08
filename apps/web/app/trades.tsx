'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { GameIcon } from './game-art';
import type { ClientRealmView as RealmView } from '../lib/client-view';
import type { TradeView } from '@card-engine/core';
import { MemberPicker, memberName } from './member-picker';
import { CardPicker, InspectableCard } from './card-browser';
import { PageHeader } from './app-shell';
type Command =
  | { action: 'create'; counterpartyCode: string; offer: { cardIds: string[]; gems: number } }
  | { action: 'edit'; tradeId: string; version: number; offer: { cardIds: string[]; gems: number } }
  | { action: 'confirm' | 'cancel'; tradeId: string; version: number };
function OfferForm({
  view,
  trade,
  disabled,
  onSubmit,
}: {
  view: RealmView;
  trade?: TradeView;
  disabled: boolean;
  onSubmit: (command: Command) => void;
}) {
  const [partner, setPartner] = useState('');
  const [selected, setSelected] = useState(trade?.myOffer.cards.map((c) => c.cardId) ?? []);
  const rules = trade?.rules ?? view.config.trading;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      offer = { cardIds: form.getAll('card').map(String), gems: Number(form.get('gems')) };
    onSubmit(
      trade
        ? { action: 'edit', tradeId: trade.id, version: trade.version, offer }
        : { action: 'create', counterpartyCode: String(form.get('partner')).trim(), offer },
    );
  }
  const prefix = trade?.id ?? 'new-trade';
  return (
    <form onSubmit={submit} className="offer-form">
      <fieldset disabled={disabled} className="trade-form">
        {!trade && (
          <MemberPicker
            realmId={view.id}
            prefix={prefix}
            disabled={disabled}
            value={partner}
            onChange={setPartner}
          />
        )}
        <div className="offer-gem-field">
          <label htmlFor={`${prefix}-gems`}>Gems you offer</label>
          <div className="input-with-icon">
            <GameIcon name="gem" />
            <input
              id={`${prefix}-gems`}
              name="gems"
              type="number"
              defaultValue={trade?.myOffer.gems ?? 0}
              min={0}
              max={rules.maxGemsPerSide}
              step={1}
              required
            />
          </div>
        </div>
        <fieldset className="trade-card-choices">
          <legend>Cards you offer · up to {rules.maxCardsPerSide}</legend>
          {selected.map((id) => (
            <input key={id} type="hidden" name="card" value={id} />
          ))}
          <CardPicker
            title="Choose cards to trade"
            trigger="Browse your collection"
            cards={view.cards.map((card) => ({
              ...card,
              id: card.cardId,
              characterId: card.id,
              valuation: view.characterValues[card.id],
              disabled: card.lockedForTrade && !selected.includes(card.cardId),
              note:
                card.lockedForTrade && !selected.includes(card.cardId)
                  ? 'Reserved in another offer'
                  : undefined,
            }))}
            selected={selected}
            onChange={setSelected}
            maximum={rules.maxCardsPerSide}
            disabled={disabled || !view.cards.length}
          />
          <div className="trade-selected-cards">
            {view.cards
              .filter((card) => selected.includes(card.cardId))
              .map((card) => (
                <div key={card.cardId}>
                  <InspectableCard card={{ ...card, valuation: view.characterValues[card.id] }} />
                  <button
                    type="button"
                    className="secondary"
                    disabled={disabled}
                    onClick={() => setSelected(selected.filter((id) => id !== card.cardId))}
                  >
                    Remove {card.name}
                  </button>
                </div>
              ))}
          </div>
          {!view.cards.length && (
            <p className="field-help">You have no cards to offer yet — you can still offer gems.</p>
          )}
        </fieldset>
        <button className="accent">{trade ? 'Save my offer' : 'Send trade offer'}</button>
      </fieldset>
    </form>
  );
}
function Offer({
  title,
  offer,
  confirmed,
  characters,
  characterValues,
}: {
  title: string;
  offer: TradeView['myOffer'];
  confirmed: boolean;
  characters: RealmView['characters'];
  characterValues: RealmView['characterValues'];
}) {
  return (
    <div className="trade-side">
      <div className="trade-side-heading">
        <h4>{title}</h4>
        <p className="offer-gems">
          <GameIcon name="gem" />
          <strong>{offer.gems.toLocaleString()}</strong> gems
        </p>
      </div>
      {offer.cards.length ? (
        <ul>
          {offer.cards.map((card) => (
            <li key={card.cardId} className={`offer-card ${card.tier}`}>
              <InspectableCard
                card={{
                  ...(characters[card.characterId] ?? {
                    id: card.characterId,
                    name: card.name,
                    series: '',
                    tier: card.tier,
                    categories: [],
                  }),
                  valuation: characterValues[card.characterId],
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="offer-empty">No cards offered</p>
      )}
      <p className={`offer-confirmation ${confirmed ? 'confirmed' : ''}`}>
        <GameIcon name={confirmed ? 'check' : 'clock'} />
        {confirmed ? 'Confirmed this version' : 'Awaiting confirmation'}
      </p>
    </div>
  );
}
export function Trades({
  view,
  disabled,
  onLockChange,
}: {
  view: RealmView;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [editing, setEditing] = useState<string | null>(null),
    [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'history'>('all');
  const [pending, setPending] = useState<{
    command: Command;
    requestKey: string;
    expectedRevision: number;
  } | null>(null);
  useEffect(() => {
    onLockChange(busy || !!pending);
  }, [busy, pending, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);
  async function send(command: Command) {
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
      const response = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realmId: view.id, ...attempt }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) {
          setPending(null);
          router.refresh();
        }
        throw new Error(result.error ?? 'The trade request failed.');
      }
      setPending(null);
      setMessage(result.message);
      setEditing(null);
      setCreating(false);
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = disabled || busy || !!pending;
  const inProgress = view.trades.filter((trade) => trade.status === 'pending').length;
  const shown = view.trades.filter(
    (trade) =>
      filter === 'all' ||
      (filter === 'pending' ? trade.status === 'pending' : trade.status !== 'pending'),
  );
  return (
    <section id="trades" className="section trades-panel" aria-label="Your trades">
      <PageHeader
        title="Trades"
        lede="Swap cards and gems with another collector. Nothing changes hands until you both confirm the same offer."
        actions={
          <button
            className="secondary"
            disabled={locked}
            onClick={() => {
              setMessage('');
              setError('');
              router.refresh();
            }}
          >
            <GameIcon name="refresh" />
            Refresh trades
          </button>
        }
      />
      <div className="trade-overview">
        <div className="trade-passport panel">
          <label htmlFor="my-trade-code">Your trade ID in this realm</label>
          <div className="copy-field">
            <input
              id="my-trade-code"
              readOnly
              value={view.tradeCode}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(view.tradeCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  document.getElementById('my-trade-code')?.focus();
                }
              }}
            >
              <GameIcon name={copied ? 'check' : 'copy'} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="field-help">
            {view.discordProfile
              ? `Others can also find you as ${view.discordProfile.displayName ?? view.discordProfile.username} (@${view.discordProfile.username}).`
              : 'Share this ID with another player in this realm. It grants no account access.'}
          </p>
        </div>
        <details
          className="trade-start panel"
          open={creating}
          onToggle={(event) => setCreating(event.currentTarget.open)}
        >
          <summary>Start a trade</summary>
          {view.config.trading.enabled ? (
            creating ? (
              <OfferForm view={view} disabled={locked} onSubmit={send} />
            ) : null
          ) : (
            <p className="quiet">New trades are disabled in this realm.</p>
          )}
        </details>
      </div>
      <p className="error" role="alert">
        {error}
      </p>
      <p className="success-note toast-line" role="status">
        {message}
      </p>
      {pending && !busy && (
        <div className="setup-note">
          <p>The result is unconfirmed. Retry the same request before making another change.</p>
          <button disabled={disabled} onClick={() => send(pending.command)}>
            Retry trade request
          </button>
        </div>
      )}
      <div className="trade-filters segmented" role="group" aria-label="Filter trades">
        {(['all', 'pending', 'history'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === 'all' ? 'All trades' : value === 'pending' ? 'In progress' : 'History'}
            {value === 'pending' && ` (${inProgress})`}
          </button>
        ))}
      </div>
      <div className="trade-list">
        {shown.map((trade) => (
          <article
            key={trade.id}
            className={`trade-entry status-${trade.status}`}
            aria-label={`Trade ${trade.id}`}
          >
            <header className="trade-entry-header">
              <h3>
                Trade<span className="sr-only"> · </span>
                <span className="trade-status">{trade.status}</span>
              </h3>
              <p>
                With{' '}
                <strong title={trade.counterpartyCode}>
                  {memberName(
                    view.tradePartners.find(
                      (member) => member.tradeCode === trade.counterpartyCode,
                    ) ?? { tradeCode: trade.counterpartyCode, username: null, displayName: null },
                  )}
                </strong>{' '}
                · Offer version {trade.version}
                {trade.status === 'pending' &&
                  ` · Expires ${new Date(trade.expiresAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}`}
              </p>
            </header>
            <div className="trade-offers">
              <Offer
                title="You give"
                offer={trade.myOffer}
                confirmed={trade.myConfirmed}
                characters={view.characters}
                characterValues={view.characterValues}
              />
              <span className="trade-swap" aria-hidden="true">
                <GameIcon name="trades" />
              </span>
              <Offer
                title="You receive"
                characters={view.characters}
                characterValues={view.characterValues}
                offer={trade.theirOffer}
                confirmed={trade.theirConfirmed}
              />
            </div>
            {trade.status === 'pending' && (
              <>
                <div className="trade-actions">
                  <button
                    className="accent"
                    disabled={locked || trade.myConfirmed}
                    onClick={() =>
                      send({ action: 'confirm', tradeId: trade.id, version: trade.version })
                    }
                  >
                    {trade.myConfirmed ? 'Your confirmation saved' : 'Confirm this offer'}
                  </button>
                  <button
                    className="secondary"
                    disabled={locked}
                    onClick={() => setEditing(editing === trade.id ? null : trade.id)}
                  >
                    Edit my offer
                  </button>
                  <button
                    className="secondary"
                    disabled={locked}
                    onClick={() =>
                      send({ action: 'cancel', tradeId: trade.id, version: trade.version })
                    }
                  >
                    Cancel trade
                  </button>
                </div>
                <p className="field-help">
                  Review both sides first — the second confirmation completes the trade instantly.
                </p>
                {editing === trade.id && (
                  <OfferForm
                    key={`${trade.id}:${trade.version}`}
                    view={view}
                    trade={trade}
                    disabled={locked}
                    onSubmit={send}
                  />
                )}
              </>
            )}
          </article>
        ))}
        {!shown.length && (
          <div className="empty panel">
            <span className="empty-icon" aria-hidden="true">
              <GameIcon name="trades" />
            </span>
            <h3>{view.trades.length ? 'Nothing here.' : 'No trades yet.'}</h3>
            <p className="quiet">
              {view.trades.length
                ? 'Try another filter.'
                : 'Start a trade to offer cards or gems to another collector.'}
            </p>
          </div>
        )}
      </div>
      {view.trades.length >= 100 && (
        <p className="field-help">
          Showing the latest 100 trades. Your collection export includes your full history.
        </p>
      )}
    </section>
  );
}
