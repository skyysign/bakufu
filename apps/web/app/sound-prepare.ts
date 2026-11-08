// Browser-side preparation of admin reveal sounds. Any format the browser can
// decode (MP3, OGG, WAV, M4A…) is cut to at most 30 seconds, mixed to mono,
// resampled and encoded as 16-bit PCM WAV, so the server only validates a header.

export const soundMaxSeconds = 30;
export const soundSampleRate = 32000;
const fadeSeconds = 0.35;

/** 16-bit PCM mono WAV from float samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return bytes;
}

/** Applies a short fade-out to the end of a cut sound so it does not click. */
export function fadeOut(samples: Float32Array, sampleRate: number) {
  const length = Math.min(samples.length, Math.round(fadeSeconds * sampleRate));
  for (let i = 0; i < length; i++)
    samples[samples.length - length + i] *= 1 - (i + 1) / length;
  return samples;
}

export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function prepareRevealSound(file: File) {
  if (file.size > 40 * 1024 * 1024) throw new Error('Choose a sound file smaller than 40 MB.');
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass || !window.OfflineAudioContext)
    throw new Error('This browser cannot prepare sounds. Try a current Chrome, Edge or Firefox.');
  const decoder = new AudioContextClass();
  let decoded: AudioBuffer;
  try {
    decoded = await decoder.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('This file could not be read as audio. Try MP3, OGG or WAV.');
  } finally {
    void decoder.close().catch(() => {});
  }
  const seconds = Math.min(decoded.duration, soundMaxSeconds);
  const trimmed = decoded.duration > soundMaxSeconds + 0.01;
  const frames = Math.max(1, Math.round(seconds * soundSampleRate));
  // Rendering offline mixes every channel to mono and resamples in one step.
  const offline = new window.OfflineAudioContext(1, frames, soundSampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0, 0, seconds);
  const rendered = await offline.startRendering();
  const samples = new Float32Array(rendered.getChannelData(0));
  if (trimmed) fadeOut(samples, soundSampleRate);
  const wav = encodeWav(samples, soundSampleRate);
  return {
    audio: toBase64(wav),
    durationMs: Math.round(seconds * 1000),
    trimmed,
    originalSeconds: decoded.duration,
    url: URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' })),
  };
}
