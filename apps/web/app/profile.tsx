'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  profileLimits,
  profileThemeLabels,
  profileThemes,
  tiers,
  type ProfileTheme,
} from '@card-engine/config';
import type {
  PlayerDirectory,
  PlayerDirectoryEntry,
  PlayerProfile,
  PlayerSummary,
} from '@card-engine/db';
import type { ClientRealmView as RealmView } from '../lib/client-view';
import { ApiError, post } from './api-client';
import { PageHeader } from './app-shell';
import { CardFace, CardPicker, InspectableCard, type BrowseCard } from './card-browser';
import { DiscordAvatar } from './discord-avatar';
import { GameIcon } from './game-art';
import './profile.css';

export type ProfileView = 'profile' | 'players';
const romanLevels = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** Players without a Discord name are shown by the start of their trade ID. */
export function playerName(player: Pick<PlayerSummary, 'displayName' | 'username' | 'tradeCode'>) {
  return player.displayName ?? player.username ?? `Player ${player.tradeCode.slice(0, 6)}`;
}
export function profileHref(realmId: string, tradeCode?: string) {
  return `/profile?realm=${encodeURIComponent(realmId)}${tradeCode ? `&player=${encodeURIComponent(tradeCode)}` : ''}`;
}
const playersHref = (realmId: string) =>
  `/profile?realm=${encodeURIComponent(realmId)}&view=players`;

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error ?? 'Could not load this page.', response.status);
  return body as T;
}

/** A player's page, or the realm's player directory. */
export function ProfileScreen({
  view,
  player,
  tab,
  disabled,
}: {
  view: RealmView;
  /** Trade code of the player to show; the viewer's own page without it. */
  player?: string;
  tab: ProfileView;
  disabled: boolean;
}) {
  const own = !player || player === view.tradeCode;
  return (
    <section id="profile" className="section profile-screen">
      <div className="segmented profile-tabs" role="group" aria-label="Profiles">
        <Link
          scroll={false}
          href={profileHref(view.id)}
          aria-current={tab === 'profile' && own ? 'page' : undefined}
        >
          My profile
        </Link>
        <Link
          scroll={false}
          href={playersHref(view.id)}
          aria-current={tab === 'players' ? 'page' : undefined}
        >
          Players
        </Link>
      </div>
      {tab === 'players' ? (
        <PlayerDirectoryList view={view} />
      ) : (
        <PlayerPage
          key={player ?? 'self'}
          view={view}
          player={own ? undefined : player}
          disabled={disabled}
        />
      )}
    </section>
  );
}

function PlayerPage({
  view,
  player,
  disabled,
}: {
  view: RealmView;
  player?: string;
  disabled: boolean;
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0),
    [editing, setEditing] = useState(false),
    [saved, setSaved] = useState('');
  // The viewer's cards and wishes change the page (showcase, matches).
  const stamp = `${view.cards.length}:${view.wishlist.length}:${view.configRevision}`;
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    getJson<PlayerProfile>(
      `/api/profile?realmId=${encodeURIComponent(view.id)}${player ? `&player=${encodeURIComponent(player)}` : ''}`,
      controller.signal,
    )
      .then(setProfile)
      .catch((failure) => {
        if ((failure as Error).name !== 'AbortError') setError((failure as Error).message);
      });
    return () => controller.abort();
  }, [view.id, player, reload, stamp]);

  if (error)
    return (
      <div className="empty panel">
        <h1 id="screen-title" tabIndex={-1}>
          This profile is not available.
        </h1>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="profile-actions">
          <button type="button" className="secondary" onClick={() => setReload(reload + 1)}>
            Try again
          </button>
          <Link scroll={false} className="button secondary" href={playersHref(view.id)}>
            Browse players
          </Link>
        </div>
      </div>
    );
  if (!profile)
    return (
      <p className="status-line" role="status">
        Loading profile…
      </p>
    );
  const name = playerName(profile.player);
  const share = profile.stats.rosterSize
    ? Math.round((profile.stats.cards / profile.stats.rosterSize) * 100)
    : 0;
  return (
    <>
      <header className={`profile-hero panel profile-theme-${profile.page.theme}`}>
        <DiscordAvatar profile={profile.player} className="profile-avatar" />
        <div className="profile-identity">
          <h1 id="screen-title" tabIndex={-1}>
            {name}
          </h1>
          <p className="profile-handle">
            {profile.player.username && profile.player.displayName && (
              <span>@{profile.player.username}</span>
            )}
            <span className="profile-chip">Level {profile.player.level}</span>
            {profile.player.admin && <span className="profile-chip">Realm admin</span>}
            {profile.ranks.map((rank) => (
              <span
                key={rank.id}
                className="profile-chip profile-rank"
                title={`${rank.name}, level ${rank.level} of ${rank.maxLevel}`}
              >
                {rank.name} {romanLevels[rank.level - 1] ?? rank.level}
              </span>
            ))}
          </p>
          {profile.page.bio ? (
            <p className="profile-bio">{profile.page.bio}</p>
          ) : (
            profile.self && (
              <p className="profile-bio quiet">
                Tell other collectors what you are looking for: choose Edit profile.
              </p>
            )
          )}
        </div>
        <div className="profile-actions">
          {profile.self ? (
            <button
              type="button"
              className={editing ? 'secondary' : ''}
              aria-expanded={editing}
              disabled={disabled}
              onClick={() => {
                setEditing(!editing);
                setSaved('');
              }}
            >
              <GameIcon name="settings" />
              {editing ? 'Close editor' : 'Edit profile'}
            </button>
          ) : view.config.trading.enabled ? (
            <Link
              scroll={false}
              className="button"
              href={`/trades?realm=${encodeURIComponent(view.id)}&with=${encodeURIComponent(profile.player.tradeCode)}`}
            >
              <GameIcon name="trades" />
              Propose a trade
            </Link>
          ) : null}
        </div>
      </header>
      <p className="status-line" role="status">
        {saved}
      </p>
      {editing && profile.self && (
        <ProfileEditor
          view={view}
          profile={profile}
          disabled={disabled}
          onSaved={() => {
            setEditing(false);
            setSaved('Profile saved.');
            setReload(reload + 1);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      <dl className="profile-stats" aria-label="Collection">
        <div>
          <dt>Cards</dt>
          <dd>{profile.stats.cards.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Collection value</dt>
          <dd className="gem-text">
            <GameIcon name="gem" />
            {profile.stats.value.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Of all characters</dt>
          <dd>
            {profile.stats.cards > 0 ? Math.max(1, share) : 0}%
            <small> of {profile.stats.rosterSize.toLocaleString()}</small>
          </dd>
        </div>
        <div>
          <dt>Series</dt>
          <dd>{profile.stats.series.toLocaleString()}</dd>
        </div>
      </dl>
      <ul className="profile-rarities" aria-label="Cards by rarity">
        {tiers.map((tier) => (
          <li key={tier} className={`rarity-chip ${tier}`}>
            {tier} <span>{profile.stats.tiers[tier].toLocaleString()}</span>
          </li>
        ))}
      </ul>

      {profile.wanted.length > 0 && (
        <section className="profile-section profile-match" aria-labelledby="profile-wanted-title">
          <h2 id="profile-wanted-title">
            <GameIcon name="wishlist" /> On your wishlist
          </h2>
          <p className="section-intro">
            {name} has {profile.wanted.length === 1 ? 'a card' : `${profile.wanted.length} cards`}{' '}
            you wish for.
          </p>
          <CardRow cards={profile.wanted} />
        </section>
      )}

      <section className="profile-section" aria-labelledby="profile-showcase-title">
        <h2 id="profile-showcase-title">
          {profile.showcase.pinned ? 'Showcase' : 'Most valuable cards'}
        </h2>
        {profile.showcase.cards.length ? (
          <CardRow cards={profile.showcase.cards} />
        ) : (
          <p className="quiet">
            {profile.self ? 'Open a pack to start your collection.' : `${name} has no cards yet.`}
          </p>
        )}
      </section>

      {profile.wishlist !== null && (
        <section className="profile-section" aria-labelledby="profile-wishlist-title">
          <h2 id="profile-wishlist-title">Wishlist</h2>
          {profile.self && !profile.page.showWishlist && (
            <p className="section-intro">
              Only you see this. Turn on “Show my wishlist” in Edit profile to let others see what
              you are looking for.
            </p>
          )}
          {profile.wishlist.length ? (
            <div className="profile-cards">
              {profile.wishlist.map((character) => (
                <article key={character.id} className={`character profile-card ${character.tier}`}>
                  <CardFace card={character} />
                  {!profile.self && character.viewerOwns && (
                    <p className="profile-card-note">
                      <GameIcon name="check" /> You own this card
                    </p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="quiet">No wishes right now.</p>
          )}
        </section>
      )}

      <section className="profile-section" aria-labelledby="profile-collection-title">
        <h2 id="profile-collection-title">Collection</h2>
        {profile.self ? (
          <p>
            <Link
              scroll={false}
              className="button secondary"
              href={`/collection?realm=${encodeURIComponent(view.id)}`}
            >
              <GameIcon name="collection" />
              Open your collection ({profile.stats.cards.toLocaleString()})
            </Link>
          </p>
        ) : (
          <OtherCollection view={view} profile={profile} />
        )}
      </section>
    </>
  );
}

function CardRow({ cards }: { cards: PlayerProfile['showcase']['cards'] }) {
  return (
    <div className="profile-cards">
      {cards.map((card) => (
        <article key={card.cardId} className={`character profile-card ${card.tier}`}>
          <InspectableCard
            card={{ ...card, id: card.cardId, characterId: card.id }}
            value={card.valuation.marketValue}
          />
        </article>
      ))}
    </div>
  );
}

/** Another player's whole collection, loaded when asked for. */
function OtherCollection({ view, profile }: { view: RealmView; profile: PlayerProfile }) {
  const [cards, setCards] = useState<BrowseCard[] | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [tier, setTier] = useState('all'),
    [shown, setShown] = useState(24);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const body = await getJson<{ cards: (BrowseCard & { cardId: string })[] }>(
        `/api/trade-partner?realmId=${encodeURIComponent(view.id)}&code=${encodeURIComponent(profile.player.tradeCode)}`,
        new AbortController().signal,
      );
      setCards(body.cards.map((card) => ({ ...card, characterId: card.id, id: card.cardId })));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const matches = useMemo(
    () =>
      (cards ?? []).filter(
        (card) =>
          (tier === 'all' || card.tier === tier) &&
          `${card.name} ${card.series}`.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [cards, search, tier],
  );
  if (!cards)
    return (
      <>
        <p>
          <button
            type="button"
            className="secondary"
            disabled={loading || !profile.stats.cards}
            onClick={() => void load()}
          >
            <GameIcon name="collection" />
            {loading
              ? 'Loading…'
              : `Browse all ${profile.stats.cards.toLocaleString()} ${profile.stats.cards === 1 ? 'card' : 'cards'}`}
          </button>
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </>
    );
  return (
    <>
      <div className="collection-toolbar profile-collection-toolbar">
        <div className="search-field">
          <label className="sr-only" htmlFor="profile-collection-search">
            Search this collection
          </label>
          <GameIcon name="search" />
          <input
            id="profile-collection-search"
            type="search"
            value={search}
            placeholder="Search characters or series"
            onChange={(event) => {
              setSearch(event.target.value);
              setShown(24);
            }}
          />
        </div>
        <div>
          <label className="sr-only" htmlFor="profile-collection-tier">
            Filter by rarity
          </label>
          <select
            id="profile-collection-tier"
            value={tier}
            onChange={(event) => {
              setTier(event.target.value);
              setShown(24);
            }}
          >
            <option value="all">All rarities</option>
            {tiers.map((value) => (
              <option key={value} value={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="small quiet" role="status">
        {matches.length.toLocaleString()} {matches.length === 1 ? 'card' : 'cards'}
      </p>
      <div className="profile-cards profile-collection">
        {matches.slice(0, shown).map((card) => (
          <article key={card.id} className={`character profile-card ${card.tier}`}>
            <InspectableCard card={card} />
          </article>
        ))}
      </div>
      {matches.length > shown && (
        <p>
          <button type="button" className="secondary" onClick={() => setShown(shown + 48)}>
            Show more cards
          </button>
        </p>
      )}
    </>
  );
}

function ProfileEditor({
  view,
  profile,
  disabled,
  onSaved,
  onCancel,
}: {
  view: RealmView;
  profile: PlayerProfile;
  disabled: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const held = new Set(view.cards.map((card) => card.cardId));
  const [bio, setBio] = useState(profile.page.bio),
    [theme, setTheme] = useState<ProfileTheme>(profile.page.theme),
    [showcase, setShowcase] = useState(
      profile.page.showcase.filter((id) => held.has(id)).slice(0, profileLimits.showcase),
    ),
    [showWishlist, setShowWishlist] = useState(profile.page.showWishlist),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const cards: BrowseCard[] = view.cards.map((card) => ({
    ...card,
    id: card.cardId,
    characterId: card.id,
    valuation: view.characterValues[card.id],
  }));
  async function save() {
    setBusy(true);
    setError('');
    try {
      await post('profile', { realmId: view.id, bio, theme, showcase, showWishlist });
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="panel profile-editor"
      aria-label="Edit profile"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={disabled || busy}>
        <legend className="sr-only">Your profile page</legend>
        <div>
          <label htmlFor="profile-bio">About you</label>
          <textarea
            id="profile-bio"
            rows={3}
            maxLength={profileLimits.bio}
            value={bio}
            placeholder="For example: collecting every swordsman, open to trades."
            aria-describedby="profile-bio-help"
            onChange={(event) => setBio(event.target.value)}
          />
          <p id="profile-bio-help" className="field-help">
            {bio.length} / {profileLimits.bio} characters. Shown to players of this realm.
          </p>
        </div>
        <div role="radiogroup" aria-label="Page colour" className="profile-theme-picker">
          <span className="profile-editor-label">Page colour</span>
          <div>
            {profileThemes.map((value) => (
              <label key={value} className={`profile-swatch profile-theme-${value}`}>
                <input
                  type="radio"
                  name="profile-theme"
                  value={value}
                  checked={theme === value}
                  onChange={() => setTheme(value)}
                />
                <span>{profileThemeLabels[value]}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <span className="profile-editor-label">Showcase</span>
          <p className="field-help">
            Pin up to {profileLimits.showcase} cards to the top of your page, in the order you pick
            them. Without any, your most valuable cards are shown.
          </p>
          <div className="profile-showcase-picker">
            <CardPicker
              title="Choose showcase cards"
              trigger={`Choose cards (${showcase.length}/${profileLimits.showcase})`}
              cards={cards}
              selected={showcase}
              onChange={setShowcase}
              maximum={profileLimits.showcase}
              disabled={disabled || busy || !cards.length}
            />
            {showcase.length > 0 && (
              <button type="button" className="secondary" onClick={() => setShowcase([])}>
                Clear showcase
              </button>
            )}
          </div>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={showWishlist}
            onChange={(event) => setShowWishlist(event.target.checked)}
          />
          <span>
            Show my wishlist
            <small>Lets other players see which characters you are looking for.</small>
          </span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="profile-actions">
          <button>{busy ? 'Saving…' : 'Save profile'}</button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

const sortLabels = { cards: 'Most cards', rarest: 'Rarest cards', name: 'Name A–Z' } as const;
type PlayerSort = keyof typeof sortLabels;

function PlayerDirectoryList({ view }: { view: RealmView }) {
  const [query, setQuery] = useState(''),
    [sort, setSort] = useState<PlayerSort>('cards'),
    [players, setPlayers] = useState<PlayerDirectoryEntry[]>([]),
    [total, setTotal] = useState<number | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const load = useCallback(
    async (offset: number, signal: AbortSignal) => {
      setLoading(true);
      setError('');
      try {
        const page = await getJson<PlayerDirectory>(
          `/api/players?${new URLSearchParams({ realmId: view.id, query, sort, offset: String(offset) })}`,
          signal,
        );
        setPlayers((current) => (offset ? [...current, ...page.players] : page.players));
        setTotal(page.total);
      } catch (failure) {
        if ((failure as Error).name !== 'AbortError') setError((failure as Error).message);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [view.id, query, sort],
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(0, controller.signal), 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);
  const ranked = sort !== 'name' && !query.trim();
  return (
    <>
      <PageHeader
        title="Players"
        lede="Everyone collecting in this realm. Open a profile to see their cards and start a trade."
      />
      <div className="collection-toolbar players-toolbar">
        <div className="search-field">
          <label className="sr-only" htmlFor="players-search">
            Search players
          </label>
          <GameIcon name="search" />
          <input
            id="players-search"
            type="search"
            value={query}
            maxLength={80}
            placeholder="Search by Discord name"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div>
          <label className="sr-only" htmlFor="players-sort">
            Order players by
          </label>
          <select
            id="players-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as PlayerSort)}
          >
            {(Object.keys(sortLabels) as PlayerSort[]).map((value) => (
              <option key={value} value={value}>
                Sort: {sortLabels[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="small quiet" role="status">
        {loading && !players.length
          ? 'Loading players…'
          : total !== null && `${total.toLocaleString()} ${total === 1 ? 'player' : 'players'}`}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ol className="player-list">
        {players.map((player, index) => (
          <li key={player.tradeCode}>
            <Link
              scroll={false}
              className="player-row"
              href={profileHref(view.id, player.self ? undefined : player.tradeCode)}
            >
              {ranked && (
                <span className="player-rank" aria-label={`Rank ${index + 1}`}>
                  {index + 1}
                </span>
              )}
              <DiscordAvatar profile={player} className="player-avatar" />
              <span className="player-name">
                <strong>
                  {playerName(player)}
                  {player.self && <span className="profile-chip">You</span>}
                </strong>
                <small>
                  Level {player.level}
                  {player.admin ? ' · Realm admin' : ''}
                </small>
              </span>
              <span className="player-counts">
                {(['legendary', 'epic'] as const).map(
                  (tier) =>
                    player.tiers[tier] > 0 && (
                      <span key={tier} className={`rarity-chip ${tier}`}>
                        {tier} <span>{player.tiers[tier]}</span>
                      </span>
                    ),
                )}
                <span className="player-cards">
                  <strong>{player.cards.toLocaleString()}</strong>{' '}
                  {player.cards === 1 ? 'card' : 'cards'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {!loading && !error && total === 0 && (
        <div className="empty">
          <h3>No players found.</h3>
          <p className="quiet">Try another name.</p>
        </div>
      )}
      {total !== null && players.length < total && (
        <p>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => void load(players.length, new AbortController().signal)}
          >
            {loading ? 'Loading…' : 'Show more players'}
          </button>
        </p>
      )}
    </>
  );
}
