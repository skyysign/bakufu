'use client';
import { useEffect, useState } from 'react';
import {
  revealSoundChangedEvent,
  revealSoundEnabled,
  revealSoundPreferenceKey,
  setRevealSoundEnabled,
  stopRevealAudio,
  unlockRevealAudio,
} from './reveal-audio';

export function RevealSoundToggle() {
  const [enabled, setEnabled] = useState(true),
    [available, setAvailable] = useState(true);
  useEffect(() => {
    setEnabled(revealSoundEnabled());
    setAvailable(!!window.AudioContext);
    const changed = (event: Event) => {
      setEnabled((event as CustomEvent<boolean>).detail);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === revealSoundPreferenceKey || event.key === null) {
        const next = revealSoundEnabled();
        setEnabled(next);
        if (!next) stopRevealAudio();
      }
    };
    window.addEventListener(revealSoundChangedEvent, changed);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(revealSoundChangedEvent, changed);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return (
    <button
      type="button"
      className="secondary reveal-sound-toggle"
      role="switch"
      aria-label="Opening sounds"
      aria-checked={enabled && available}
      disabled={!available}
      title="Original opening sounds; reduced motion stays silent"
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        setRevealSoundEnabled(next);
        if (next) unlockRevealAudio();
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="M4 9h4l5-4v14l-5-4H4z" />
        {enabled ? <path d="M16 8q5 4 0 8m3-11q8 7 0 14" /> : <path d="m17 9 5 6m0-6-5 6" />}
      </svg>
      {available ? (enabled ? 'Sound on' : 'Sound off') : 'Sound unavailable'}
    </button>
  );
}
