'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Tier } from '@card-engine/config';
import type { ProviderArtwork } from '../../../packages/importers/src/artwork';
import { tiers } from '@card-engine/config';
import { CharacterPortrait, GameIcon } from './game-art';
import type { CharacterValue } from '@card-engine/core';
export { InspectableCard } from './card-inspection';

export type BrowseCard = {
  id: string;
  characterId?: string;
  name: string;
  series: string;
  categories: string[];
  tier: Tier;
  artwork?: ProviderArtwork;
  disabled?: boolean;
  note?: string;
  sourceKey?: string;
  valuation?: CharacterValue;
};
export function CardFace({
  card,
  value,
  children,
  priority = false,
}: {
  card: BrowseCard;
  value?: number;
  children?: ReactNode;
  priority?: boolean;
}) {
  const shownValue = value ?? card.valuation?.marketValue;
  return (
    <div className={`card-face ${card.tier}`}>
      <div className="card-face-heading">
        <span>{card.tier}</span>
        <GameIcon name="spark" />
      </div>
      <div className="card-face-art">
        <CharacterPortrait
          seed={card.name}
          characterId={card.characterId ?? card.id}
          artwork={card.artwork}
          priority={priority}
        />
      </div>
      <div className="card-face-copy">
        <h3>{card.name}</h3>
        <p>{card.series}</p>
        {shownValue !== undefined && (
          <span className="card-value" aria-label={`${shownValue.toLocaleString()} gems`}>
            <GameIcon name="gem" /> {shownValue.toLocaleString()}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export type CardPage = { cards: BrowseCard[]; total: number };
/** Remote pickers page the realm catalog on the server instead of in memory. */
export type CardLoader = (input: {
  query: string;
  tier: string;
  offset: number;
  limit: number;
  signal: AbortSignal;
}) => Promise<CardPage>;
const pageSize = 20;

export function CardPicker({
  cards = [],
  load,
  selected,
  onChange,
  maximum,
  title,
  trigger,
  disabled,
  single = false,
  confirmLabel,
  confirmManyLabel,
}: {
  cards?: BrowseCard[];
  load?: CardLoader;
  selected: string[];
  onChange: (ids: string[]) => void;
  maximum: number;
  title: string;
  trigger: string;
  disabled: boolean;
  single?: boolean;
  /** Single-choice confirm button text; defaults to "Choose character". */
  confirmLabel?: string;
  /** Multiple-choice confirm button text for a count; "Use N selected cards" by default. */
  confirmManyLabel?: (count: number) => string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null),
    searchInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string[]>([]),
    [search, setSearch] = useState(''),
    [tier, setTier] = useState('all'),
    [page, setPage] = useState(0),
    [open, setOpen] = useState(false),
    [remote, setRemote] = useState<(CardPage & { page: number }) | null>(null),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState('');
  useEffect(() => {
    if (!load || !open) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await load({
          query: search.trim(),
          tier,
          offset: page * pageSize,
          limit: pageSize,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setRemote({ ...result, page });
          setLoadError('');
        }
      } catch {
        if (!controller.signal.aborted) setLoadError('Characters could not be loaded. Try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load, open, search, tier, page]);
  const localMatches = load
    ? []
    : cards.filter(
        (card) =>
          (tier === 'all' || card.tier === tier) &&
          `${card.name} ${card.series} ${card.categories.join(' ')}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      );
  const total = load ? (remote?.total ?? 0) : localMatches.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const shownPage = Math.min(page, pages - 1);
  // The page label describes the cards on screen, so a remote page changes it
  // only when its cards arrive. Navigation keeps using the requested page.
  const labelPage = load ? Math.min(remote?.page ?? 0, pages - 1) : shownPage;
  const shown = load
    ? (remote?.cards ?? [])
    : localMatches.slice(shownPage * pageSize, (shownPage + 1) * pageSize);
  function close() {
    dialog.current?.close();
  }
  return (
    <>
      <button
        type="button"
        className="secondary browse-cards-button"
        ref={opener}
        disabled={disabled}
        onClick={() => {
          setDraft(selected);
          setSearch('');
          setTier('all');
          setPage(0);
          setRemote(null);
          setOpen(true);
          dialog.current?.showModal();
          searchInput.current?.focus({ preventScroll: true });
        }}
      >
        <GameIcon name="grid" />
        {trigger}
      </button>
      <dialog
        className="card-picker"
        aria-label={title}
        ref={dialog}
        onClose={() => {
          setOpen(false);
          opener.current?.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
          }
          if (event.key === 'Enter' && event.target === searchInput.current) event.preventDefault();
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
            ),
          );
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="card-picker-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="secondary icon-button"
            aria-label="Close card browser"
            onClick={close}
          >
            <GameIcon name="close" />
          </button>
        </div>
        <div className="card-browser-toolbar">
          <label className="search-field">
            <span className="sr-only">Search cards by name or series</span>
            <GameIcon name="search" />
            <input
              ref={searchInput}
              type="search"
              placeholder="Search by character, series or category"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            <span className="sr-only">Filter card rarity</span>
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
        </div>
        <p className="card-browser-count" role="status">
          {load && loading && !remote
            ? 'Loading characters…'
            : `${total.toLocaleString()} characters · ${draft.length} / ${maximum} selected`}
        </p>
        <div className="card-browser-grid" aria-busy={loading || undefined}>
          {shown.map((card) => {
            const checked = draft.includes(card.id);
            return (
              <button
                type="button"
                className="card-choice"
                key={card.id}
                aria-label={`Select ${card.name}`}
                aria-pressed={checked}
                disabled={card.disabled || (!single && !checked && draft.length >= maximum)}
                onClick={() =>
                  setDraft(
                    checked
                      ? draft.filter((id) => id !== card.id)
                      : single
                        ? [card.id]
                        : [...draft, card.id],
                  )
                }
              >
                <CardFace card={card} />
                <span className="card-choice-status">
                  {checked ? 'Selected ✓' : card.disabled ? 'Reserved' : 'Select card'}
                </span>
              </button>
            );
          })}
        </div>
        {loadError && (
          <p className="error" role="alert">
            {loadError}
          </p>
        )}
        {!shown.length && !loading && !loadError && (
          <p className="empty">No characters match your search.</p>
        )}
        <div className="card-picker-footer">
          <span>
            Page {labelPage + 1} of {pages}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={shownPage === 0}
            onClick={() => setPage(shownPage - 1)}
          >
            Previous cards
          </button>
          <button
            type="button"
            className="secondary"
            disabled={shownPage + 1 >= pages}
            onClick={() => setPage(shownPage + 1)}
          >
            Next cards
          </button>
          <button
            type="button"
            disabled={(single && draft.length !== 1) || (!!confirmManyLabel && !draft.length)}
            onClick={() => {
              onChange(draft);
              close();
            }}
          >
            {single
              ? (confirmLabel ?? 'Choose character')
              : confirmManyLabel
                ? confirmManyLabel(draft.length)
                : `Use ${draft.length} selected cards`}
          </button>
        </div>
      </dialog>
    </>
  );
}
