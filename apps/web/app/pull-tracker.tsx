'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PullFeed, PulledCard } from '@card-engine/db';
import type { ProviderArtwork } from '../../../packages/importers/src/artwork';
import { InspectableCard } from './card-inspection';
import { DiscordAvatar } from './discord-avatar';
import { GameIcon } from './game-art';
import { ownershipText } from './ownership';

const refreshMs = 15000;
/** Polling pauses after this long without input and resumes on the next one. */
const idleAfterMs = 5 * 60 * 1000;
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
 * Puts a freshly loaded first page in front of the pulls already shown. Older
 * pages stay when the new page reaches them; otherwise (more new pulls than a
 * page) the strip starts over with the new page (`null`).
 */
function withNewestPage(shown: PulledCard[], page: PulledCard[]) {
  const last = page.at(-1);
  const overlap = last ? shown.findIndex((pull) => pull.key === last.key) : -1;
  return overlap < 0 ? null : [...page, ...shown.slice(overlap + 1)];
}

/**
 * "Live pulls": the realm's latest rare, epic and legendary pulls, shown below
 * the packs as one row of cards. Newer and older buttons at the sides (shown
 * on hover or keyboard focus; swipe on touch screens) page further back, and
 * older pulls load a page at a time. Select a card to inspect it. Polls the
 * saved opening receipts while the tab is visible.
 */
export function PullTracker({ realmId, refreshKey }: { realmId: string; refreshKey?: string }) {
  const [pulls, setPulls] = useState<PulledCard[] | null>(null),
    [more, setMore] = useState(false),
    [fresh, setFresh] = useState<Set<string>>(new Set()),
    [now, setNow] = useState(() => Date.now()),
    [failed, setFailed] = useState(false),
    [loadingOlder, setLoadingOlder] = useState(false),
    [edges, setEdges] = useState({ start: true, end: true });
  // The shown pulls also live in refs, so polls, older pages and scrolling all
  // build on the latest list without waiting for a render.
  const shown = useRef<PulledCard[] | null>(null),
    hasMore = useRef(false),
    olderRequest = useRef<Promise<void> | null>(null),
    strip = useRef<HTMLOListElement>(null),
    anchor = useRef<{ key: string; offset: number } | null>(null),
    stepAfterLoad = useRef(false),
    // After a failed older page, scrolling waits before asking again (a click retries at once).
    olderRetryAt = useRef(0);
  const show = useCallback((next: PulledCard[], nextMore: boolean) => {
    shown.current = next;
    hasMore.current = nextMore;
    setPulls(next);
    setMore(nextMore);
  }, []);

  // A different realm starts with an empty strip.
  useEffect(
    () => () => {
      shown.current = null;
      hasMore.current = false;
      anchor.current = null;
    },
    [realmId],
  );

  /** Keeps the card at the left edge in place when newer pulls are added in front. */
  const rememberPosition = useCallback(() => {
    const element = strip.current;
    anchor.current = null;
    if (!element || element.scrollLeft < 2) return;
    const inset = parseFloat(getComputedStyle(element).paddingLeft) || 0;
    for (const item of Array.from(element.children) as HTMLElement[]) {
      if (item.offsetLeft + item.offsetWidth > element.scrollLeft + inset + 1) {
        anchor.current = {
          key: item.dataset.key ?? '',
          offset: item.offsetLeft - element.scrollLeft,
        };
        return;
      }
    }
  }, []);

  // Timed polls (`quiet`) only ask whether anything newer was pulled; the full
  // first page (with current owners and values) loads on start, on return to
  // the tab, after your own openings and whenever a new big pull appears.
  const load = useCallback(
    async (quiet = false) => {
      try {
        const newest = shown.current?.[0]?.openingId;
        const after = quiet && newest ? `&after=${encodeURIComponent(newest)}` : '';
        const response = await fetch(`/api/pulls?realmId=${encodeURIComponent(realmId)}${after}`);
        if (!response.ok) throw new Error();
        const body = (await response.json()) as PullFeed | { unchanged: true };
        setNow(Date.now());
        setFailed(false);
        if ('unchanged' in body) return;
        const previous = shown.current;
        const known = new Set((previous ?? []).map((pull) => pull.key));
        setFresh(
          new Set(
            previous
              ? body.pulls.filter((pull) => !known.has(pull.key)).map((pull) => pull.key)
              : [],
          ),
        );
        const merged = previous ? withNewestPage(previous, body.pulls) : null;
        rememberPosition();
        show(merged ?? body.pulls, merged ? hasMore.current : body.more);
      } catch {
        setFailed(true);
      }
    },
    [realmId, rememberPosition, show],
  );

  /** Appends the next older page; one request at a time. */
  const loadOlder = useCallback(() => {
    const current = shown.current;
    if (olderRequest.current) return olderRequest.current;
    if (!current?.length || !hasMore.current) return Promise.resolve();
    const last = current[current.length - 1];
    setLoadingOlder(true);
    const request = (async () => {
      try {
        const response = await fetch(
          `/api/pulls?realmId=${encodeURIComponent(realmId)}&before=${encodeURIComponent(last.key)}`,
        );
        if (!response.ok) throw new Error();
        const body = (await response.json()) as PullFeed;
        const latest = shown.current;
        // The strip started over in the meantime; its own older pages load later.
        if (!latest || latest[latest.length - 1]?.key !== last.key) return;
        const keys = new Set(latest.map((pull) => pull.key));
        show([...latest, ...body.pulls.filter((pull) => !keys.has(pull.key))], body.more);
      } catch {
        // The older button stays; the next click (or scrolling, after a pause) tries again.
        olderRetryAt.current = Date.now() + 10_000;
      } finally {
        olderRequest.current = null;
        setLoadingOlder(false);
      }
    })();
    olderRequest.current = request;
    return request;
  }, [realmId, show]);

  const updateEdges = useCallback(() => {
    const element = strip.current;
    if (!element) return;
    const start = element.scrollLeft <= 1,
      end = element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
    setEdges((previous) =>
      previous.start === start && previous.end === end ? previous : { start, end },
    );
    // Once someone scrolls back, the next older page loads before they reach it.
    if (
      !start &&
      element.scrollWidth - element.scrollLeft - element.clientWidth < element.clientWidth &&
      Date.now() >= olderRetryAt.current
    )
      void loadOlder();
  }, [loadOlder]);

  /** Scrolls one view (every visible card) newer (-1) or older (1). */
  const step = useCallback((direction: 1 | -1) => {
    const element = strip.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const view =
      element.clientWidth -
      (parseFloat(style.paddingLeft) || 0) -
      (parseFloat(style.paddingRight) || 0) +
      (parseFloat(style.columnGap) || 0);
    element.scrollBy({
      left: direction * view,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, []);

  const showOlder = async () => {
    const element = strip.current;
    if (!element) return;
    const atEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
    if (!atEnd) return step(1);
    if (!hasMore.current) return;
    const before = shown.current?.length ?? 0;
    stepAfterLoad.current = true;
    await loadOlder();
    if ((shown.current?.length ?? 0) === before) stepAfterLoad.current = false;
  };

  useLayoutEffect(() => {
    const element = strip.current;
    const kept = anchor.current;
    if (element && kept) {
      const item = (Array.from(element.children) as HTMLElement[]).find(
        (child) => child.dataset.key === kept.key,
      );
      if (item) element.scrollLeft = item.offsetLeft - kept.offset;
    }
    anchor.current = null;
    if (stepAfterLoad.current) {
      stepAfterLoad.current = false;
      step(1);
    }
    updateEdges();
  }, [pulls, step, updateEdges]);

  const hasStrip = !!pulls?.length;
  useEffect(() => {
    const element = strip.current;
    if (!hasStrip || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateEdges());
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasStrip, updateEdges]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  useEffect(() => {
    let lastInput = Date.now();
    const idle = () => Date.now() - lastInput > idleAfterMs;
    const tick = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !idle()) void load(true);
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

  // The buttons appear only while the strip can move; at an end the button
  // stays focusable (dimmed) so keyboard focus is never lost.
  const scrollable = !edges.start || !edges.end || more,
    newerDisabled = edges.start,
    olderDisabled = edges.end && !more;
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
        <div className="pull-strip">
          {scrollable && (
            <button
              type="button"
              className="pull-nav pull-nav-newer"
              aria-label="Show newer pulls"
              aria-controls="pull-strip-list"
              aria-disabled={newerDisabled || undefined}
              onClick={() => {
                if (!newerDisabled) step(-1);
              }}
            >
              <GameIcon name="chevron" />
            </button>
          )}
          <ol
            id="pull-strip-list"
            className="pull-grid"
            ref={strip}
            aria-busy={loadingOlder || undefined}
            onScroll={updateEdges}
          >
            {pulls.map((pull) => (
              <li
                key={pull.key}
                data-key={pull.key}
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
                    note: `${ownershipText(pull.status, pull.owner)} · pulled from ${pull.packName}`,
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
          {scrollable && (
            <button
              type="button"
              className="pull-nav pull-nav-older"
              aria-label={loadingOlder ? 'Loading older pulls' : 'Show older pulls'}
              aria-controls="pull-strip-list"
              aria-disabled={olderDisabled || undefined}
              onClick={() => {
                if (!olderDisabled) void showOlder();
              }}
            >
              <GameIcon name="chevron" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
