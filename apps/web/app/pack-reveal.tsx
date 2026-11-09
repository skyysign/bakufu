'use client';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { Character, CharacterValue, OpeningResult, PackMotif } from '@card-engine/core';
import { GameIcon, PackArtwork, packMotif } from './game-art';
import { packPaletteStyle } from './pack-palettes';
import { InspectableCard } from './card-inspection';
import { RarityEffects } from './rarity-effects';
import { RevealSoundToggle } from './reveal-sound';
import {
  playRevealAudio,
  preloadCustomRevealSounds,
  stopRevealAudio,
  unlockRevealAudio,
} from './reveal-audio';
import { RevealBackdrop } from './reveal-backdrop';
import type { Tier } from '@card-engine/config';
import './inline-reveal.css';

export type SuccessfulOpening = Extract<OpeningResult, { ok: true }>;
const preferenceKey = 'card-engine:pack-reveals:v1';
export function usePackRevealPreference() {
  const [enabled, setEnabled] = useState(true),
    [ready, setReady] = useState(false);
  useEffect(() => {
    function read() {
      try {
        setEnabled(localStorage.getItem(preferenceKey) !== 'off');
      } catch {
        /* Private storage can be unavailable. */
      }
      setReady(true);
    }
    const changed = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null) read();
    };
    read();
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  function change(value: boolean) {
    setEnabled(value);
    try {
      localStorage.setItem(preferenceKey, value ? 'on' : 'off');
    } catch {
      /* Keep the in-memory choice. */
    }
  }
  return { enabled, ready, change };
}

function dismissWithEscape(event: KeyboardEvent<HTMLElement>, dismiss: () => void) {
  // Inspection has its own native dialog and keyboard handling. This page
  // should never intercept Escape intended for a card's closer look.
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  dismiss();
}

type PackAppearance = { index: number; motif: PackMotif };

// Foil scraps thrown off when the seal tears: fixed, spread trajectories so the
// burst looks the same on every render (no randomness during rendering).
const tearShards = Array.from({ length: 16 }, (_, i) => {
  const side = i % 2 ? 1 : -1,
    spread = 30 + ((i * 37) % 110);
  return {
    '--i': i,
    '--x': `${side * spread}px`,
    '--y': `${-30 - ((i * 53) % 120)}px`,
    '--r': `${side * (20 + ((i * 29) % 60))}deg`,
  } as CSSProperties;
});

function SealedPack({ packName, appearance }: { packName: string; appearance?: PackAppearance }) {
  return (
    <div
      className="opening-seal"
      aria-hidden="true"
      style={packPaletteStyle(appearance?.motif, packMotif(packName, appearance?.motif))}
    >
      <div className="opening-seal-body">
        <PackArtwork name={packName} {...appearance} />
        <span className="opening-seal-line" />
      </div>
      <span className="tear-flash" />
      <span className="tear-shards">
        {tearShards.map((shard, index) => (
          <i key={index} style={shard} />
        ))}
      </span>
      <div className="opening-seal-cap">
        <span>CHARACTER COLLECTION</span>
      </div>
    </div>
  );
}

export function OpeningPreparation({
  packName,
  packCount,
  phase,
  progress,
  onDismiss,
  appearance,
}: {
  packName: string;
  packCount: number;
  phase: 'request' | 'artwork';
  progress?: { loaded: number; total: number };
  onDismiss: () => void;
  appearance?: PackAppearance;
}) {
  const heading = useRef<HTMLHeadingElement>(null),
    title = useId(),
    description = useId();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    heading.current?.focus({ preventScroll: true });
  }, []);
  const determinate = phase === 'artwork' && !!progress?.total;
  return (
    <section
      className={`pack-reveal opening-room-stage opening-preparation preparation-${phase}`}
      aria-label="Opening preparation"
      aria-describedby={description}
      onKeyDown={(event) => dismissWithEscape(event, onDismiss)}
    >
      <div className="reveal-cinema preparation-cinema" aria-hidden="true">
        <RevealBackdrop tier="sealed" phase="charging" />
        <span className="cinema-orbit orbit-a" />
        <span className="cinema-orbit orbit-b" />
        <span className="cinema-particles" />
      </div>
      <div className="reveal-heading">
        <div>
          <h1 id={title} ref={heading} tabIndex={-1}>
            Opening {packName}
          </h1>
        </div>
        <button className="secondary reveal-close" onClick={onDismiss}>
          Return to pack
        </button>
        <RevealSoundToggle />
      </div>
      <div className="opening-preparation-stage" aria-hidden="true">
        <span className="opening-halo" />
        <span className="opening-track track-a" />
        <span className="opening-track track-b" />
        <SealedPack packName={packName} appearance={appearance} />
        {packCount > 1 && <span className="opening-quantity">× {packCount}</span>}
        <span className="opening-floor" />
      </div>
      <div className="opening-preparation-copy">
        <h3>
          {phase === 'request'
            ? packCount === 1
              ? 'Opening your pack…'
              : 'Opening your packs…'
            : 'Preparing your cards…'}
        </h3>
        <p role="status" aria-live="polite">
          {phase === 'artwork' && progress?.total
            ? `${progress.loaded} of ${progress.total} artwork ready`
            : 'Your next discovery is on its way.'}
        </p>
        <progress
          aria-label="Opening preparation"
          max={determinate ? progress!.total : 1}
          value={determinate ? progress!.loaded : undefined}
        />
        <p id={description} className="opening-preparation-note">
          Your result is already saved — you can return to the pack at any time.
        </p>
      </div>
    </section>
  );
}

function RevealCard({
  character,
  index,
  packNumber,
  valuation,
  footer,
}: {
  character: Character;
  index: number;
  packNumber?: number;
  valuation?: CharacterValue;
  footer?: ReactNode;
}) {
  return (
    <article
      className={`reveal-card reveal-face ${character.tier}`}
      aria-label={`Revealed card ${index + 1}`}
    >
      {packNumber !== undefined && <span className="sr-only">Pack {packNumber}</span>}
      <div className="reveal-portrait">
        <InspectableCard card={{ ...character, valuation }} priority />
        {packNumber !== undefined && (
          <span className="reveal-pack-number reveal-pack-badge">Pack {packNumber}</span>
        )}
      </div>
      {footer}
    </article>
  );
}

export function PackReveal({
  receipt,
  packName,
  onDismiss,
  characterValues,
  onBrowseCollection,
  appearance,
  customSounds,
  onRecycle,
}: {
  receipt: SuccessfulOpening;
  packName: string;
  onDismiss: () => void;
  characterValues?: Record<string, CharacterValue>;
  onBrowseCollection?: () => void;
  appearance?: PackAppearance;
  /** Realm-provided arrival sounds (URLs): per character first, then per tier. */
  customSounds?: {
    tiers: Partial<Record<Tier, string>>;
    characters: Record<string, string>;
  };
  /** Recycles cards from this opening; resolves with the gems credited per card ID. */
  onRecycle?: (cardIds: string[]) => Promise<Record<string, number>>;
}) {
  const primary = useRef<HTMLButtonElement>(null),
    summaryHeading = useRef<HTMLHeadingElement>(null);
  const title = useId(),
    description = useId();
  const packCount = receipt.packCount ?? 1,
    cardsPerPack = receipt.cardsPerPack ?? receipt.characters.length;
  const [phase, setPhase] = useState<'bundle' | 'sealed' | 'charging' | 'face' | 'summary'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'summary'
      : packCount > 1
        ? 'bundle'
        : 'sealed',
  );
  const [index, setIndex] = useState(0);
  // Recycling straight from the results: credited gems per recycled card.
  const [recycled, setRecycled] = useState<Record<string, number>>({}),
    [recycling, setRecycling] = useState<string | null>(null),
    [confirmTier, setConfirmTier] = useState<Tier | null>(null),
    [recycleError, setRecycleError] = useState(''),
    [recycleNote, setRecycleNote] = useState('');
  const recycleValue = (i: number) =>
    characterValues?.[receipt.characters[i].id]?.recycleValue ?? null;
  async function recycleCards(cardIds: string[], busyKey: string, label: string) {
    if (!onRecycle || recycling) return;
    setRecycling(busyKey);
    setRecycleError('');
    setRecycleNote('');
    try {
      const credits = await onRecycle(cardIds);
      const credited = Object.values(credits).reduce((sum, value) => sum + value, 0);
      setRecycled((current) => ({ ...current, ...credits }));
      setConfirmTier(null);
      setRecycleNote(`${label} recycled: +${credited.toLocaleString()} gems.`);
    } catch (failure) {
      setRecycleError((failure as Error).message);
    } finally {
      setRecycling(null);
    }
  }
  // Bulk recycling by rarity: tiers with at least two cards still in the collection.
  const bulkTiers = (['common', 'uncommon', 'rare'] as const)
    .map((tier) => {
      const cards = receipt.characters
        .map((character, i) => ({ character, i, cardId: receipt.cardIds[i] }))
        .filter(({ character, cardId }) => character.tier === tier && !(cardId in recycled));
      return {
        tier,
        cardIds: cards.map((card) => card.cardId),
        gems: cards.reduce((sum, card) => sum + (recycleValue(card.i) ?? 0), 0),
      };
    })
    .filter((group) => group.cardIds.length >= 2);
  const skipped = useRef(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const activeTier = receipt.characters[index].tier,
    revealedTier = phase === 'face' || phase === 'charging' ? activeTier : 'sealed',
    chargeDuration =
      activeTier === 'legendary'
        ? 2350
        : activeTier === 'epic'
          ? 1900
          : activeTier === 'rare'
            ? 1450
            : activeTier === 'uncommon'
              ? 1000
              : 650;
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => {
      if (media.matches) {
        stopRevealAudio();
        setPhase('summary');
      }
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') stopRevealAudio();
    };
    changed();
    media.addEventListener('change', changed);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopRevealAudio();
      media.removeEventListener('change', changed);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (phase === 'summary') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      summaryHeading.current?.focus({ preventScroll: true });
    } else primary.current?.focus({ preventScroll: true });
  }, [phase, index]);
  useEffect(() => {
    if (phase !== 'charging') return;
    const timer = window.setTimeout(() => setPhase('face'), chargeDuration);
    return () => window.clearTimeout(timer);
  }, [phase, index, chargeDuration]);
  // Read through a ref: a data refresh after the opening must not replay a cue.
  const sounds = useRef(customSounds);
  useEffect(() => {
    sounds.current = customSounds;
    preloadCustomRevealSounds([
      ...Object.values(customSounds?.tiers ?? {}),
      ...receipt.characters.map((character) => customSounds?.characters[character.id]),
    ]);
  }, [customSounds, receipt]);
  useEffect(() => {
    if (phase === 'charging') return playRevealAudio(activeTier, 'charge');
    if (phase === 'face' && !skipped.current)
      return playRevealAudio(
        activeTier,
        'arrival',
        sounds.current?.characters[receipt.characters[index].id] ??
          sounds.current?.tiers[activeTier],
      );
  }, [phase, index, activeTier]);
  function close() {
    stopRevealAudio();
    onDismiss();
  }
  function advance() {
    unlockRevealAudio();
    stopRevealAudio();
    skipped.current = phase === 'charging';
    if (phase === 'bundle') setPhase('charging');
    else if (phase === 'sealed') setPhase('charging');
    else if (phase === 'charging') setPhase('face');
    else if (index < receipt.characters.length - 1) {
      setIndex(index + 1);
      setPhase('charging');
    } else setPhase('summary');
  }
  return (
    <section
      className={`pack-reveal opening-room-stage cinematic-reveal reveal-tier-${revealedTier} reveal-phase-${phase}`}
      data-pack-count={packCount}
      data-reveal-effect={revealedTier}
      aria-label={`Pack reveal: ${packName}`}
      aria-describedby={description}
      onKeyDown={(event) => dismissWithEscape(event, close)}
    >
      <div className={`reveal-cinema cinema-${revealedTier}`} aria-hidden="true">
        <RevealBackdrop
          tier={revealedTier}
          phase={phase === 'charging' ? 'charging' : phase === 'face' ? 'face' : 'idle'}
        />
        {phase === 'face' &&
          ['rare', 'epic', 'legendary'].includes(revealedTier) &&
          !videoFailed && (
            <video
              src="/media/rare-reveal.webm"
              autoPlay
              muted
              loop
              playsInline
              onError={() => setVideoFailed(true)}
              tabIndex={-1}
            />
          )}
        <span className="cinema-orbit orbit-a" />
        <span className="cinema-orbit orbit-b" />
        <span className="cinema-beam beam-a" />
        <span className="cinema-beam beam-b" />
        <span className="cinema-particles" />
      </div>
      <div className="reveal-heading">
        <div>
          <h1 id={title}>{packName}</h1>
        </div>
        <button className="secondary reveal-close" onClick={close}>
          Return to pack
        </button>
        <RevealSoundToggle />
      </div>
      <p id={description} className="reveal-receipt-note">
        {packCount > 1 && `${packCount} packs · ${receipt.characters.length} cards · `}
        {receipt.charged.toLocaleString()} gems spent
        {receipt.progression ? ` · +${receipt.progression.xpAwarded} XP` : ''} · saved to your
        collection
        {!!receipt.progression?.levelsGained && ` · you reached level ${receipt.progression.level}`}
      </p>
      {!!receipt.progression?.levelsGained && (
        <p className="reveal-level-up">Level up! You reached level {receipt.progression.level}.</p>
      )}
      {phase === 'summary' ? (
        <>
          <h2 ref={summaryHeading} tabIndex={-1} className="reveal-summary-title">
            {packCount > 1 ? `Your ${packCount}-pack opening` : 'Your pack contents'}
          </h2>
          {onRecycle && bulkTiers.length > 0 && (
            <div className="reveal-bulk-recycle" role="group" aria-label="Recycle by rarity">
              {bulkTiers.map((group) =>
                confirmTier === group.tier ? (
                  <span key={group.tier} className="reveal-bulk-confirm">
                    <button
                      type="button"
                      disabled={!!recycling}
                      onClick={() =>
                        void recycleCards(
                          group.cardIds,
                          `bulk:${group.tier}`,
                          `${group.cardIds.length} ${group.tier} cards`,
                        )
                      }
                    >
                      {recycling === `bulk:${group.tier}`
                        ? 'Recycling…'
                        : `Confirm: recycle ${group.cardIds.length} for +${group.gems.toLocaleString()}`}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!!recycling}
                      onClick={() => setConfirmTier(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    key={group.tier}
                    type="button"
                    className="secondary"
                    disabled={!!recycling}
                    onClick={() => setConfirmTier(group.tier)}
                  >
                    <GameIcon name="recycle" /> Recycle all {group.tier} ({group.cardIds.length})
                    <span className="recycle-reward">+{group.gems.toLocaleString()}</span>
                  </button>
                ),
              )}
            </div>
          )}
          {recycleNote && (
            <p className="success-note reveal-recycle-note" role="status">
              {recycleNote}
            </p>
          )}
          {recycleError && (
            <p className="error" role="alert">
              {recycleError}
            </p>
          )}
          <div
            className={`reveal-summary reveal-gallery${
              receipt.characters.length === 1 ? ' reveal-gallery-single' : ''
            }`}
            aria-label="All revealed cards"
            style={
              {
                '--gallery-columns': Math.min(5, receipt.characters.length),
                '--gallery-tablet-columns': Math.min(3, receipt.characters.length),
                '--gallery-mobile-columns': Math.min(2, receipt.characters.length),
              } as CSSProperties
            }
          >
            {receipt.characters.map((character, i) => (
              <RevealCard
                key={receipt.cardIds[i]}
                character={character}
                valuation={characterValues?.[character.id]}
                index={i}
                packNumber={packCount > 1 ? Math.floor(i / cardsPerPack) + 1 : undefined}
                footer={
                  onRecycle &&
                  (receipt.cardIds[i] in recycled ? (
                    <p className="reveal-recycled">
                      <GameIcon name="check" /> Recycled +
                      {recycled[receipt.cardIds[i]].toLocaleString()}
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="secondary wide recycle-button"
                      aria-label={`Recycle ${character.name}${
                        recycleValue(i) === null ? '' : ` for ${recycleValue(i)} gems`
                      }`}
                      disabled={!!recycling}
                      onClick={() =>
                        void recycleCards([receipt.cardIds[i]], receipt.cardIds[i], character.name)
                      }
                    >
                      {recycling === receipt.cardIds[i] ? (
                        'Recycling…'
                      ) : (
                        <>
                          <GameIcon name="recycle" />
                          Recycle
                          {recycleValue(i) !== null && (
                            <span className="recycle-reward">
                              +{recycleValue(i)!.toLocaleString()}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  ))
                }
              />
            ))}
          </div>
        </>
      ) : phase === 'bundle' ? (
        <>
          <p className="reveal-progress" role="status">
            {packCount} packs ready to open
          </p>
          <div className={`bundle-pack-stage bundle-count-${packCount}`} aria-hidden="true">
            {Array.from({ length: packCount }, (_, packIndex) => (
              <div
                className="bundle-pack"
                key={packIndex}
                style={
                  {
                    '--pack-index': packIndex,
                    '--pack-column': packIndex % 5,
                  } as CSSProperties
                }
              >
                <PackArtwork name={`${packName} pack`} {...appearance} />
                <span>{packIndex + 1}</span>
              </div>
            ))}
          </div>
          <p className="bundle-opening-note">
            Every pack is saved. Reveal one card at a time or show the full opening.
          </p>
        </>
      ) : (
        <>
          <p className="reveal-progress" role="status" aria-live="polite" aria-atomic="true">
            {packCount > 1 && `Pack ${Math.floor(index / cardsPerPack) + 1} of ${packCount} / `}
            Card {index + 1} of {receipt.characters.length}
            {phase === 'face'
              ? `: ${receipt.characters[index].name}, ${receipt.characters[index].tier}`
              : phase === 'charging'
                ? ' / opening'
                : ' / ready to reveal'}
          </p>
          {phase === 'face' && (
            <p className={`rarity-announcement ${revealedTier}`}>
              {revealedTier === 'legendary'
                ? 'A legendary encounter'
                : revealedTier === 'epic'
                  ? 'An epic arrival'
                  : revealedTier === 'rare'
                    ? 'A rare discovery'
                    : revealedTier === 'uncommon'
                      ? 'Something extraordinary'
                      : 'A new chapter begins'}
            </p>
          )}
          <div
            className={`reveal-stage ${phase === 'charging' ? 'unseal-stage' : ''}`}
            style={{ '--charge-duration': `${chargeDuration}ms` } as CSSProperties}
          >
            {(phase === 'charging' || phase === 'face') && (
              <RarityEffects key={`${index}-${phase}`} tier={activeTier} />
            )}
            {phase === 'sealed' || phase === 'charging' ? (
              <div
                className={`sealed-discovery ${phase === 'charging' ? 'is-unsealing' : ''}`}
                aria-label="Unrevealed card"
              >
                <span className="opening-halo" aria-hidden="true" />
                <span className="unseal-rays" aria-hidden="true" />
                <span className="unseal-ring" aria-hidden="true" />
                <SealedPack packName={packName} appearance={appearance} />
                <span className="opening-floor" aria-hidden="true" />
              </div>
            ) : (
              <RevealCard
                key={receipt.cardIds[index]}
                character={receipt.characters[index]}
                valuation={characterValues?.[receipt.characters[index].id]}
                index={index}
              />
            )}
          </div>
        </>
      )}
      <div className="reveal-actions">
        {phase === 'summary' ? (
          <button ref={primary} onClick={close}>
            Open more packs
          </button>
        ) : (
          <>
            <button ref={primary} onClick={advance}>
              {phase === 'bundle'
                ? `Open ${packCount} packs`
                : phase === 'sealed'
                  ? `Reveal card ${index + 1}`
                  : phase === 'charging'
                    ? 'Skip animation'
                    : index < receipt.characters.length - 1
                      ? 'Next card'
                      : 'View all cards'}
            </button>
            <button
              className="secondary"
              onClick={() => {
                stopRevealAudio();
                setPhase('summary');
              }}
            >
              Show all cards
            </button>
          </>
        )}
        {phase === 'summary' && onBrowseCollection && (
          <button
            className="secondary"
            onClick={() => {
              stopRevealAudio();
              onBrowseCollection();
            }}
          >
            View collection
          </button>
        )}
      </div>
    </section>
  );
}
