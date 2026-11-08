'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PulledCard } from '@card-engine/db';
import type { ProviderArtwork } from '../../../packages/importers/src/artwork';
import { InspectableCard } from './card-inspection';
import { DiscordAvatar } from './discord-avatar';

const refreshMs = 15000;
/** Polling pauses after this long without input and resumes on the next one. */
const idleAfterMs = 5 * 60 * 1000;
const statusName = (status: PulledCard['status']) =>
  status === 'yours'
    ? 'In your collection'
    : status === 'claimed'
      ? 'Owned by another collector'
      : 'Unclaimed';
function ago(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * "Live pulls": the realm's latest rare, epic and legendary pulls, shown below
 * the packs as one row of cards (no scrolling). Select a card to inspect it.
 * Polls the saved opening receipts while the tab is visible.
 */
export function PullTracker({ realmId, refreshKey }: { realmId: string; refreshKey?: string }) {
  const [pulls, setPulls] = useState<PulledCard[] | null>(null),
    [fresh, setFresh] = useState<Set<string>>(new Set()),
    [now, setNow] = useState(() => Date.now()),
    [failed, setFailed] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/pulls?realmId=${encodeURIComponent(realmId)}`);
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { pulls: PulledCard[] };
      const previous = known.current;
      setFresh(
        new Set(
          previous
            ? body.pulls.filter((pull) => !previous.has(pull.key)).map((pull) => pull.key)
            : [],
        ),
      );
      known.current = new Set(body.pulls.map((pull) => pull.key));
      setPulls(body.pulls);
      setNow(Date.now());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [realmId]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  useEffect(() => {
    let lastInput = Date.now();
    const idle = () => Date.now() - lastInput > idleAfterMs;
    const tick = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !idle()) void load();
    }, refreshMs);
    const visible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const active = () => {
      const wasIdle = idle();
      lastInput = Date.now();
      if (wasIdle && document.visibilityState === 'visible') void load();
    };
    const inputs = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    document.addEventListener('visibilitychange', visible);
    for (const input of inputs) window.addEventListener(input, active, { passive: true });
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', visible);
      for (const input of inputs) window.removeEventListener(input, active);
    };
  }, [load]);

  return (
    <section className="section pull-tracker" aria-labelledby="pull-tracker-title">
      <div className="pull-tracker-head">
        <p className="pull-tracker-eyebrow">
          <span className="live-dot" aria-hidden="true" /> Live · rare and above
        </p>
        <h2 id="pull-tracker-title">Live pulls</h2>
      </div>
      {pulls === null || pulls.length === 0 ? (
        <p className="pull-tracker-empty">
          {pulls === null
            ? failed
              ? 'Live pulls are unavailable right now.'
              : 'Loading…'
            : 'No big pulls yet. The next rare, epic or legendary card pulled in this realm shows up here.'}
        </p>
      ) : (
        <ol className="pull-grid">
          {pulls.map((pull) => (
            <li
              key={pull.key}
              className="pull-item"
              data-tier={pull.tier}
              data-fresh={fresh.has(pull.key) || undefined}
              data-mine={pull.mine || undefined}
            >
              <InspectableCard
                card={{
                  id: pull.characterId,
                  characterId: pull.characterId,
                  sourceKey: pull.sourceKey,
                  name: pull.name,
                  series: pull.series,
                  categories: pull.categories,
                  tier: pull.tier,
                  artwork: pull.artwork as ProviderArtwork | undefined,
                  valuation: pull.valuation,
                  note: `${statusName(pull.status)} · pulled from ${pull.packName}`,
                }}
              />
              <div className="pull-meta">
                <DiscordAvatar
                  className="pull-avatar"
                  profile={
                    pull.collector
                      ? {
                          avatarUrl: pull.collector.avatarUrl,
                          displayName: pull.collector.name,
                          username: pull.collector.username,
                        }
                      : { displayName: pull.mine ? 'You' : 'Collector' }
                  }
                />
                <span className="pull-who">
                  <strong>{pull.mine ? 'You' : (pull.collector?.name ?? 'A collector')}</strong>
                  <time dateTime={pull.pulledAt}>{ago(pull.pulledAt, now)}</time>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
