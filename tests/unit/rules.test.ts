import { describe, expect, it } from 'vitest';
import demo from '../../packages/importers/fixtures/demo.v1.json';
import { parseCatalog } from '../../packages/importers/src/index';
import { parseRealmConfig } from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { availableOdds, drawPack, generatePacks } from '../../packages/core/src/index';

const { characters } = parseCatalog(demo);
describe('versioned original content and rules', () => {
  it('round trips catalog IDs, source keys, and deterministic tiers', () => {
    expect(parseCatalog(JSON.parse(JSON.stringify(demo))).characters).toEqual(characters);
    expect(characters.find((c) => c.sourceKey === 'lantern-demo:ro')?.tier).toBe('common');
    expect(new Set(characters.map((c) => c.id)).size).toBe(12);
  });
  it('rejects duplicate/source-mismatched IDs and unrecognized versions', () => {
    expect(() =>
      parseCatalog({ ...demo, characters: [demo.characters[0], demo.characters[0]] }),
    ).toThrow();
    expect(() => parseCatalog({ ...demo, source: 'another' })).toThrow();
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 999 })).toThrow();
    expect(() =>
      parseRealmConfig({
        ...defaultConfig,
        tierWeights: { ...defaultConfig.tierWeights, common: 0, uncommon: 0, rare: 0 },
      }),
    ).toThrow();
  });
  it('generates ranked category packs plus fallback and respects pool limits', () => {
    const packs = generatePacks(characters, defaultConfig);
    expect(packs).toHaveLength(6);
    expect(packs.at(-1)?.name).toBe('All Characters');
    expect(generatePacks(characters, { ...defaultConfig, maximumCategoryPacks: 1 })).toHaveLength(
      2,
    );
    expect(generatePacks([], defaultConfig)).toEqual([]);
  });
  it('reports only available weighted tiers and samples without replacement', () => {
    const common = characters.filter((c) => c.tier === 'common');
    expect(availableOdds(common, defaultConfig)).toEqual({
      common: 1,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    });
    expect(availableOdds([], defaultConfig)).toEqual({
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    });
    const draw = drawPack(characters, { ...defaultConfig, packSize: 5 }, () => 0);
    expect(new Set(draw.map((c) => c.id)).size).toBe(5);
    expect(() => drawPack([], defaultConfig, () => 0)).toThrow('Not enough eligible');
    expect(() =>
      drawPack(
        common,
        {
          ...defaultConfig,
          tierWeights: { ...defaultConfig.tierWeights, common: 0, uncommon: 1, rare: 1 },
        },
        () => 0,
      ),
    ).toThrow();
  });
  it('uses weighted interval boundaries for rarity draws', () => {
    let call = 0;
    expect(drawPack(characters, defaultConfig, () => (call++ === 0 ? 95 : 0))[0].tier).toBe('rare');
  });
});
