'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { screenHref, type GameScreen } from './screens';
import { GemClaim } from './gem-claim';
import { Brand, GameHeader, PageHeader } from './app-shell';
import type { Account } from '@card-engine/db';
import type { ClientRealmView as RealmView } from '../lib/client-view';
import type { OpeningResult, RecyclingResult } from '@card-engine/core';
import { packPresentation } from '@card-engine/core';
import { recycleNeedsConfirmation, tiers } from '@card-engine/config';
import {
  OpeningPreparation,
  PackReveal,
  usePackRevealPreference,
  type SuccessfulOpening,
} from './pack-reveal';
import { prepareOpeningArtwork, type AssetProgress } from './opening-assets';
import { AccountSettings } from './account-settings';
import { Trades } from './trades';
import { PackArtwork, GameIcon } from './game-art';
import { Market } from './market';
import { RankTracks } from './rank-track-view';
import { WishlistLibrary } from './wishlist-library';
import { DiscoveryHero, PackCatalog, PackDetail } from './pack-discovery';
import { PullTracker } from './pull-tracker';
import { unlockRevealAudio } from './reveal-audio';
import { InspectableCard } from './card-browser';

import { ApiError, post } from './api-client';
import { siteName } from '../lib/brand';
import { AdminHub } from './admin-hub';
import { SeriesProgressList } from './series-progress';
import { ProfileScreen, type ProfileView } from './profile';
export function SignIn({
  discordEnabled,
  bootstrapNeeded,
  initialError,
}: {
  discordEnabled: boolean;
  bootstrapNeeded: boolean;
  initialError: string;
}) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function discordSignIn() {
    setBusy(true);
    setError('');
    try {
      const result = await post('auth/discord/start', {});
      window.location.assign(result.url);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await post('login', { email: form.get('email'), password: form.get('password') });
      window.location.assign('/');
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <header className="site-header auth-header">
        <div className="topbar">
          <Brand />
          <span className="badge">Invite-only realms</span>
        </div>
      </header>
      <main id="main" className="login-shell">
        <section className="intro">
          <h1>
            Open packs. Collect your <em>favorite characters</em>.
          </h1>
          <p className="intro-copy">
            Build a collection with your community, trade the cards you love and chase the rare ones
            — on the web or right inside Discord.
          </p>
          <div className="login-card-fan" aria-hidden="true">
            <PackArtwork index={0} name="All Characters" />
            <PackArtwork index={1} name="Shōnen" motif="shonen" />
            <PackArtwork index={2} name="Seinen" motif="seinen" />
          </div>
          <ul className="intro-points">
            <li>
              <GameIcon name="packs" /> Packs with real odds
            </li>
            <li>
              <GameIcon name="trades" /> Trading &amp; market
            </li>
            <li>
              <GameIcon name="shield" /> Your server, your data
            </li>
          </ul>
        </section>
        <section className="panel login-panel">
          <h2>Sign in to {siteName}</h2>
          <p className="quiet">Sign in to your private collection.</p>
          {bootstrapNeeded && (
            <div className="setup-note" role="status">
              <strong>First-time setup is needed</strong>
              <p>
                No administrator account exists yet. Run{' '}
                <code>docker compose exec web pnpm bootstrap</code> and choose your website email
                and password.
                {discordEnabled && ' Or continue below with your configured Discord admin account.'}
              </p>
            </div>
          )}
          {discordEnabled && (
            <>
              <button
                className="wide discord-button"
                onClick={discordSignIn}
                disabled={busy || !ready}
              >
                Continue with Discord
              </button>
              <p className="login-divider">
                <span>or use your local account</span>
              </p>
            </>
          )}
          <form method="post" onSubmit={submit}>
            <fieldset className="create-fields" disabled={!ready}>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                maxLength={254}
                required
              />
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={256}
                aria-describedby="password-help"
                required
              />
              <p id="password-help" className="field-help">
                Your website password (12–256 characters) — not the database password from .env.
              </p>
              <button className="wide" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in →'}
              </button>
              <p className="error" role="alert">
                {error}
              </p>
            </fieldset>
          </form>
          <p className="form-note">
            {discordEnabled
              ? 'Signing in with Discord shows your Discord name to members of your realms. '
              : ''}
            No account yet? Ask your realm administrator for an invitation.
          </p>
        </section>
      </main>
      <footer className="site-footer">
        <span>
          <strong>{siteName}</strong> · an open-source card engine
        </span>
        <span>Free to play · Self-hosted · Export your progress anytime</span>
      </footer>
    </>
  );
}

const collectionSorts = ['newest', 'rarity', 'value', 'name'] as const;
type CollectionSort = (typeof collectionSorts)[number];
const isCollectionSort = (value: string): value is CollectionSort =>
  (collectionSorts as readonly string[]).includes(value);
const collectionSortKey = 'bakufu-collection-sort';
/** Cards per bulk request (the server's recycleBatchLimit). */
const bulkBatchSize = 50;
type BulkRecycling = {
  chunks: { cardIds: string[]; key: string }[];
  /** Index of the next batch to send. */
  next: number;
  revision: number;
  total: number;
  recycled: number;
  credited: number;
};

export function Dashboard({
  account,
  realms,
  view,
  discordEnabled,
  screen = 'packs',
  initialTask,
  initialPack,
  profilePlayer,
  profileView = 'profile',
  tradePartner,
}: {
  account: Account;
  realms: { id: string; name: string }[];
  view: RealmView | null;
  discordEnabled: boolean;
  screen?: GameScreen;
  initialTask?: string;
  initialPack?: string;
  profilePlayer?: string;
  profileView?: ProfileView;
  tradePartner?: string;
}) {
  const router = useRouter();
  // Realm-provided arrival sounds; the timestamp versions the cached audio.
  const customSounds = useMemo(() => {
    if (!view) return { tiers: {}, characters: {} };
    const realm = encodeURIComponent(view.id);
    return {
      tiers: Object.fromEntries(
        Object.entries(view.tierSounds ?? {}).map(([tier, sound]) => [
          tier,
          `/api/tier-sound?realmId=${realm}&tier=${tier}&v=${encodeURIComponent(sound!.updatedAt)}`,
        ]),
      ),
      characters: Object.fromEntries(
        Object.entries(view.characterSounds ?? {}).map(([id, sound]) => [
          id,
          `/api/character-sound?realmId=${realm}&characterId=${id}&v=${encodeURIComponent(sound.updatedAt)}`,
        ]),
      ),
    };
  }, [view]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OpeningResult | null>(null);
  const reveals = usePackRevealPreference();
  const openingOperation = useRef<{
    packId: string;
    hidden: boolean;
    responseKnown: boolean;
  } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      openingOperation.current = null;
    };
  }, []);
  const [preparation, setPreparation] = useState<{
    packName: string;
    packCount: 1 | 5 | 10;
    phase: 'request' | 'artwork';
    progress?: AssetProgress;
  } | null>(null);
  function dismissPreparation() {
    const operation = openingOperation.current;
    if (!operation) return;
    operation.hidden = true;
    setPreparation(null);
    // Once the response is known, closing presentation can immediately return
    // to play. Image preparation may finish quietly, without reopening a modal.
    if (operation.responseKnown) {
      openingOperation.current = null;
      setBusy(null);
    }
    requestAnimationFrame(() => {
      const target = document.getElementById(`pack-open-${operation.packId}`);
      if (target && !target.matches(':disabled')) target.focus({ preventScroll: true });
      else document.getElementById('packs-title')?.focus({ preventScroll: true });
    });
  }
  const [reveal, setReveal] = useState<{
    receipt: SuccessfulOpening;
    packId: string;
    packName: string;
  } | null>(null);
  function dismissReveal() {
    const packId = reveal?.packId;
    setReveal(null);
    requestAnimationFrame(() => {
      const target = document.getElementById(`pack-open-${packId}`);
      if (target && !target.matches(':disabled')) target.focus({ preventScroll: true });
      else document.getElementById('packs-title')?.focus({ preventScroll: true });
    });
  }
  const [packCount, setPackCount] = useState<1 | 5 | 10>(1);
  const [pending, setPending] = useState<{
    packId: string;
    key: string;
    revision: number;
    packCount: 1 | 5 | 10;
  } | null>(null);
  const [pendingRecycle, setPendingRecycle] = useState<{
    cardId: string;
    key: string;
    revision: number;
    confirmed: boolean;
  } | null>(null);
  const [recyclingReceipt, setRecyclingReceipt] = useState<RecyclingResult | null>(null);
  // An epic or legendary card waiting for its second click (recycling safeguard).
  const [confirmRecycle, setConfirmRecycle] = useState<string | null>(null);
  // Recycling several collection cards at once.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [pendingBulk, setPendingBulk] = useState<BulkRecycling | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkReceipt, setBulkReceipt] = useState<{ count: number; credited: number } | null>(null);
  const [pendingWish, setPendingWish] = useState<{
    characterIds: string[];
    present: boolean;
    key: string;
    revision: number;
  } | null>(null);
  const [wishMessage, setWishMessage] = useState('');
  const [marketBusy, setMarketBusy] = useState(false);
  const [rankBusy, setRankBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [gemClaimPending, setGemClaimPending] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [collectionTier, setCollectionTier] = useState('all');
  const [collectionSort, setCollectionSort] = useState<CollectionSort>('newest');
  // The chosen sort is remembered in this browser and becomes the default.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(collectionSortKey);
      if (saved && isCollectionSort(saved)) setCollectionSort(saved);
    } catch {
      // Storage can be unavailable in private browsing; keep the default.
    }
  }, []);
  function changeCollectionSort(value: string) {
    if (!isCollectionSort(value)) return;
    setCollectionSort(value);
    try {
      localStorage.setItem(collectionSortKey, value);
    } catch {
      // The sort still applies for this visit.
    }
  }
  const [collectionView, setCollectionView] = useState<'cards' | 'series'>('cards');
  const [packSearch, setPackSearch] = useState('');
  const [adminMode, setAdminMode] = useState(true);
  const canAdmin = account.instanceAdmin || view?.role === 'admin';
  useEffect(() => {
    try {
      setAdminMode(localStorage.getItem('lantern-admin-view') !== 'false');
    } catch {
      // Storage can be unavailable in private browsing; use this session's view.
    }
  }, []);
  function changeAdminMode(enabled: boolean) {
    setAdminMode(enabled);
    try {
      localStorage.setItem('lantern-admin-view', String(enabled));
    } catch {
      // The switch still works when the browser cannot persist its preference.
    }
    if (!enabled && screen === 'admin') router.push(screenHref('packs', view?.id));
  }
  const adminVisible = canAdmin && adminMode;

  const [settingsBusy, setSettingsBusy] = useState(false);
  const [tradeBusy, setTradeBusy] = useState(false);
  async function open(packId: string) {
    if (
      !view ||
      !reveals.ready ||
      openingOperation.current ||
      !!reveal ||
      busy ||
      pendingRecycle ||
      pendingBulk ||
      pendingWish ||
      gemClaimPending ||
      marketBusy ||
      rankBusy ||
      settingsBusy ||
      tradeBusy
    )
      return;
    unlockRevealAudio();
    setError('');
    setBusy(packId);
    // Retain this key after network/server errors; a retry cannot spend twice.
    const attempt = pending ?? {
      packId,
      key: crypto.randomUUID(),
      revision: view.configRevision,
      packCount,
    };
    setPending(attempt);
    const operation = { packId: attempt.packId, hidden: !reveals.enabled, responseKnown: false };
    openingOperation.current = operation;
    const packName = view.packs.find((pack) => pack.id === attempt.packId)?.name ?? 'Pack';
    if (reveals.enabled)
      setPreparation({ packName, packCount: attempt.packCount, phase: 'request' });
    try {
      const result = (await post('open', {
        realmId: view.id,
        packId: attempt.packId,
        requestKey: attempt.key,
        expectedRevision: attempt.revision,
        packCount: attempt.packCount,
      })) as OpeningResult;
      if (!mounted.current || openingOperation.current !== operation) return;
      operation.responseKnown = true;
      setReceipt(result);
      setRecyclingReceipt(null);
      setPending(null);
      router.refresh();
      if (result.ok && result.characters.length && !operation.hidden) {
        setPreparation({ packName, packCount: attempt.packCount, phase: 'artwork' });
        await prepareOpeningArtwork(result.characters, (progress) => {
          if (mounted.current && openingOperation.current === operation && !operation.hidden)
            setPreparation({ packName, packCount: attempt.packCount, phase: 'artwork', progress });
        });
        if (mounted.current && openingOperation.current === operation && !operation.hidden) {
          setPreparation(null);
          setReveal({ receipt: result, packId: attempt.packId, packName });
        }
      }
    } catch (error) {
      if (!mounted.current || openingOperation.current !== operation) return;
      setError((error as Error).message);
      if (error instanceof ApiError && error.status < 500) {
        setPending(null);
        router.refresh();
      }
    } finally {
      if (openingOperation.current === operation) {
        openingOperation.current = null;
        if (mounted.current) {
          setPreparation(null);
          setBusy(null);
        }
      }
    }
  }
  async function recycle(cardId: string, confirmed = false) {
    if (!view || busy || pending || pendingBulk || pendingWish || settingsBusy || tradeBusy) return;
    const attempt = pendingRecycle ?? {
      cardId,
      key: crypto.randomUUID(),
      revision: view.configRevision,
      confirmed,
    };
    if (attempt.cardId !== cardId) return;
    setConfirmRecycle(null);
    setBusy(`recycle:${cardId}`);
    setError('');
    setPendingRecycle(attempt);
    try {
      const result = (await post('recycle', {
        realmId: view.id,
        cardId,
        requestKey: attempt.key,
        expectedRevision: attempt.revision,
        ...(attempt.confirmed ? { confirmed: true } : {}),
      })) as RecyclingResult;
      setRecyclingReceipt(result);
      setBulkReceipt(null);
      setPendingRecycle(null);
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
      // A network/server error can have an unknown outcome: keep the same key for retry.
      if (error instanceof ApiError && error.status < 500) {
        setPendingRecycle(null);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }
  // Recycling from the opening results. A request whose outcome is unknown
  // (network/server error) keeps its key, so retrying never pays twice.
  const revealRecycleKeys = useRef(new Map<string, string>());
  async function recycleFromReveal(
    cardIds: string[],
    confirmed = false,
  ): Promise<Record<string, number>> {
    if (!view) throw new Error('This realm is not available.');
    const id = cardIds.join(',');
    const requestKey = revealRecycleKeys.current.get(id) ?? crypto.randomUUID();
    revealRecycleKeys.current.set(id, requestKey);
    try {
      const results: RecyclingResult[] =
        cardIds.length === 1
          ? [
              (await post('recycle', {
                realmId: view.id,
                cardId: cardIds[0],
                requestKey,
                expectedRevision: view.configRevision,
                ...(confirmed ? { confirmed: true } : {}),
              })) as RecyclingResult,
            ]
          : (
              (await post('recycle/batch', {
                realmId: view.id,
                cardIds,
                requestKey,
                expectedRevision: view.configRevision,
              })) as { recycled: RecyclingResult[] }
            ).recycled;
      revealRecycleKeys.current.delete(id);
      router.refresh();
      return Object.fromEntries(results.map((result) => [result.cardId, result.credited]));
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) revealRecycleKeys.current.delete(id);
      throw error;
    }
  }
  // Recycles the selected cards in batches of up to 50, each all-or-nothing
  // with its own request key. A batch whose outcome is unknown (network or
  // server error) keeps its key, so Retry continues without paying twice.
  async function recycleSelected() {
    if (
      !view ||
      busy ||
      pending ||
      pendingRecycle ||
      pendingWish ||
      settingsBusy ||
      tradeBusy ||
      marketBusy ||
      rankBusy
    )
      return;
    let state: BulkRecycling = pendingBulk ?? {
      chunks: Array.from({ length: Math.ceil(selectedCards.length / bulkBatchSize) }, (_, i) => ({
        cardIds: selectedCards
          .slice(i * bulkBatchSize, (i + 1) * bulkBatchSize)
          .map((card) => card.cardId),
        key: crypto.randomUUID(),
      })),
      next: 0,
      revision: view.configRevision,
      total: selectedCards.length,
      recycled: 0,
      credited: 0,
    };
    if (!state.total) return;
    setPendingBulk(state);
    setBulkConfirm(false);
    setBusy('bulk-recycle');
    setError('');
    try {
      while (state.next < state.chunks.length) {
        setBulkProgress({ done: state.recycled, total: state.total });
        const chunk = state.chunks[state.next];
        const result = (await post('recycle/batch', {
          realmId: view.id,
          cardIds: chunk.cardIds,
          requestKey: chunk.key,
          expectedRevision: state.revision,
        })) as { recycled: RecyclingResult[]; credited: number };
        state = {
          ...state,
          next: state.next + 1,
          recycled: state.recycled + result.recycled.length,
          credited: state.credited + result.credited,
        };
        setPendingBulk(state);
      }
      setPendingBulk(null);
      setSelected([]);
      setRecyclingReceipt(null);
      setBulkReceipt({ count: state.recycled, credited: state.credited });
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        setPendingBulk(null);
        setError(
          state.recycled
            ? `Recycled ${state.recycled} of ${state.total} cards (+${state.credited.toLocaleString()} gems); the rest stay in your collection. ${(error as Error).message}`
            : (error as Error).message,
        );
        if (state.recycled) {
          setRecyclingReceipt(null);
          setBulkReceipt({ count: state.recycled, credited: state.credited });
        }
        router.refresh();
      } else
        setError(
          `${(error as Error).message} Choose Retry recycling to continue; no card is recycled twice.`,
        );
    } finally {
      setBusy(null);
      setBulkProgress(null);
    }
  }
  // One character changes through /api/wishlist; several picked together are
  // added in one all-or-nothing request. A retry reuses the same key.
  async function changeWish(characterIds: string[], present: boolean) {
    if (!view || busy || pending || pendingRecycle || pendingBulk || settingsBusy || tradeBusy)
      return;
    const attempt = pendingWish ?? {
      characterIds,
      present,
      key: crypto.randomUUID(),
      revision: view.configRevision,
    };
    setPendingWish(attempt);
    setBusy('wishlist');
    setError('');
    setWishMessage('');
    try {
      if (attempt.characterIds.length === 1)
        await post('wishlist', {
          realmId: view.id,
          characterId: attempt.characterIds[0],
          present: attempt.present,
          requestKey: attempt.key,
          expectedRevision: attempt.revision,
        });
      else
        await post('wishlist/batch', {
          realmId: view.id,
          characterIds: attempt.characterIds,
          requestKey: attempt.key,
          expectedRevision: attempt.revision,
        });
      setPendingWish(null);
      setWishMessage(
        attempt.characterIds.length > 1
          ? `${attempt.characterIds.length} characters added to your wishlist.`
          : 'Wishlist change saved.',
      );
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
      if (error instanceof ApiError && error.status < 500) {
        setPendingWish(null);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }
  async function signOut() {
    if (gamePending || busy) return;
    try {
      await post('logout', {});
      window.location.assign('/');
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const collection = view?.cards ?? [];
  const filteredCollection = collection
    .filter(
      (card) =>
        (collectionTier === 'all' || card.tier === collectionTier) &&
        `${card.name} ${card.series} ${card.categories.join(' ')}`
          .toLowerCase()
          .includes(collectionSearch.trim().toLowerCase()),
    )
    .sort((a, b) =>
      collectionSort === 'name'
        ? a.name.localeCompare(b.name)
        : collectionSort === 'rarity'
          ? tiers.indexOf(b.tier) - tiers.indexOf(a.tier) || a.name.localeCompare(b.name)
          : collectionSort === 'value'
            ? (view?.characterValues[b.id]?.marketValue ?? 0) -
                (view?.characterValues[a.id]?.marketValue ?? 0) || a.name.localeCompare(b.name)
            : b.acquiredAt.localeCompare(a.acquiredAt),
    );
  // Cards that can join a bulk recycling: not reserved, not listed, not
  // protected by the safeguard and not just recycled.
  const bulkEligible = (card: (typeof collection)[number]) =>
    !card.lockedForTrade &&
    !card.listedForSale &&
    recyclingReceipt?.cardId !== card.cardId &&
    !(view && recycleNeedsConfirmation(view.config, card.tier));
  const selectedIds = new Set(selected);
  const selectedCards = collection.filter(
    (card) => selectedIds.has(card.cardId) && bulkEligible(card),
  );
  const selectedGems = selectedCards.reduce(
    (sum, card) => sum + (view?.characterValues[card.id]?.recycleValue ?? 0),
    0,
  );
  const shownSelectable = filteredCollection.filter(bulkEligible);
  const shownGuarded = filteredCollection.filter(
    (card) => !!view && recycleNeedsConfirmation(view.config, card.tier),
  ).length;
  const tierCounts = Object.fromEntries(
    tiers.map((tier) => [tier, collection.filter((card) => card.tier === tier).length]),
  ) as Record<(typeof tiers)[number], number>;
  const collectionValue = collection.reduce(
    (sum, card) => sum + (view?.characterValues[card.id]?.marketValue ?? 0),
    0,
  );
  const catalogSize = view?.catalogSize ?? 0;
  const otherGamePending =
    marketBusy ||
    rankBusy ||
    !!pending ||
    !!pendingRecycle ||
    !!pendingBulk ||
    !!pendingWish ||
    !!preparation ||
    !!reveal ||
    settingsBusy ||
    tradeBusy;
  const gamePending = accountBusy || gemClaimPending || otherGamePending;
  const locked = gamePending || !!busy;
  const requestedPack = pending?.packId ?? initialPack;
  const selectedPack = view?.packs.find((pack) => pack.id === requestedPack);
  const selectedPackAppearance =
    selectedPack && view
      ? { index: view.packs.indexOf(selectedPack), motif: packPresentation(selectedPack).motif }
      : undefined;
  const openingStudio = screen === 'packs' && !!selectedPack;
  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' }),
    );
    return () => {
      cancelAnimationFrame(frame);
      window.history.scrollRestoration = previous;
    };
  }, [screen, initialPack, view?.id]);
  return (
    <>
      {!openingStudio && (
        <GameHeader
          account={account}
          view={view}
          screen={screen}
          canAdmin={canAdmin}
          adminMode={adminMode}
          onAdminMode={changeAdminMode}
          locked={locked}
          onSignOut={() => void signOut()}
        />
      )}
      <main
        id="main"
        className={`shell game-shell routed-screen screen-${screen}${openingStudio ? ' opening-studio' : ''}`}
      >
        {!openingStudio && !adminMode && canAdmin && (
          <p className="player-preview-note" role="status">
            Player preview: your own collection and balance
          </p>
        )}
        {screen === 'account' && (
          <>
            <PageHeader
              title="Account"
              lede={
                account.email ??
                (view?.discordProfile
                  ? `Signed in with Discord as @${view.discordProfile.username}`
                  : 'Signed in')
              }
            />
            <div className="account-layout">
              <section className="realm-preferences panel" aria-label="Realm settings">
                <h2>Your realm</h2>
                <p className="quiet">
                  Each realm keeps its own collection, gems and rules. Switch any time.
                </p>
                <label htmlFor="realm">Choose realm</label>
                <select
                  id="realm"
                  value={view?.id ?? ''}
                  onChange={(event) =>
                    window.location.assign(screenHref('account', event.target.value))
                  }
                  disabled={!realms.length || locked}
                >
                  {!realms.length && <option value="">No realms yet</option>}
                  {realms.map((realm) => (
                    <option key={realm.id} value={realm.id}>
                      {realm.name}
                    </option>
                  ))}
                </select>
                <details className="inline-details">
                  <summary>Ownership rules</summary>
                  <p>
                    Classic unique ownership: each character has one active owner in this realm.
                    Recycling releases it. Other realms have their own collections.
                  </p>
                </details>
              </section>
              <AccountSettings
                key={account.id}
                account={account}
                onLockChange={setAccountBusy}
                onClose={() => router.push(screenHref('packs', view?.id))}
              />
            </div>
          </>
        )}
        {screen === 'admin' && adminVisible && (
          <AdminHub
            key={view?.id ?? 'no-realm'}
            account={account}
            view={view}
            discordEnabled={discordEnabled}
            initialTask={initialTask}
            locked={locked}
            onLockChange={setSettingsBusy}
          />
        )}
        <p className="error" role="alert">
          {error}
        </p>
        {screen === 'account' || (screen === 'admin' && adminVisible) ? null : !view ? (
          <section className="empty panel empty-hero">
            <span className="empty-icon" aria-hidden="true">
              <GameIcon name="spark" />
            </span>
            <h1>A world waiting to be opened.</h1>
            <p>
              {account.instanceAdmin
                ? 'Open Administration to create your first realm and start collecting.'
                : 'Your account is ready. Ask your administrator to add you to a realm.'}
            </p>
            {canAdmin && (
              <Link scroll={false} className="button" href="/admin?task=create">
                Create your first realm
              </Link>
            )}
          </section>
        ) : (
          <>
            {screen === 'packs' && !requestedPack && <DiscoveryHero view={view} />}
            {(screen === 'collection' || (screen === 'packs' && !openingStudio)) &&
              (recyclingReceipt || bulkReceipt) && (
                <section className="discovery receipt-banner" aria-live="polite">
                  <span className="receipt-icon" aria-hidden="true">
                    <GameIcon name="recycle" />
                  </span>
                  <div>
                    <h2>
                      {bulkReceipt
                        ? `${bulkReceipt.count.toLocaleString()} ${bulkReceipt.count === 1 ? 'card' : 'cards'} recycled`
                        : `${recyclingReceipt!.name} recycled`}
                    </h2>
                    <p>
                      +{(bulkReceipt ?? recyclingReceipt)!.credited.toLocaleString()} gems · back in
                      this realm’s pack pool.
                    </p>
                  </div>
                </section>
              )}
            {screen === 'packs' &&
              (requestedPack ? (
                selectedPack ? (
                  preparation ? (
                    <OpeningPreparation
                      appearance={selectedPackAppearance}
                      packName={preparation.packName}
                      packCount={preparation.packCount}
                      phase={preparation.phase}
                      progress={preparation.progress}
                      onDismiss={dismissPreparation}
                    />
                  ) : reveal ? (
                    <PackReveal
                      appearance={selectedPackAppearance}
                      key={reveal.receipt.openingId}
                      receipt={reveal.receipt}
                      customSounds={customSounds}
                      characterValues={view.characterValues}
                      packName={reveal.packName}
                      onDismiss={dismissReveal}
                      onRecycle={recycleFromReveal}
                      safeguard={view.config.recycleSafeguard}
                      onBrowseCollection={() => {
                        dismissReveal();
                        router.push(screenHref('collection', view.id));
                      }}
                    />
                  ) : (
                    <PackDetail
                      pack={selectedPack}
                      view={view}
                      quantity={pending?.packCount ?? packCount}
                      onQuantity={setPackCount}
                      onOpen={() => open(selectedPack.id)}
                      opening={busy === selectedPack.id}
                      locked={
                        !!busy ||
                        !!reveal ||
                        !!pendingRecycle ||
                        !!pendingBulk ||
                        !!pendingWish ||
                        settingsBusy ||
                        rankBusy ||
                        marketBusy ||
                        tradeBusy ||
                        gemClaimPending ||
                        !!preparation
                      }
                      pending={pending?.packId === selectedPack.id}
                      quantityLocked={locked}
                      reveals={reveals.enabled}
                      onReveals={reveals.change}
                      ready={reveals.ready}
                      navigationLocked={locked}
                      notice={
                        receipt && (
                          <section
                            id="discovery"
                            className={`discovery receipt-banner studio-receipt ${receipt.ok ? '' : 'notice'}`}
                            aria-live="polite"
                          >
                            <span className="receipt-icon" aria-hidden="true">
                              <GameIcon name={receipt.ok ? 'spark' : 'info'} />
                            </span>
                            <div>
                              <h2>
                                {receipt.ok
                                  ? receipt.characters.length > 3
                                    ? `${receipt.characters.length} cards added to your collection`
                                    : `Latest pull: ${receipt.characters.map((c) => c.name).join(', ')}`
                                  : receipt.message}
                              </h2>
                              {receipt.ok && (
                                <p>
                                  {receipt.charged.toLocaleString()} gems spent
                                  {receipt.progression && ` · +${receipt.progression.xpAwarded} XP`}
                                  {!!receipt.progression?.levelsGained &&
                                    ` · Level ${receipt.progression.level}!`}
                                </p>
                              )}
                            </div>
                          </section>
                        )
                      }
                    />
                  )
                ) : (
                  <section className="pack-not-found empty panel" aria-label="Pack unavailable">
                    <h1 id="packs-title" tabIndex={-1}>
                      This pack is unavailable.
                    </h1>
                    <p className="quiet">It may have been removed or renamed by an admin.</p>
                    <Link scroll={false} className="button" href={screenHref('packs', view.id)}>
                      Explore the packs
                    </Link>
                  </section>
                )
              ) : (
                <>
                  <PackCatalog
                    view={view}
                    disabled={locked}
                    search={packSearch}
                    onSearch={setPackSearch}
                  />
                  <PullTracker
                    realmId={view.id}
                    refreshKey={view.lastOpening?.ok ? view.lastOpening.openingId : undefined}
                  />
                </>
              ))}
            {screen === 'ranks' && (
              <>
                <PageHeader
                  title="Collector ranks"
                  lede="Level up by discovering new characters, claim free gems and unlock lasting perks."
                />
                <div className="ranks-overview">
                  <section className="progression-panel panel" aria-label="Your progression">
                    <div className="progression-heading">
                      <span className="level-badge" aria-hidden="true">
                        {view.progression.level}
                      </span>
                      <div>
                        <h2>Level {view.progression.level}</h2>
                        <p>{view.progression.totalXp.toLocaleString()} XP total</p>
                      </div>
                    </div>
                    <progress
                      aria-label="Level progress"
                      value={
                        view.progression.nextLevelAt === null ? 1 : view.progression.xpIntoLevel
                      }
                      max={
                        view.progression.nextLevelAt === null
                          ? 1
                          : view.progression.nextLevelAt - view.progression.levelStartsAt
                      }
                      aria-valuetext={
                        view.progression.nextLevelAt === null
                          ? `Level ${view.progression.level}, highest configured level, ${view.progression.totalXp} XP`
                          : `${view.progression.totalXp} XP, ${view.progression.xpToNextLevel} XP to level ${view.progression.level + 1}`
                      }
                    />
                    <p className="progression-target">
                      {view.progression.nextLevelAt === null
                        ? `Highest configured level reached.${view.config.progression.xpPerNewCharacter > 0 ? ' New discoveries still earn XP.' : ''}`
                        : `${view.progression.xpToNextLevel} XP to level ${view.progression.level + 1} (${view.progression.nextLevelAt} total).`}
                    </p>
                    <p className="progression-rules">
                      {view.config.progression.xpPerNewCharacter === 0
                        ? 'XP awards are turned off in this realm.'
                        : `+${view.config.progression.xpPerNewCharacter} XP the first time you collect each character in this realm.`}{' '}
                      Recycling and repeat claims give no XP.
                    </p>
                  </section>
                  <GemClaim
                    realmId={view.id}
                    reward={view.gemReward}
                    revision={view.configRevision}
                    disabled={otherGamePending || !!busy}
                    onPendingChange={setGemClaimPending}
                    adminHref={
                      adminVisible && view.role === 'admin'
                        ? screenHref('admin', view.id)
                        : undefined
                    }
                  />
                </div>
                <RankTracks
                  view={view.rankTracks}
                  realmId={view.id}
                  revision={view.configRevision}
                  disabled={
                    !!busy ||
                    !!pending ||
                    !!pendingRecycle ||
                    !!pendingBulk ||
                    !!pendingWish ||
                    settingsBusy ||
                    tradeBusy ||
                    marketBusy ||
                    gemClaimPending
                  }
                  onLockChange={setRankBusy}
                />
              </>
            )}
            {screen === 'collection' && (
              <section id="collection" className="section collection-screen">
                <PageHeader
                  title="Collection"
                  lede={
                    collection.length ? (
                      <>
                        {collection.length.toLocaleString()}{' '}
                        {collection.length === 1 ? 'card' : 'cards'}
                        {catalogSize > 0 &&
                          ` · ${Math.max(1, Math.round((collection.length / catalogSize) * 100))}% of ${catalogSize.toLocaleString()} characters`}
                        {' · '}
                        <span className="gem-text">
                          <GameIcon name="gem" />
                          {collectionValue.toLocaleString()}
                        </span>{' '}
                        total value
                      </>
                    ) : (
                      'Every character you pull lands here.'
                    )
                  }
                  actions={
                    <a className="button secondary" href={`/api/export?realmId=${view.id}`}>
                      <GameIcon name="download" />
                      Export collection
                    </a>
                  }
                />
                {collection.length > 0 && (
                  <div
                    className="segmented collection-view-toggle"
                    role="group"
                    aria-label="Show collection as"
                  >
                    <button
                      type="button"
                      aria-pressed={collectionView === 'cards'}
                      onClick={() => setCollectionView('cards')}
                    >
                      Cards
                    </button>
                    <button
                      type="button"
                      aria-pressed={collectionView === 'series'}
                      onClick={() => setCollectionView('series')}
                    >
                      Series ({view.seriesProgress.length.toLocaleString()})
                    </button>
                  </div>
                )}
                {collectionView === 'series' && collection.length > 0 ? (
                  <SeriesProgressList
                    progress={view.seriesProgress}
                    seriesCount={view.seriesCount}
                    onOpen={(series) => {
                      setCollectionSearch(series);
                      setCollectionTier('all');
                      setCollectionView('cards');
                    }}
                  />
                ) : (
                  <>
                    {collection.length > 0 && (
                      <>
                        <div className="rarity-filter" role="group" aria-label="Filter by rarity">
                          <button
                            type="button"
                            className="rarity-chip all"
                            aria-pressed={collectionTier === 'all'}
                            onClick={() => setCollectionTier('all')}
                          >
                            All <span>{collection.length}</span>
                          </button>
                          {tiers.map((tier) => (
                            <button
                              type="button"
                              key={tier}
                              className={`rarity-chip ${tier}`}
                              aria-pressed={collectionTier === tier}
                              disabled={!tierCounts[tier] && collectionTier !== tier}
                              onClick={() =>
                                setCollectionTier(collectionTier === tier ? 'all' : tier)
                              }
                            >
                              {tier} <span>{tierCounts[tier]}</span>
                            </button>
                          ))}
                        </div>
                        <div className="collection-toolbar">
                          <div className="search-field">
                            <label className="sr-only" htmlFor="collection-search">
                              Search your collection
                            </label>
                            <GameIcon name="search" />
                            <input
                              id="collection-search"
                              type="search"
                              value={collectionSearch}
                              onChange={(event) => setCollectionSearch(event.target.value)}
                              placeholder="Search characters or series"
                            />
                          </div>
                          <div>
                            <label className="sr-only" htmlFor="collection-sort">
                              Sort your collection
                            </label>
                            <select
                              id="collection-sort"
                              value={collectionSort}
                              title="Your choice is remembered in this browser"
                              onChange={(event) => changeCollectionSort(event.target.value)}
                            >
                              <option value="newest">Sort: Newest first</option>
                              <option value="rarity">Sort: Rarest first</option>
                              <option value="value">Sort: Highest value</option>
                              <option value="name">Sort: Name A–Z</option>
                            </select>
                          </div>
                          <button
                            type="button"
                            className="secondary collection-select-toggle"
                            aria-pressed={selecting}
                            disabled={!!pendingBulk || busy === 'bulk-recycle'}
                            onClick={() => {
                              setSelecting(!selecting);
                              setSelected([]);
                              setBulkConfirm(false);
                              setConfirmRecycle(null);
                            }}
                          >
                            <GameIcon name={selecting ? 'check' : 'recycle'} />
                            {selecting ? 'Done' : 'Recycle several'}
                          </button>
                        </div>
                        {selecting && (
                          <div
                            className="bulk-recycle-bar panel"
                            role="region"
                            aria-label="Recycle several cards"
                          >
                            <p className="bulk-recycle-status" role="status">
                              {bulkProgress ? (
                                `Recycling… ${bulkProgress.done.toLocaleString()} of ${bulkProgress.total.toLocaleString()} cards`
                              ) : bulkConfirm ? (
                                <>
                                  Recycle {selectedCards.length.toLocaleString()}{' '}
                                  {selectedCards.length === 1 ? 'card' : 'cards'} for{' '}
                                  <span className="gem-text">
                                    <GameIcon name="gem" />+{selectedGems.toLocaleString()}
                                  </span>
                                  ? The characters go back into the packs for anyone to pull.
                                </>
                              ) : pendingBulk ? (
                                `${pendingBulk.recycled.toLocaleString()} of ${pendingBulk.total.toLocaleString()} cards recycled so far.`
                              ) : selectedCards.length ? (
                                <>
                                  {selectedCards.length.toLocaleString()} selected ·{' '}
                                  <span className="gem-text">
                                    <GameIcon name="gem" />+{selectedGems.toLocaleString()}
                                  </span>
                                </>
                              ) : (
                                'Pick cards below, or filter by rarity or series and select every card shown.'
                              )}
                            </p>
                            <div className="bulk-recycle-actions">
                              {pendingBulk ? (
                                <button
                                  type="button"
                                  disabled={!!busy}
                                  onClick={() => void recycleSelected()}
                                >
                                  {busy === 'bulk-recycle' ? 'Recycling…' : 'Retry recycling'}
                                </button>
                              ) : bulkConfirm ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={!!busy || !selectedCards.length}
                                    onClick={() => void recycleSelected()}
                                  >
                                    <GameIcon name="recycle" />
                                    Recycle {selectedCards.length.toLocaleString()}
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={!!busy}
                                    onClick={() => setBulkConfirm(false)}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={
                                      !!busy ||
                                      shownSelectable.every((card) => selectedIds.has(card.cardId))
                                    }
                                    onClick={() =>
                                      setSelected([
                                        ...new Set([
                                          ...selected,
                                          ...shownSelectable.map((card) => card.cardId),
                                        ]),
                                      ])
                                    }
                                  >
                                    Select all shown ({shownSelectable.length.toLocaleString()})
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={!!busy || !selectedCards.length}
                                    onClick={() => setSelected([])}
                                  >
                                    Clear
                                  </button>
                                  <button
                                    type="button"
                                    disabled={locked || !selectedCards.length}
                                    onClick={() => setBulkConfirm(true)}
                                  >
                                    <GameIcon name="recycle" />
                                    Recycle selected
                                  </button>
                                </>
                              )}
                            </div>
                            {shownGuarded > 0 && (
                              <p className="field-help">
                                <GameIcon name="shield" /> Epic and legendary cards are protected in
                                this realm: recycle them one at a time.
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {collection.length ? (
                      <>
                        <div className="collection-grid">
                          {filteredCollection.map((card) => {
                            const valuation = view.characterValues[card.id];
                            const reward = valuation.recycleValue;
                            const recovering = pendingRecycle?.cardId === card.cardId;
                            const guarded = recycleNeedsConfirmation(view.config, card.tier);
                            const chosen = selecting && selectedIds.has(card.cardId);
                            const actionsLocked =
                              !!busy ||
                              !!pending ||
                              !!pendingBulk ||
                              !!pendingWish ||
                              settingsBusy ||
                              rankBusy ||
                              marketBusy ||
                              tradeBusy;
                            return (
                              <article
                                className={`character collection-card ${card.tier}${chosen ? ' selected' : ''}`}
                                key={card.cardId}
                              >
                                <InspectableCard
                                  card={{ ...card, valuation }}
                                  value={valuation.marketValue}
                                />
                                {selecting ? (
                                  <button
                                    type="button"
                                    className="secondary wide recycle-button select-toggle"
                                    aria-pressed={chosen}
                                    aria-label={
                                      card.listedForSale
                                        ? `${card.name} listed on market`
                                        : card.lockedForTrade
                                          ? `${card.name} reserved in a trade`
                                          : guarded
                                            ? `${card.name} is protected; recycle it on its own`
                                            : `Select ${card.name} (${reward} gems)`
                                    }
                                    disabled={actionsLocked || !bulkEligible(card)}
                                    onClick={() =>
                                      setSelected(
                                        chosen
                                          ? selected.filter((id) => id !== card.cardId)
                                          : [...selected, card.cardId],
                                      )
                                    }
                                  >
                                    {card.listedForSale ? (
                                      <>
                                        <GameIcon name="tag" /> Listed on market
                                      </>
                                    ) : card.lockedForTrade ? (
                                      <>
                                        <GameIcon name="lock" /> In a trade
                                      </>
                                    ) : guarded ? (
                                      <>
                                        <GameIcon name="shield" /> Protected
                                      </>
                                    ) : (
                                      <>
                                        <GameIcon name={chosen ? 'check' : 'plus'} />
                                        {chosen ? 'Selected' : 'Select'}
                                        <span className="recycle-reward">
                                          +{reward.toLocaleString()}
                                        </span>
                                      </>
                                    )}
                                  </button>
                                ) : confirmRecycle === card.cardId ? (
                                  <div
                                    className="recycle-confirm"
                                    role="group"
                                    aria-label={`Confirm recycling ${card.name}`}
                                  >
                                    <button
                                      type="button"
                                      className="wide recycle-button"
                                      title={`Recycle this ${card.tier} card`}
                                      autoFocus
                                      disabled={actionsLocked || !!pendingRecycle}
                                      onClick={() => void recycle(card.cardId, true)}
                                    >
                                      Confirm
                                      <span className="recycle-reward">
                                        +{reward.toLocaleString()}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary icon-button"
                                      aria-label="Cancel"
                                      title="Keep this card"
                                      disabled={!!busy}
                                      onClick={() => setConfirmRecycle(null)}
                                    >
                                      <GameIcon name="close" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    className="secondary wide recycle-button"
                                    aria-label={
                                      recovering
                                        ? 'Retry recycling'
                                        : card.listedForSale
                                          ? `${card.name} listed on market`
                                          : card.lockedForTrade
                                            ? `${card.name} reserved in a trade`
                                            : `Recycle ${card.name} for ${reward} gems`
                                    }
                                    disabled={
                                      !!busy ||
                                      !!pending ||
                                      (!!pendingRecycle && !recovering) ||
                                      !!pendingWish ||
                                      settingsBusy ||
                                      rankBusy ||
                                      marketBusy ||
                                      tradeBusy ||
                                      card.lockedForTrade ||
                                      card.listedForSale ||
                                      recyclingReceipt?.cardId === card.cardId
                                    }
                                    onClick={() =>
                                      guarded && !recovering
                                        ? setConfirmRecycle(card.cardId)
                                        : void recycle(card.cardId)
                                    }
                                  >
                                    {busy === `recycle:${card.cardId}` ? (
                                      'Recycling…'
                                    ) : recovering ? (
                                      'Retry recycling'
                                    ) : card.listedForSale ? (
                                      <>
                                        <GameIcon name="tag" /> Listed on market
                                      </>
                                    ) : card.lockedForTrade ? (
                                      <>
                                        <GameIcon name="lock" /> In a trade
                                      </>
                                    ) : (
                                      <>
                                        <GameIcon name={guarded ? 'shield' : 'recycle'} />
                                        Recycle
                                        <span className="recycle-reward">
                                          +{reward.toLocaleString()}
                                        </span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </article>
                            );
                          })}
                        </div>
                        {filteredCollection.length === 0 && (
                          <div className="empty">
                            <h3>No matching cards.</h3>
                            <p className="quiet">Try a different name, series or rarity.</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="empty panel">
                        <span className="empty-icon" aria-hidden="true">
                          <GameIcon name="collection" />
                        </span>
                        <h3>Your next discovery is waiting.</h3>
                        <p className="quiet">Open a pack to meet your first character.</p>
                        <Link className="button" href={screenHref('packs', view.id)} scroll={false}>
                          Browse packs
                        </Link>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
            {screen === 'wishlist' && (
              <>
                <WishlistLibrary
                  view={view}
                  disabled={locked}
                  onWish={(id, present) => void changeWish([id], present)}
                  onAdd={(ids) => void changeWish(ids, true)}
                />
                {pendingWish && (
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => changeWish(pendingWish.characterIds, pendingWish.present)}
                  >
                    Retry wishlist change
                  </button>
                )}
                <p className="status-line" role="status">
                  {wishMessage}
                </p>
              </>
            )}
            {screen === 'market' && (
              <Market
                key={`market:${view.id}`}
                view={view}
                disabled={
                  !!busy ||
                  !!pending ||
                  !!pendingRecycle ||
                  !!pendingBulk ||
                  !!pendingWish ||
                  settingsBusy ||
                  tradeBusy ||
                  rankBusy
                }
                onLockChange={setMarketBusy}
              />
            )}
            {screen === 'profile' && (
              <ProfileScreen
                view={view}
                player={profilePlayer}
                tab={profileView}
                disabled={locked}
              />
            )}
            {screen === 'trades' && (
              <Trades
                key={view.id}
                view={view}
                initialPartner={tradePartner}
                disabled={
                  !!busy ||
                  !!pending ||
                  !!pendingRecycle ||
                  !!pendingBulk ||
                  !!pendingWish ||
                  settingsBusy ||
                  rankBusy ||
                  marketBusy
                }
                onLockChange={setTradeBusy}
              />
            )}
          </>
        )}
      </main>
      {!openingStudio && (
        <footer className="site-footer">
          <span>
            <strong>{siteName}</strong> · open-source card engine
          </span>
          <span>Your progress is always exportable</span>
        </footer>
      )}
    </>
  );
}
