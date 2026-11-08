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
import { tiers } from '@card-engine/config';
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

export function Dashboard({
  account,
  realms,
  view,
  discordEnabled,
  screen = 'packs',
  initialTask,
  initialPack,
}: {
  account: Account;
  realms: { id: string; name: string }[];
  view: RealmView | null;
  discordEnabled: boolean;
  screen?: GameScreen;
  initialTask?: string;
  initialPack?: string;
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
  } | null>(null);
  const [recyclingReceipt, setRecyclingReceipt] = useState<RecyclingResult | null>(null);
  const [pendingWish, setPendingWish] = useState<{
    characterId: string;
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
  const [collectionSort, setCollectionSort] = useState('newest');
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
  async function recycle(cardId: string) {
    if (!view || busy || pending || pendingWish || settingsBusy || tradeBusy) return;
    const attempt = pendingRecycle ?? {
      cardId,
      key: crypto.randomUUID(),
      revision: view.configRevision,
    };
    if (attempt.cardId !== cardId) return;
    setBusy(`recycle:${cardId}`);
    setError('');
    setPendingRecycle(attempt);
    try {
      const result = (await post('recycle', {
        realmId: view.id,
        cardId,
        requestKey: attempt.key,
        expectedRevision: attempt.revision,
      })) as RecyclingResult;
      setRecyclingReceipt(result);
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
  async function changeWish(characterId: string, present: boolean) {
    if (!view || busy || pending || pendingRecycle || settingsBusy || tradeBusy) return;
    const attempt = pendingWish ?? {
      characterId,
      present,
      key: crypto.randomUUID(),
      revision: view.configRevision,
    };
    setPendingWish(attempt);
    setBusy('wishlist');
    setError('');
    setWishMessage('');
    try {
      await post('wishlist', {
        realmId: view.id,
        characterId: attempt.characterId,
        present: attempt.present,
        requestKey: attempt.key,
        expectedRevision: attempt.revision,
      });
      setPendingWish(null);
      setWishMessage('Wishlist change saved.');
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
              recyclingReceipt && (
                <section className="discovery receipt-banner" aria-live="polite">
                  <span className="receipt-icon" aria-hidden="true">
                    <GameIcon name="recycle" />
                  </span>
                  <div>
                    <h2>{recyclingReceipt.name} recycled</h2>
                    <p>
                      +{recyclingReceipt.credited.toLocaleString()} gems · back in this realm’s pack
                      pool.
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
                                  {receipt.progression &&
                                    ` · +${receipt.progression.xpAwarded} XP`}
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
                          onClick={() => setCollectionTier(collectionTier === tier ? 'all' : tier)}
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
                          onChange={(event) => setCollectionSort(event.target.value)}
                        >
                          <option value="newest">Recently collected</option>
                          <option value="rarity">Rarest first</option>
                          <option value="value">Highest value</option>
                          <option value="name">Name A–Z</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}
                {collection.length ? (
                  <>
                    <div className="collection-grid">
                      {filteredCollection.map((card) => {
                        const valuation = view.characterValues[card.id];
                        const reward = valuation.recycleValue;
                        const recovering = pendingRecycle?.cardId === card.cardId;
                        return (
                          <article
                            className={`character collection-card ${card.tier}`}
                            key={card.cardId}
                          >
                            <InspectableCard
                              card={{ ...card, valuation }}
                              value={valuation.marketValue}
                            />
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
                              onClick={() => void recycle(card.cardId)}
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
                                  <GameIcon name="recycle" />
                                  Recycle
                                  <span className="recycle-reward">
                                    +{reward.toLocaleString()}
                                  </span>
                                </>
                              )}
                            </button>
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
              </section>
            )}
            {screen === 'wishlist' && (
              <>
                <WishlistLibrary
                  view={view}
                  disabled={locked}
                  onWish={(id, present) => void changeWish(id, present)}
                />
                {pendingWish && (
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => changeWish(pendingWish.characterId, pendingWish.present)}
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
                  !!pendingWish ||
                  settingsBusy ||
                  tradeBusy ||
                  rankBusy
                }
                onLockChange={setMarketBusy}
              />
            )}
            {screen === 'trades' && (
              <Trades
                key={view.id}
                view={view}
                disabled={
                  !!busy ||
                  !!pending ||
                  !!pendingRecycle ||
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
