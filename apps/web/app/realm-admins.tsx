'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealmAdmin, RealmAdminList, RealmRoleChange } from '@card-engine/db';
import { post } from './api-client';
import { DiscordAvatar } from './discord-avatar';
import { MemberPicker, memberName } from './member-picker';

/**
 * Administration → Players & access → Realm admins. Admins can make other
 * members admins and remove them again; the realm's creator always stays one.
 * The server checks every change.
 */
export function RealmAdmins({
  realmId,
  disabled,
  onLockChange,
}: {
  realmId: string;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const router = useRouter();
  const [admins, setAdmins] = useState<RealmAdmin[] | null>(null),
    [loadError, setLoadError] = useState(''),
    [retry, setRetry] = useState(0),
    [code, setCode] = useState(''),
    [picker, setPicker] = useState(0),
    [removing, setRemoving] = useState<RealmAdmin | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useEffect(() => onLockChange(busy), [busy, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError('');
    void (async () => {
      try {
        const response = await fetch(`/api/realm-admins?${new URLSearchParams({ realmId })}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Could not load the realm’s admins.');
        setAdmins((data as RealmAdminList).admins);
      } catch (failure) {
        if (!controller.signal.aborted) setLoadError((failure as Error).message);
      }
    })();
    return () => controller.abort();
  }, [realmId, retry]);

  async function change(tradeCode: string, role: 'admin' | 'player', self = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = (await post('realm-admins', { realmId, tradeCode, role })) as RealmRoleChange;
      const before = admins?.find((admin) => admin.tradeCode === tradeCode),
        after = result.admins.find((admin) => admin.tradeCode === tradeCode);
      const name = memberName(after ?? before ?? { tradeCode, username: null, displayName: null });
      setAdmins(result.admins);
      setRemoving(null);
      if (role === 'admin') {
        setCode('');
        setPicker((value) => value + 1);
        setMessage(result.changed ? `${name} is now an admin.` : `${name} is already an admin.`);
      } else if (self) {
        // Without the admin role this page is no longer yours; the refresh
        // takes you back to the game.
        setMessage('You are no longer an admin of this realm.');
        router.refresh();
      } else setMessage(`${name} is no longer an admin.`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const locked = disabled || busy;
  return (
    <section className="panel access-panel realm-admins" aria-labelledby="realm-admins-heading">
      <h2 id="realm-admins-heading">Realm admins</h2>
      <p>
        Admins can change everything in this realm: game rules, packs, rarity, sounds, player
        collections and gems, and who may join. Only add people you trust. The realm’s creator
        always stays an admin.
      </p>
      {loadError ? (
        <>
          <p className="error" role="alert">
            {loadError}
          </p>
          <button type="button" className="secondary" onClick={() => setRetry(retry + 1)}>
            Retry loading admins
          </button>
        </>
      ) : !admins ? (
        <p role="status">Loading admins…</p>
      ) : (
        <ul className="realm-admin-list" aria-label="Current admins">
          {admins.map((admin) => {
            const name = memberName(admin),
              confirming = removing?.tradeCode === admin.tradeCode;
            return (
              <li key={admin.tradeCode} className="realm-admin-row" data-admin={admin.tradeCode}>
                <DiscordAvatar profile={admin} className="member-avatar" />
                <span className="realm-admin-name">
                  <strong>{name}</strong>
                  {admin.username && <span className="small quiet">@{admin.username}</span>}
                  {admin.creator && <span className="badge">Creator</span>}
                  {admin.self && <span className="badge">You</span>}
                  <code className="member-code">{admin.tradeCode}</code>
                </span>
                {!admin.creator && !confirming && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={locked || !!removing}
                    onClick={() => {
                      setMessage('');
                      setError('');
                      setRemoving(admin);
                    }}
                    aria-label={admin.self ? 'Step down as admin' : `Remove ${name} as admin`}
                  >
                    {admin.self ? 'Step down' : 'Remove admin'}
                  </button>
                )}
                {confirming && (
                  <div className="realm-admin-confirm" role="group" aria-label="Confirm removal">
                    <p>
                      {admin.self
                        ? 'Step down as admin? You lose access to Administration in this realm until an admin adds you again.'
                        : `Remove ${name} as admin? They keep their cards and gems and play as a normal player.`}
                    </p>
                    <div>
                      <button
                        type="button"
                        className="danger"
                        disabled={locked}
                        onClick={() => void change(admin.tradeCode, 'player', admin.self)}
                      >
                        {busy ? 'Removing…' : admin.self ? 'Step down' : 'Remove admin'}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => setRemoving(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="realm-admin-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.trim()) void change(code.trim(), 'admin');
        }}
      >
        <h3>Add an admin</h3>
        <MemberPicker
          key={picker}
          realmId={realmId}
          prefix="realm-admin"
          disabled={locked}
          value={code}
          onChange={setCode}
          labels={{
            legend: 'Choose a member',
            selected: 'New admin',
            code: 'Member code (trade ID)',
          }}
        />
        <button disabled={locked || !code.trim()}>{busy ? 'Saving…' : 'Make admin'}</button>
      </form>
      <p className="error" role="alert">
        {error}
      </p>
      <p className="success-note" role="status">
        {message}
      </p>
    </section>
  );
}
