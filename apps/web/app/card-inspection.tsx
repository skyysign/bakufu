'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { providerArtworkSchema } from '../../../packages/importers/src/artwork';
import { CardFace, type BrowseCard } from './card-browser';
import { GameIcon } from './game-art';
import { RarityEffects } from './rarity-effects';

/** Keep selection and inspection controls outside the purely visual card face. */
export function InspectableCard({
  card,
  value,
  className = '',
  priority = false,
}: {
  card: BrowseCard;
  value?: number;
  className?: string;
  priority?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const modal = dialog.current;
    if (!modal) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (modal.open) modal.close();
      document.body.style.overflow = overflow;
      opener.current?.focus({ preventScroll: true });
    };
  }, [open]);
  const artwork = providerArtworkSchema.safeParse(card.artwork),
    valuation = card.valuation,
    shownValue = value ?? valuation?.marketValue;
  return (
    <>
      <button
        className={`inspect-card ${className}`}
        type="button"
        aria-label={`Inspect ${card.name}`}
        aria-haspopup="dialog"
        ref={opener}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <CardFace card={card} value={shownValue} priority={priority} />
        <span className="inspect-card-hint" aria-hidden="true">
          Inspect
        </span>
      </button>
      {open &&
        createPortal(
          <dialog
            className={`card-inspector ${card.tier}`}
            ref={dialog}
            aria-label={`${card.name} card details`}
            onClose={(event) => {
              event.stopPropagation();
              if (dialog.current && !dialog.current.open) setOpen(false);
            }}
            onCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (event.target !== event.currentTarget) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              )
                setOpen(false);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
              if (event.key !== 'Tab') return;
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]'),
              );
              const first = controls[0],
                last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <button
              ref={closeButton}
              type="button"
              className="secondary inspector-close"
              aria-label="Close card inspection"
              onClick={() => setOpen(false)}
            >
              <span aria-hidden="true">×</span>
            </button>
            <div className="inspector-art">
              <RarityEffects tier={card.tier} />
              <CardFace card={card} value={shownValue} priority />
            </div>
            <div className="inspector-details">
              <span className={`inspector-rarity ${card.tier}`}>{card.tier}</span>
              <h2>{card.name}</h2>
              <p className="inspector-series">{card.series}</p>
              {card.note && <p className="inspector-availability">{card.note}</p>}
              {(shownValue !== undefined || valuation) && (
                <dl className="inspector-values">
                  {shownValue !== undefined && (
                    <div>
                      <dt>Character value</dt>
                      <dd>
                        <GameIcon name="gem" /> {shownValue.toLocaleString()}
                      </dd>
                    </div>
                  )}
                  {valuation && (
                    <>
                      <div>
                        <dt>Recycling estimate</dt>
                        <dd>
                          <GameIcon name="gem" /> {valuation.recycleValue.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt>Saved source popularity</dt>
                        <dd>
                          {valuation.popularity === null
                            ? 'Not available'
                            : valuation.popularity.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt>Collector demand</dt>
                        <dd>{valuation.wishlistDemand.toLocaleString()}</dd>
                      </div>
                    </>
                  )}
                </dl>
              )}
              {valuation?.enabled && (
                <p className="inspector-value-basis">
                  Value reflects saved source popularity and collector wishlists in this realm.
                  Sellers choose their own asking price.
                </p>
              )}
              {artwork.success && (
                <a
                  className="inspector-source"
                  href={artwork.data.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  View character source <span aria-hidden="true">↗</span>
                </a>
              )}
              {card.sourceKey && (
                <p className="inspector-catalog-source">Catalog · {card.sourceKey.split(':')[0]}</p>
              )}
              <p className="inspector-keyboard-hint">Esc to close</p>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
