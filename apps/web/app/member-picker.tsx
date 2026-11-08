'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealmMember, RealmMemberPage } from '@card-engine/db';
import { DiscordAvatar } from './discord-avatar';
export function memberName(member: RealmMember) {
  return member.displayName ?? member.username ?? 'Player';
}
export type MemberPickerLabels = { legend: string; selected: string; code: string };
const tradeLabels: MemberPickerLabels = {
  legend: 'Choose a trade partner',
  selected: 'Trade partner',
  code: 'Other player’s trade ID',
};
export function MemberPicker({
  realmId,
  prefix,
  disabled,
  value,
  onChange,
  labels = tradeLabels,
}: {
  realmId: string;
  prefix: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
  /** Wording for the purpose (trading by default). */
  labels?: MemberPickerLabels;
}) {
  const [query, setQuery] = useState(''),
    [members, setMembers] = useState<RealmMember[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [selected, setSelected] = useState<RealmMember | null>(null);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(
    async (search: string, after: string | null, controller: AbortController) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ realmId, query: search });
        if (after) params.set('cursor', after);
        const response = await fetch(`/api/members?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Could not load realm members.');
        if (controller.signal.aborted) return;
        const page = data as RealmMemberPage;
        setMembers((previous) =>
          after
            ? [
                ...new Map(
                  [...previous, ...page.members].map((member) => [member.tradeCode, member]),
                ).values(),
              ]
            : page.members,
        );
        setCursor(page.nextCursor);
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [realmId],
  );
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setMembers([]);
    setCursor(null);
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void load(query, null, controller);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load, query, retry]);
  return (
    <div className="member-picker">
      <label htmlFor={`${prefix}-search`}>Search realm members</label>
      <input
        id={`${prefix}-search`}
        type="search"
        value={query}
        maxLength={80}
        placeholder="Discord username or display name"
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setSelected(null);
          onChange('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
      />
      <p className="small quiet">
        Only members of this realm appear. Discord names refresh when that player signs in with
        Discord. Names can repeat; check the trade ID if unsure.
      </p>
      <fieldset className="member-results" disabled={disabled}>
        <legend>{labels.legend}</legend>
        {members.map((member) => (
          <label key={member.tradeCode} className="member-choice">
            <input
              type="radio"
              name="member-selection"
              value={member.tradeCode}
              checked={value === member.tradeCode}
              aria-label={`Choose ${memberName(member)} (${member.tradeCode})`}
              onChange={() => {
                setSelected(member);
                onChange(member.tradeCode);
              }}
            />
            <DiscordAvatar profile={member} className="member-avatar" />
            <span>
              <strong>{memberName(member)}</strong>
              {member.username && <span className="small quiet"> @{member.username}</span>}
              <code className="member-code">{member.tradeCode}</code>
            </span>
          </label>
        ))}
        {!loading && !error && !members.length && (
          <p className="small quiet">
            No members found. Try another name or paste a trade ID below.
          </p>
        )}
      </fieldset>
      <p className="small" role="status">
        {loading ? 'Loading realm members…' : ''}
      </p>
      <p className="error" role="alert">
        {error}
      </p>
      {error && (
        <button
          className="secondary"
          type="button"
          disabled={disabled || loading}
          onClick={() => setRetry(retry + 1)}
        >
          Retry member search
        </button>
      )}
      {cursor && (
        <button
          className="secondary"
          type="button"
          disabled={disabled || loading}
          onClick={() => {
            if (active.current) void load(query, cursor, active.current);
          }}
        >
          Load more members
        </button>
      )}
      {selected && value === selected.tradeCode && (
        <p className="selected-member" role="status">
          {labels.selected}: <strong>{memberName(selected)}</strong>
          {selected.username ? ` (@${selected.username})` : ''}
        </p>
      )}
      <label htmlFor={`${prefix}-partner`}>{labels.code}</label>
      <input
        id={`${prefix}-partner`}
        name="partner"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          setSelected(null);
          onChange(event.currentTarget.value);
        }}
        autoComplete="off"
        required
        maxLength={36}
        aria-describedby={`${prefix}-code-help`}
      />
      <p id={`${prefix}-code-help`} className="small quiet">
        Filled when you choose a member. You can also paste a shared trade ID for local or unnamed
        accounts.
      </p>
    </div>
  );
}
