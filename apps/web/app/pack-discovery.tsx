'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ClientRealmView as RealmView } from '../lib/client-view';
import { GameIcon, PackArtwork } from './game-art';
import { InspectableCard } from './card-browser';
import { TiltArtwork } from './tilt-artwork';
import { screenHref } from './screens';
import { siteName } from '../lib/brand';
import { RevealSoundToggle } from './reveal-sound';
import { packGroup, packPresentation, type PackGroup } from '@card-engine/core';

type Pack = RealmView['packs'][number];
export function packHref(realmId: string, packId: string) {
  return `${screenHref('packs', realmId)}&pack=${encodeURIComponent(packId)}`;
}
const descriptions: Record<string, string> = {
  'All Characters': 'Every character in the realm, in one pack.',
  Shōnen: 'Rivals, training arcs and impossible comebacks.',
  Seinen: 'Sharper stories with older protagonists.',
  Shōjo: 'Bonds, first loves and big feelings.',
  Josei: 'Grown-up romance and real-life drama.',
  Kodomo: 'Stories made for younger audiences.',
  'Battle Arena': 'Resolve, rivalries and impossible victories.',
  'Grand Voyage': 'Set out for a bigger world.',
  'Fantasy Realms': 'Magic beyond the horizon.',
  Heartstrings: 'A little fate. A little courage.',
  'Detective Files': 'One clue can change everything.',
  'Future City': 'New machines. Endless possibilities.',
  'Spirit Realm': 'Where the ordinary meets the unknown.',
  'Sports Festival': 'One team. One more chance.',
  'School Days': 'After the bell, a new story begins.',
  'Everyday Stories': 'Small moments that stay with you.',
  'Comedy Club': 'Chaos, punchlines and comic timing.',
  'Character Arcs': 'Choices that change everything.',
  'Encore Stage': 'Idols, bands and the spotlight.',
  'Midnight Tales': 'Things that go bump in the night.',
  'Edge of Night': 'Tension until the final page.',
  'Final Countdown': 'Every second counts.',
  'Era Chronicles': 'Legends from another age.',
  'Mecha Hangar': 'Giant robots, ready to launch.',
  'Isekai Gateways': 'Reborn in another world.',
  'Magical Girls': 'Transformations and sparkling resolve.',
  'Golden Age': 'Where it all began.',
  '80s Classics': 'Big hair, bigger battles.',
  '90s Icons': 'The decade that defined a generation.',
  '2000s Hits': 'The series everyone was watching.',
  '2010s Stars': 'Modern classics and fan favorites.',
  'New Generation': 'The newest stories everyone is talking about.',
};
function packDescription(name: string, category: string | null) {
  return (
    descriptions[name] ??
    (category ? `Characters tagged ${category}.` : `A new story in ${name.toLowerCase()}.`)
  );
}
const groupLabels: Record<Exclude<PackGroup, 'all'>, string> = {
  demographic: 'Demographics',
  genre: 'Genres',
  theme: 'Themes',
  era: 'Eras',
};

export function PackInfo({ pack, view }: { pack: Pack; view: RealmView }) {
  const details = useRef<HTMLDetailsElement>(null);
  const hoverOpened = useRef(false);
  function placeInformation(node: HTMLDetailsElement) {
    if (!node.open) return;
    const content = node.querySelector<HTMLElement>('.pack-insight-content');
    if (!content) return;
    content.style.setProperty('--info-shift', '0px');
    const bounds = content.getBoundingClientRect();
    const shift = Math.max(12 - bounds.left, Math.min(0, innerWidth - 12 - bounds.right));
    content.style.setProperty('--info-shift', `${shift}px`);
  }
  useEffect(() => {
    const resized = () => {
      if (details.current) placeInformation(details.current);
    };
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);
  return (
    <details
      ref={details}
      className="pack-insight"
      onToggle={(event) => placeInformation(event.currentTarget)}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' && !event.currentTarget.open) {
          hoverOpened.current = true;
          event.currentTarget.open = true;
        }
      }}
      onPointerLeave={(event) => {
        hoverOpened.current = false;
        if (!event.currentTarget.contains(document.activeElement)) event.currentTarget.open = false;
      }}
      onBlur={(event) => {
        hoverOpened.current = false;
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          hoverOpened.current = false;
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label={`Pack information for ${pack.name}`}
        title="Odds and pack information"
        onClick={(event) => {
          // The first mouse click pins information already opened by hover.
          // Native keyboard and touch activation retain their normal toggle.
          if (event.detail > 0 && hoverOpened.current) event.preventDefault();
          hoverOpened.current = false;
        }}
      >
        <span aria-hidden="true">i</span>
      </summary>
      <div className="pack-insight-content">
        <h3>{pack.name}</h3>
        <p className="pack-insight-pool">
          {pack.category ? `Pool: ${pack.category}` : 'Pool: the complete realm catalog'} ·{' '}
          {pack.available.toLocaleString()} unclaimed · {view.config.packSize} per pack
        </p>
        <dl className="odds" aria-label="Available rarity odds">
          {Object.entries(pack.odds).map(([tier, odds]) => (
            <div key={tier} className={`odds-row ${tier}`}>
              <dt>{tier}</dt>
              <dd>{(odds * 100).toFixed(2)}%</dd>
            </div>
          ))}
        </dl>
        {view.wishlist.length > 0 && (
          <p
            className="pack-insight-wish"
            aria-label="Chance of a wishlist character on the next draw"
          >
            Wish on next draw: {(pack.wishlistChance * 100).toFixed(1)}%
          </p>
        )}
        <ul className="pack-insight-rules">
          <li>
            Odds are for your next draw from what’s still unclaimed. Empty rarities get 0% and later
            cards are drawn without replacement.
          </li>
          <li>
            One active owner per character in this realm, across every pack. Recycling releases
            that character.
          </li>
          <li>
            {view.effectiveCooldownSeconds > 0
              ? `${view.effectiveCooldownSeconds}-second cooldown per opening. `
              : 'No waiting between openings. '}
            A bundle only charges when every pack can be filled.
          </li>
        </ul>
      </div>
    </details>
  );
}

export function DiscoveryHero({ view }: { view: RealmView }) {
  const characters = view.featuredCharacters.slice(0, 3);
  return (
    <section className="discovery-hero" aria-label="Discover your next favorite">
      <div className="discovery-hero-copy">
        <span className="hero-kicker">
          <GameIcon name="spark" /> {view.name}
        </span>
        <h1>
          Your next <em>favorite</em> is waiting.
        </h1>
        <p>
          Pick a pack, break the seal and see who you meet. Every character has one owner in this
          realm — find yours before someone else does.
        </p>
        <div className="hero-actions">
          <a className="button accent hero-explore" href="#packs">
            Browse packs <GameIcon name="arrow" />
          </a>
          <Link className="button secondary" href={screenHref('collection', view.id)} scroll={false}>
            My collection
          </Link>
        </div>
        <dl className="hero-stats">
          <div>
            <dt>Characters</dt>
            <dd>{view.catalogSize.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Unclaimed</dt>
            <dd>{view.catalogStatus.available.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Yours</dt>
            <dd>{view.cards.length.toLocaleString()}</dd>
          </div>
        </dl>
      </div>
      <div className="hero-spotlight">
        <span className="hero-caption">
          {characters.length ? 'Rarest still unclaimed' : 'A new chapter starts with a pack'}
        </span>
        <div className={`spotlight-fan spotlight-count-${characters.length}`}>
          {characters.map((character, index) => (
            <figure
              key={character.id}
              data-character-id={character.id}
              className={`featured-character spotlight-card spotlight-${index} ${character.tier}`}
            >
              <TiltArtwork>
                <InspectableCard
                  card={{ ...character, valuation: view.characterValues[character.id] }}
                />
              </TiltArtwork>
            </figure>
          ))}
          {!characters.length && (
            <div className="spotlight-empty">
              <GameIcon name="spark" />
              <p>
                No unclaimed characters are available right now. Check back after a card is
                recycled.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function PackCatalog({
  view,
  disabled,
  search,
  onSearch,
}: {
  view: RealmView;
  disabled: boolean;
  search: string;
  onSearch: (search: string) => void;
}) {
  const [group, setGroup] = useState<PackGroup | 'any'>('any');
  const normalize = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/shounen/g, 'shonen')
      .replace(/shoujo/g, 'shojo');
  const query = normalize(search.trim());
  const groups = (['demographic', 'genre', 'theme', 'era'] as const).filter((value) =>
    view.packs.some((pack) => packGroup(pack.category) === value),
  );
  const packs = view.packs.filter(
    (pack) =>
      (group === 'any' || packGroup(pack.category) === group || pack.category === null) &&
      normalize(`${pack.name} ${pack.category ?? ''}`).includes(query),
  );
  return (
    <section id="packs" className="section pack-catalog">
      <div className="section-heading pack-catalog-heading">
        <div>
          <h2 id="packs-title" tabIndex={-1}>
            Explore the packs
          </h2>
          <p>
            {view.packs.length} {view.packs.length === 1 ? 'pack' : 'packs'} ·{' '}
            <span className="gem-text">
              <GameIcon name="gem" />
              {view.packPrice.toLocaleString()}
            </span>{' '}
            each · {view.config.packSize} {view.config.packSize === 1 ? 'card' : 'cards'} per pack
          </p>
        </div>
        <label className="pack-search-field search-field">
          <span className="sr-only">Search packs</span>
          <GameIcon name="search" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Find a pack…"
          />
        </label>
      </div>
      {groups.length > 1 && (
        <div className="pack-groups segmented" role="group" aria-label="Pack types">
          <button type="button" aria-pressed={group === 'any'} onClick={() => setGroup('any')}>
            All packs
          </button>
          {groups.map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={group === value}
              onClick={() => setGroup(value)}
            >
              {groupLabels[value]}
            </button>
          ))}
        </div>
      )}
      {view.packGrouping.missingDemographics && (
        <p className="inline-note pack-grouping-note">
          This catalog has no demographic tags yet, so Shōnen, Seinen, Shōjo and Josei packs aren’t
          available. All Characters includes the full roster.
        </p>
      )}
      <div className="discovery-pack-grid">
        {packs.map((pack) => {
          const index = view.packs.findIndex((entry) => entry.id === pack.id);
          const soldOut = pack.available < view.config.packSize;
          return (
            <article
              className={`pack discovery-pack tone-${index % 4}${soldOut ? ' is-sold-out' : ''}`}
              key={pack.id}
            >
              <Link
                href={packHref(view.id, pack.id)}
                prefetch={false}
                className="pack-explore"
                aria-label={`Explore ${pack.name}`}
                aria-disabled={disabled || undefined}
                onClick={(event) => {
                  if (disabled) event.preventDefault();
                }}
              >
                <TiltArtwork className="catalog-pack-art">
                  <PackArtwork
                    index={index}
                    name={pack.name}
                    motif={packPresentation(pack).motif}
                  />
                </TiltArtwork>
                <div className="pack-tile-copy">
                  <h3>{pack.name}</h3>
                  <p>{packDescription(pack.name, pack.category)}</p>
                  <div className="pack-tile-meta">
                    {soldOut ? (
                      <span className="badge">Sold out</span>
                    ) : (
                      <span>{pack.available.toLocaleString()} unclaimed</span>
                    )}
                  </div>
                </div>
              </Link>
              <PackInfo pack={pack} view={view} />
            </article>
          );
        })}
      </div>
      {!packs.length && (
        <p role="status" className="pack-search-empty empty">
          No packs match “{search}”. Try another name.
        </p>
      )}
    </section>
  );
}

export function PackStage({ pack, view }: { pack: Pack; view: RealmView }) {
  const index = view.packs.findIndex((entry) => entry.id === pack.id);
  return (
    <div className={`pack-immersive-stage tone-${index % 4}`}>
      <span className="pack-stage-aura" aria-hidden="true" />
      <span className="pack-stage-orbit" aria-hidden="true" />
      <span className="pack-stage-floor" aria-hidden="true" />
      <div className="pack-stage-floating">
        <TiltArtwork className="selected-pack-art">
          <PackArtwork index={index} name={pack.name} motif={packPresentation(pack).motif} />
        </TiltArtwork>
      </div>
    </div>
  );
}

export function PackDetail({
  pack,
  view,
  quantity,
  onQuantity,
  onOpen,
  opening,
  locked,
  pending,
  quantityLocked,
  reveals,
  onReveals,
  ready,
  navigationLocked,
  notice,
}: {
  notice?: ReactNode;
  pack: Pack;
  view: RealmView;
  quantity: 1 | 5 | 10;
  onQuantity: (quantity: 1 | 5 | 10) => void;
  onOpen: () => void;
  opening: boolean;
  locked: boolean;
  pending: boolean;
  quantityLocked: boolean;
  reveals: boolean;
  onReveals: (enabled: boolean) => void;
  ready: boolean;
  navigationLocked: boolean;
}) {
  const cards = view.config.packSize * quantity;
  const cost = view.packPrice * quantity;
  const enough = pack.available >= cards;
  const canAfford = view.balance >= cost;
  return (
    <section id="packs" className="pack-detail pack-studio" aria-label={`Open ${pack.name}`}>
      <header className="pack-studio-header">
        <Link
          className="pack-back-link"
          href={screenHref('packs', view.id)}
          scroll={false}
          prefetch={false}
          aria-disabled={navigationLocked || undefined}
          onClick={(event) => {
            if (navigationLocked) event.preventDefault();
          }}
        >
          <span aria-hidden="true">←</span> All packs
        </Link>
        <span className="pack-studio-wordmark" aria-hidden="true">
          <GameIcon name="spark" /> {siteName}
        </span>
        <div className="pack-studio-tools">
          <span className="pack-studio-wallet" aria-label={`${view.balance.toLocaleString()} gems`}>
            <GameIcon name="gem" /> {view.balance.toLocaleString()}
          </span>
          <PackInfo pack={pack} view={view} />
        </div>
      </header>
      <div className="pack-detail-heading">
        <h1 id="packs-title" tabIndex={-1}>
          {pack.name}
        </h1>
        <p className="pack-studio-subtitle">
          {packDescription(pack.name, pack.category)} ·{' '}
          {pack.available.toLocaleString()} unclaimed
        </p>
      </div>
      <div className="pack-opening-layout">
        <PackStage pack={pack} view={view} />
        <div className="pack-opening-controls">
          <div className="pack-count-picker" role="group" aria-label="Packs per opening">
            <span className="sr-only">Packs per opening</span>
            {([1, 5, 10] as const).map((count) => (
              <button
                key={count}
                type="button"
                aria-pressed={quantity === count}
                disabled={quantityLocked}
                onClick={() => onQuantity(count)}
              >
                {count} {count === 1 ? 'pack' : 'packs'}
              </button>
            ))}
          </div>
          <p className="pack-bundle-cost">
            {quantity} {quantity === 1 ? 'pack' : 'packs'} · {cards}{' '}
            {cards === 1 ? 'card' : 'cards'} ·{' '}
            <span className="gem-text">
              <GameIcon name="gem" />
              {cost.toLocaleString()} gems
            </span>
            {canAfford && enough && (
              <span className="pack-balance-after">
                {' '}
                · {(view.balance - cost).toLocaleString()} left after
              </span>
            )}
          </p>
          <button
            id={`pack-open-${pack.id}`}
            className="pack-primary-open"
            onClick={onOpen}
            disabled={!ready || locked || (!pending && (!enough || !canAfford))}
          >
            {opening ? (
              'Opening…'
            ) : pending ? (
              'Retry this opening'
            ) : !enough ? (
              'Not enough available'
            ) : !canAfford ? (
              'Not enough gems'
            ) : (
              <>
                {quantity === 1 ? 'Open pack' : `Open ${quantity} packs`}{' '}
                <span className="open-cost">
                  <span className="sr-only">· </span>
                  <GameIcon name="gem" />
                  {cost.toLocaleString()}
                  <span className="sr-only"> gems</span>
                </span>
              </>
            )}
          </button>
          <div className="pack-studio-preferences">
            <label className="check-label reveal-preference">
              <input
                type="checkbox"
                checked={reveals}
                disabled={!ready}
                onChange={(event) => onReveals(event.target.checked)}
              />
              Show card reveals
            </label>
            <RevealSoundToggle />
          </div>
          {notice}
        </div>
      </div>
    </section>
  );
}
