'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Account } from '@card-engine/db';
import type { ClientRealmView as RealmView } from '../lib/client-view';
import { GameIcon, type IconName } from './game-art';
import { DiscordAvatar } from './discord-avatar';
import { GemRechargeStatus } from './gem-claim';
import { screenHref, type GameScreen } from './screens';
import { siteName } from '../lib/brand';

export function Brand({ disabled = false, realmId }: { disabled?: boolean; realmId?: string }) {
  return (
    <a
      className="brand"
      href={realmId ? screenHref('packs', realmId) : '/'}
      aria-label={`${siteName} home`}
      onClick={(event) => {
        if (disabled) event.preventDefault();
      }}
    >
      <span className="brand-mark" aria-hidden="true">
        <GameIcon name="spark" />
      </span>
      <span className="brand-name" aria-hidden="true">
        {siteName}
      </span>
    </a>
  );
}

const playScreens: { screen: GameScreen; label: string; icon: IconName }[] = [
  { screen: 'packs', label: 'Packs', icon: 'packs' },
  { screen: 'collection', label: 'Collection', icon: 'collection' },
  { screen: 'wishlist', label: 'Wishlist', icon: 'wishlist' },
  { screen: 'market', label: 'Market', icon: 'market' },
  { screen: 'trades', label: 'Trades', icon: 'trades' },
  { screen: 'ranks', label: 'Ranks', icon: 'ranks' },
];

function MenuLink({
  href,
  current,
  locked,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  current: boolean;
  locked: boolean;
  icon: IconName;
  children: ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      scroll={false}
      prefetch={false}
      href={href}
      className="account-menu-item"
      aria-current={current ? 'page' : undefined}
      aria-disabled={locked || undefined}
      onClick={(event) => {
        if (locked) event.preventDefault();
        else onNavigate();
      }}
    >
      <GameIcon name={icon} />
      {children}
    </Link>
  );
}

function AccountMenu({
  account,
  view,
  screen,
  canAdmin,
  adminMode,
  onAdminMode,
  locked,
  onSignOut,
}: {
  account: Account;
  view: RealmView | null;
  screen: GameScreen;
  canAdmin: boolean;
  adminMode: boolean;
  onAdminMode: (enabled: boolean) => void;
  locked: boolean;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    panelId = useId();
  useEffect(() => setOpen(false), [screen]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const profile = view?.discordProfile;
  const displayName = profile?.displayName ?? profile?.username ?? account.email ?? 'Collector';
  return (
    <div className="header-player account-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-label="Account menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <DiscordAvatar profile={profile} className="avatar-dot" />
        <GameIcon name="chevron" className="account-chevron" />
      </button>
      <div id={panelId} className="account-panel" hidden={!open}>
        <div className="account-identity">
          <strong>{displayName}</strong>
          <span>{view ? view.name : 'No realm selected'}</span>
        </div>
        {canAdmin && (
          <label className="account-switch">
            <span>
              <strong>Admin view</strong>
              <small>{adminMode ? 'Admin controls visible' : 'Previewing as a player'}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Admin view"
              checked={adminMode}
              disabled={locked}
              onChange={(event) => onAdminMode(event.target.checked)}
            />
          </label>
        )}
        <div className="account-menu-links">
          {canAdmin && adminMode && (
            <MenuLink
              href={screenHref('admin', view?.id)}
              current={screen === 'admin'}
              locked={locked}
              icon="shield"
              onNavigate={() => setOpen(false)}
            >
              Administration
            </MenuLink>
          )}
          <MenuLink
            href={screenHref('account', view?.id)}
            current={screen === 'account'}
            locked={locked}
            icon="settings"
            onNavigate={() => setOpen(false)}
          >
            Account settings
          </MenuLink>
        </div>
        <button
          type="button"
          className="account-menu-item account-signout"
          disabled={locked}
          onClick={onSignOut}
        >
          <GameIcon name="logout" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export function GameHeader({
  account,
  view,
  screen,
  canAdmin,
  adminMode,
  onAdminMode,
  locked,
  onSignOut,
}: {
  account: Account;
  view: RealmView | null;
  screen: GameScreen;
  canAdmin: boolean;
  adminMode: boolean;
  onAdminMode: (enabled: boolean) => void;
  locked: boolean;
  onSignOut: () => void;
}) {
  return (
    <header className="site-header game-header">
      <div className="topbar">
        <Brand disabled={locked} realmId={view?.id} />
        <nav className="game-nav" aria-label="Main navigation">
          {playScreens.map((item) => (
            <Link
              key={item.screen}
              scroll={false}
              prefetch={false}
              href={screenHref(item.screen, view?.id)}
              className="nav-link"
              aria-current={screen === item.screen ? 'page' : undefined}
              aria-disabled={locked || undefined}
              onClick={(event) => {
                if (locked) event.preventDefault();
              }}
            >
              <GameIcon name={item.icon} />
              <span className="nav-label">{item.label}</span>
              {item.screen === 'collection' && view && (
                <span className="count" aria-label={`${view.cards.length} cards`}>
                  {view.cards.length.toLocaleString()}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="topbar-actions">
          {view && (
            <div className="header-wallet">
              <span
                className="header-gems"
                aria-label={`${view.balance.toLocaleString()} gems`}
                title="Your gems in this realm"
              >
                <GameIcon name="gem" />
                <strong>{view.balance.toLocaleString()}</strong>
              </span>
              <GemRechargeStatus
                reward={view.gemReward}
                href={screenHref('ranks', view.id)}
                disabled={locked}
              />
            </div>
          )}
          <AccountMenu
            account={account}
            view={view}
            screen={screen}
            canAdmin={canAdmin}
            adminMode={adminMode}
            onAdminMode={onAdminMode}
            locked={locked}
            onSignOut={onSignOut}
          />
        </div>
      </div>
    </header>
  );
}

export function PageHeader({
  title,
  lede,
  actions,
  id = 'screen-title',
}: {
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <div className="page-header">
      <div className="page-heading">
        <h1 id={id} tabIndex={-1}>
          {title}
        </h1>
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
