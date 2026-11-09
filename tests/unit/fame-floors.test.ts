import { describe, expect, it } from 'vitest';
import {
  defaultConfig,
  defaultFameFloors,
  disabledFameFloors,
  fameFloorsSchema,
  parseRealmConfig,
  realmConfigSchema,
  withoutFameFloors,
} from '../../packages/config/src/index';
import { adjustedTier, drawableTiers, fameFloorTier } from '../../packages/core/src/index';
import { parseCatalog } from '../../packages/importers/src/index';

describe('fame floors', () => {
  it('lifts provider characters by favourites and leaves own catalogs alone', () => {
    expect(defaultConfig.fameFloors).toEqual(defaultFameFloors);
    expect(fameFloorTier(9_999, 'mal:1', defaultConfig)).toBeNull();
    expect(fameFloorTier(13_464, 'mal:175198', defaultConfig)).toBe('rare');
    expect(fameFloorTier(64_410, 'anilist:2', defaultConfig)).toBe('epic');
    expect(fameFloorTier(150_263, 'mal:3', defaultConfig)).toBe('legendary');
    expect(fameFloorTier(150_263, 'demo:3', defaultConfig)).toBeNull();
    expect(fameFloorTier(null, 'mal:3', defaultConfig)).toBeNull();
    const off = { ...defaultConfig, fameFloors: disabledFameFloors };
    expect(fameFloorTier(150_263, 'mal:3', off)).toBeNull();
  });
  it('never lowers a tier, and an override always wins', () => {
    expect(adjustedTier('uncommon', null, 13_464, 'mal:1', defaultConfig)).toBe('rare');
    expect(adjustedTier('legendary', null, 13_464, 'mal:1', defaultConfig)).toBe('legendary');
    expect(adjustedTier('legendary', 'common', 150_263, 'mal:1', defaultConfig)).toBe('common');
    expect(adjustedTier('common', 'epic', null, 'demo:1', defaultConfig)).toBe('epic');
  });
  it('stays within tiers a pack can draw', () => {
    const threeTiers = {
      ...defaultConfig,
      tierWeights: { common: 70, uncommon: 25, rare: 5, epic: 0, legendary: 0 },
    };
    expect(drawableTiers(threeTiers)).toEqual(['common', 'uncommon', 'rare']);
    expect(fameFloorTier(150_263, 'mal:1', threeTiers)).toBe('rare');
    const noLegendary = {
      ...defaultConfig,
      tierWeights: { ...defaultConfig.tierWeights, legendary: 0 },
    };
    expect(fameFloorTier(150_263, 'mal:1', noLegendary)).toBe('epic');
  });
  it('requires each higher floor to need more favourites', () => {
    expect(fameFloorsSchema.safeParse({ ...defaultFameFloors, epic: 5_000 }).success).toBe(false);
    expect(
      fameFloorsSchema.safeParse({ schemaVersion: 1, rare: null, epic: 30_000, legendary: null })
        .success,
    ).toBe(true);
    expect(fameFloorsSchema.safeParse({ ...defaultFameFloors, rare: 0 }).success).toBe(false);
  });
  it('migrates v11 realms with floors off and keeps their v11 shape recognizable', () => {
    const v11 = withoutFameFloors(defaultConfig);
    expect(v11).not.toHaveProperty('fameFloors');
    const migrated = parseRealmConfig(v11);
    expect(migrated).toEqual({
      ...defaultConfig,
      fameFloors: disabledFameFloors,
    });
    expect(() => realmConfigSchema.parse(v11)).toThrow();
    expect(() => parseRealmConfig({ ...v11, fameFloors: defaultFameFloors })).toThrow();
  });
  it('fixes a well-known character that misses the rare cut in a roster of hits', () => {
    // 10 hit series x 25 characters: the 46th most favourited character
    // (about 13,000 favourites) is outside the top 12% that the rare band holds.
    const characters = Array.from({ length: 250 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      sourceKey: `mal:${index + 1}`,
      name: `Character ${index + 1}`,
      series: `Series ${index % 10}`,
      categories: ['Action'],
      popularity: Math.round(600_000 / (index + 1)),
    }));
    const parsed = parseCatalog(
      { schemaVersion: 1, source: 'mal', revision: 'fixture', license: 'test', characters },
      true,
    );
    const target = parsed.characters[45];
    expect(characters[45].popularity).toBeGreaterThan(10_000);
    expect(target.tier).toBe('uncommon');
    expect(
      adjustedTier(target.tier, null, characters[45].popularity, target.sourceKey, defaultConfig),
    ).toBe('rare');
  });
});
