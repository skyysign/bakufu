import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defaultConfig,
  defaultFameFloors,
  disabledFameFloors,
  tiers,
  type RealmConfig,
  type Tier,
} from '../../packages/config/src/index';
import {
  addRealmCharacters,
  applyTierFloors,
  bootstrap,
  createRealm,
  getRealmView,
  openPack,
  previewRealmCatalog,
  previewRealmSettings,
  previewTierFloors,
  provisionPlayer,
  realmTierAdjustments,
  setTierOverride,
  transaction,
  type Database,
} from '../../packages/db/src/index';
import { validateTierAdjustments } from '../../packages/db/src/tier-adjustments';
import { validateEconomyRebalances } from '../../packages/db/src/economy-preset';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { providerCharacterId } from '../../packages/importers/src/providers';
import { startPostgres } from '../support/postgres';

// Original fictional provider-shaped roster (no real names or provider data):
// 200 characters of 8 hit series, favourites falling from 600,000 to 3,000.
const entry = (index: number, popularity: number) => ({
  id: providerCharacterId('mal', 920000000 + index),
  sourceKey: `mal:${920000000 + index}`,
  name: `Original Ember Warden ${index}`,
  series: `Original Hit ${index % 8}`,
  categories: ['Action', '2020s'],
  popularity,
});
const roster = {
  schemaVersion: 1,
  source: 'mal',
  revision: 'original-fame-fixture',
  license: 'Original fictional provider-shaped fixture, MIT',
  characters: Array.from({ length: 200 }, (_, index) =>
    entry(index, Math.round(600_000 / (index + 1))),
  ),
};
const floorsOff: RealmConfig = { ...defaultConfig, fameFloors: disabledFameFloors };

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
let players = 0;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('tier_adjustments_test')).db;
  admin = await bootstrap(db, 'rarity-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

async function realmWith(config: RealmConfig, name: string) {
  const catalog = { data: roster, rightsConfirmed: true };
  const preview = await previewRealmCatalog(db, admin, config, catalog);
  const realm = await createRealm(db, admin, name, config, catalog, preview.fingerprint);
  return { realm, preview };
}
async function characters(realm: string) {
  return (
    await db.query(
      `SELECT id,name,tier,popularity::int AS popularity,provenance->>'tierBeforeAdjustment' AS base,
      provenance->>'tierOverride' AS override FROM characters WHERE realm_id=$1 ORDER BY popularity DESC`,
      [realm],
    )
  ).rows as {
    id: string;
    name: string;
    tier: Tier;
    popularity: number;
    base: Tier | null;
    override: Tier | null;
  }[];
}
const rank = (tier: Tier) => tiers.indexOf(tier);
const audit = () =>
  transaction(db, async (tx) => {
    await validateEconomyRebalances(tx);
    await validateTierAdjustments(tx);
  });
async function apply(realm: string, floors = defaultFameFloors) {
  const preview = await previewTierFloors(db, admin, realm, { floors });
  const requestKey = randomUUID();
  const result = await applyTierFloors(db, admin, realm, {
    floors,
    previewHash: preview.previewHash,
    requestKey,
  });
  return { preview, result, requestKey };
}

describe('fame floors and manual tiers', () => {
  it('lifts well-known characters at creation and keeps the computed tier', async () => {
    const plain = await realmWith(floorsOff, 'Floors off');
    const floored = await realmWith(defaultConfig, 'Floors on');
    const before = await characters(plain.realm),
      after = await characters(floored.realm);
    expect(before.every((c) => c.base === null)).toBe(true);
    for (const [index, character] of after.entries()) {
      const minimum: Tier | null =
        character.popularity >= 100_000
          ? 'legendary'
          : character.popularity >= 30_000
            ? 'epic'
            : character.popularity >= 10_000
              ? 'rare'
              : null;
      expect(rank(character.tier)).toBeGreaterThanOrEqual(rank(before[index].tier));
      if (minimum) expect(rank(character.tier)).toBeGreaterThanOrEqual(rank(minimum));
      expect(character.base).toBe(
        character.tier === before[index].tier ? null : before[index].tier,
      );
    }
    // The preview's counts are the tiers the realm is created with.
    for (const tier of tiers)
      expect(floored.preview.tiers[tier]).toBe(after.filter((c) => c.tier === tier).length);
    expect(after.filter((c) => c.base).length).toBeGreaterThan(0);
  });

  it('is for realm administrators only', async () => {
    const { realm } = await realmWith(floorsOff, 'Admin only');
    const player = await provisionPlayer(db, realm, `rarity-${++players}@example.test`, password);
    const character = (await characters(realm))[0];
    await expect(realmTierAdjustments(db, player, realm)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      previewTierFloors(db, player, realm, { floors: defaultFameFloors }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      applyTierFloors(db, player, realm, {
        floors: defaultFameFloors,
        previewHash: 'a'.repeat(64),
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      setTierOverride(db, player, realm, {
        characterId: character.id,
        tier: 'legendary',
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reviews, applies, replays and removes floors on an existing realm', async () => {
    const { realm } = await realmWith(floorsOff, 'Existing realm');
    const player = await provisionPlayer(db, realm, `rarity-${++players}@example.test`, password);
    const pack = (await getRealmView(db, admin, realm)).packs.find(
      (p) => p.name === 'All Characters',
    )!.id;
    const opening = await openPack(db, player, realm, pack, randomUUID());
    expect(opening.ok).toBe(true);
    const original = await characters(realm);
    const view = await realmTierAdjustments(db, admin, realm);
    expect(view.floors).toEqual(disabledFameFloors);
    expect(view.recommended).toEqual(defaultFameFloors);
    expect(view.providerCharacters).toBe(200);

    const revision = (await db.query('SELECT config_revision FROM realms WHERE id=$1', [realm]))
      .rows[0].config_revision;
    const { preview, result, requestKey } = await apply(realm);
    expect(preview.floorsChanged).toBe(true);
    expect(preview.raised).toBe(preview.changedCharacters);
    expect(preview.lowered).toBe(0);
    // Most favourited first, every listed change is a lift.
    const listed = preview.changes.map((change) => change.popularity!);
    expect(listed).toEqual([...listed].sort((a, b) => b - a));
    expect(preview.changes.every((c) => rank(c.after) > rank(c.before))).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      kind: 'floors',
      revision: revision + 1,
      changedCharacters: preview.changedCharacters,
    });
    const lifted = await characters(realm);
    expect(lifted.filter((c, i) => c.tier !== original[i].tier).length).toBe(
      preview.changedCharacters,
    );
    expect(lifted.filter((c) => c.base).length).toBe(preview.changedCharacters);
    expect((await realmTierAdjustments(db, admin, realm)).raisedByFloors).toBe(
      preview.changedCharacters,
    );
    // Pull receipts keep the tier a card was pulled at.
    const receipt = (
      await db.query("SELECT result->'characters' AS characters FROM openings WHERE realm_id=$1", [
        realm,
      ])
    ).rows[0].characters;
    expect(receipt[0].tier).toBe(original.find((c) => c.id === receipt[0].id)!.tier);

    // A lost response is retried with the same key: same result, no second change.
    await expect(
      applyTierFloors(db, admin, realm, {
        floors: defaultFameFloors,
        previewHash: preview.previewHash,
        requestKey,
      }),
    ).resolves.toEqual(result);
    await expect(
      applyTierFloors(db, admin, realm, {
        floors: defaultFameFloors,
        previewHash: 'b'.repeat(64),
        requestKey,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(apply(realm)).rejects.toMatchObject({ code: 'NO_CHANGES' });

    // A stale review is refused.
    const lower = { ...defaultFameFloors, rare: 5_000 };
    const stale = await previewTierFloors(db, admin, realm, { floors: lower });
    await setTierOverride(db, admin, realm, {
      characterId: lifted.find((c) => c.popularity < 10_000 && c.popularity >= 5_000)!.id,
      tier: 'legendary',
      requestKey: randomUUID(),
    });
    await expect(
      applyTierFloors(db, admin, realm, {
        floors: lower,
        previewHash: stale.previewHash,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });

    // Turning floors off returns everyone (except the manual tier) to the computed tier.
    const off = await apply(realm, disabledFameFloors);
    expect(off.preview.lowered).toBe(preview.changedCharacters);
    const restored = await characters(realm);
    for (const [index, character] of restored.entries())
      if (!character.override) {
        expect(character.tier).toBe(original[index].tier);
        expect(character.base).toBeNull();
      }
    await audit();
  });

  it('lets a manual tier win over floors and return to automatic', async () => {
    const { realm } = await realmWith(defaultConfig, 'Manual tiers');
    const target = (await characters(realm)).find(
      (c) => c.popularity >= 30_000 && c.popularity < 100_000,
    )!;
    expect(target.tier).toBe('epic');
    const requestKey = randomUUID();
    const set = await setTierOverride(db, admin, realm, {
      characterId: target.id,
      tier: 'common',
      requestKey,
    });
    expect(set).toMatchObject({ ok: true, kind: 'override', tier: 'common', override: 'common' });
    await expect(
      setTierOverride(db, admin, realm, { characterId: target.id, tier: 'common', requestKey }),
    ).resolves.toEqual(set);
    await expect(
      setTierOverride(db, admin, realm, { characterId: target.id, tier: 'rare', requestKey }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      setTierOverride(db, admin, realm, {
        characterId: target.id,
        tier: 'common',
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NO_CHANGES' });
    // Floors no longer move it.
    const stronger = { ...defaultFameFloors, rare: 2_000 };
    const preview = await previewTierFloors(db, admin, realm, { floors: stronger });
    expect(preview.changes.some((change) => change.characterId === target.id)).toBe(false);
    const view = await realmTierAdjustments(db, admin, realm);
    expect(view.overrides).toEqual([
      expect.objectContaining({
        characterId: target.id,
        tier: 'common',
        override: 'common',
        automaticTier: 'epic',
      }),
    ]);
    const automatic = await setTierOverride(db, admin, realm, {
      characterId: target.id,
      tier: null,
      requestKey: randomUUID(),
    });
    expect(automatic).toMatchObject({ tier: 'epic', override: null, changedCharacters: 1 });
    const saved = (await characters(realm)).find((c) => c.id === target.id)!;
    expect(saved).toMatchObject({ tier: 'epic', override: null });
    expect((await realmTierAdjustments(db, admin, realm)).history[0]).toMatchObject({
      kind: 'override',
      override: null,
      characterName: target.name,
    });
    await audit();
  });

  it('stays within tiers packs can draw', async () => {
    const config = {
      ...defaultConfig,
      tierWeights: { ...defaultConfig.tierWeights, legendary: 0 },
    };
    const { realm } = await realmWith(config, 'No legendaries');
    const list = await characters(realm);
    // Floors stop at epic: the five characters past 100,000 favourites after the top one.
    expect(list.filter((c) => c.base).every((c) => c.tier !== 'legendary')).toBe(true);
    expect(list.slice(1, 6).map((c) => c.tier)).toEqual(Array(5).fill('epic'));
    await expect(
      setTierOverride(db, admin, realm, {
        characterId: list[1].id,
        tier: 'legendary',
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' });
  });

  it('keeps floors out of the ordinary rules form', async () => {
    const { realm } = await realmWith(floorsOff, 'Rules guard');
    await expect(
      previewRealmSettings(db, admin, realm, { ...floorsOff, fameFloors: defaultFameFloors }),
    ).rejects.toMatchObject({ code: 'SETTINGS_INVALID' });
    await expect(
      previewRealmSettings(db, admin, realm, { ...floorsOff, packPrice: 250 }),
    ).resolves.toMatchObject({ revision: 1 });
  });

  it('applies floors to added characters', async () => {
    const { realm } = await realmWith(defaultConfig, 'Additions');
    const added = await addRealmCharacters(db, admin, realm, {
      characters: [
        entry(500, 45_000),
        { ...entry(501, 4_000), series: 'Original Niche Series', popularity: 4_000 },
      ],
      rightsConfirmed: true,
    });
    const famous = added.added.find((c) => c.sourceKey === `mal:${920000500}`)!;
    expect(rank(famous.tier)).toBeGreaterThanOrEqual(rank('epic'));
    const saved = (await characters(realm)).find((c) => c.id === famous.id)!;
    expect(saved.tier).toBe(famous.tier);
  });

  it('restores rarity history to a fresh database and catches tampering', async () => {
    const { realm } = await realmWith(floorsOff, 'Backup realm');
    await apply(realm);
    const target = (await characters(realm))[10];
    await setTierOverride(db, admin, realm, {
      characterId: target.id,
      tier: 'legendary',
      requestKey: randomUUID(),
    });
    await audit();
    const passphrase = randomBytes(24).toString('hex');
    const backup = await makeBackup(db, passphrase);
    const restored = (await server.database('tier_adjustments_restore')).db;
    try {
      await restoreBackup(restored, backup, passphrase);
      for (const query of [
        'SELECT jsonb_agg(to_jsonb(t) ORDER BY t.realm_id,t.id) AS data FROM tier_adjustments t',
        'SELECT jsonb_agg(jsonb_build_array(realm_id,id,tier,provenance) ORDER BY realm_id,id) AS data FROM characters',
        'SELECT jsonb_agg(jsonb_build_array(id,config,config_revision) ORDER BY id) AS data FROM realms',
      ])
        expect((await restored.query(query)).rows).toEqual((await db.query(query)).rows);
    } finally {
      await restored.end();
    }
    // A tier changed outside the journal no longer reconciles.
    const rollback = new Error('rollback');
    await expect(
      transaction(db, async (tx) => {
        await tx.query("UPDATE characters SET tier='common' WHERE realm_id=$1 AND id=$2", [
          realm,
          target.id,
        ]);
        await expect(validateTierAdjustments(tx)).rejects.toThrow(/rarity adjustments/);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    await audit();
  });
});
