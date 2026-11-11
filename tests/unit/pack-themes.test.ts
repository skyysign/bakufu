import { describe, expect, it } from 'vitest';
import {
  defaultPackName,
  buildStarterPacks,
  generatePacks,
  packPresentation,
  presentPacks,
  catalogPackGrouping,
  packsForCatalog,
} from '../../packages/core/src/index';
import type { Character } from '../../packages/core/src/index';
import { defaultConfig } from '../support/prototype-config';

describe('truthful anime-inspired pack editions', () => {
  it('uses genre themes without inventing demographic or isekai membership', () => {
    expect(packPresentation({ name: 'Action', category: 'Action' })).toEqual({
      name: 'Battle Arena',
      motif: 'battle',
      sourceCategory: 'Action',
    });
    expect(packPresentation({ name: 'Fantasy', category: 'Fantasy' })).toEqual({
      name: 'Fantasy Realms',
      motif: 'fantasy',
      sourceCategory: 'Fantasy',
    });
    expect(defaultPackName('Action')).not.toContain('Shōnen');
    expect(defaultPackName('Fantasy')).not.toContain('Isekai');
  });
  it('recognizes actual demographic/theme tags and common source spellings', () => {
    expect(defaultPackName('Shounen')).toBe('Shōnen');
    expect(defaultPackName('shōnen')).toBe('Shōnen');
    expect(defaultPackName('Shoujo')).toBe('Shōjo');
    expect(defaultPackName('Seinen')).toBe('Seinen');
    expect(defaultPackName('Josei')).toBe('Josei');
    expect(defaultPackName('Kids')).toBe('Kodomo');
    expect(defaultPackName('Isekai')).toBe('Isekai Gateways');
    expect(defaultPackName('Mecha')).toBe('Mecha Hangar');
    expect(defaultPackName('School Life')).toBe('School Days');
    expect(defaultPackName('Science Fiction')).toBe('Future City');
    expect(packPresentation({ name: 'Seinen Archives', category: 'Seinen' }).name).toBe('Seinen');
    expect(packPresentation({ name: 'Shōnen Showdown', category: 'Shounen' }).name).toBe('Shōnen');
  });
  it('preserves custom names and motifs still follow the real category', () => {
    expect(packPresentation({ name: 'My Isekai Favorites', category: 'Action' })).toEqual({
      name: 'My Isekai Favorites',
      motif: 'battle',
      sourceCategory: 'Action',
    });
    expect(packPresentation({ name: 'Battle Arena', category: 'Action' }).motif).toBe('battle');
    expect(packPresentation({ name: 'All Characters', category: null })).toEqual({
      name: 'All Characters',
      motif: 'collection',
      sourceCategory: null,
    });
    expect(packPresentation({ name: 'paper makers', category: 'paper makers' })).toEqual({
      name: 'paper makers',
      motif: 'custom',
      sourceCategory: 'paper makers',
    });
  });
  it('changes automatic names while preserving exact pools and disambiguating aliases', () => {
    const characters: Character[] = ['Action', 'School', 'School Life'].map((category, index) => ({
      id: `c6000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      sourceKey: `original:theme-${index}`,
      name: `Original Courier ${index}`,
      series: 'Original Theme Academy',
      tier: 'common',
      categories: [category],
    }));
    const packs = generatePacks(characters, { ...defaultConfig, minimumPoolSize: 1 });
    expect(packs).toEqual([
      { name: 'Battle Arena', category: 'Action' },
      { name: 'School Days', category: 'School' },
      { name: 'School Days (School Life)', category: 'School Life' },
      { name: 'All Characters', category: null },
    ]);
    expect(new Set(packs.map((pack) => pack.name)).size).toBe(packs.length);
  });
  it('keeps customized names and disambiguates existing alias-based editions', () => {
    const saved = [
      { id: 'one', name: 'School', category: 'School' },
      { id: 'two', name: 'School Life', category: 'School Life' },
      { id: 'custom', name: 'School Days', category: 'Action' },
    ];
    expect(presentPacks(saved)).toEqual([
      { ...saved[0], name: 'School Days (School)' },
      { ...saved[1], name: 'School Days (School Life)' },
      saved[2],
    ]);
    expect(saved[0].name).toBe('School');
    expect(new Set(['Horror', 'Suspense', 'Thriller'].map(defaultPackName)).size).toBe(3);
  });
  it('keeps aliases stable when callers return colliding categories in different orders', () => {
    const saved = [
      { id: 'one', name: 'School', category: 'School' },
      { id: 'two', name: 'school', category: 'school' },
      { id: 'custom', name: 'School Days (School)', category: 'Action' },
    ];
    const byId = (packs: typeof saved) =>
      Object.fromEntries(packs.map((pack) => [pack.id, pack.name]));
    const forward = presentPacks(saved);
    const reverse = presentPacks([...saved].reverse());
    expect(byId(forward)).toEqual(byId(reverse));
    expect(forward.map((pack) => pack.id)).toEqual(saved.map((pack) => pack.id));
    expect(reverse.map((pack) => pack.id)).toEqual([...saved].reverse().map((pack) => pack.id));
    expect(new Set(forward.map((pack) => pack.name.toLowerCase())).size).toBe(saved.length);
    expect(forward.find((pack) => pack.id === 'custom')).toEqual(saved[2]);
  });
  it('groups actual demographics instead of larger genres and keeps distinct overlapping demographics', () => {
    const characters = [
      { sourceKey: 'mal:1', categories: ['Action', 'Fantasy', 'Shounen', 'Seinen'] },
      { sourceKey: 'mal:2', categories: ['Action', 'Fantasy', 'Shounen', 'Seinen'] },
      { sourceKey: 'mal:3', categories: ['Action', 'Fantasy'] },
    ].map((character, index) => ({
      ...character,
      id: String(index),
      name: 'Original Courier',
      series: 'Original Academy',
      tier: 'common' as const,
    }));
    expect(generatePacks(characters, { ...defaultConfig, minimumPoolSize: 1 })).toEqual([
      { name: 'Seinen', category: 'Seinen' },
      { name: 'Shōnen', category: 'Shounen' },
      { name: 'All Characters', category: null },
    ]);
    expect(catalogPackGrouping(characters)).toEqual({
      mode: 'demographics',
      missingDemographics: false,
    });
  });
  it('uses an honest fallback when anime metadata has no demographics, retaining generic original catalogs', () => {
    const character = {
      id: 'original-1',
      sourceKey: 'anilist:1',
      name: 'Original Courier',
      series: 'Original Academy',
      tier: 'common' as const,
      categories: ['Action'],
    };
    expect(generatePacks([character], { ...defaultConfig, minimumPoolSize: 1 })).toEqual([
      { name: 'All Characters', category: null },
    ]);
    expect(catalogPackGrouping([character])).toEqual({
      mode: 'demographics',
      missingDemographics: true,
    });
    expect(
      generatePacks([{ ...character, sourceKey: 'original:1' }], {
        ...defaultConfig,
        minimumPoolSize: 1,
      }),
    ).toHaveLength(2);
  });
  it('keeps saved anime genre packs visible for variety without changing stored records', () => {
    const saved = [
      { id: 'one', name: 'Action', category: 'Action' },
      { id: 'two', name: 'Battle Arena', category: 'Action' },
      { id: 'custom', name: 'Original Academy Favorites', category: 'Action' },
      { id: 'all', name: 'All Characters', category: null },
    ];
    const before = structuredClone(saved);
    const anime = packsForCatalog(saved, [{ sourceKey: 'mal:1', categories: ['Action'] }]);
    expect(anime.map((pack) => pack.id)).toEqual(['one', 'two', 'custom', 'all']);
    expect(new Set(anime.map((pack) => pack.name.toLowerCase())).size).toBe(4);
    expect(saved).toEqual(before);
    expect(
      packsForCatalog(saved, [{ sourceKey: 'original:1', categories: ['Action'] }]),
    ).toHaveLength(4);
  });
  it('adds distinct genre and theme packs after real demographics in anime catalogs', () => {
    const tags = [
      ['Shounen', 'Action', 'Adventure'],
      ['Shounen', 'Action', 'School'],
      ['Seinen', 'Action', 'Mystery'],
      ['Seinen', 'Action', 'Mystery', 'Psychological'],
      ['Shoujo', 'Romance', 'School'],
      ['Shoujo', 'Action', 'Romance', 'School'],
      ['Josei', 'Romance'],
      ['Kodomo', 'Action', 'Adventure'],
    ];
    const characters = tags.map((categories, index) => ({
      id: String(index),
      sourceKey: `mal:${index + 1}`,
      name: 'Original Courier',
      series: 'Original Academy',
      tier: 'common' as const,
      categories,
    }));
    const packs = generatePacks(characters, {
      ...defaultConfig,
      minimumPoolSize: 2,
      maximumCategoryPacks: 10,
    });
    // Demographics with at least two characters lead; distinct genre/theme
    // pools follow by size. Mystery has exactly Seinen's pool, so it is skipped.
    expect(packs.slice(0, 3).map((pack) => pack.category)).toEqual(['Seinen', 'Shoujo', 'Shounen']);
    expect(packs.map((pack) => pack.category)).toEqual(
      expect.arrayContaining(['Action', 'Romance', 'School']),
    );
    expect(packs.map((pack) => pack.category)).not.toContain('Mystery');
    // Adventure (Grand Voyage) mostly repeats Action and Fantasy: never automatic,
    // but still a choice for a hand-picked plan.
    expect(packs.map((pack) => pack.category)).not.toContain('Adventure');
    expect(
      buildStarterPacks(
        characters,
        { ...defaultConfig, minimumPoolSize: 2 },
        {
          schemaVersion: 1,
          categories: [{ category: 'Adventure', name: 'Grand Voyage' }],
        },
      ).map((pack) => pack.name),
    ).toEqual(['Grand Voyage', 'All Characters']);
    expect(packs.at(-1)).toEqual({ name: 'All Characters', category: null });
    // A tag covering nearly the whole roster would only repeat All Characters.
    const nearTotal = characters.map((character) => ({
      ...character,
      categories: [...character.categories, 'Award Winning'],
    }));
    expect(
      generatePacks(nearTotal, { ...defaultConfig, minimumPoolSize: 2 }).map(
        (pack) => pack.category,
      ),
    ).not.toContain('Award Winning');
  });
  it('disambiguates previous demographic editions while reserving customized canonical labels', () => {
    const saved = [
      { id: 'old', name: 'Shōnen Showdown', category: 'Shounen' },
      { id: 'raw', name: 'Shounen', category: 'Shounen' },
      { id: 'custom', name: 'Shōnen', category: 'Action' },
    ];
    const result = presentPacks(saved);
    expect(new Set(result.map((pack) => pack.name.toLowerCase())).size).toBe(3);
    expect(result.find((pack) => pack.id === 'custom')).toEqual(saved[2]);
    const byId = (packs: typeof saved) =>
      Object.fromEntries(packs.map((pack) => [pack.id, pack.name]));
    expect(byId(result)).toEqual(byId(presentPacks([...saved].reverse())));
  });
});
