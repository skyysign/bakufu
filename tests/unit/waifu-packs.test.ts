import { describe, expect, it, vi } from 'vitest';
import { fetchJikanApiStep, inferCharacterGender } from '../../packages/importers/src/jikan';
import { defaultPackName, packGroup } from '../../packages/core/src/index';

const common = {
  provider: 'jikan-api',
  medium: 'anime',
  revision: 'original-fixture',
  providerConsent: true,
  termsConfirmed: true,
};

describe('waifu and husbando packs', () => {
  it('names the gender categories as packs', () => {
    expect(defaultPackName('Female')).toBe('Waifus');
    expect(defaultPackName('Male')).toBe('Husbandos');
    expect(packGroup('Female')).toBe('theme');
  });

  it('infers gender only from an explicit line or clearly agreeing pronouns', () => {
    expect(inferCharacterGender('Age: 17\nGender: Female\nShe likes tea.')).toBe('female');
    expect(inferCharacterGender('Sex: male')).toBe('male');
    expect(
      inferCharacterGender('An original courier. She runs the night line; her map is her pride.'),
    ).toBe('female');
    expect(
      inferCharacterGender('He guards the gate. His sword was his father’s; he never rests.'),
    ).toBe('male');
    // Too little evidence, or mixed pronouns (another character mentioned), stays unknown.
    expect(inferCharacterGender('A quiet courier.')).toBeNull();
    expect(inferCharacterGender('She met him. He thanked her. They left.')).toBeNull();
    expect(inferCharacterGender(null)).toBeNull();
    // Words that merely contain pronouns do not count.
    expect(inferCharacterGender('The theme of the shelter is hero worship and heresy.')).toBeNull();
  });

  it('reads one profile on the fixed host and returns only the inferred gender', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            mal_id: 910000123,
            name: 'Original Courier',
            about: 'Gender: Female\ndo-not-store-fixture-biography',
          },
        }),
      ),
    );
    const result = await fetchJikanApiStep(
      { ...common, step: 'profile', characterId: 910000123 },
      fetcher,
    );
    expect(result).toEqual({ kind: 'profile', characterId: 910000123, gender: 'female' });
    expect(JSON.stringify(result)).not.toContain('biography');
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(new URL(url).pathname).toMatch(/\/characters\/910000123$/);
  });
});

describe('provider pacing', () => {
  it('stays below the published Tenrai and Jikan limits', async () => {
    const { jikanPacing } = await import('../../packages/importers/src/jikan');
    // Tenrai: 120 requests/minute and 4/second. Legacy Jikan: 60/minute and 3/second.
    expect(jikanPacing.tenrai.perMinute).toBeLessThan(120);
    expect(jikanPacing.tenrai.delayMs).toBeGreaterThanOrEqual(250);
    expect(jikanPacing.jikan.perMinute).toBeLessThan(60);
    expect(jikanPacing.jikan.delayMs).toBeGreaterThanOrEqual(334);
  });
});
