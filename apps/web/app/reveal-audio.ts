import type { Tier } from '@card-engine/config';

export type RevealCue = 'charge' | 'arrival';
type Tone = {
  at: number;
  length: number;
  from: number;
  to?: number;
  level: number;
  wave?: OscillatorType;
};
/** Filtered noise: whooshes, risers, impacts and glitter (enhanced audio only). */
type Texture = {
  at: number;
  length: number;
  filter: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  level: number;
  /** Rapid level steps: the crackle of foil tearing. */
  crackle?: boolean;
};
// The rip of the pack seal opens every charge cue.
const rip: Texture[] = [
  { at: 0, length: 0.22, filter: 'bandpass', from: 2800, to: 1400, q: 0.8, level: 0.09, crackle: true },
  { at: 0.02, length: 0.14, filter: 'highpass', from: 5200, level: 0.05, crackle: true },
];

// Original synthesized scores, never samples or externally hosted audio. Each
// tier climbs in harmony and space: commons pluck, uncommons chime, rares land
// with an impact and shimmer, epics swell into a choir-like chord, legendaries
// rise, hit and ring out with a fanfare and a sparkle cascade.
const D4 = 293.66,
  Fs4 = 369.99,
  A4 = 440,
  D5 = 587.33,
  Fs5 = 739.99,
  A5 = 880,
  D6 = 1174.66,
  Fs6 = 1479.98,
  A6 = 1760,
  D7 = 2349.32;
const arpeggio = (notes: number[], start: number, step: number, length: number, level: number) =>
  notes.map((from, index) => ({ at: start + index * step, length, from, level }));

const scores: Record<Tier, Record<RevealCue, Tone[]>> = {
  common: {
    charge: [
      { at: 0, length: 0.38, from: 330, to: 660, level: 0.02, wave: 'triangle' },
      { at: 0.3, length: 0.12, from: 1318.51, to: 987.77, level: 0.016 },
    ],
    arrival: [
      { at: 0, length: 0.32, from: D5, level: 0.05 },
      { at: 0, length: 0.18, from: D6, level: 0.016, wave: 'triangle' },
      { at: 0.06, length: 0.36, from: A5, level: 0.024 },
      { at: 0.12, length: 0.16, from: D7, level: 0.006 },
    ],
  },
  uncommon: {
    charge: [
      { at: 0, length: 0.72, from: 220, to: 660, level: 0.022, wave: 'triangle' },
      ...arpeggio([D5, Fs5, A5], 0.22, 0.15, 0.24, 0.016),
    ],
    arrival: [
      ...arpeggio([D5, Fs5, A5, D6], 0, 0.05, 0.9, 0.026),
      // Inharmonic bell partials give the chime its glassy edge.
      { at: 0, length: 0.5, from: D5 * 2.76, level: 0.006 },
      { at: 0.1, length: 0.5, from: A5 * 2.76, level: 0.005 },
      { at: 0.2, length: 0.4, from: D7, level: 0.006 },
    ],
  },
  rare: {
    charge: [
      { at: 0, length: 1.2, from: 55, to: 110, level: 0.045 },
      { at: 0.1, length: 1.1, from: 220, to: 1320, level: 0.016, wave: 'triangle' },
      ...arpeggio([A5, A5, D6, Fs6], 0.62, 0.14, 0.1, 0.01),
    ],
    arrival: [
      // Impact: a pitch-dropping body under a bright chord, then a rising sparkle.
      { at: 0, length: 0.55, from: 120, to: 42, level: 0.05 },
      ...[D4, Fs4, A4, D5, A5].map((from, index) => ({
        at: 0.03 + index * 0.025,
        length: 1.55,
        from,
        level: 0.018,
        wave: 'triangle' as const,
      })),
      ...arpeggio([D6, Fs6, A6, D7], 0.18, 0.09, 0.45, 0.008),
    ],
  },
  epic: {
    charge: [
      // Heartbeat thumps under a rising detuned swell.
      ...[0, 0.55, 1.0, 1.35, 1.6].map((at) => ({ at, length: 0.26, from: 75, to: 40, level: 0.045 })),
      { at: 0, length: 1.85, from: 196, to: 784, level: 0.012, wave: 'sawtooth' },
      { at: 0.05, length: 1.8, from: 198, to: 792, level: 0.012, wave: 'triangle' },
      ...arpeggio([D6, Fs6, A6, D7], 1.15, 0.16, 0.22, 0.009),
    ],
    arrival: [
      { at: 0, length: 0.9, from: 95, to: 32, level: 0.06 },
      // Choir-like chord: detuned pairs with slow, overlapping entries.
      ...[220, 277.18, 329.63, 440, 554.37, 659.25].flatMap((from, index) => [
        { at: index * 0.04, length: 2.3, from, level: 0.011 },
        { at: index * 0.04 + 0.02, length: 2.2, from: from * 1.004, level: 0.008, wave: 'triangle' as const },
      ]),
      ...arpeggio([2637.02, 2217.46, 1760, 1318.51, 1108.73], 0.25, 0.08, 0.6, 0.007),
    ],
  },
  legendary: {
    charge: [
      { at: 0, length: 2.3, from: 41, to: 82, level: 0.045 },
      ...[196, 246.94, 293.66].map((from, index) => ({
        at: index * 0.12,
        length: 2.2,
        from,
        to: from * 4,
        level: 0.01,
        wave: 'triangle' as const,
      })),
      // Accelerating ticks count down to the reveal.
      ...[0.35, 0.75, 1.08, 1.34, 1.54, 1.7, 1.82, 1.92, 2.0, 2.07, 2.13].map((at, index) => ({
        at,
        length: 0.08,
        from: 1318.51 * 2 ** (index / 12),
        level: 0.01,
      })),
    ],
    arrival: [
      { at: 0, length: 1.3, from: 85, to: 28, level: 0.065 },
      // Fanfare: root, fifth and octaves entering like a brass section.
      ...[D4 / 2, D4, A4, D5, Fs5, A5, D6].flatMap((from, index) => [
        { at: index * 0.05, length: 2.8, from, level: index < 2 ? 0.016 : 0.01, wave: 'triangle' as const },
        { at: index * 0.05 + 0.01, length: 2.6, from: from * 2, level: 0.004 },
      ]),
      // Descending sparkle cascade, then a last high ring.
      ...arpeggio([D7, A6, Fs6, D6, A5, Fs5, D6, Fs6, A6, D7], 0.3, 0.07, 0.5, 0.006),
      { at: 1.15, length: 1.6, from: D7 * 1.5, level: 0.004 },
    ],
  },
};

const textures: Record<Tier, Record<RevealCue, Texture[]>> = {
  common: {
    charge: [
      ...rip,{ at: 0, length: 0.42, filter: 'bandpass', from: 700, to: 2600, q: 1.2, level: 0.05 }],
    arrival: [{ at: 0, length: 0.08, filter: 'highpass', from: 5000, level: 0.03 }],
  },
  uncommon: {
    charge: [
      ...rip,{ at: 0, length: 0.75, filter: 'bandpass', from: 500, to: 3600, q: 1.4, level: 0.06 }],
    arrival: [{ at: 0.02, length: 0.7, filter: 'highpass', from: 7000, to: 9000, level: 0.02 }],
  },
  rare: {
    charge: [
      ...rip,{ at: 0, length: 1.25, filter: 'bandpass', from: 300, to: 5200, q: 2, level: 0.08 }],
    arrival: [
      { at: 0, length: 0.45, filter: 'lowpass', from: 1600, to: 200, level: 0.12 },
      { at: 0.1, length: 1.2, filter: 'highpass', from: 6500, to: 9500, level: 0.022 },
    ],
  },
  epic: {
    charge: [
      ...rip,{ at: 0, length: 1.9, filter: 'bandpass', from: 200, to: 6400, q: 2.4, level: 0.09 }],
    arrival: [
      { at: 0, length: 0.9, filter: 'lowpass', from: 2000, to: 160, level: 0.15 },
      { at: 0.15, length: 1.8, filter: 'highpass', from: 6000, to: 10000, level: 0.026 },
    ],
  },
  legendary: {
    charge: [
      ...rip,
      { at: 0, length: 2.35, filter: 'bandpass', from: 150, to: 8000, q: 2.8, level: 0.1 },
      { at: 1.6, length: 0.75, filter: 'highpass', from: 3000, to: 9000, level: 0.03 },
    ],
    arrival: [
      { at: 0, length: 1.4, filter: 'lowpass', from: 2400, to: 120, level: 0.18 },
      { at: 0.2, length: 2.6, filter: 'highpass', from: 5500, to: 11000, level: 0.03 },
    ],
  },
};
const reverbAmount: Record<Tier, number> = {
  common: 0.14,
  uncommon: 0.22,
  rare: 0.3,
  epic: 0.38,
  legendary: 0.45,
};

type Bus = { dry: AudioNode; reverb: AudioNode | null; noise: AudioBuffer | null };
const buses = new WeakMap<BaseAudioContext, Bus>();
/**
 * Shared output: a gentle compressor and a generated reverb tail when the
 * browser supports them. Minimal contexts (and the unit-test fixture) connect
 * voices straight to the destination.
 */
function revealBus(context: AudioContext): Bus {
  const existing = buses.get(context);
  if (existing) return existing;
  const full = context as AudioContext & Partial<Record<string, unknown>>;
  let bus: Bus = { dry: context.destination, reverb: null, noise: null };
  if (
    typeof full.createDynamicsCompressor === 'function' &&
    typeof full.createConvolver === 'function' &&
    typeof full.createBuffer === 'function' &&
    typeof full.createBiquadFilter === 'function' &&
    typeof full.createBufferSource === 'function'
  ) {
    try {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 4;
      compressor.connect(context.destination);
      const rate = context.sampleRate || 44100,
        impulse = context.createBuffer(2, Math.floor(rate * 2.4), rate);
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < data.length; i++)
          data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3.2;
      }
      const convolver = context.createConvolver();
      convolver.buffer = impulse;
      const wet = context.createGain();
      wet.gain.value = 0.9;
      convolver.connect(wet);
      wet.connect(compressor);
      const noise = context.createBuffer(1, Math.floor(rate * 3), rate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      bus = { dry: compressor, reverb: convolver, noise };
    } catch {
      bus = { dry: context.destination, reverb: null, noise: null };
    }
  }
  buses.set(context, bus);
  return bus;
}

// Kept independent of browser construction so cancellation can be checked with
// a small audio fixture. Stops cancel future notes as well as sounding notes.
export function scheduleRevealScore(context: AudioContext, tier: Tier, cue: RevealCue) {
  const bus = revealBus(context);
  const voices = new Set<{ source: AudioScheduledSourceNode; nodes: AudioNode[] }>();
  let send: GainNode | null = null;
  if (bus.reverb) {
    send = context.createGain();
    send.gain.value = reverbAmount[tier];
    send.connect(bus.reverb);
  }
  const track = (source: AudioScheduledSourceNode, nodes: AudioNode[], start: number, end: number) => {
    const voice = { source, nodes };
    voices.add(voice);
    source.onended = () => {
      for (const node of [source, ...nodes]) node.disconnect();
      voices.delete(voice);
    };
    source.start(start);
    source.stop(end + 0.02);
  };
  for (const tone of scores[tier][cue]) {
    const oscillator = context.createOscillator(),
      gain = context.createGain(),
      start = context.currentTime + 0.015 + tone.at,
      end = start + tone.length;
    oscillator.type = tone.wave ?? 'sine';
    oscillator.frequency.setValueAtTime(tone.from, start);
    if (tone.to) oscillator.frequency.exponentialRampToValueAtTime(tone.to, end);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(tone.level, start + Math.min(0.035, tone.length / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(bus.dry);
    if (send) gain.connect(send);
    track(oscillator, [gain], start, end);
  }
  if (bus.noise)
    for (const texture of textures[tier][cue]) {
      const source = context.createBufferSource(),
        filter = context.createBiquadFilter(),
        gain = context.createGain(),
        start = context.currentTime + 0.015 + texture.at,
        end = start + texture.length;
      source.buffer = bus.noise;
      source.loop = true;
      filter.type = texture.filter;
      filter.Q.value = texture.q ?? 0.8;
      filter.frequency.setValueAtTime(texture.from, start);
      if (texture.to) filter.frequency.exponentialRampToValueAtTime(texture.to, end);
      const rising = texture.filter === 'bandpass' && !texture.crackle;
      gain.gain.setValueAtTime(0, start);
      if (texture.crackle) {
        // Deterministic level steps keep the rip identical on every opening.
        for (let step = 0, t = start; t < end - 0.02; step++, t += 0.013)
          gain.gain.setValueAtTime(texture.level * (0.25 + (((step * 7919) % 13) / 13) * 0.75), t);
      } else
        // Risers swell towards the reveal; impacts and glitter start loud and decay.
        gain.gain.linearRampToValueAtTime(
          texture.level,
          rising ? end - Math.min(0.08, texture.length / 5) : start + 0.01,
        );
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(bus.dry);
      if (send) gain.connect(send);
      track(source, [filter, gain], start, end);
    }
  return () => {
    for (const { source, nodes } of voices) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // An already completed voice needs no further stop.
      }
      for (const node of [source, ...nodes]) node.disconnect();
    }
    voices.clear();
    send?.disconnect();
    send = null;
  };
}

export const revealSoundPreferenceKey = 'card-engine:opening-sound:v1';
export const revealSoundChangedEvent = 'card-engine:opening-sound-changed';
let context: AudioContext | undefined;
const playing = new Set<() => void>();
let fallbackPreference: boolean | undefined;

export function revealSoundEnabled() {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem(revealSoundPreferenceKey);
    return stored === null ? (fallbackPreference ?? true) : stored !== 'off';
  } catch {
    return fallbackPreference ?? true;
  }
}
export function stopRevealAudio() {
  for (const stop of playing) stop();
  playing.clear();
}
export function setRevealSoundEnabled(enabled: boolean) {
  fallbackPreference = enabled;
  if (!enabled) stopRevealAudio();
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(revealSoundPreferenceKey, enabled ? 'on' : 'off');
    fallbackPreference = undefined;
  } catch {
    // A private browser may allow the in-memory choice only.
  }
  window.dispatchEvent(new CustomEvent(revealSoundChangedEvent, { detail: enabled }));
}
function motionAllowed() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
// Call synchronously from Open/Reveal/Next or enabling sound. Nothing plays at
// unlock; async artwork/network preparation cannot claim a later user gesture.
export function unlockRevealAudio() {
  if (
    typeof window === 'undefined' ||
    !window.AudioContext ||
    !revealSoundEnabled() ||
    !motionAllowed()
  )
    return;
  try {
    if (!context || context.state === 'closed')
      context = new window.AudioContext({ latencyHint: 'interactive' });
    if (context.state === 'suspended') void context.resume().catch(() => {});
  } catch {
    // Unsupported or denied audio leaves the same fully usable silent reveal.
  }
}
function audible() {
  return (
    typeof window !== 'undefined' &&
    !!context &&
    context.state === 'running' &&
    revealSoundEnabled() &&
    motionAllowed() &&
    document.visibilityState !== 'hidden'
  );
}

// Admin-provided tier sounds (Administration → Reveal sounds). Bytes are
// fetched once per URL; decoding waits for the unlocked audio context.
const customBytes = new Map<string, Promise<ArrayBuffer | null>>();
const customDecoded = new Map<string, Promise<AudioBuffer | null>>();
export function preloadCustomRevealSounds(urls: (string | undefined)[]) {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  for (const url of urls)
    if (url && !customBytes.has(url))
      customBytes.set(
        url,
        fetch(url)
          .then((response) => (response.ok ? response.arrayBuffer() : null))
          .catch(() => null),
      );
}
function decodedCustomSound(url: string) {
  if (!context) return Promise.resolve(null);
  let decoded = customDecoded.get(url);
  if (!decoded) {
    preloadCustomRevealSounds([url]);
    const audioContext = context;
    decoded = customBytes
      .get(url)!
      .then((bytes) => (bytes ? audioContext.decodeAudioData(bytes.slice(0)) : null))
      .catch(() => null);
    customDecoded.set(url, decoded);
  }
  return decoded;
}

/**
 * Plays a reveal cue. With a custom sound URL for the arrival, the realm's own
 * sound replaces the synthesized score (falling back to it if it cannot play).
 */
export function playRevealAudio(tier: Tier, cue: RevealCue, customUrl?: string) {
  if (!audible()) return () => {};
  let release = () => {};
  let cancelled = false;
  let stop = () => {};
  release = () => {
    cancelled = true;
    stop();
    playing.delete(release);
  };
  playing.add(release);
  const synthesize = () => {
    if (cancelled || !audible()) return;
    try {
      stop = scheduleRevealScore(context!, tier, cue);
    } catch {
      stopRevealAudio();
    }
  };
  if (!customUrl || cue !== 'arrival') {
    synthesize();
    return release;
  }
  void decodedCustomSound(customUrl).then((buffer) => {
    if (cancelled || !audible()) return;
    if (!buffer) return synthesize();
    try {
      const audioContext = context!,
        source = audioContext.createBufferSource(),
        gain = audioContext.createGain();
      source.buffer = buffer;
      gain.gain.value = 0.9;
      source.connect(gain);
      gain.connect(revealBus(audioContext).dry);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start();
      stop = () => {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // Already finished.
        }
        source.disconnect();
        gain.disconnect();
      };
    } catch {
      synthesize();
    }
  });
  return release;
}
