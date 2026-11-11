'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GameIcon } from './game-art';
import type { ClientRealmView as RealmView } from '../lib/client-view';
import type { CharacterValue, TradeView } from '@card-engine/core';
import { MemberPicker, memberName } from './member-picker';
import { CardPicker, InspectableCard, type BrowseCard } from './card-browser';
import { PageHeader } from './app-shell';

type Side = { cardIds: string[]; gems: number };
type Command =
  | { action: 'create'; counterpartyCode: string; offer: Side; request: Side }
  | { action: 'edit'; tradeId: string; version: number; offer: Side; request?: Side }
  | { action: 'confirm' | 'cancel'; tradeId: string; version: number };
type PartnerCard = BrowseCard & {
  cardId: string;
  lockedForTrade: boolean;
  listedForSale: boolean;
};
type Partner = {
  partner: { tradeCode: string; username: string | null; displayName: string | null };
  cards: PartnerCard[];
};
const emptySide: Side = { cardIds: [], gems: 0 };
const sideOf = (offer: TradeView['myOffer']): Side => ({
  cardIds: offer.cards.map((card) => card.cardId),
  gems: offer.gems,
});

/** One side of an offer: chosen cards (from a picker), gems and the total value. */
function SideEditor({
  id,
  title,
  cards,
  side,
  onChange,
  maxCards,
  maxGems,
  disabled,
  readOnly,
  pickerTitle,
  emptyText,
}: {
  id: string;
  title: string;
  cards: BrowseCard[];
  side: Side;
  onChange: (side: Side) => void;
  maxCards: number;
  maxGems: number;
  disabled: boolean;
  readOnly?: boolean;
  pickerTitle: string;
  emptyText: string;
}) {
  const chosen = side.cardIds
    .map((cardId) => cards.find((card) => card.id === cardId))
    .filter((card): card is BrowseCard => !!card);
  const value =
    chosen.reduce((sum, card) => sum + (card.valuation?.marketValue ?? 0), 0) + side.gems;
  return (
    <section className="trade-side trade-side-editor" aria-labelledby={`${id}-title`}>
      <div className="trade-side-heading">
        <h3 id={`${id}-title`}>{title}</h3>
        <p className="offer-gems" title="Card values plus gems">
          ≈ <GameIcon name="gem" />
          <strong>{value.toLocaleString()}</strong>
        </p>
      </div>
      {chosen.length ? (
        <ul className="trade-chosen">
          {chosen.map((card) => (
            <li key={card.id} className={`offer-card ${card.tier}`}>
              <InspectableCard card={{ ...card, id: card.characterId ?? card.id }} />
              {!readOnly && (
                <button
                  type="button"
                  className="secondary"
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...side,
                      cardIds: side.cardIds.filter((other) => other !== card.id),
                    })
                  }
                >
                  Remove {card.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="offer-empty">{readOnly ? 'No cards' : emptyText}</p>
      )}
      {!readOnly && (
        <div className="trade-side-controls">
          <CardPicker
            title={pickerTitle}
            trigger={`Choose cards (${side.cardIds.length}/${maxCards})`}
            cards={cards}
            selected={side.cardIds}
            onChange={(cardIds) => onChange({ ...side, cardIds })}
            maximum={maxCards}
            disabled={disabled || !cards.length}
          />
          <div className="offer-gem-field">
            <label htmlFor={`${id}-gems`}>Gems</label>
            <div className="input-with-icon">
              <GameIcon name="gem" />
              <input
                id={`${id}-gems`}
                type="number"
                min={0}
                max={maxGems}
                step={1}
                inputMode="numeric"
                // Empty instead of 0: typing into a field showing 0 gave "0500".
                value={side.gems || ''}
                placeholder="0"
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...side,
                    gems: Math.max(
                      0,
                      Math.min(maxGems, Math.floor(Number(event.target.value)) || 0),
                    ),
                  })
                }
              />
            </div>
          </div>
        </div>
      )}
      {readOnly && side.gems > 0 && (
        <p className="field-help">+ {side.gems.toLocaleString()} gems</p>
      )}
    </section>
  );
}

/**
 * Writing an offer: pick a player, then both sides at once — your cards and
 * gems, and the cards and gems you want from them. Sending confirms your side;
 * the trade completes when they accept. Also used to counter or change an
 * offer (older trades can change only your own side).
 */
function TradeComposer({
  view,
  trade,
  partnerName,
  initialPartner,
  disabled,
  onSubmit,
  onClose,
}: {
  view: RealmView;
  trade?: TradeView;
  partnerName?: string;
  /** A new trade started from a player's profile. */
  initialPartner?: string;
  disabled: boolean;
  onSubmit: (command: Command) => void;
  onClose: () => void;
}) {
  const [partnerCode, setPartnerCode] = useState(trade?.counterpartyCode ?? initialPartner ?? ''),
    [partner, setPartner] = useState<Partner | null>(null),
    [partnerError, setPartnerError] = useState(''),
    [mine, setMine] = useState<Side>(trade ? sideOf(trade.myOffer) : emptySide),
    [theirs, setTheirs] = useState<Side>(trade ? sideOf(trade.theirOffer) : emptySide);
  const rules = trade?.rules ?? view.config.trading;
  const legacy = trade?.protocol === 1;
  const validCode = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    partnerCode,
  );
  useEffect(() => {
    setPartner(null);
    setPartnerError('');
    if (!validCode || partnerCode === view.tradeCode) return;
    const controller = new AbortController();
    fetch(
      `/api/trade-partner?realmId=${encodeURIComponent(view.id)}&code=${encodeURIComponent(partnerCode)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Could not load their collection.');
        setPartner(body as Partner);
      })
      .catch((failure) => {
        if ((failure as Error).name !== 'AbortError') setPartnerError((failure as Error).message);
      });
    return () => controller.abort();
  }, [partnerCode, validCode, view.id, view.tradeCode]);
  // A new trade starts empty for each partner.
  useEffect(() => {
    if (!trade) setTheirs(emptySide);
  }, [partnerCode, trade]);

  const myCards: BrowseCard[] = view.cards.map((card) => {
    const elsewhere =
      card.lockedForTrade && !trade?.myOffer.cards.some((c) => c.cardId === card.cardId);
    return {
      ...card,
      id: card.cardId,
      characterId: card.id,
      valuation: view.characterValues[card.id],
      disabled: elsewhere || card.listedForSale,
      note: card.listedForSale
        ? 'Listed on the market'
        : elsewhere
          ? 'Reserved in another trade'
          : undefined,
    };
  });
  const theirCards: BrowseCard[] = useMemo(
    () =>
      (partner?.cards ?? []).map((card) => {
        const inThisTrade = trade?.theirOffer.cards.some((c) => c.cardId === card.cardId);
        const blocked = card.listedForSale || (card.lockedForTrade && !inThisTrade);
        return {
          ...card,
          id: card.cardId,
          characterId: card.id,
          disabled: blocked,
          note: card.listedForSale
            ? 'Listed on the market'
            : blocked
              ? 'Reserved in another trade'
              : undefined,
        };
      }),
    [partner, trade],
  );
  // Cards already in the trade stay visible even before the partner list loads.
  const theirKnown: BrowseCard[] = theirCards.length
    ? theirCards
    : (trade?.theirOffer.cards ?? []).map((card) => ({
        ...(view.characters[card.characterId] ?? {
          name: card.name,
          series: '',
          categories: [],
          tier: card.tier,
        }),
        id: card.cardId,
        characterId: card.characterId,
        valuation: view.characterValues[card.characterId],
      }));
  const name =
    partnerName ?? (partner ? memberName(partner.partner) : validCode ? 'this player' : '');
  const empty = !mine.cardIds.length && !mine.gems && !theirs.cardIds.length && !theirs.gems;
  const unchanged =
    !!trade &&
    JSON.stringify([[...mine.cardIds].sort(), mine.gems]) ===
      JSON.stringify([sideOf(trade.myOffer).cardIds.sort(), trade.myOffer.gems]) &&
    JSON.stringify([[...theirs.cardIds].sort(), theirs.gems]) ===
      JSON.stringify([sideOf(trade.theirOffer).cardIds.sort(), trade.theirOffer.gems]);
  function submit() {
    if (!trade)
      onSubmit({ action: 'create', counterpartyCode: partnerCode, offer: mine, request: theirs });
    else
      onSubmit({
        action: 'edit',
        tradeId: trade.id,
        version: trade.version,
        offer: mine,
        ...(legacy ? {} : { request: theirs }),
      });
  }
  return (
    <section
      className="panel trade-composer"
      aria-label={trade ? (legacy ? 'Change your side' : 'Counter-offer') : 'New trade'}
    >
      <div className="trade-composer-heading">
        <h2>
          {trade
            ? legacy
              ? 'Change your side'
              : trade.changedByMe
                ? `Change your offer to ${name}`
                : `Counter-offer to ${name}`
            : 'New trade'}
        </h2>
        <button type="button" className="secondary" disabled={disabled} onClick={onClose}>
          Close
        </button>
      </div>
      {!trade && (
        <MemberPicker
          realmId={view.id}
          prefix="new-trade"
          disabled={disabled}
          value={partnerCode}
          onChange={setPartnerCode}
        />
      )}
      {partnerError && (
        <p className="error" role="alert">
          {partnerError}
        </p>
      )}
      {validCode && partnerCode !== view.tradeCode && (
        <>
          <div className="trade-offers trade-composer-sides">
            <SideEditor
              id={`${trade?.id ?? 'new'}-give`}
              title="You give"
              cards={myCards}
              side={mine}
              onChange={setMine}
              maxCards={rules.maxCardsPerSide}
              maxGems={Math.min(rules.maxGemsPerSide, view.balance)}
              disabled={disabled}
              pickerTitle="Choose cards to give"
              emptyText={
                view.cards.length ? 'No cards yet' : 'You have no cards; you can offer gems.'
              }
            />
            <span className="trade-swap" aria-hidden="true">
              <GameIcon name="trades" />
            </span>
            <SideEditor
              id={`${trade?.id ?? 'new'}-get`}
              title={`You get from ${name}`}
              cards={theirKnown}
              side={theirs}
              onChange={setTheirs}
              maxCards={rules.maxCardsPerSide}
              maxGems={rules.maxGemsPerSide}
              disabled={disabled || (!partner && !trade)}
              readOnly={legacy}
              pickerTitle={`Choose cards from ${name}`}
              emptyText={
                partner && !partner.cards.length
                  ? 'They have no cards; you can ask for gems.'
                  : 'Pick the cards you want'
              }
            />
          </div>
          <p className="field-help">
            {legacy
              ? 'This trade was started before offers covered both sides: you can change only what you give.'
              : `Sending confirms your side. Nothing changes hands until ${name} accepts; they can also counter or decline.`}
          </p>
          <div className="trade-actions">
            <button
              type="button"
              className="accent"
              disabled={disabled || empty || unchanged}
              onClick={submit}
            >
              {trade ? (legacy ? 'Save my side' : 'Send counter-offer') : 'Send offer'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function OfferSide({
  title,
  offer,
  view,
}: {
  title: string;
  offer: TradeView['myOffer'];
  view: RealmView;
}) {
  const value =
    offer.cards.reduce(
      (sum, card) =>
        sum +
        ((view.characterValues[card.characterId] as CharacterValue | undefined)?.marketValue ?? 0),
      0,
    ) + offer.gems;
  return (
    <div className="trade-side">
      <div className="trade-side-heading">
        <h4>{title}</h4>
        <p className="offer-gems" title="Card values plus gems">
          ≈ <GameIcon name="gem" />
          <strong>{value.toLocaleString()}</strong>
        </p>
      </div>
      {offer.cards.length ? (
        <ul>
          {offer.cards.map((card) => (
            <li key={card.cardId} className={`offer-card ${card.tier}`}>
              <InspectableCard
                card={{
                  ...(view.characters[card.characterId] ?? {
                    id: card.characterId,
                    name: card.name,
                    series: '',
                    tier: card.tier,
                    categories: [],
                  }),
                  valuation: view.characterValues[card.characterId],
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="offer-empty">No cards</p>
      )}
      {offer.gems > 0 && <p className="field-help">+ {offer.gems.toLocaleString()} gems</p>}
    </div>
  );
}

export function Trades({
  view,
  disabled,
  onLockChange,
  initialPartner,
}: {
  view: RealmView;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
  /** Trade code from "Propose a trade" on a profile: opens a new offer to them. */
  initialPartner?: string;
}) {
  const startWith =
    initialPartner && initialPartner !== view.tradeCode && view.config.trading.enabled
      ? initialPartner
      : undefined;
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [composing, setComposing] = useState<'new' | string | null>(startWith ? 'new' : null),
    [tab, setTab] = useState<'open' | 'history'>('open'),
    [copied, setCopied] = useState(false);
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
      setComposing(null);
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = disabled || busy || !!pending;
  const nameOf = (code: string) =>
    memberName(
      view.tradePartners.find((member) => member.tradeCode === code) ?? {
        tradeCode: code,
        username: null,
        displayName: null,
      },
    );
  const open = view.trades.filter((trade) => trade.status === 'pending');
  const forMe = open.filter((trade) => !trade.myConfirmed);
  const forThem = open.filter((trade) => trade.myConfirmed);
  const history = view.trades.filter((trade) => trade.status !== 'pending');

  function entry(trade: TradeView) {
    const name = nameOf(trade.counterpartyCode),
      legacy = trade.protocol === 1,
      pendingTrade = trade.status === 'pending';
    const heading = !pendingTrade
      ? `Trade with ${name}`
      : trade.myConfirmed
        ? `Your offer to ${name}`
        : `Offer from ${name}`;
    return (
      <article
        key={trade.id}
        className={`trade-entry status-${trade.status} ${pendingTrade && !trade.myConfirmed ? 'needs-answer' : ''}`}
        aria-label={`Trade ${trade.id}`}
      >
        <header className="trade-entry-header">
          <h3>
            {heading}
            <span className="sr-only"> · </span>
            <span className="trade-status">
              {pendingTrade
                ? trade.myConfirmed
                  ? 'waiting for them'
                  : 'waiting for you'
                : trade.status}
            </span>
          </h3>
          <p>
            Version {trade.version}
            {pendingTrade &&
              ` · Expires ${new Date(trade.expiresAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}`}
            {trade.completedAt &&
              ` · ${new Date(trade.completedAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}`}
          </p>
        </header>
        <div className="trade-offers">
          <OfferSide title="You give" offer={trade.myOffer} view={view} />
          <span className="trade-swap" aria-hidden="true">
            <GameIcon name="trades" />
          </span>
          <OfferSide title="You get" offer={trade.theirOffer} view={view} />
        </div>
        {pendingTrade && (
          <>
            <div className="trade-actions">
              {!trade.myConfirmed ? (
                <>
                  <button
                    className="accent"
                    disabled={locked}
                    onClick={() =>
                      send({ action: 'confirm', tradeId: trade.id, version: trade.version })
                    }
                  >
                    {legacy ? 'Confirm this offer' : 'Accept'}
                  </button>
                  <button
                    className="secondary"
                    disabled={locked}
                    onClick={() => setComposing(composing === trade.id ? null : trade.id)}
                  >
                    {legacy ? 'Change my side' : 'Counter-offer'}
                  </button>
                  <button
                    className="secondary"
                    disabled={locked}
                    onClick={() =>
                      send({ action: 'cancel', tradeId: trade.id, version: trade.version })
                    }
                  >
                    Decline
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="secondary"
                    disabled={locked}
                    onClick={() => setComposing(composing === trade.id ? null : trade.id)}
                  >
                    {legacy ? 'Change my side' : 'Change offer'}
                  </button>
                  <button
                    className="secondary"
                    disabled={locked}
                    onClick={() =>
                      send({ action: 'cancel', tradeId: trade.id, version: trade.version })
                    }
                  >
                    Cancel offer
                  </button>
                </>
              )}
            </div>
            <p className="field-help">
              {trade.myConfirmed
                ? legacy
                  ? `Your confirmation is saved. ${name} confirms to complete it.`
                  : `Waiting for ${name} to accept, counter or decline.`
                : legacy
                  ? 'Both players confirm this version; the second confirmation completes it.'
                  : 'Accepting completes the trade at once.'}
            </p>
            {composing === trade.id && (
              <TradeComposer
                key={`${trade.id}:${trade.version}`}
                view={view}
                trade={trade}
                partnerName={name}
                disabled={locked}
                onSubmit={send}
                onClose={() => setComposing(null)}
              />
            )}
          </>
        )}
      </article>
    );
  }

  return (
    <section id="trades" className="section trades-panel" aria-label="Your trades">
      <PageHeader
        title="Trades"
        lede="Swap cards and gems with another collector. Choose what you give and what you want; nothing changes hands until they accept."
        actions={
          <>
            {view.config.trading.enabled && (
              <button
                className="accent"
                disabled={locked}
                onClick={() => {
                  setMessage('');
                  setError('');
                  setComposing(composing === 'new' ? null : 'new');
                }}
              >
                <GameIcon name="plus" />
                New trade
              </button>
            )}
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
          </>
        }
      />
      {!view.config.trading.enabled && (
        <p className="quiet">New trades are disabled in this realm.</p>
      )}
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
      {composing === 'new' && (
        <TradeComposer
          view={view}
          initialPartner={startWith}
          disabled={locked}
          onSubmit={send}
          onClose={() => setComposing(null)}
        />
      )}
      <div className="trade-filters segmented" role="group" aria-label="Show trades">
        <button aria-pressed={tab === 'open'} onClick={() => setTab('open')}>
          Open ({open.length})
        </button>
        <button aria-pressed={tab === 'history'} onClick={() => setTab('history')}>
          History ({history.length})
        </button>
      </div>
      {tab === 'open' ? (
        <div className="trade-list">
          {forMe.length > 0 && (
            <h2 className="trade-group-title">Waiting for you ({forMe.length})</h2>
          )}
          {forMe.map(entry)}
          {forThem.length > 0 && (
            <h2 className="trade-group-title">Waiting for them ({forThem.length})</h2>
          )}
          {forThem.map(entry)}
          {!open.length && (
            <div className="empty panel">
              <span className="empty-icon" aria-hidden="true">
                <GameIcon name="trades" />
              </span>
              <h3>No open trades.</h3>
              <p className="quiet">
                Start a new trade: pick a player, choose what you give and what you want.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="trade-list">
          {history.map(entry)}
          {!history.length && (
            <div className="empty panel">
              <h3>No finished trades yet.</h3>
            </div>
          )}
          {view.trades.length >= 100 && (
            <p className="field-help">
              Showing the latest 100 trades. Your collection export includes your full history.
            </p>
          )}
        </div>
      )}
      <details className="trade-passport panel">
        <summary>Your trade ID</summary>
        <div className="copy-field">
          <label className="sr-only" htmlFor="my-trade-code">
            Your trade ID in this realm
          </label>
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
            ? `Others find you by name as ${view.discordProfile.displayName ?? view.discordProfile.username} (@${view.discordProfile.username}); the ID works too.`
            : 'Others can find you by this ID. It grants no account access.'}
        </p>
      </details>
    </section>
  );
}
