'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GameIcon } from './game-art';
import Link from 'next/link';
export type GemRewardDisplay = {
  enabled: boolean;
  amount: number;
  intervalSeconds: number;
  claimable: boolean;
  lastClaimAt: string | null;
  nextClaimAt: string | null;
  serverTime: string;
};
function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    remaining = seconds % 60;
  return `${hours > 0 ? `${hours}h ` : ''}${minutes}m ${String(remaining).padStart(2, '0')}s`;
}
/** Header countdowns stay calm: seconds appear only during the final hour. */
function compactDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m`
    : `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}
function useGemClock(reward: GemRewardDisplay) {
  const [elapsed, setElapsed] = useState(0),
    [localTime, setLocalTime] = useState('');
  useEffect(() => {
    setElapsed(0);
    setLocalTime(
      reward.nextClaimAt
        ? new Date(reward.nextClaimAt).toLocaleString(undefined, {
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '',
    );
    const start = performance.now(),
      timer = setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [reward.serverTime, reward.nextClaimAt]);
  const remaining = reward.nextClaimAt
    ? Math.max(
        0,
        Math.ceil((Date.parse(reward.nextClaimAt) - Date.parse(reward.serverTime)) / 1000) -
          elapsed,
      )
    : 0;
  return { remaining, localTime };
}

export function GemRechargeStatus({
  reward,
  href,
  disabled,
}: {
  reward: GemRewardDisplay;
  href: string;
  disabled: boolean;
}) {
  const { remaining, localTime } = useGemClock(reward);
  const ready = reward.enabled && remaining === 0;
  return (
    <Link
      scroll={false}
      className={`header-recharge ${ready ? 'claim-ready' : ''} ${reward.enabled ? '' : 'claims-off'}`}
      href={href}
      prefetch={false}
      aria-label={
        !reward.enabled
          ? 'Timed gem claims are disabled in this realm'
          : remaining > 0
            ? `Next gem claim in ${duration(remaining)}${localTime ? `, ${localTime}` : ''}`
            : `${reward.amount} gems available to claim`
      }
      title={localTime ? `Next claim: ${localTime}` : undefined}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        if (disabled) event.preventDefault();
      }}
    >
      <GameIcon name={ready ? 'gem' : 'clock'} />
      {!reward.enabled ? (
        'Claims off'
      ) : remaining > 0 ? (
        <span>
          <span className="sr-only">Next gems in </span>
          {compactDuration(remaining)}
        </span>
      ) : (
        <span>Claim {reward.amount.toLocaleString()}</span>
      )}
    </Link>
  );
}
export function GemClaim({
  realmId,
  reward,
  revision,
  disabled,
  onPendingChange,
  adminHref,
}: {
  realmId: string;
  reward: GemRewardDisplay;
  revision: number;
  disabled: boolean;
  onPendingChange?: (pending: boolean) => void;
  adminHref?: string;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [pending, setPending] = useState<{ requestKey: string; expectedRevision: number } | null>(
    null,
  );
  useEffect(() => {
    onPendingChange?.(busy || !!pending);
  }, [busy, pending, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const { remaining, localTime } = useGemClock(reward);
  async function claim() {
    if (busy || disabled || (!pending && (!reward.enabled || remaining > 0))) return;
    const attempt = pending ?? { requestKey: crypto.randomUUID(), expectedRevision: revision };
    setPending(attempt);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/gems/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ realmId, ...attempt }),
        }),
        result = await response.json();
      if (!response.ok) {
        if (response.status < 500) {
          setPending(null);
          router.refresh();
        }
        throw new Error(result.error ?? 'Could not claim gems.');
      }
      setPending(null);
      setMessage(`+${result.amount} gems claimed. Your next claim is saved.`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not claim gems.');
    } finally {
      setBusy(false);
    }
  }
  if (!reward.enabled && !pending)
    return (
      <section className="gem-claim-strip gem-claim-disabled" aria-label="Timed gem reward">
        <div className="gem-claim-symbol">
          <GameIcon name="gem" />
        </div>
        <div className="gem-claim-copy">
          <h2>Free gems are off</h2>
          <p>This realm doesn’t hand out timed gem claims right now.</p>
        </div>
        {adminHref && (
          <Link
            className="button secondary"
            href={adminHref}
            onClick={(event) => {
              if (disabled) event.preventDefault();
            }}
          >
            Configure gem claims
          </Link>
        )}
      </section>
    );
  const ready = remaining === 0;
  return (
    <section
      className={`gem-claim-strip ${ready ? 'is-ready' : 'is-waiting'}`}
      aria-label="Timed gem reward"
    >
      <div className="gem-claim-symbol">
        <GameIcon name="gem" />
      </div>
      <div className="gem-claim-copy">
        <h2>
          {ready ? 'Free gems ready' : 'Free gems'}
          <span className="gem-text">
            <GameIcon name="gem" />+{reward.amount.toLocaleString()}
          </span>
        </h2>
        <p>
          {remaining > 0
            ? `Next claim in ${duration(remaining)}`
            : `Claim now · refills every ${duration(reward.intervalSeconds)}`}
          {remaining > 0 && reward.nextClaimAt && (
            <time className="claim-ready-time" dateTime={reward.nextClaimAt}>
              {localTime ? ` · ready ${localTime}` : ''}
            </time>
          )}
        </p>
      </div>
      <button
        className={ready && !pending ? 'accent' : undefined}
        onClick={claim}
        disabled={busy || disabled || (!pending && remaining > 0)}
      >
        {busy
          ? 'Claiming…'
          : pending
            ? 'Retry gem claim'
            : remaining > 0
              ? 'Claim on cooldown'
              : 'Claim gems'}
      </button>
      {pending && !busy && (
        <p className="gem-claim-note" role="status">
          Retry this claim to recover its result.
        </p>
      )}
      {message && (
        <p className="gem-claim-note success-note" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="gem-claim-note error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
