'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Account } from '@card-engine/db';

type Attempt = { expectedRevision: number; currentPassword: string; newPassword: string };
export function AccountSettings({
  account,
  onClose,
  onLockChange,
}: {
  account: Account;
  onClose: () => void;
  onLockChange?: (locked: boolean) => void;
}) {
  const router = useRouter();
  const [revision, setRevision] = useState(account.passwordRevision);
  const [pending, setPending] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onLockChange?.(busy || !!pending);
  }, [busy, pending, onLockChange]);
  useEffect(() => () => onLockChange?.(false), [onLockChange]);
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    setRevision((value) => Math.max(value, account.passwordRevision));
  }, [account.passwordRevision]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setMessage('');
    if (!pending && next !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    const attempt = pending ?? {
      expectedRevision: revision,
      currentPassword: current,
      newPassword: next,
    };
    setPending(attempt);
    setBusy(true);
    try {
      const response = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) {
          setPending(null);
          setCurrent('');
          setNext('');
          setConfirm('');
          router.refresh();
        }
        throw new Error(result.error ?? 'Could not change your password.');
      }
      setRevision(result.revision);
      setPending(null);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage(
        result.changed
          ? 'Password changed. Other sessions were signed out.'
          : 'Password is already current. No new change was needed.',
      );
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="account-settings-title">
      <h2 id="account-settings-title">Account settings</h2>
      {account.hasLocalPassword ? (
        <form onSubmit={submit}>
          <p>
            Change your local password. Your other signed-in sessions will end; this browser stays
            signed in. Use 12 to 256 characters.
          </p>
          <fieldset disabled={busy || !!pending}>
            <label>
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                maxLength={256}
              />
            </label>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={12}
                maxLength={256}
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={12}
                maxLength={256}
              />
            </label>
          </fieldset>
          {pending && !busy && (
            <p role="status">
              The result is uncertain. Retry to check whether your password was changed.
            </p>
          )}
          <button disabled={busy}>
            {busy ? 'Changing password...' : pending ? 'Retry password change' : 'Change password'}
          </button>
        </form>
      ) : (
        <p>You sign in through Discord. This account has no local password to change.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button className="secondary" onClick={onClose} disabled={busy || !!pending}>
        Close account settings
      </button>
    </section>
  );
}
