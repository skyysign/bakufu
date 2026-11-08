import { describe, expect, it } from 'vitest';
import {} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import { selectPackSpotlights, type Character } from '../../packages/core/src/index';

const character = (id: string, tier: Character['tier']): Character => ({
  id,
  tier,
  sourceKey: `original-spotlight:${id}`,
  name: `Original spotlight ${id}`,
  series: 'Original spotlight fixture',
  categories: ['Fixture'],
});

describe('claimable pack spotlights', () => {
  it('shows the rarest saved tiers first with stable ties without mutating the pool', () => {
    const pool = [
      character('common', 'common'),
      character('rare-b', 'rare'),
      character('uncommon', 'uncommon'),
      character('rare-a', 'rare'),
    ];
    const before = [...pool];
    expect(selectPackSpotlights(pool, defaultConfig, 3).map((entry) => entry.id)).toEqual([
      'rare-a',
      'rare-b',
      'uncommon',
    ]);
    expect(pool).toEqual(before);
  });

  it('never advertises zero-odds tiers or an incomplete base pack', () => {
    const pool = [character('rare', 'rare'), character('common', 'common')];
    const config = {
      ...defaultConfig,
      tierWeights: { ...defaultConfig.tierWeights, common: 1, uncommon: 0, rare: 0 },
    };
    expect(selectPackSpotlights(pool, config, 5).map((entry) => entry.id)).toEqual(['common']);
    expect(selectPackSpotlights(pool, { ...config, packSize: 2 }, 5)).toEqual([]);
    expect(selectPackSpotlights([], defaultConfig, 5)).toEqual([]);
  });
});
