import { describe, expect, it } from 'vitest';
import {
  defaultConfig,
  parseRealmConfig,
  realmConfigSchema,
  recycleNeedsConfirmation,
  withoutFameFloors,
  withoutRecycleSafeguard,
} from '../../packages/config/src/index';

describe('recycling safeguard (realm config v13)', () => {
  it('is on for new realms and protects only epic and legendary cards', () => {
    expect(defaultConfig.schemaVersion).toBe(13);
    expect(defaultConfig.recycleSafeguard).toBe(true);
    expect(recycleNeedsConfirmation(defaultConfig, 'common')).toBe(false);
    expect(recycleNeedsConfirmation(defaultConfig, 'rare')).toBe(false);
    expect(recycleNeedsConfirmation(defaultConfig, 'epic')).toBe(true);
    expect(recycleNeedsConfirmation(defaultConfig, 'legendary')).toBe(true);
    expect(
      recycleNeedsConfirmation({ ...defaultConfig, recycleSafeguard: false }, 'legendary'),
    ).toBe(false);
  });
  it('turns on for v12 realms without changing anything else, like migration 0031', () => {
    const v12 = withoutRecycleSafeguard({ ...defaultConfig, packPrice: 321 });
    expect(v12).toMatchObject({ schemaVersion: 12, packPrice: 321 });
    expect(v12).not.toHaveProperty('recycleSafeguard');
    expect(parseRealmConfig(v12)).toEqual({ ...defaultConfig, packPrice: 321 });
    // Strict: a v12 config can't carry the field, and v13 needs it.
    expect(() => parseRealmConfig({ ...v12, recycleSafeguard: false })).toThrow();
    expect(() => realmConfigSchema.parse(v12)).toThrow();
    // Older shapes still migrate through v12.
    expect(parseRealmConfig(withoutFameFloors(defaultConfig)).recycleSafeguard).toBe(true);
  });
  it('keeps an admin choice to turn it off', () => {
    const off = { ...defaultConfig, recycleSafeguard: false };
    expect(parseRealmConfig(JSON.parse(JSON.stringify(off)))).toEqual(off);
  });
});
