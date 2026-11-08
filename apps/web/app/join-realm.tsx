'use client';
import { useState } from 'react';
export function JoinRealm({
  code,
  name,
  guildId,
  enabled,
  initialError,
}: {
  code: string;
  name: string;
  guildId: string;
  enabled: boolean;
  initialError: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError);
  async function join() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/discord/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinCode: code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not start joining.');
      window.location.assign(result.url);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="panel create-panel" aria-label="Join realm">
      <h1>Join {name}</h1>
      <p>
        Membership in Discord server <code>{guildId}</code> is required to join through this link.
        Complete any server screening first.
      </p>
      <p>
        Discord will verify your account and membership in that server. Successful verification
        creates or reuses your game account and joins this realm as a player. Existing players keep
        their progress.
      </p>
      <p className="small quiet">
        Already have a local game account? Ask the operator to link it to your Discord account first
        so you keep the same account. Your Discord name is visible to other realm members.
      </p>
      <button disabled={busy || !enabled} onClick={join}>
        {busy ? 'Opening Discord…' : 'Verify with Discord and join'}
      </button>
      {!enabled && (
        <p>Discord sign-in is unavailable here. Ask the instance operator to configure it.</p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      <p>
        <a href="/">Back to sign-in</a>
      </p>
    </section>
  );
}
