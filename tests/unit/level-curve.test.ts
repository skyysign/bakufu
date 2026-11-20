import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  defaultConfig,
  defaultLevelThresholds,
  legacyLevelThresholds,
  parseRealmConfig,
  parseV13RealmConfig,
  progressionSchema,
  realmConfigSchema,
} from '../../packages/config/src/index';
import { xpProgress } from '../../packages/core/src/index';

/** A realm's settings as release 0032 stored them (config v13). */
function v13(progression = defaultConfig.progression) {
  return { ...defaultConfig, schemaVersion: 13 as const, progression };
}
const legacy = { xpPerNewCharacter: 10, levelThresholds: legacyLevelThresholds };

describe('the 100-level curve (realm config v14)', () => {
  it('has 100 levels that start like the original five and grow steadily', () => {
    expect(defaultConfig.schemaVersion).toBe(14);
    expect(defaultConfig.progression.levelThresholds).toEqual(defaultLevelThresholds);
    expect(defaultLevelThresholds).toHaveLength(100);
    expect(defaultLevelThresholds.slice(0, 5)).toEqual(legacyLevelThresholds);
    expect(defaultLevelThresholds.slice(0, 12)).toEqual([
      0, 20, 40, 70, 100, 140, 180, 230, 280, 340, 400, 470,
    ]);
    // 10 XP per new character: level 10 at 34 characters, 50 at 674, 100 at 2,599.
    expect([9, 49, 99].map((index) => defaultLevelThresholds[index])).toEqual([340, 6740, 25990]);
    const steps = defaultLevelThresholds
      .slice(1)
      .map((value, i) => value - defaultLevelThresholds[i]);
    steps.forEach((step, i) => {
      expect(step).toBeGreaterThanOrEqual(steps[i - 1] ?? 0);
      expect(step % 10).toBe(0);
    });
    expect(progressionSchema.safeParse(defaultConfig.progression).success).toBe(true);
  });

  it('gives realms on the original five levels the new curve, so XP decides the level', () => {
    const upgraded = parseRealmConfig(v13(legacy));
    expect(upgraded).toEqual({
      ...defaultConfig,
      progression: { ...legacy, levelThresholds: defaultLevelThresholds },
    });
    // Players stuck at the old cap get the level their XP earned; nobody goes down.
    for (const xp of [0, 19, 20, 99, 100, 139, 140, 500, 6740, 25_989, 25_990, 1_000_000]) {
      const before = xpProgress(xp, { ...defaultConfig, progression: legacy }).level,
        after = xpProgress(xp, upgraded).level;
      expect(after).toBeGreaterThanOrEqual(before);
      if (xp < 140) expect(after).toBe(before);
    }
    expect(xpProgress(500, upgraded)).toMatchObject({ level: 12, maxLevel: 100, nextLevelAt: 540 });
    expect(xpProgress(30_000, upgraded)).toMatchObject({ level: 100, nextLevelAt: null });
    // The XP reward is kept as it was.
    const generous = parseRealmConfig(v13({ ...legacy, xpPerNewCharacter: 25 }));
    expect(generous.progression).toEqual({
      xpPerNewCharacter: 25,
      levelThresholds: defaultLevelThresholds,
    });
  });

  it('keeps levels an admin chose, before and after the update', () => {
    const custom = { xpPerNewCharacter: 10, levelThresholds: [0, 50, 500, 5000] };
    expect(parseRealmConfig(v13(custom)).progression).toEqual(custom);
    const longer = { xpPerNewCharacter: 10, levelThresholds: [...legacyLevelThresholds, 150] };
    expect(parseRealmConfig(v13(longer)).progression).toEqual(longer);
    // From v14 on, the original five levels are a deliberate choice.
    const chosen = { ...defaultConfig, progression: legacy };
    expect(parseRealmConfig(JSON.parse(JSON.stringify(chosen)))).toEqual(chosen);
  });

  it('still reads v13 settings as they were, for requests and receipts written then', () => {
    expect(parseV13RealmConfig(v13(legacy))).toEqual(v13(legacy));
    expect(parseV13RealmConfig(v13(legacy)).progression.levelThresholds).toEqual(
      legacyLevelThresholds,
    );
    expect(() => realmConfigSchema.parse(v13())).toThrow();
    expect(() => parseRealmConfig({ ...defaultConfig, schemaVersion: 15 })).toThrow();
  });

  it('matches migration 0033, which applies the same curve to stored realms', () => {
    const sql = readFileSync('packages/db/migrations/0033_level_curve.sql', 'utf8');
    const curve = sql.match(/'\{progression,levelThresholds\}','(\[[0-9,]+\])'/)?.[1];
    expect(curve && JSON.parse(curve)).toEqual(defaultLevelThresholds);
    expect(sql).toContain(`='[0,20,40,70,100]'::jsonb`);
    expect(sql).toContain(`config->>'schemaVersion'='14'`);
  });
});
