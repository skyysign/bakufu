import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../packages/config/src/index';
import { generatePacks, isMediumCategory, type Character } from '../../packages/core/src/index';

const character = (index: number, categories: string[]): Character => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  sourceKey: `mal:${index}`,
  name: `Original Wanderer ${index}`,
  series: `Original Series ${index % 6}`,
  categories,
  tier: 'common',
});

describe('medium packs', () => {
  it('offers Anime, Manga and Manhwa packs right after demographics', () => {
    // 60 characters: 30 anime, 20 manga, 10 manhwa; every one has a genre and a demographic.
    const characters = Array.from({ length: 60 }, (_, index) =>
      character(index, [
        index < 30 ? 'Anime' : index < 50 ? 'Manga' : 'Manhwa',
        'Action',
        index % 2 ? 'Shounen' : 'Seinen',
        index % 3 ? 'Fantasy' : 'Drama',
      ]),
    );
    const packs = generatePacks(characters, { ...defaultConfig, maximumCategoryPacks: 5 });
    expect(packs.map((pack) => pack.category)).toEqual([
      'Seinen',
      'Shounen',
      'Anime',
      'Manga',
      'Manhwa',
      null,
    ]);
    expect(isMediumCategory('Manhwa')).toBe(true);
    expect(isMediumCategory('Action')).toBe(false);
  });
  it('skips a medium that covers nearly the whole roster', () => {
    const characters = Array.from({ length: 40 }, (_, index) =>
      character(index, ['Anime', index % 2 ? 'Shounen' : 'Seinen', index % 4 ? 'Action' : 'Drama']),
    );
    expect(generatePacks(characters, defaultConfig).map((pack) => pack.category)).not.toContain(
      'Anime',
    );
  });
});
