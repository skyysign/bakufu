'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientRealmView as RealmView } from '../lib/client-view';
export function DiscordGuild({ view, disabled }: { view: RealmView; disabled: boolean }) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function save(guildId: string | null) {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/discord/guild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realmId: view.id, guildId }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? 'Could not update the Discord server link.');
      setMessage(
        guildId
          ? 'Discord server linked. Review Realm joining to choose who can join.'
          : 'Discord server unlinked. Website progress is preserved.',
      );
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(String(new FormData(event.currentTarget).get('guildId')).trim());
  }
  return (
    <section className="panel create-panel" aria-label="Discord gameplay setup">
      <h2>Connect your Discord server</h2>
      <p>
        Link one server so its members can play with <code>/bakufu</code> commands. Linking doesn’t
        add anyone to the realm by itself.
      </p>
      <p className={`access-state ${view.discordGuildId ? 'is-done' : ''}`}>
        {view.discordGuildId
          ? `Linked server: ${view.discordGuildId}`
          : 'No Discord server linked.'}
      </p>
      <form onSubmit={submit}>
        <label htmlFor="discord-guild-id">Discord server ID</label>
        <div className="inline-form">
          <input
            key={view.discordGuildId ?? 'unlinked'}
            id="discord-guild-id"
            name="guildId"
            inputMode="numeric"
            pattern="[0-9]{17,20}"
            maxLength={20}
            defaultValue={view.discordGuildId ?? ''}
            disabled={disabled || busy}
            required
          />
          <button disabled={disabled || busy}>Link Discord server</button>
        </div>
      </form>
      <details className="help-disclosure">
        <summary>Where do I find the server ID?</summary>
        <ol>
          <li>In Discord, open User Settings → Advanced and turn on Developer Mode.</li>
          <li>Right-click your server’s icon and choose Copy Server ID.</li>
          <li>Paste it above. Your instance operator must also have enabled Discord commands.</li>
        </ol>
        <p>Collection replies stay private unless a player chooses to share a page.</p>
      </details>
      {view.discordGuildId && (
        <button className="secondary" disabled={disabled || busy} onClick={() => save(null)}>
          Unlink Discord server
        </button>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      <p className="small" role="status">
        {message}
      </p>
    </section>
  );
}
