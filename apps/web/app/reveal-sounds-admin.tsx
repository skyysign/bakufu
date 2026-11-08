'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { tiers, type Tier } from '@card-engine/config';
import type { CharacterSounds, TierSounds } from '@card-engine/db';
import { post } from './api-client';
import { prepareRevealSound, soundMaxSeconds } from './sound-prepare';

const tierLabel = (tier: Tier) => tier[0].toUpperCase() + tier.slice(1);
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
type Target = { kind: 'tier'; tier: Tier } | { kind: 'character'; id: string; name: string };
type Found = { id: string; name: string; series: string; tier: Tier };
const targetKey = (target: Target) => (target.kind === 'tier' ? target.tier : target.id);

/**
 * Administration → Reveal sounds. One optional sound per rarity replaces the
 * built-in arrival sound for that rarity; a character's own sound takes
 * priority over both. Files are trimmed to 30 seconds in the browser.
 */
export function RevealSoundsAdmin({
  realmId,
  initial,
  initialCharacters,
  disabled,
  onLockChange,
}: {
  realmId: string;
  initial: TierSounds;
  initialCharacters: CharacterSounds;
  disabled: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const router = useRouter();
  const [sounds, setSounds] = useState<TierSounds>(initial),
    [characterSounds, setCharacterSounds] = useState<CharacterSounds>(initialCharacters),
    [busy, setBusy] = useState<string | null>(null),
    [rights, setRights] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [playing, setPlaying] = useState<string | null>(null),
    [query, setQuery] = useState(''),
    [found, setFound] = useState<Found[] | null>(null),
    [searching, setSearching] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => onLockChange(!!busy), [busy, onLockChange]);
  useEffect(
    () => () => {
      onLockChange(false);
      audio.current?.pause();
    },
    [onLockChange],
  );
  const url = (target: Target, updatedAt: string) =>
    target.kind === 'tier'
      ? `/api/tier-sound?realmId=${encodeURIComponent(realmId)}&tier=${target.tier}&v=${encodeURIComponent(updatedAt)}`
      : `/api/character-sound?realmId=${encodeURIComponent(realmId)}&characterId=${target.id}&v=${encodeURIComponent(updatedAt)}`;
  function preview(target: Target, updatedAt: string) {
    audio.current?.pause();
    const key = targetKey(target);
    if (playing === key) return setPlaying(null);
    const element = new Audio(url(target, updatedAt));
    element.onended = () => setPlaying(null);
    audio.current = element;
    setPlaying(key);
    void element.play().catch(() => setPlaying(null));
  }
  const label = (target: Target) => (target.kind === 'tier' ? tierLabel(target.tier) : target.name);
  async function upload(target: Target, file: File | undefined) {
    if (!file || busy) return;
    setBusy(targetKey(target));
    setError('');
    setMessage('');
    try {
      const prepared = await prepareRevealSound(file);
      URL.revokeObjectURL(prepared.url);
      const body = {
        realmId,
        fileName: file.name.slice(0, 120) || 'sound',
        audio: prepared.audio,
        rightsConfirmed: true,
      };
      if (target.kind === 'tier') {
        const result = (await post('tier-sounds', { ...body, tier: target.tier })) as {
          tierSounds: TierSounds;
        };
        setSounds(result.tierSounds);
      } else {
        const result = (await post('character-sounds', { ...body, characterId: target.id })) as {
          characterSounds: CharacterSounds;
        };
        setCharacterSounds(result.characterSounds);
        setFound(null);
        setQuery('');
      }
      setMessage(
        prepared.trimmed
          ? `${label(target)} sound saved. It was ${Math.round(prepared.originalSeconds)} s long, so the first ${soundMaxSeconds} s are used.`
          : `${label(target)} sound saved (${seconds(prepared.durationMs)}).`,
      );
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function remove(target: Target) {
    if (busy) return;
    setBusy(targetKey(target));
    setError('');
    setMessage('');
    try {
      if (target.kind === 'tier') {
        const result = (await post('tier-sounds/remove', { realmId, tier: target.tier })) as {
          tierSounds: TierSounds;
        };
        setSounds(result.tierSounds);
        setMessage(`${label(target)} uses the built-in sound again.`);
      } else {
        const result = (await post('character-sounds/remove', {
          realmId,
          characterId: target.id,
        })) as { characterSounds: CharacterSounds };
        setCharacterSounds(result.characterSounds);
        setMessage(`${label(target)} uses the rarity sound again.`);
      }
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setError('');
    try {
      const response = await fetch(
        `/api/catalog?realmId=${encodeURIComponent(realmId)}&query=${encodeURIComponent(query.trim())}&limit=8`,
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not search characters.');
      setFound(
        (body.characters as Found[]).map(({ id, name, series, tier }) => ({ id, name, series, tier })),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSearching(false);
    }
  }
  function SoundActions({ target, updatedAt }: { target: Target; updatedAt?: string }) {
    const key = targetKey(target);
    return (
      <span className="sound-actions">
        {updatedAt && (
          <button
            type="button"
            className="secondary"
            disabled={disabled || !!busy}
            onClick={() => preview(target, updatedAt)}
            aria-label={`${playing === key ? 'Stop' : 'Play'} ${label(target)} sound`}
          >
            {playing === key ? 'Stop' : 'Play'}
          </button>
        )}
        <label
          className={`button secondary sound-upload${disabled || !!busy || !rights ? ' is-disabled' : ''}`}
        >
          {updatedAt ? 'Replace' : 'Upload'}
          <input
            type="file"
            accept="audio/*"
            className="sr-only"
            aria-label={`Upload ${label(target)} sound`}
            disabled={disabled || !!busy || !rights}
            onChange={(event) => {
              void upload(target, event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {updatedAt && (
          <button
            type="button"
            className="text-button"
            disabled={disabled || !!busy}
            onClick={() => void remove(target)}
            aria-label={`Remove ${label(target)} sound`}
          >
            Remove
          </button>
        )}
      </span>
    );
  }
  const characters = Object.entries(characterSounds);
  return (
    <section className="panel reveal-sounds" aria-labelledby="reveal-sounds-title">
      <div className="section-heading">
        <div>
          <h2 id="reveal-sounds-title">Reveal sounds</h2>
          <p className="section-intro">
            Give each rarity, or a specific character, its own sound when it is revealed. A
            character&apos;s sound wins over its rarity sound. Any common audio file works (MP3, OGG,
            WAV, M4A); sounds longer than {soundMaxSeconds} seconds are cut to the first{' '}
            {soundMaxSeconds} seconds. Players who muted sounds or prefer reduced motion hear
            nothing.
          </p>
        </div>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={rights}
          disabled={disabled}
          onChange={(event) => setRights(event.target.checked)}
        />
        I made these sounds or have permission to use them in this realm.
      </label>
      <h3 className="sound-group-title">By rarity</h3>
      <ul className="sound-rows" aria-label="Rarity sounds">
        {tiers.map((tier) => {
          const sound = sounds[tier];
          return (
            <li key={tier} className="sound-row" data-tier={tier}>
              <span className="tier-name" data-tier={tier}>
                {tierLabel(tier)}
              </span>
              <span className="sound-status">
                {busy === tier ? (
                  'Preparing…'
                ) : sound ? (
                  <>
                    <strong title={sound.fileName}>{sound.fileName}</strong>
                    <small>{seconds(sound.durationMs)}</small>
                  </>
                ) : (
                  <small>Built-in sound</small>
                )}
              </span>
              <SoundActions target={{ kind: 'tier', tier }} updatedAt={sound?.updatedAt} />
            </li>
          );
        })}
      </ul>
      <h3 className="sound-group-title">By character</h3>
      {characters.length > 0 && (
        <ul className="sound-rows" aria-label="Character sounds">
          {characters.map(([id, sound]) => (
            <li key={id} className="sound-row" data-tier={sound.tier}>
              <span className="sound-character">
                <strong className="tier-name" data-tier={sound.tier}>
                  {sound.name}
                </strong>
                <small>{sound.series}</small>
              </span>
              <span className="sound-status">
                {busy === id ? (
                  'Preparing…'
                ) : (
                  <>
                    <strong title={sound.fileName}>{sound.fileName}</strong>
                    <small>{seconds(sound.durationMs)}</small>
                  </>
                )}
              </span>
              <SoundActions
                target={{ kind: 'character', id, name: sound.name }}
                updatedAt={sound.updatedAt}
              />
            </li>
          ))}
        </ul>
      )}
      <form className="inline-form sound-search" onSubmit={(event) => void search(event)}>
        <label className="sr-only" htmlFor="sound-character-search">
          Find a character
        </label>
        <input
          id="sound-character-search"
          type="search"
          value={query}
          maxLength={100}
          placeholder="Find a character to give their own sound"
          disabled={disabled || !!busy}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="secondary" disabled={disabled || !!busy || searching || !query.trim()}>
          {searching ? 'Searching…' : 'Find character'}
        </button>
      </form>
      {found && (
        <ul className="sound-rows sound-found" aria-label="Characters found">
          {found.length === 0 && (
            <li className="sound-row">
              <small>No characters match. Try another name.</small>
            </li>
          )}
          {found.map((character) => (
            <li key={character.id} className="sound-row" data-tier={character.tier}>
              <span className="sound-character">
                <strong className="tier-name" data-tier={character.tier}>
                  {character.name}
                </strong>
                <small>{character.series}</small>
              </span>
              <span className="sound-status">
                {busy === character.id ? (
                  'Preparing…'
                ) : characterSounds[character.id] ? (
                  <small>Has its own sound</small>
                ) : (
                  <small>Uses the {tierLabel(character.tier).toLowerCase()} sound</small>
                )}
              </span>
              <SoundActions
                target={{ kind: 'character', id: character.id, name: character.name }}
                updatedAt={characterSounds[character.id]?.updatedAt}
              />
            </li>
          ))}
        </ul>
      )}
      {!rights && (
        <p className="field-help">Confirm the permission above to upload sounds.</p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      <p className="success-note" role="status">
        {message}
      </p>
    </section>
  );
}
