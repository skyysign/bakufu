'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealmPackPlan } from '@card-engine/db';
import type { PackGroup } from '@card-engine/core';
import { GameIcon } from './game-art';

const groupLabels: Record<PackGroup, string> = {
  all: 'All',
  demographic: 'Demographic',
  genre: 'Genre',
  theme: 'Theme',
  era: 'Era',
};

/** Realm admins add category packs from the realm's own catalog. */
export function RealmPacks({
  realmId,
  disabled,
  onLockChange,
}: {
  realmId: string;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<RealmPackPlan | null>(null),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [filter, setFilter] = useState<PackGroup | 'any'>('any'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [confirming, setConfirming] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/realm-packs?realmId=${encodeURIComponent(realmId)}`, {
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not load packs.');
      setPlan(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load packs.');
    }
  }, [realmId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => onLockChange(busy), [busy, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);
  const chosen = Object.entries(selected);
  async function remove(pack: { id: string; name: string }) {
    if (busy) return;
    if (confirming !== pack.id) return setConfirming(pack.id);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/realm-packs/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realmId, packId: pack.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not remove this pack.');
      setMessage(
        `${pack.name} removed. Cards pulled from it stay in collections; add the category again to bring it back.`,
      );
      setConfirming(null);
      router.refresh();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not remove this pack.');
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (!chosen.length || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/realm-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          realmId,
          packs: chosen.map(([category, name]) => ({ category, name: name.trim() })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not add these packs.');
      setSelected({});
      setMessage(
        result.added.length
          ? `${result.added.length} ${result.added.length === 1 ? 'pack' : 'packs'} added. Players can open ${result.added.length === 1 ? 'it' : 'them'} now.`
          : 'Those packs were already live.',
      );
      router.refresh();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not add these packs.');
    } finally {
      setBusy(false);
    }
  }
  const groups = plan
    ? (['demographic', 'genre', 'theme', 'era'] as const).filter((group) =>
        plan.candidates.some((candidate) => candidate.group === group),
      )
    : [];
  const categoryPacks = plan?.packs.filter((pack) => pack.category !== null).length ?? 0;
  const remaining = plan ? plan.maximum - categoryPacks - chosen.length : 0;
  const minimum = plan ? plan.minimumPoolSize : 0;
  return (
    <section id="realm-packs" className="panel realm-packs-panel" aria-label="Realm packs">
      <div className="section-heading">
        <div>
          <h2>Packs</h2>
          <p>
            Only All Characters is required. Add packs from this realm’s catalog categories
            for more variety, or remove the ones you don’t want; cards and history stay as they
            are.
          </p>
        </div>
      </div>
      {!plan ? (
        <p className="loading-line">{error || 'Loading packs…'}</p>
      ) : (
        <>
          <ul className="live-packs" aria-label="Live packs">
            {plan.packs.map((pack) => (
              <li key={pack.id}>
                <GameIcon name="packs" />
                <span className="live-pack-name">{pack.name}</span>
                {pack.category === null ? (
                  <small className="live-pack-note">Always included</small>
                ) : (
                  <span className="live-pack-actions">
                    <button
                      type="button"
                      className={confirming === pack.id ? 'danger' : 'text-button'}
                      disabled={disabled || busy}
                      aria-label={
                        confirming === pack.id ? `Confirm removing ${pack.name}` : `Remove ${pack.name}`
                      }
                      onClick={() => void remove(pack)}
                    >
                      {confirming === pack.id ? 'Confirm remove' : 'Remove'}
                    </button>
                    {confirming === pack.id && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="realm-packs-toolbar">
            <h3>Add category packs</h3>
            {groups.length > 1 && (
              <div className="segmented" role="group" aria-label="Category types">
                <button
                  type="button"
                  aria-pressed={filter === 'any'}
                  onClick={() => setFilter('any')}
                >
                  All
                </button>
                {groups.map((group) => (
                  <button
                    type="button"
                    key={group}
                    aria-pressed={filter === group}
                    onClick={() => setFilter(group)}
                  >
                    {groupLabels[group]}s
                  </button>
                ))}
              </div>
            )}
          </div>
          <fieldset className="pack-candidates" disabled={disabled || busy}>
            <legend className="sr-only">Catalog categories</legend>
            {plan.candidates
              .filter((candidate) => filter === 'any' || candidate.group === filter)
              .map((candidate) => {
                const live = candidate.packId !== null;
                const tooSmall = candidate.poolSize < minimum;
                const checked = candidate.category in selected;
                const share = Math.round((candidate.poolSize / Math.max(1, plan.catalogSize)) * 100);
                return (
                  <div
                    key={candidate.category}
                    className={`pack-candidate${checked ? ' is-selected' : ''}${live ? ' is-live' : ''}`}
                  >
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={live || checked}
                        disabled={live || tooSmall || (!checked && remaining <= 0)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = { ...current };
                            if (event.target.checked) next[candidate.category] = candidate.suggestedName;
                            else delete next[candidate.category];
                            return next;
                          })
                        }
                      />
                      <span>
                        <strong>{candidate.category}</strong>
                        <small>
                          {groupLabels[candidate.group]} · {candidate.poolSize.toLocaleString()}{' '}
                          characters ({share}%)
                          {live
                            ? ` · live as ${candidate.packName}`
                            : tooSmall
                              ? ' · too few characters'
                              : share >= 85
                                ? ' · almost everyone'
                                : ''}
                        </small>
                      </span>
                    </label>
                    {checked && (
                      <input
                        aria-label={`Pack name for ${candidate.category}`}
                        value={selected[candidate.category]}
                        maxLength={80}
                        onChange={(event) =>
                          setSelected((current) => ({
                            ...current,
                            [candidate.category]: event.target.value,
                          }))
                        }
                      />
                    )}
                  </div>
                );
              })}
          </fieldset>
          <div className="form-actions">
            <button
              className="accent"
              disabled={disabled || busy || !chosen.length || chosen.some(([, name]) => !name.trim())}
              onClick={() => void add()}
            >
              {busy
                ? 'Adding packs…'
                : chosen.length
                  ? `Add ${chosen.length} ${chosen.length === 1 ? 'pack' : 'packs'}`
                  : 'Select categories to add'}
            </button>
            <span className="field-help">
              {categoryPacks} of {plan.maximum} category packs used.
            </span>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="success-note" role="status">
              {message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
