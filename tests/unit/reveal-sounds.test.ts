import { describe, expect, it } from 'vitest';
import { encodeWav, fadeOut, toBase64 } from '../../apps/web/app/sound-prepare';
import { wavDuration } from '../../packages/db/src/tier-sounds';

const tone = (seconds: number, rate = 32000) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => Math.sin(i / 8) * 0.5);

describe('admin reveal sounds', () => {
  it('encodes 16-bit mono WAV that the server measures exactly', () => {
    const wav = encodeWav(tone(2.5), 32000);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(wav.byteLength).toBe(44 + 2.5 * 32000 * 2);
    expect(wavDuration(wav)).toBe(2500);
    expect(Buffer.from(toBase64(wav), 'base64').equals(Buffer.from(wav))).toBe(true);
  });

  it('accepts up to 30 seconds and rejects longer or non-PCM files', () => {
    expect(wavDuration(encodeWav(tone(30, 8000), 8000))).toBe(30000);
    expect(() => wavDuration(encodeWav(tone(30.5, 8000), 8000))).toThrow('at most 30 seconds');
    const float = encodeWav(tone(1, 8000), 8000);
    new DataView(float.buffer).setUint16(20, 3, true);
    expect(() => wavDuration(float)).toThrow('16-bit PCM');
    expect(() => wavDuration(new TextEncoder().encode('not a wave file at all, just text....'))).toThrow();
  });

  it('fades the end of a cut sound to silence', () => {
    const samples = fadeOut(Float32Array.from({ length: 32000 }, () => 1), 32000);
    expect(samples[0]).toBe(1);
    expect(samples.at(-1)).toBe(0);
    expect(samples[32000 - Math.round(0.35 * 32000) / 2]).toBeLessThan(0.6);
  });
});
