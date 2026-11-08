'use client';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AdminMemberCollection } from '@card-engine/db';
import { post } from './api-client';
import { GameIcon } from './game-art';
import { MemberPicker } from './member-picker';

const date = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
const reasons: Record<string, string> = {
  starting_grant: 'Starting gems',
  pack_opening: 'Pack opening',
  recycling: 'Recycling',
  upgrade_purchase: 'Upgrade',
  trade: 'Trade or market',
  rank_purchase: 'Collector rank',
  rank_track_purchase: 'Rank level',
  gem_reward: 'Gem claim',
  admin_grant: 'Admin test gems',
  admin_adjustment: 'Admin adjustment',
};
const actionNames: Record<string, string> = {
  restore_card: 'Restored',
  return_card: 'Returned',
  adjust_gems: 'Gems adjusted',
};
const tierLabel = (tier: string) => tier.charAt(0).toUpperCase() + tier.slice(1);

type Pending =
  | { kind: 'restore_card'; cardId: string; name: string; credited: number }
  | { kind: 'return_card'; cardId: string; name: string; holder: string };

/**
 * Administration → Collections. Look up one member, see their cards, wallet
 * and recent losses, then repair mistakes: restore a recycled card, return a
 * card to them from whoever has it now, or adjust gems. Every change needs a
 * note, is recorded in the action history and is checked again on the server.
 */
export function AdminCollections({
  realmId,
  disabled,
  onLockChange,
}: {
  realmId: string;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const [memberCode, setMemberCode] = useState(''),
    [view, setView] = useState<AdminMemberCollection | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Pending | null>(null),
    [takeBack, setTakeBack] = useState(true),
    [note, setNote] = useState(''),
    [amount, setAmount] = useState(''),
    [gemNote, setGemNote] = useState(''),
    [filter, setFilter] = useState(''),
    [requestKey, setRequestKey] = useState(() => crypto.randomUUID()),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useEffect(() => onLockChange(busy), [busy, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);

  const load = useCallback(
    async (code: string) => {
      // Wait for a complete member code (typed or chosen) before loading.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code))
        return setView(null);
      setLoading(true);
      setError('');
      try {
        const response = await fetch(
          `/api/admin-collection?realmId=${encodeURIComponent(realmId)}&member=${encodeURIComponent(code)}`,
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Could not load this collection.');
        setView(body as AdminMemberCollection);
      } catch (failure) {
        setView(null);
        setError((failure as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [realmId],
  );
  useEffect(() => {
    setPending(null);
    setMessage('');
    void load(memberCode);
  }, [memberCode, load]);

  async function run(command: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await post('admin-collection', {
        realmId,
        command: { ...command, requestKey, memberCode },
      });
      // A new key only after success: a retry of a lost response is replayed.
      setRequestKey(crypto.randomUUID());
      setPending(null);
      setNote('');
      setMessage(done);
      await load(memberCode);
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) return;
    if (pending.kind === 'restore_card')
      void run(
        {
          kind: 'restore_card',
          cardId: pending.cardId,
          takeBackGems: takeBack && pending.credited > 0,
          note,
        },
        `${pending.name} is back in ${view?.member.name ?? 'the'} collection.`,
      );
    else
      void run(
        { kind: 'return_card', cardId: pending.cardId, note },
        `${pending.name} was returned to ${view?.member.name ?? 'the member'}.`,
      );
  }
  function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount);
    void run(
      { kind: 'adjust_gems', amount: value, note: gemNote },
      `${value > 0 ? 'Added' : 'Removed'} ${Math.abs(value).toLocaleString()} gems.`,
    ).then((saved) => {
      if (!saved) return;
      setAmount('');
      setGemNote('');
    });
  }
  const shownCards = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return (view?.cards ?? []).filter(
      (card) => !query || `${card.name} ${card.series}`.toLowerCase().includes(query),
    );
  }, [view, filter]);
  const locked = disabled || busy;

  function confirmForm(item: { cardId: string }) {
    if (!pending || pending.cardId !== item.cardId) return null;
    return (
      <form className="collection-admin-confirm" onSubmit={confirm}>
        {pending.kind === 'restore_card' && pending.credited > 0 && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={takeBack}
              onChange={(event) => setTakeBack(event.target.checked)}
            />
            <span>
              Take back the {pending.credited.toLocaleString()} gems recycling paid
              <small>Leave this on to undo the sale completely.</small>
            </span>
          </label>
        )}
        {pending.kind === 'return_card' && (
          <p className="field-help">
            Moves the card from {pending.holder} back to {view?.member.name}. Gems are not moved;
            use “Adjust gems” below to refund a market price if needed.
          </p>
        )}
        <label>
          Reason (saved in the history)
          <input
            value={note}
            maxLength={200}
            required
            placeholder="For example: recycled by accident"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="collection-admin-buttons">
          <button type="submit" disabled={locked || !note.trim()}>
            {busy ? 'Saving…' : pending.kind === 'restore_card' ? 'Restore card' : 'Return card'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <section className="panel collection-admin" aria-labelledby="collection-admin-title">
      <h2 id="collection-admin-title">Player collections</h2>
      <p className="section-intro">
        Look up a member to see their cards and wallet, and fix mistakes: bring back a card they
        recycled by accident, return a card someone else now has, or adjust their gems.
      </p>
      <MemberPicker
        realmId={realmId}
        prefix="collection-admin"
        disabled={locked}
        value={memberCode}
        onChange={setMemberCode}
        labels={{ legend: 'Choose a member', selected: 'Member', code: 'Member code (trade ID)' }}
      />
      {loading && <p role="status">Loading collection…</p>}
      {message && (
        <p className="success-note" role="status">
          {message}
        </p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      {view && !loading && (
        <>
          <dl
            className="admin-stats collection-admin-stats"
            aria-label={`${view.member.name} at a glance`}
          >
            <div>
              <dt>Member</dt>
              <dd>
                {view.member.name}
                {view.member.role === 'admin' && <small> · admin</small>}
              </dd>
            </div>
            <div>
              <dt>Gems</dt>
              <dd>
                <GameIcon name="gem" /> {view.member.balance.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Cards</dt>
              <dd>{view.cardCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>XP</dt>
              <dd>{view.member.xp.toLocaleString()}</dd>
            </div>
          </dl>

          <section className="artwork-backfill" aria-labelledby="collection-recycled-title">
            <h3 id="collection-recycled-title">Recently recycled</h3>
            {view.recycled.length === 0 ? (
              <p className="field-help">Nothing recycled.</p>
            ) : (
              <ul className="sound-rows">
                {view.recycled.map((card) => (
                  <li key={card.cardId} className="sound-row collection-admin-row">
                    <span className="tier-name" data-tier={card.tier}>
                      {tierLabel(card.tier)}
                    </span>
                    <span className="sound-status">
                      <strong>{card.name}</strong>
                      <small>
                        {card.series} · recycled {date(card.recycledAt)} for{' '}
                        {card.credited.toLocaleString()} gems
                        {card.heldBy && ` · pulled again by ${card.heldBy}`}
                      </small>
                    </span>
                    <span className="sound-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={locked || !!card.heldBy}
                        onClick={() => {
                          setTakeBack(true);
                          setNote('');
                          setPending({
                            kind: 'restore_card',
                            cardId: card.cardId,
                            name: card.name,
                            credited: card.credited,
                          });
                        }}
                      >
                        Restore…
                      </button>
                    </span>
                    {confirmForm(card)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="artwork-backfill" aria-labelledby="collection-away-title">
            <h3 id="collection-away-title">Traded or sold away</h3>
            {view.givenAway.length === 0 ? (
              <p className="field-help">No cards went to other members.</p>
            ) : (
              <ul className="sound-rows">
                {view.givenAway.map((card) => (
                  <li key={card.cardId} className="sound-row collection-admin-row">
                    <span className="tier-name" data-tier={card.tier}>
                      {tierLabel(card.tier)}
                    </span>
                    <span className="sound-status">
                      <strong>{card.name}</strong>
                      <small>
                        {card.via === 'market'
                          ? `Sold on the market${card.price === null ? '' : ` for ${card.price.toLocaleString()} gems`}`
                          : card.via === 'admin'
                            ? 'Moved by an admin'
                            : 'Traded'}{' '}
                        {date(card.movedAt)} ·{' '}
                        {card.returnable ? `now with ${card.holder}` : 'recycled since'}
                      </small>
                    </span>
                    <span className="sound-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={locked || !card.returnable}
                        onClick={() => {
                          setNote('');
                          setPending({
                            kind: 'return_card',
                            cardId: card.cardId,
                            name: card.name,
                            holder: card.holder,
                          });
                        }}
                      >
                        Return…
                      </button>
                    </span>
                    {confirmForm(card)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="artwork-backfill" aria-labelledby="collection-gems-title">
            <h3 id="collection-gems-title">Adjust gems</h3>
            <form className="collection-admin-gems" onSubmit={adjust}>
              <label>
                Amount (negative removes gems)
                <input
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={-1_000_000}
                  max={1_000_000}
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label>
                Reason (saved in the history)
                <input
                  value={gemNote}
                  maxLength={200}
                  required
                  placeholder="For example: refund for a mistaken sale"
                  onChange={(event) => setGemNote(event.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={
                  locked ||
                  !gemNote.trim() ||
                  !Number.isInteger(Number(amount)) ||
                  Number(amount) === 0
                }
              >
                Apply
              </button>
            </form>
          </section>

          <section className="artwork-backfill" aria-labelledby="collection-cards-title">
            <h3 id="collection-cards-title">Collection ({view.cardCount.toLocaleString()})</h3>
            <label className="collection-admin-filter">
              Filter
              <input
                type="search"
                value={filter}
                placeholder="Name or series"
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            {shownCards.length === 0 ? (
              <p className="field-help">No cards.</p>
            ) : (
              <ul className="sound-rows collection-admin-cards">
                {shownCards.map((card) => (
                  <li key={card.cardId} className="sound-row collection-admin-row">
                    <span className="tier-name" data-tier={card.tier}>
                      {tierLabel(card.tier)}
                    </span>
                    <span className="sound-status">
                      <strong>{card.name}</strong>
                      <small>
                        {card.series} · since {date(card.acquiredAt)}
                        {card.locked === 'trade' && ' · in a pending trade'}
                        {card.locked === 'market' && ' · listed on the market'}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {view.cardCount > view.cards.length && (
              <p className="field-help">
                Showing the {view.cards.length.toLocaleString()} newest cards.
              </p>
            )}
          </section>

          <section className="artwork-backfill" aria-labelledby="collection-history-title">
            <h3 id="collection-history-title">History</h3>
            {view.actions.length > 0 && (
              <ul className="sound-rows">
                {view.actions.map((action) => (
                  <li key={action.actionId} className="sound-row collection-admin-row">
                    <span className="sound-status">
                      <strong>
                        {actionNames[action.kind] ?? action.kind}
                        {action.characterName && ` · ${action.characterName}`}
                        {action.amount !== 0 &&
                          ` · ${action.amount > 0 ? '+' : ''}${action.amount.toLocaleString()} gems`}
                      </strong>
                      <small>
                        {action.note} · by {action.by} · {date(action.createdAt)}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <h4 className="sound-group-title">Recent wallet activity</h4>
            <ul className="sound-rows">
              {view.ledger.map((entry, index) => (
                <li key={`${entry.createdAt}-${index}`} className="sound-row collection-admin-row">
                  <span className="sound-status">
                    <strong>
                      {entry.amount > 0 ? '+' : ''}
                      {entry.amount.toLocaleString()} gems · {reasons[entry.reason] ?? entry.reason}
                    </strong>
                    <small>
                      {date(entry.createdAt)} · balance {entry.balanceAfter.toLocaleString()}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
