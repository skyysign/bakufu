'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RankTracksView } from '@card-engine/db';
import { GameIcon } from './game-art';

/** 90 → "1 min 30 s", 4320 → "1 h 12 min". */
export function durationText(seconds: number) {
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    rest = seconds % 60;
  return (
    [hours && `${hours} h`, minutes && `${minutes} min`, rest && `${rest} s`]
      .filter(Boolean)
      .join(' ') || '0 s'
  );
}
function benefitsText(benefits: RankTracksView['benefits']) {
  return [
    benefits.packDiscount ? `${benefits.packDiscount} gems off every pack` : null,
    benefits.recycleBonus ? `+${benefits.recycleBonus} recycling gems` : null,
    benefits.wishlistSlots ? `+${benefits.wishlistSlots} wishlist slots` : null,
    benefits.cooldownReductionSeconds
      ? `${durationText(benefits.cooldownReductionSeconds)} less cooldown`
      : null,
  ].filter(Boolean);
}
export function RankTracks({
  view,
  realmId,
  revision,
  disabled,
  onLockChange,
}: {
  view: RankTracksView;
  realmId: string;
  revision: number;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [pending, setPending] = useState<{
    trackId: string;
    level: number;
    requestKey: string;
    expectedRevision: number;
    name: string;
    cost: number;
  } | null>(null);
  useEffect(() => onLockChange(busy || !!pending), [busy, pending, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);
  async function purchase(track?: RankTracksView['tracks'][number]) {
    if (busy || disabled || (!track?.next && !pending)) return;
    const attempt = pending ?? {
      trackId: track!.id,
      level: track!.next!.level,
      requestKey: crypto.randomUUID(),
      expectedRevision: revision,
      name: track!.name,
      cost: track!.next!.cost,
    };
    setPending(attempt);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/ranks/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          realmId,
          trackId: attempt.trackId,
          level: attempt.level,
          requestKey: attempt.requestKey,
          expectedRevision: attempt.expectedRevision,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) {
          setPending(null);
          router.refresh();
        }
        throw new Error(result.error ?? 'Could not improve this rank.');
      }
      setPending(null);
      setMessage(`${result.name} level ${result.level} unlocked. Your benefits are active.`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not improve this rank.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="ranks" className="section rank-tracks-section" aria-label="Collector ranks">
      <div className="section-heading">
        <div>
          <h2>Rank tracks</h2>
          <p>
            Level up Bronze, Silver and Gold to unlock Sapphire, Ruby and Emerald. Every level is a
            permanent perk.
          </p>
        </div>
      </div>
      {!view.enabled ? (
        <div className="empty panel">
          <span className="empty-icon" aria-hidden="true">
            <GameIcon name="ranks" />
          </span>
          <h3>Rank tracks are off</h3>
          <p className="quiet">Your administrator can enable them in Realm settings.</p>
        </div>
      ) : (
        <div className="rank-track-grid">
          {view.tracks.map((track) => {
            const locked = track.blocked === 'prerequisites';
            return (
              <article
                key={track.id}
                className={`rank-track rank-track-${track.id}${locked ? ' is-locked' : ''}${track.next ? '' : ' is-maxed'}`}
                data-rank-track={track.id}
              >
                <div className="rank-track-title">
                  <span className="rank-emblem" aria-hidden="true">
                    <GameIcon name={locked ? 'lock' : 'ranks'} />
                  </span>
                  <h3>{track.name}</h3>
                  <span className="rank-level-label">
                    Level {track.level} / {track.maxLevel}
                  </span>
                </div>
                <div
                  className="rank-level-pips"
                  aria-label={`${track.level} of ${track.maxLevel} levels unlocked`}
                >
                  {track.levels.map((_, index) => (
                    <span key={index} className={index < track.level ? 'owned' : ''}>
                      {index + 1}
                    </span>
                  ))}
                </div>
                <div className="rank-benefits">
                  <p className="rank-current-benefits">
                    <span>Active perks</span>
                    {track.level ? benefitsText(track.benefits).join(' · ') : 'None yet'}
                  </p>
                  {track.next && (
                    <div className="rank-next-benefits">
                      <span>Level {track.next.level} unlocks</span>
                      <ul>
                        {benefitsText(track.next.benefits).map((text) => (
                          <li key={text}>{text}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {!!track.requires.length && (
                  <p className={`rank-requirements ${track.unmet.length ? 'unmet' : 'met'}`}>
                    <GameIcon name={track.unmet.length ? 'lock' : 'check'} />
                    <span>
                      Requires{' '}
                      {track.requires
                        .map(
                          (rule) =>
                            `${view.tracks.find((item) => item.id === rule.trackId)?.name ?? rule.trackId} ${rule.level}`,
                        )
                        .join(' · ')}
                      <span className="sr-only">
                        {track.unmet.length ? ' · Requirements not met' : ' · Requirements met'}
                      </span>
                    </span>
                  </p>
                )}
                {track.next ? (
                  <button
                    className={track.blocked === null ? 'rank-buy' : 'secondary rank-buy'}
                    disabled={disabled || busy || !!pending || track.blocked !== null}
                    onClick={() => void purchase(track)}
                    aria-label={`Upgrade ${track.name} to level ${track.next.level}`}
                  >
                    {track.blocked === 'prerequisites' ? (
                      'Ranks required'
                    ) : track.blocked === 'gems' ? (
                      `Need ${track.next.cost.toLocaleString()} gems`
                    ) : (
                      <>
                        Level up
                        <span className="gem-text">
                          <GameIcon name="gem" />
                          {track.next.cost.toLocaleString()}
                        </span>
                      </>
                    )}
                  </button>
                ) : (
                  <p className="success-note rank-maxed">
                    <GameIcon name="check" /> Maximum level reached
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
      {pending && (
        <div className="purchase-recovery">
          <p>
            {busy ? 'Upgrading' : 'Recover the result of upgrading'} {pending.name} to level{' '}
            {pending.level}.
          </p>
          <button disabled={busy || disabled} onClick={() => void purchase()}>
            {busy ? 'Upgrading…' : 'Retry rank upgrade'}
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
