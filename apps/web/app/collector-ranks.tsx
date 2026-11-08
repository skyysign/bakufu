'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { defaultCollectorRanks, type CollectorRanksConfig } from '@card-engine/config';
import { GameIcon } from './game-art';

type Benefits = {
  packDiscount: number;
  recycleBonus: number;
  wishlistSlots: number;
  cooldownReductionSeconds: number;
};
type Level = Benefits & {
  rank: number;
  name: string;
  cost: number;
  status: 'owned' | 'available' | 'locked';
};
export type CollectorRankDisplay = {
  enabled: boolean;
  rank: number;
  maxRank: number;
  name: string;
  benefits: Benefits;
  levels: Level[];
  next: Level | null;
  blocked: 'disabled' | 'max_rank' | 'gems' | null;
};
export function CollectorRankFields({
  value,
  prefix,
  onChanged,
}: {
  value: CollectorRanksConfig;
  prefix: string;
  onChanged?: () => void;
}) {
  const [enabled, setEnabled] = useState(value.enabled),
    [levels, setLevels] = useState(JSON.stringify(value.levels, null, 2));
  return (
    <fieldset className="reward-settings">
      <legend>Collector ranks</legend>
      <label className="check-label">
        <input
          type="checkbox"
          name="collectorRanksEnabled"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enable gem-purchased collector ranks
      </label>
      <p className="small quiet">
        Separate from XP levels. Names, gem costs and cumulative benefits are configurable; ranks
        never change rarity odds.
      </p>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setEnabled(true);
          setLevels(JSON.stringify(defaultCollectorRanks.levels, null, 2));
          onChanged?.();
        }}
      >
        Use default metal rank ladder
      </button>
      <label htmlFor={`${prefix}-collectorRanks`}>Rank ladder (JSON)</label>
      <textarea
        id={`${prefix}-collectorRanks`}
        name="collectorRankLevels"
        rows={8}
        value={levels}
        onChange={(event) => setLevels(event.target.value)}
        spellCheck={false}
      />
      <p className="small quiet">
        Each row has name, cost, packDiscount, recycleBonus, wishlistSlots and
        cooldownReductionSeconds. Benefits are total values at that rank and must not decrease.
      </p>
    </fieldset>
  );
}
export function readCollectorRanks(form: FormData) {
  let levels: unknown;
  try {
    levels = JSON.parse(String(form.get('collectorRankLevels') ?? '[]'));
  } catch {
    throw new Error('Enter a valid JSON rank ladder.');
  }
  return { enabled: form.get('collectorRanksEnabled') === 'on', levels };
}
function benefitText(benefits: Benefits) {
  return [
    benefits.packDiscount > 0 ? `${benefits.packDiscount} gem pack discount` : null,
    benefits.recycleBonus > 0 ? `+${benefits.recycleBonus} recycling gems` : null,
    benefits.wishlistSlots > 0 ? `+${benefits.wishlistSlots} wishlist slots` : null,
    benefits.cooldownReductionSeconds > 0
      ? `${benefits.cooldownReductionSeconds}s less cooldown`
      : null,
  ].filter(Boolean);
}
export function CollectorRanks({
  rank,
  realmId,
  revision,
  balance,
  disabled,
  onLockChange,
}: {
  rank: CollectorRankDisplay;
  realmId: string;
  revision: number;
  balance: number;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [pending, setPending] = useState<{
    targetRank: number;
    requestKey: string;
    expectedRevision: number;
    name: string;
    cost: number;
  } | null>(null);
  useEffect(() => {
    onLockChange(busy || !!pending);
  }, [busy, pending, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);
  async function purchase() {
    if (busy || disabled || (!rank.next && !pending)) return;
    const attempt = pending ?? {
      targetRank: rank.next!.rank,
      requestKey: crypto.randomUUID(),
      expectedRevision: revision,
      name: rank.next!.name,
      cost: rank.next!.cost,
    };
    setBusy(true);
    setPending(attempt);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/ranks/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          realmId,
          rank: attempt.targetRank,
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
        throw new Error(result.error ?? 'Could not unlock this rank.');
      }
      setPending(null);
      setMessage(
        `${result.name ?? rank.next?.name ?? 'Collector rank'} unlocked. Your benefits are active.`,
      );
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not unlock this rank.');
    } finally {
      setBusy(false);
    }
  }
  const actionRank = pending ? { name: pending.name, cost: pending.cost } : rank.next;
  return (
    <section id="ranks" className="section rank-section" aria-label="Collector ranks">
      <div className="section-heading">
        <div>
          <p className="eyebrow">A LITTLE MORE POWER. EVERY OPENING.</p>
          <h2>Rise through the ranks</h2>
        </div>
        <span className="current-rank">
          <GameIcon name="ranks" />
          {rank.name}
        </span>
      </div>
      <p className="quiet">
        Spend the gems you earn to unlock lasting benefits. Your rank belongs to this realm; your XP
        level keeps growing separately.
      </p>
      {!rank.enabled ? (
        <div className="empty panel">
          <GameIcon name="ranks" />
          <h3>Ranks are resting in this realm.</h3>
          <p>Your realm administrator can enable a rank ladder in Realm settings.</p>
        </div>
      ) : (
        <>
          <div className="rank-grid">
            {rank.levels.map((level) => (
              <article key={level.rank} className={`rank-card rank-${level.rank} ${level.status}`}>
                <span className="rank-symbol">
                  <GameIcon name="ranks" />
                </span>
                <p className="eyebrow">RANK {String(level.rank).padStart(2, '0')}</p>
                <h3>{level.name}</h3>
                <ul>
                  {benefitText(level).map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
                <div className="rank-cost">
                  <GameIcon name="gem" />
                  {level.cost}
                  <small>gems</small>
                </div>
                <span className="rank-status">
                  {level.status === 'owned'
                    ? 'Unlocked'
                    : level.status === 'available'
                      ? 'Next rank'
                      : 'Unlock previous rank first'}
                </span>
              </article>
            ))}
          </div>
          {actionRank && pending ? (
            <div className="purchase-recovery">
              <p>
                {busy ? 'Unlocking' : 'Recover the result of unlocking'} {actionRank.name}.
              </p>
              <button disabled={busy || disabled} onClick={purchase}>
                {busy ? 'Unlocking...' : 'Retry rank purchase'}
              </button>
            </div>
          ) : rank.next ? (
            <button disabled={disabled || busy || balance < rank.next.cost} onClick={purchase}>
              {balance < rank.next.cost
                ? `Need ${rank.next.cost} gems`
                : `Unlock ${rank.next.name} ? ${rank.next.cost} gems`}
            </button>
          ) : (
            <p className="small quiet">You have unlocked every rank in this realm.</p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="success-note">
          {message}
        </p>
      )}
    </section>
  );
}
