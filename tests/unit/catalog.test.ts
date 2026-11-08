import { describe, expect, it } from 'vitest';
import { prepareRealmCatalog } from '../../packages/db/src/catalog';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { customCatalog, customChoice } from '../support/catalog-fixture';

describe('reviewed original catalog creation', () => {
  it('previews original IDs, tiers, playable category pools, fallback, and actual odds', () => {
    const { preview } = prepareRealmCatalog(defaultConfig, customChoice);
    expect(preview.characterCount).toBe(4);
    expect(preview.tiers).toEqual({ rare: 1, uncommon: 1, common: 2, epic: 0, legendary: 0 });
    expect(preview.packs).toHaveLength(3);
    expect(preview.packs.at(-1)).toMatchObject({
      name: 'All Characters',
      poolSize: 4,
      drawable: 4,
      openable: true,
    });
    expect(preview.packs.find((p) => p.name === 'wind walkers')?.odds).toEqual({
      common: 1,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    });
    expect(preview.characters.map((c) => c.id)).toEqual(customCatalog.characters.map((c) => c.id));
    expect(prepareRealmCatalog().preview.characterCount).toBe(12);
  });
  it('binds the review to parsed content and every configuration field', () => {
    const first = prepareRealmCatalog(defaultConfig, customChoice).preview;
    expect(
      prepareRealmCatalog(
        JSON.parse(JSON.stringify(defaultConfig)),
        JSON.parse(JSON.stringify(customChoice)),
      ).preview,
    ).toEqual(first);
    expect(
      prepareRealmCatalog({ ...defaultConfig, startingGems: 101 }, customChoice).preview
        .fingerprint,
    ).not.toBe(first.fingerprint);
    expect(
      prepareRealmCatalog(defaultConfig, {
        ...customChoice,
        data: { ...customCatalog, revision: 'changed' },
      }).preview.fingerprint,
    ).not.toBe(first.fingerprint);
  });
  it('rejects missing rights attestation, duplicate IDs, unsupported versions, and unplayable pools', () => {
    expect(() =>
      prepareRealmCatalog(defaultConfig, { data: customCatalog, rightsConfirmed: false }),
    ).toThrow();
    expect(() =>
      prepareRealmCatalog(defaultConfig, {
        ...customChoice,
        data: { ...customCatalog, schemaVersion: 2 },
      }),
    ).toThrow();
    expect(() =>
      prepareRealmCatalog(defaultConfig, {
        ...customChoice,
        data: {
          ...customCatalog,
          characters: [customCatalog.characters[0], customCatalog.characters[0]],
        },
      }),
    ).toThrow();
    expect(() =>
      prepareRealmCatalog({ ...defaultConfig, minimumPoolSize: 5 }, customChoice),
    ).toThrow('playable');
    expect(() =>
      prepareRealmCatalog(
        { ...defaultConfig, tierWeights: { ...defaultConfig.tierWeights, rare: 1, uncommon: 0, common: 0 }, packSize: 2 },
        customChoice,
      ),
    ).toThrow('playable');
  });
  it('bounds original uploads without relaxing the versioned JSON format', () => {
    const characters = Array.from({ length: 1001 }, (_, i) => ({
      ...customCatalog.characters[0],
      id: `c6000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      sourceKey: `workshop:c${i}`,
    }));
    expect(() =>
      prepareRealmCatalog(defaultConfig, {
        ...customChoice,
        data: { ...customCatalog, characters },
      }),
    ).toThrow('1,000');
    expect(() =>
      prepareRealmCatalog(defaultConfig, {
        ...customChoice,
        data: { ...customCatalog, imageUrl: 'https://example.test/image' },
      }),
    ).toThrow();
  });
});
