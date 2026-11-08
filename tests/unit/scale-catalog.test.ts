import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateScaleCatalog } from '../../packages/importers/src/scale';
import { majorCatalogCategories } from '../../packages/importers/src/providers';
import { parseCatalog } from '../../packages/importers/src/json';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { buildStarterPacks } from '../../packages/core/src/starter-packs';
describe('original scale catalog', () => {
  it('generates one thousand stable original identities under the import request budget', () => {
    const catalog = generateScaleCatalog();
    expect(catalog.characters).toHaveLength(1000);
    expect(new Set(catalog.characters.map((item) => item.id)).size).toBe(1000);
    expect(generateScaleCatalog()).toEqual(catalog);
    expect(
      Buffer.byteLength(JSON.stringify({ format: 'json', data: catalog, rightsConfirmed: true })),
    ).toBeLessThan(2 * 1024 * 1024 - 16384);
    expect(catalog.license).toContain('Original fictional');
  });
  it('produces major-category packs and a complete compatible source rarity cohort', () => {
    const parsed = parseCatalog(generateScaleCatalog()),
      packs = buildStarterPacks(parsed.characters, defaultConfig);
    expect(packs).toHaveLength(11);
    expect(packs.find((item) => item.category === null)?.name).toBe('All Characters');
    for (const pack of packs.filter((item) => item.category !== null))
      expect(majorCatalogCategories).toContain(pack.category);
    expect(parsed.characters.filter((item) => item.tier === 'rare')).toHaveLength(100);
    expect(parsed.characters.filter((item) => item.tier === 'uncommon')).toHaveLength(250);
    expect(parsed.characters.filter((item) => item.tier === 'common')).toHaveLength(650);
  });
  it('ships the same deterministic downloadable fixture and rejects unsupported sizes', () => {
    expect(JSON.parse(readFileSync('apps/web/public/catalog-scale.v1.json', 'utf8'))).toEqual(
      generateScaleCatalog(),
    );
    for (const count of [0, 11, 1001, 1.5]) expect(() => generateScaleCatalog(count)).toThrow();
  });
  it('ships the original demo catalog as the downloadable JSON example', () => {
    expect(readFileSync('apps/web/public/catalog-demo.v1.json', 'utf8')).toBe(
      readFileSync('packages/importers/fixtures/demo.v1.json', 'utf8'),
    );
  });
});
