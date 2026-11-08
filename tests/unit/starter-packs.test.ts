import { describe, expect, it } from 'vitest';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import {
  buildStarterPacks,
  generatePacks,
  starterPackCategories,
} from '../../packages/core/src/index';
import { parseCatalog } from '../../packages/importers/src/index';
import { prepareRealmCatalog } from '../../packages/db/src/catalog';
import { customCatalog, customChoice } from '../support/catalog-fixture';
import { manualPlan, overlapChoice } from '../support/pack-plan-fixture';

const { characters } = parseCatalog(customCatalog);
describe('reviewed category starter packs', () => {
  it('keeps automatic generation unchanged and counts distinct category characters', () => {
    expect(buildStarterPacks(characters, defaultConfig)).toEqual(
      generatePacks(characters, defaultConfig),
    );
    expect(starterPackCategories([...characters, characters[0]])).toEqual([
      { category: 'paper makers', poolSize: 2 },
      { category: 'wind walkers', poolSize: 2 },
    ]);
  });
  it('selects exact category pools with custom names and always keeps the fallback', () => {
    const preview = prepareRealmCatalog(defaultConfig, customChoice, {
      schemaVersion: 1,
      categories: [manualPlan.categories[1]],
    }).preview;
    expect(preview.packMode).toBe('manual');
    expect(preview.packs).toEqual([
      {
        name: 'Wind Notes',
        category: 'wind walkers',
        poolSize: 2,
        drawable: 2,
        openable: true,
        odds: { common: 1, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
      },
      expect.objectContaining({ name: 'All Characters', category: null, poolSize: 4 }),
    ]);
  });
  it('allows intentional overlapping categories that automatic generation would deduplicate', () => {
    const pool = parseCatalog(overlapChoice.data).characters,
      config = { ...defaultConfig, minimumPoolSize: 1 };
    expect(generatePacks(pool, config)).toHaveLength(2);
    expect(buildStarterPacks(pool, config, manualPlan)).toEqual([
      ...manualPlan.categories,
      { name: 'All Characters', category: null },
    ]);
  });
  it('rejects duplicate categories/names, the fallback name, invalid versions, and extra fields', () => {
    for (const invalid of [
      { ...manualPlan, schemaVersion: 2 },
      {
        ...manualPlan,
        categories: [manualPlan.categories[0], { ...manualPlan.categories[0], name: 'Other' }],
      },
      {
        ...manualPlan,
        categories: [
          manualPlan.categories[0],
          { ...manualPlan.categories[1], name: ' paper trail ' },
        ],
      },
      { ...manualPlan, categories: [{ ...manualPlan.categories[0], name: ' all characters ' }] },
      { ...manualPlan, categories: [{ ...manualPlan.categories[0], name: 'Bad\nName' }] },
      {
        ...manualPlan,
        categories: [{ ...manualPlan.categories[0], series: 'Unsupported filter' }],
      },
    ])
      expect(() => buildStarterPacks(characters, defaultConfig, invalid)).toThrow();
  });
  it('enforces configured pack limits and minimum pools, rejecting missing categories', () => {
    expect(() =>
      buildStarterPacks(characters, { ...defaultConfig, maximumCategoryPacks: 1 }, manualPlan),
    ).toThrow('at most 1');
    expect(() =>
      buildStarterPacks(characters, { ...defaultConfig, minimumPoolSize: 3 }, manualPlan),
    ).toThrow('smaller');
    expect(() =>
      buildStarterPacks(characters, defaultConfig, {
        schemaVersion: 1,
        categories: [{ category: 'missing', name: 'Missing' }],
      }),
    ).toThrow('missing');
    expect(
      buildStarterPacks(
        characters,
        { ...defaultConfig, maximumCategoryPacks: 0 },
        { schemaVersion: 1, categories: [] },
      ),
    ).toEqual([{ name: 'All Characters', category: null }]);
  });
  it('binds reviews to normalized pack selection/names and distinguishes manual from automatic', () => {
    const first = prepareRealmCatalog(defaultConfig, customChoice, manualPlan).preview;
    expect(
      prepareRealmCatalog(defaultConfig, customChoice, {
        ...manualPlan,
        categories: manualPlan.categories.map((p) => ({ ...p, name: ` ${p.name} ` })),
      }).preview.fingerprint,
    ).toBe(first.fingerprint);
    expect(prepareRealmCatalog(defaultConfig, customChoice).preview.fingerprint).not.toBe(
      first.fingerprint,
    );
    expect(
      prepareRealmCatalog(defaultConfig, customChoice, {
        ...manualPlan,
        categories: [manualPlan.categories[0]],
      }).preview.fingerprint,
    ).not.toBe(first.fingerprint);
    expect(
      prepareRealmCatalog(defaultConfig, customChoice, {
        ...manualPlan,
        categories: [{ ...manualPlan.categories[0], name: 'Changed' }, manualPlan.categories[1]],
      }).preview.fingerprint,
    ).not.toBe(first.fingerprint);
  });
  it('shows category packs that cannot fill a draw without changing realm-wide size or odds', () => {
    const preview = prepareRealmCatalog(
      { ...defaultConfig, packSize: 3 },
      customChoice,
      manualPlan,
    ).preview;
    expect(preview.packs[0]).toMatchObject({ poolSize: 2, openable: false });
    expect(preview.packs.at(-1)).toMatchObject({ poolSize: 4, openable: true });
    expect(preview.packSize).toBe(3);
    expect(preview.packPrice).toBe(defaultConfig.packPrice);
  });
});
