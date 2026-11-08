import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleRevealScore } from '../../apps/web/app/reveal-audio';

function audioFixture() {
  const param = () => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const oscillators: {
    frequency: ReturnType<typeof param>;
    type: string;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }[] = [];
  const gains: { gain: ReturnType<typeof param>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    currentTime: 7,
    state: 'running',
    destination: {},
    resume: vi.fn(async () => {}),
    createOscillator: vi.fn(() => {
      const voice = {
        frequency: param(),
        type: '',
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      oscillators.push(voice);
      return voice;
    }),
    createGain: vi.fn(() => {
      const gain = { gain: param(), connect: vi.fn(), disconnect: vi.fn() };
      gains.push(gain);
      return gain;
    }),
  };
  return { context: context as unknown as AudioContext, oscillators, gains };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('original opening sound lifecycle', () => {
  it('cancels both sounding notes and future scheduled notes, idempotently', () => {
    const { context, oscillators, gains } = audioFixture();
    const stop = scheduleRevealScore(context, 'rare', 'arrival');
    expect(oscillators.length).toBeGreaterThan(1);
    expect(oscillators.at(-1)!.start.mock.calls[0][0]).toBeGreaterThan(context.currentTime);
    stop();
    for (const voice of oscillators) {
      expect(voice.stop.mock.calls.at(-1)).toEqual([]);
      expect(voice.disconnect).toHaveBeenCalledTimes(1);
      expect(voice.onended).toBeNull();
    }
    for (const gain of gains) expect(gain.disconnect).toHaveBeenCalledTimes(1);
    stop();
    for (const voice of oscillators) expect(voice.disconnect).toHaveBeenCalledTimes(1);
  });

  it('releases naturally completed notes and keeps every tier bounded and audibly distinct', () => {
    const signatures = new Set<string>();
    for (const tier of ['common', 'uncommon', 'rare'] as const) {
      for (const cue of ['charge', 'arrival'] as const) {
        const { context, oscillators, gains } = audioFixture();
        const stop = scheduleRevealScore(context, tier, cue);
        signatures.add(
          JSON.stringify(oscillators.map((voice) => voice.frequency.setValueAtTime.mock.calls)),
        );
        expect(
          oscillators.every((voice) => voice.stop.mock.calls[0][0] <= context.currentTime + 2),
        ).toBe(true);
        const peak = gains.reduce(
          (sum, gain) => sum + gain.gain.linearRampToValueAtTime.mock.calls[0][0],
          0,
        );
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThan(0.2);
        oscillators[0].onended!();
        expect(oscillators[0].disconnect).toHaveBeenCalledTimes(1);
        stop();
        expect(oscillators[0].disconnect).toHaveBeenCalledTimes(1);
      }
    }
    expect(signatures.size).toBe(6);
  });

  it('needs a gesture unlock and muting immediately cancels active and pending audio', async () => {
    const fixture = audioFixture(),
      saved = new Map<string, string>(),
      AudioContext = vi.fn(function () {
        return fixture.context;
      });
    vi.stubGlobal('window', {
      AudioContext,
      matchMedia: () => ({ matches: false }),
      localStorage: {
        getItem: (key: string) => saved.get(key) ?? null,
        setItem: (key: string, value: string) => saved.set(key, value),
      },
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('document', { visibilityState: 'visible' });
    const sound = await import('../../apps/web/app/reveal-audio');
    sound.playRevealAudio('rare', 'charge');
    expect(AudioContext).not.toHaveBeenCalled();
    expect(fixture.oscillators).toHaveLength(0);
    sound.unlockRevealAudio();
    expect(AudioContext).toHaveBeenCalledTimes(1);
    expect(fixture.oscillators).toHaveLength(0);
    sound.playRevealAudio('rare', 'charge');
    expect(fixture.oscillators.length).toBeGreaterThan(0);
    sound.setRevealSoundEnabled(false);
    for (const voice of fixture.oscillators) expect(voice.stop.mock.calls.at(-1)).toEqual([]);
    expect(saved.get(sound.revealSoundPreferenceKey)).toBe('off');
    const count = fixture.oscillators.length;
    sound.playRevealAudio('rare', 'arrival');
    expect(fixture.oscillators).toHaveLength(count);
  });

  it('stays silent for reduced motion, hidden pages, and unsupported audio', async () => {
    const fixture = audioFixture(),
      AudioContext = vi.fn(function () {
        return fixture.context;
      });
    let reduced = true;
    const browser = {
      AudioContext: AudioContext as unknown,
      matchMedia: () => ({ matches: reduced }),
      localStorage: { getItem: () => null },
    };
    vi.stubGlobal('window', browser);
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    const sound = await import('../../apps/web/app/reveal-audio');
    sound.unlockRevealAudio();
    expect(AudioContext).not.toHaveBeenCalled();
    reduced = false;
    sound.unlockRevealAudio();
    sound.playRevealAudio('rare', 'arrival');
    expect(fixture.oscillators).toHaveLength(0);
    browser.AudioContext = undefined;
    expect(() => sound.unlockRevealAudio()).not.toThrow();
  });

  it('retains a mute choice when private browser storage is blocked', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('Private storage');
        },
        setItem: () => {
          throw new Error('Private storage');
        },
      },
      dispatchEvent: vi.fn(),
    });
    const sound = await import('../../apps/web/app/reveal-audio');
    expect(sound.revealSoundEnabled()).toBe(true);
    sound.setRevealSoundEnabled(false);
    expect(sound.revealSoundEnabled()).toBe(false);
    sound.setRevealSoundEnabled(true);
    expect(sound.revealSoundEnabled()).toBe(true);
  });
});
