'use client';
import { useEffect, useState } from 'react';
import type { CharacterRemovalPreview, CharacterRemovalResult } from '@card-engine/db';
import type { Tier } from '@card-engine/config';
import { ApiError, post } from './api-client';

type Selection = { characterIds: string[] } | { withoutArtwork: true };
type Found = { id: string; name: string; series: string; tier: Tier };
const tierLabel = (tier: string) => tier.charAt(0).toUpperCase() + tier.slice(1);

/**
 * Administration → Characters → Remove characters. One character at a time,
 * or every character without a picture in one go. Each removal is reviewed
 * first: who owns the removed characters and the gems they get back.
 */
export function CharacterRemoval({
  realmId,
  withoutArtwork,
  disabled,
  onBusyChange,
  onRemoved,
}: {
  realmId: string;
  /** Characters in the realm that have no picture. */
  withoutArtwork: number;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onRemoved: () => void;
}) {
  const [query, setQuery] = useState(''),
    [found, setFound] = useState<Found[]>([]),
    [review, setReview] = useState<{
      selection: Selection;
      label: string;
      preview: CharacterRemovalPreview;
      requestKey: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useEffect(() => onBusyChange(busy || !!review), [busy, review, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setFound([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `/api/catalog?realmId=${encodeURIComponent(realmId)}&query=${encodeURIComponent(text)}&limit=8`,
        { signal: controller.signal },
      )
        .then((response) => response.json())
        .then((body) => setFound((body.characters ?? []) as Found[]))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, realmId]);

  async function start(selection: Selection, label: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const preview = (await post('character-removal/preview', {
        realmId,
        selection,
      })) as CharacterRemovalPreview;
      setReview({ selection, label, preview, requestKey: crypto.randomUUID() });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!review) return;
    setBusy(true);
    setError('');
    try {
      const result = (await post('character-removal', {
        realmId,
        selection: review.selection,
        previewHash: review.preview.previewHash,
        requestKey: review.requestKey,
      })) as CharacterRemovalResult;
      setReview(null);
      setQuery('');
      setMessage(
        `Removed ${result.removed.toLocaleString()} character${result.removed === 1 ? '' : 's'}.` +
          (result.refundedCards
            ? ` ${result.refundedCards.toLocaleString()} owner${result.refundedCards === 1 ? '' : 's'} got ${result.refundedGems.toLocaleString()} gems back in total.`
            : '') +
          (result.skipped ? ` ${result.skipped.toLocaleString()} skipped (market or trade).` : ''),
      );
      onRemoved();
    } catch (failure) {
      setError((failure as Error).message);
      // A clear refusal (stale review, nothing to remove) ends this review.
      if (failure instanceof ApiError && failure.status < 500) setReview(null);
    } finally {
      setBusy(false);
    }
  }

  const locked = disabled || busy;
  const preview = review?.preview;
  return (
    <section className="artwork-backfill character-removal" aria-labelledby="removal-title">
      <h3 id="removal-title">Remove characters without a picture</h3>
      <p className="field-help">
        Cards without a picture show initials. Removed characters leave packs, the glossary and
        wishlists. Anyone who owns one gets the card&apos;s recycle value in gems, as if they had
        recycled it themselves. Characters whose card is listed on the market or reserved in a trade
        are skipped. Adding a character again later brings it back.
      </p>
      {message && (
        <p className="success-note" role="status">
          {message}
        </p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      {!review ? (
        <>
          <div className="removal-quick">
            <p>
              {withoutArtwork > 0
                ? `${withoutArtwork.toLocaleString()} character${withoutArtwork === 1 ? ' has' : 's have'} no picture.`
                : 'Every character has a picture.'}
            </p>
            <button
              type="button"
              className="secondary"
              disabled={locked || withoutArtwork === 0}
              onClick={() =>
                void start(
                  { withoutArtwork: true },
                  `all ${withoutArtwork.toLocaleString()} without a picture`,
                )
              }
            >
              {busy ? 'Reviewing…' : 'Remove all without a picture…'}
            </button>
          </div>
          <h4 className="rarity-subtitle">Remove one character</h4>
          <label className="rarity-search">
            Find a character to remove
            <input
              type="search"
              value={query}
              placeholder="Name or series"
              disabled={locked}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {found.length > 0 && (
            <ul className="sound-rows" aria-label="Characters to remove">
              {found.map((character) => (
                <li key={character.id} className="sound-row rarity-row">
                  <span className="tier-name" data-tier={character.tier}>
                    {tierLabel(character.tier)}
                  </span>
                  <span className="sound-status">
                    <strong>{character.name}</strong>
                    <small>{character.series}</small>
                  </span>
                  <span className="sound-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={locked}
                      onClick={() => void start({ characterIds: [character.id] }, character.name)}
                    >
                      Remove…
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        preview && (
          <div className="removal-review" role="group" aria-label="Review removal">
            <p>
              <strong>
                Remove {preview.removable.toLocaleString()} character
                {preview.removable === 1 ? '' : 's'}
              </strong>{' '}
              ({review.label}).{' '}
              {preview.owned > 0
                ? `${preview.owned.toLocaleString()} ${preview.owned === 1 ? 'is' : 'are'} owned: the owners get ${preview.refundGems.toLocaleString()} gems back in total.`
                : 'Nobody owns them.'}
            </p>
            {preview.skipped.length > 0 && (
              <p className="field-help">
                Skipped (card on the market or in a trade):{' '}
                {preview.skipped
                  .slice(0, 10)
                  .map((item) => item.name)
                  .join(', ')}
                {preview.skipped.length > 10 ? '…' : ''}
              </p>
            )}
            {preview.thinPacks.length > 0 && (
              <p className="field-help removal-warning">
                Afterwards these packs have too few characters to open:{' '}
                {preview.thinPacks.join(', ')}.
              </p>
            )}
            {preview.characters.length > 0 && (
              <ul className="sound-rows rarity-changes" aria-label="Characters to be removed">
                {preview.characters.map((character) => (
                  <li key={character.characterId} className="sound-row rarity-row">
                    <span className="tier-name" data-tier={character.tier}>
                      {tierLabel(character.tier)}
                    </span>
                    <span className="sound-status">
                      <strong>{character.name}</strong>
                      <small>
                        {character.series}
                        {character.owner &&
                          ` · owned by ${character.owner}, refund ${character.refund?.toLocaleString() ?? 0} gems`}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {preview.removable > preview.characters.length && (
              <p className="field-help">
                And {(preview.removable - preview.characters.length).toLocaleString()} more.
              </p>
            )}
            <div className="collection-admin-buttons">
              <button
                type="button"
                className="danger"
                disabled={disabled || busy || preview.removable === 0}
                onClick={() => void confirm()}
              >
                {busy
                  ? 'Removing…'
                  : `Remove ${preview.removable.toLocaleString()} character${preview.removable === 1 ? '' : 's'}`}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )
      )}
    </section>
  );
}
