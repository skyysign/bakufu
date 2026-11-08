import { describe, expect, it } from 'vitest';
import { defaultConfig, tiers, type Tier } from '../../packages/config/src/index';
import {
  characterStandings,
  parseCatalog,
  tierForStanding,
} from '../../packages/importers/src/json';
import { availableOdds, drawPack, type Character } from '../../packages/core/src/index';
import { additionStanding } from '../../packages/db/src/realm-characters';

/** Original fixture roster: one hit series and many smaller ones. */
function roster() {
  const characters: {
    id: string;
    sourceKey: string;
    name: string;
    series: string;
    categories: string[];
    popularity: number;
    role?: 'main' | 'supporting';
  }[] = [];
  let n = 0;
  const add = (series: string, popularity: number, role: 'main' | 'supporting') => {
    n++;
    characters.push({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      sourceKey: `mal:${n}`,
      name: `Original ${n}`,
      series,
      categories: [],
      popularity,
      role,
    });
  };
  // The hit: 25 characters, from 90,000 favourites down to 2,000.
  for (let i = 0; i < 25; i++) add('Hit Series', 90_000 - i * 3_667, i < 3 ? 'main' : 'supporting');
  // 79 smaller series with 25 characters each, far fewer favourites.
  for (let s = 0; s < 79; s++)
    for (let i = 0; i < 25; i++)
      add(`Series ${s}`, Math.max(0, 1_800 - s * 20 - i * 60), i < 2 ? 'main' : 'supporting');
  return {
    schemaVersion: 1 as const,
    source: 'mal',
    revision: 'fixture',
    license: 'fixture',
    characters,
  };
}

describe('standing-based rarity (five tiers)', () => {
  const catalog = roster();
  const parsed = parseCatalog(catalog, true);
  const tierOf = (index: number) => parsed.characters[index].tier;
  const order: Tier[] = [...tiers];

  it('uses wider bands: 0.5% legendary, 2.5% epic, 9% rare, 28% uncommon', () => {
    expect(tierForStanding(0)).toBe('legendary');
    expect(tierForStanding(0.006)).toBe('epic');
    expect(tierForStanding(0.05)).toBe('rare');
    expect(tierForStanding(0.2)).toBe('uncommon');
    expect(tierForStanding(0.5)).toBe('common');
    const counts = Object.fromEntries(
      tiers.map((tier) => [tier, parsed.characters.filter((c) => c.tier === tier).length]),
    );
    // 2,000 characters; the main-cast floor lifts a few commons to uncommon.
    expect(counts.legendary).toBe(10);
    expect(counts.epic).toBe(50);
    expect(counts.rare).toBe(180);
    expect(counts.uncommon).toBeGreaterThanOrEqual(560);
    expect(parsed.calculationVersion).toBe('source-standing-v3');
  });

  it('lifts a smaller series’ leads above a hit’s deep supporting cast', () => {
    // Index 25 is the lead of "Series 0" (1,800 favourites); index 24 is the
    // hit's 25th character (about 2,000 favourites, more than that lead).
    expect(catalog.characters[24].popularity).toBeGreaterThan(catalog.characters[25].popularity);
    expect(order.indexOf(tierOf(25))).toBeGreaterThan(order.indexOf(tierOf(24)));
    // The hit's leads stay at the top.
    expect(tierOf(0)).toBe('legendary');
  });

  it('never makes main characters or a series favourite common', () => {
    catalog.characters.forEach((character, index) => {
      if (character.role === 'main') expect(tierOf(index)).not.toBe('common');
    });
    // The last, least popular series still has an uncommon lead.
    const last = catalog.characters.length - 25;
    expect(tierOf(last)).toBe('uncommon');
    expect(tierOf(catalog.characters.length - 1)).toBe('common');
  });

  it('places a later addition with the same standing rules', () => {
    const standings = characterStandings(catalog.characters);
    const scores = [...standings.values()].map((s) => s.score).sort((a, b) => b - a);
    const cohort = catalog.characters.map((c) => c.popularity).sort((a, b) => b - a);
    // A new main character of a brand-new small series is never common.
    expect(additionStanding(300, 'main', cohort, [], scores).tier).not.toBe('common');
    // A deep supporting character of the hit with few favourites is common.
    const hitCohort = catalog.characters
      .filter((c) => c.series === 'Hit Series')
      .map((c) => c.popularity)
      .sort((a, b) => b - a);
    expect(additionStanding(500, 'supporting', cohort, hitCohort, scores).tier).toBe('common');
    // Without popularity evidence a character is common, as before.
    expect(additionStanding(null, 'main', cohort, [], scores)).toEqual({
      tier: 'common',
      standing: null,
    });
  });
});

describe('draw fairness', () => {
  // Deterministic PRNG (mulberry32) so the statistical check is repeatable.
  function seeded(seed: number) {
    let state = seed >>> 0;
    return (max: number) => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
    };
  }
  const pool: Character[] = tiers.flatMap((tier) =>
    Array.from({ length: 40 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(tiers.indexOf(tier) * 100 + i).padStart(12, '0')}`,
      sourceKey: `fixture:${tier}-${i}`,
      name: `${tier} ${i}`,
      series: 'Fixture',
      categories: [],
      tier,
    })),
  );

  it('draws each tier at its displayed chance', () => {
    const odds = availableOdds(pool, defaultConfig);
    expect(odds).toEqual({
      common: 0.65,
      uncommon: 0.26,
      rare: 0.07,
      epic: 0.017,
      legendary: 0.003,
    });
    const random = seeded(20261108),
      draws = 200_000,
      counts = Object.fromEntries(tiers.map((tier) => [tier, 0])) as Record<Tier, number>;
    for (let i = 0; i < draws; i++) counts[drawPack(pool, defaultConfig, random)[0].tier]++;
    for (const tier of tiers) {
      const expected = odds[tier] * draws,
        sd = Math.sqrt(draws * odds[tier] * (1 - odds[tier]));
      // Within five standard deviations of the expected count.
      expect(Math.abs(counts[tier] - expected)).toBeLessThan(5 * sd);
    }
  });

  it('spreads odds over the tiers left when cheaper tiers are empty', () => {
    // A pack whose pool has only rare and better cards (for example after the
    // commons were claimed) can only award those tiers.
    const topOnly = pool.filter((c) => ['rare', 'epic', 'legendary'].includes(c.tier));
    const odds = availableOdds(topOnly, defaultConfig);
    expect(odds.common).toBe(0);
    expect(odds.rare).toBeCloseTo(700 / 900, 6);
    expect(odds.legendary).toBeCloseTo(30 / 900, 6);
  });
});
