'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientRealmView as RealmView } from '../lib/client-view';
type Policy = { mode: 'invite_only' } | { mode: 'discord_server'; guildId: string };
export function AdmissionSettings({
  view,
  disabled,
  discordEnabled,
}: {
  view: RealmView;
  disabled: boolean;
  discordEnabled: boolean;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [pending, setPending] = useState<{
    policy: Policy;
    expectedRevision: number;
    requestKey: string;
  } | null>(null);
  const policy = view.admission!;
  async function save(input: Policy) {
    if (busy || disabled) return;
    const attempt = pending ?? {
      policy: input,
      expectedRevision: policy.revision,
      requestKey: crypto.randomUUID(),
    };
    setPending(attempt);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ realmId: view.id, ...attempt }),
        }),
        result = await response.json();
      if (!response.ok) {
        if (response.status < 500) {
          setPending(null);
          router.refresh();
        }
        throw new Error(result.error ?? 'Could not save joining settings.');
      }
      setPending(null);
      setMessage('Joining settings saved. Existing members keep their access and progress.');
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mode = new FormData(event.currentTarget).get('mode');
    void save(
      mode === 'discord_server'
        ? { mode, guildId: view.discordGuildId ?? '' }
        : { mode: 'invite_only' },
    );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        new URL(`/join/${policy.joinCode}`, window.location.origin).href,
      );
      setMessage('Join link copied.');
    } catch {
      setMessage('Open the join page and copy its address.');
    }
  }
  return (
    <section className="panel create-panel" aria-label="Realm joining">
      <h2>Choose who can join</h2>
      <p>
        <strong>Invitation only</strong> admits just the players you invite.{' '}
        <strong>Members of linked Discord server</strong> gives you a join link anyone in that
        server can use. Invitations work in both modes, and existing members always keep access.
      </p>
      <form key={policy.revision} onSubmit={submit}>
        <label htmlFor="admission-mode">Joining mode</label>
        <select
          id="admission-mode"
          name="mode"
          defaultValue={policy.mode}
          disabled={disabled || busy || !!pending}
        >
          <option value="invite_only">Invitation only</option>
          <option value="discord_server" disabled={!discordEnabled || !view.discordGuildId}>
            Members of linked Discord server
          </option>
        </select>
        {(!discordEnabled || !view.discordGuildId) && (
          <p className="field-help">
            Configure Discord sign-in and link a server before enabling server joining.
          </p>
        )}
        <button disabled={disabled || busy || !!pending}>Save joining settings</button>
      </form>
      {policy.mode === 'discord_server' && policy.joinCode && (
        <div>
          <label htmlFor="realm-join-link">Join link</label>
          <input id="realm-join-link" readOnly value={`/join/${policy.joinCode}`} />
          <div className="recycle-actions">
            <button type="button" className="secondary" onClick={copy}>
              Copy join link
            </button>
            <a className="button secondary" href={`/join/${policy.joinCode}`}>
              Open join page
            </a>
          </div>
          <p className="field-help">
            Share this link in your server. Players sign in with Discord, and membership is checked
            when they join.
          </p>
        </div>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      <p className="small" role="status">
        {message}
      </p>
      {pending && !busy && (
        <button disabled={disabled} onClick={() => save(pending.policy)}>
          Retry joining settings save
        </button>
      )}
    </section>
  );
}
