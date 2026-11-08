'use client';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Account } from '@card-engine/db';
import type { ClientRealmView as RealmView } from '../lib/client-view';
import { post } from './api-client';
import { GameIcon, type IconName } from './game-art';
import { PageHeader } from './app-shell';
import { CreateRealmWizard } from './create-realm';
import { RealmSettings } from './settings';
import { RealmPacks } from './realm-packs';
import { RealmCharacters } from './realm-characters';
import { RevealSoundsAdmin } from './reveal-sounds-admin';
import { DiscordGuild } from './discord-guild';
import { AdmissionSettings } from './admission-settings';
import { AdminCollections } from './admin-collections';

export type AdminSection =
  | 'overview'
  | 'rules'
  | 'packs'
  | 'characters'
  | 'sounds'
  | 'collections'
  | 'access'
  | 'create';
const sectionInfo: Record<AdminSection, { label: string; icon: IconName; hint: string }> = {
  overview: { label: 'Overview', icon: 'grid', hint: 'Setup checklist' },
  rules: {
    label: 'Game rules',
    icon: 'settings',
    hint: 'Prices, rewards, progression',
  },
  packs: { label: 'Packs', icon: 'packs', hint: 'Add more variety' },
  characters: {
    label: 'Characters',
    icon: 'collection',
    hint: 'Add missing ones',
  },
  sounds: {
    label: 'Reveal sounds',
    icon: 'spark',
    hint: 'Per rarity or character',
  },
  collections: {
    label: 'Player collections',
    icon: 'shield',
    hint: 'Restore cards, adjust gems',
  },
  access: {
    label: 'Players & access',
    icon: 'user',
    hint: 'Discord, joining, invites',
  },
  create: { label: 'New realm', icon: 'plus', hint: 'Start another game' },
};

function duration(seconds: number) {
  const hours = seconds / 3600;
  if (hours >= 1) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  return `${Math.round(seconds / 60)} min`;
}

function InvitePlayer({
  realmId,
  disabled,
  onBusyChange,
}: {
  realmId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setMessage('');
    try {
      await post('discord/invite', {
        realmId,
        discordId: new FormData(form).get('discordId'),
      });
      form.reset();
      setMessage('Invitation saved. This player can now continue with Discord.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="panel access-panel" aria-label="Invite a Discord player">
      <h2>Invite players</h2>
      <p>
        Invite someone directly by their Discord user ID. They can then sign in with Discord and
        play right away, whichever joining mode you chose.
      </p>
      <form onSubmit={invite}>
        <label htmlFor="discordId">Discord user ID</label>
        <div className="inline-form">
          <input
            id="discordId"
            name="discordId"
            inputMode="numeric"
            pattern="[0-9]{17,20}"
            maxLength={20}
            required
            disabled={disabled || busy}
          />
          <button disabled={disabled || busy}>Invite player</button>
        </div>
      </form>
      <details className="help-disclosure">
        <summary>Where do I find a user ID?</summary>
        <p>
          With Developer Mode on (User Settings → Advanced), right-click the player’s name in
          Discord and choose Copy User ID.
        </p>
      </details>
      <p className="error" role="alert">
        {error}
      </p>
      <p className="success-note" role="status">
        {message}
      </p>
    </section>
  );
}

type ChecklistStatus = 'done' | 'todo' | 'optional' | 'info';
function ChecklistItem({
  status,
  title,
  children,
  action,
  onAction,
  disabled,
}: {
  status: ChecklistStatus;
  title: string;
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  disabled: boolean;
}) {
  return (
    <li className="checklist-item" data-status={status}>
      <span className="checklist-mark" aria-hidden="true">
        {status === 'done' && <GameIcon name="check" />}
        {status === 'info' && <GameIcon name="info" />}
      </span>
      <div>
        <h3>
          {title}
          <span className="sr-only">
            {status === 'done' ? ' (done)' : status === 'todo' ? ' (to do)' : ''}
          </span>
        </h3>
        <p>{children}</p>
      </div>
      {action && onAction && (
        <button
          type="button"
          className={status === 'todo' ? undefined : 'secondary'}
          disabled={disabled}
          onClick={onAction}
        >
          {action}
        </button>
      )}
    </li>
  );
}

/**
 * Administration hub. Each section is one task; the overview walks a new admin
 * through setting up a realm in order. Server-side RBAC still guards every write.
 */
export function AdminHub({
  account,
  view,
  discordEnabled,
  initialTask,
  locked,
  onLockChange,
}: {
  account: Account;
  view: RealmView | null;
  discordEnabled: boolean;
  initialTask?: string;
  locked: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const router = useRouter();
  const canManage = view?.role === 'admin',
    canCreate = account.instanceAdmin;
  const sections = (
    [
      'overview',
      'rules',
      'packs',
      'characters',
      'sounds',
      'collections',
      'access',
      'create',
    ] as AdminSection[]
  ).filter((id) =>
    id === 'create' ? canCreate : id === 'characters' ? canManage && canCreate : canManage,
  );
  const requested = (initialTask === 'create' || !view ? 'create' : initialTask) as
    | AdminSection
    | undefined;
  const [section, setSection] = useState<AdminSection>(
    requested && sections.includes(requested) ? requested : (sections[0] ?? 'overview'),
  );
  const [notice, setNotice] = useState('');
  const [locks, setLocks] = useState({
    create: false,
    settings: false,
    packs: false,
    characters: false,
    sounds: false,
    collections: false,
    invite: false,
  });
  const setLock = useCallback(
    (key: keyof typeof locks) => (value: boolean) =>
      setLocks((current) => (current[key] === value ? current : { ...current, [key]: value })),
    [],
  );
  const [createLock] = useState(() => setLock('create')),
    [settingsLock] = useState(() => setLock('settings')),
    [packsLock] = useState(() => setLock('packs')),
    [charactersLock] = useState(() => setLock('characters')),
    [soundsLock] = useState(() => setLock('sounds')),
    [collectionsLock] = useState(() => setLock('collections')),
    [inviteLock] = useState(() => setLock('invite'));
  const busy =
    locks.create ||
    locks.settings ||
    locks.packs ||
    locks.characters ||
    locks.sounds ||
    locks.collections ||
    locks.invite;
  useEffect(() => onLockChange(busy), [busy, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);

  function open(next: AdminSection) {
    if (locked) return;
    setSection(next);
    if (next !== 'overview') setNotice('');
    try {
      const url = new URL(window.location.href);
      if (next === 'overview') url.searchParams.delete('task');
      else url.searchParams.set('task', next);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // The section still opens when the address cannot be updated.
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  if (!sections.length) return null;
  const admission = view?.admission;
  const gem = view?.gemReward;
  return (
    <>
      <PageHeader
        title="Administration"
        lede={
          view && canManage
            ? `Managing ${view.name}. Pick a task; the overview shows what’s left to set up.`
            : 'Create a realm to start a game for your community.'
        }
      />
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Administration sections">
          {sections.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? 'page' : undefined}
              disabled={locked && section !== id}
              onClick={() => open(id)}
            >
              <GameIcon name={sectionInfo[id].icon} />
              <span>
                <strong>{sectionInfo[id].label}</strong>
                <small>{sectionInfo[id].hint}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="admin-content">
          {notice && (
            <p className="notice admin-notice" role="status">
              <GameIcon name="check" /> {notice}
            </p>
          )}
          {section === 'overview' && view && canManage && (
            <div className="admin-overview">
              <section className="panel admin-status" aria-label="Realm at a glance">
                <h2>{view.name}</h2>
                <dl className="admin-stats">
                  <div>
                    <dt>Characters</dt>
                    <dd>{view.catalogSize.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Packs</dt>
                    <dd>{view.packs.length}</dd>
                  </div>
                  <div>
                    <dt>Pack price</dt>
                    <dd>{view.packPrice.toLocaleString()} gems</dd>
                  </div>
                  <div>
                    <dt>Free gems</dt>
                    <dd>
                      {gem?.enabled
                        ? `${gem.amount.toLocaleString()} / ${duration(gem.intervalSeconds)}`
                        : 'Off'}
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="panel setup-checklist" aria-labelledby="setup-title">
                <h2 id="setup-title">Setup checklist</h2>
                <p className="section-intro">
                  Work through these in order to get your community playing. Everything stays
                  editable later.
                </p>
                <ol>
                  <ChecklistItem
                    status="done"
                    title="Create the realm"
                    action={canCreate ? 'Add characters' : undefined}
                    onAction={canCreate ? () => open('characters') : undefined}
                    disabled={locked}
                  >
                    {view.catalogSize.toLocaleString()} characters are ready to be pulled. Missing a
                    favourite? You can add characters any time.
                  </ChecklistItem>
                  <ChecklistItem
                    status={view.packs.length > 1 ? 'done' : 'todo'}
                    title="Offer a variety of packs"
                    action="Manage packs"
                    onAction={() => open('packs')}
                    disabled={locked}
                  >
                    {view.packs.length > 1
                      ? `${view.packs.length} packs are live: ${view.packs
                          .slice(0, 4)
                          .map((pack) => pack.name)
                          .join(', ')}${view.packs.length > 4 ? '…' : ''}`
                      : 'Only All Characters so far. Add genre, theme or era packs.'}
                  </ChecklistItem>
                  <ChecklistItem
                    status="optional"
                    title="Check the game rules"
                    action="Review rules"
                    onAction={() => open('rules')}
                    disabled={locked}
                  >
                    {view.packPrice.toLocaleString()} gems per pack ·{' '}
                    {view.config.startingGems.toLocaleString()} starting gems ·{' '}
                    {gem?.enabled
                      ? `${gem.amount.toLocaleString()} free gems every ${duration(gem.intervalSeconds)}`
                      : 'no free gem claims'}
                    . The defaults work well for most groups.
                  </ChecklistItem>
                  {discordEnabled ? (
                    <ChecklistItem
                      status={view.discordGuildId ? 'done' : 'todo'}
                      title="Connect your Discord server"
                      action={view.discordGuildId ? 'Change server' : 'Connect server'}
                      onAction={() => open('access')}
                      disabled={locked}
                    >
                      {view.discordGuildId
                        ? 'Linked. Members can use /bakufu commands for this realm.'
                        : 'Lets members play with /bakufu commands and join with a link.'}
                    </ChecklistItem>
                  ) : (
                    <ChecklistItem status="info" title="Discord isn’t set up" disabled={locked}>
                      This server has no Discord sign-in configured, so players use accounts created
                      by the server operator.
                    </ChecklistItem>
                  )}
                  <ChecklistItem
                    status={admission?.mode === 'discord_server' ? 'done' : 'optional'}
                    title="Choose who can join"
                    action="Joining options"
                    onAction={() => open('access')}
                    disabled={locked}
                  >
                    {admission?.mode === 'discord_server'
                      ? 'Members of your Discord server can join with the join link.'
                      : 'Invitation only: players join when you invite them.'}
                  </ChecklistItem>
                  {discordEnabled && (
                    <ChecklistItem
                      status="optional"
                      title="Invite players"
                      action="Invite players"
                      onAction={() => open('access')}
                      disabled={locked}
                    >
                      Invite friends by Discord user ID, or share the join link.
                    </ChecklistItem>
                  )}
                </ol>
              </section>
              {canCreate && (
                <section className="panel admin-create-card" aria-label="Another realm">
                  <div>
                    <h2>Run another realm</h2>
                    <p>
                      Each realm is a separate game with its own characters and economy, which is
                      useful for testing or for another community.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={locked}
                    onClick={() => open('create')}
                  >
                    <GameIcon name="plus" /> Create a realm
                  </button>
                </section>
              )}
            </div>
          )}
          {section === 'rules' && view && canManage && (
            <RealmSettings
              key={view.id}
              view={view}
              onLockChange={settingsLock}
              onSaved={(result) => {
                setNotice(`Game rules saved. Revision ${result.revision} is active.`);
                setSection('overview');
                router.refresh();
              }}
            />
          )}
          {section === 'packs' && view && canManage && (
            <RealmPacks
              key={`realm-packs:${view.id}`}
              realmId={view.id}
              disabled={locked && !locks.packs}
              onLockChange={packsLock}
            />
          )}
          {section === 'characters' && view && canManage && canCreate && (
            <RealmCharacters
              key={`realm-characters:${view.id}`}
              realmId={view.id}
              disabled={locked && !locks.characters}
              onLockChange={charactersLock}
            />
          )}
          {section === 'sounds' && view && canManage && (
            <RevealSoundsAdmin
              key={`reveal-sounds:${view.id}`}
              realmId={view.id}
              initial={view.tierSounds ?? {}}
              initialCharacters={view.characterSounds ?? {}}
              disabled={locked && !locks.sounds}
              onLockChange={soundsLock}
            />
          )}
          {section === 'collections' && view && canManage && (
            <AdminCollections
              key={`collections:${view.id}`}
              realmId={view.id}
              disabled={locked && !locks.collections}
              onLockChange={collectionsLock}
            />
          )}
          {section === 'access' && view && canManage && (
            <div className="admin-access">
              <p className="section-intro">
                Three steps: connect your Discord server, decide who may join, then invite people.
              </p>
              <ol className="access-steps">
                <li>
                  <span className="access-step-number" aria-hidden="true">
                    1
                  </span>
                  <DiscordGuild key={`discord-guild:${view.id}`} view={view} disabled={locked} />
                </li>
                <li>
                  <span className="access-step-number" aria-hidden="true">
                    2
                  </span>
                  <AdmissionSettings
                    key={`admission:${view.id}`}
                    view={view}
                    disabled={locked}
                    discordEnabled={discordEnabled}
                  />
                </li>
                <li>
                  <span className="access-step-number" aria-hidden="true">
                    3
                  </span>
                  {discordEnabled ? (
                    <InvitePlayer
                      realmId={view.id}
                      disabled={locked && !locks.invite}
                      onBusyChange={inviteLock}
                    />
                  ) : (
                    <section className="panel access-panel" aria-label="Invite players">
                      <h2>Invite players</h2>
                      <p>
                        Discord sign-in isn’t configured on this server, so the server operator
                        creates player accounts (see the README’s player provisioning steps).
                      </p>
                    </section>
                  )}
                </li>
              </ol>
            </div>
          )}
          {section === 'create' && canCreate && <CreateRealmWizard onLockChange={createLock} />}
        </div>
      </div>
    </>
  );
}
