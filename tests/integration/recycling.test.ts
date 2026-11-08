import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRealmConfig, type RealmConfig } from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import {
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  parsePlayerArchive,
  provisionPlayer,
  recycleCard,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { startPostgres } from '../support/postgres';
import {
  installLegacySchema,
  seedLegacyRealm,
  legacyConfig,
  withoutTradeArchiveFields,
} from '../support/legacy';

let postgres: Awaited<ReturnType<typeof startPostgres>>;
let db: Database;
let admin: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  postgres = await startPostgres();
  db = (await postgres.database('recycling_test')).db;
  admin = await bootstrap(db, 'recycler@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await postgres?.stop();
});

async function realm(config: RealmConfig = defaultConfig, single = true) {
  const id = await createRealm(db, admin, 'Recycling realm', config);
  const pack = (await getRealmView(db, admin, id)).packs.find((p) => p.name === 'All Characters')!;
  if (single)
    await db.query('DELETE FROM characters WHERE realm_id=$1 AND source_key != $2', [
      id,
      'lantern-demo:ro',
    ]);
  return { id, packId: pack.id };
}
async function claim(realmId: string, packId: string, actor = admin, key = randomUUID()) {
  const opening = await openPack(db, actor, realmId, packId, key);
  if (!opening.ok) throw new Error(`Fixture opening failed: ${opening.code}`);
  return opening;
}

describe('transactional recycling', () => {
  it('replays simultaneous retries with one reward and preserves cooldown and history', async () => {
    const r = await realm({ ...defaultConfig, cooldownSeconds: 60 });
    const card = (await claim(r.id, r.packId)).cardIds[0],
      key = randomUUID();
    const before = (
      await db.query('SELECT last_opened_at FROM memberships WHERE realm_id=$1', [r.id])
    ).rows;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => recycleCard(db, admin, r.id, card, key)),
    );
    results.forEach((result) => expect(result).toEqual(results[0]));
    expect(results[0]).toMatchObject({ credited: 2, balance: 92, cardId: card });
    expect((await getRealmView(db, admin, r.id)).cards).toHaveLength(0);
    expect(
      (await db.query('SELECT last_opened_at FROM memberships WHERE realm_id=$1', [r.id])).rows,
    ).toEqual(before);
    expect(
      (await db.query('SELECT recycled_at FROM cards WHERE realm_id=$1 AND id=$2', [r.id, card]))
        .rows[0].recycled_at,
    ).toBeInstanceOf(Date);
    expect(
      (
        await db.query("SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND reason='recycling'", [
          r.id,
        ])
      ).rowCount,
    ).toBe(1);
    expect((await db.query('SELECT 1 FROM recyclings WHERE realm_id=$1', [r.id])).rowCount).toBe(1);
    expect(await openPack(db, admin, r.id, r.packId, randomUUID())).toMatchObject({
      code: 'COOLDOWN',
    });
    expect((await getRealmView(db, admin, r.id)).balance).toBe(92);
  });
  it('credits only one of two different concurrent requests for the same card', async () => {
    const r = await realm(),
      card = (await claim(r.id, r.packId)).cardIds[0];
    const results = await Promise.allSettled([
      recycleCard(db, admin, r.id, card, randomUUID()),
      recycleCard(db, admin, r.id, card, randomUUID()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'CARD_UNAVAILABLE' },
    });
    expect((await getRealmView(db, admin, r.id)).balance).toBe(92);
    const retired = (await db.query('SELECT * FROM recyclings WHERE realm_id=$1', [r.id])).rows[0];
    await expect(
      db.query(
        'INSERT INTO recyclings(realm_id,account_id,request_key,id,card_id,result,config_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [r.id, admin, randomUUID(), randomUUID(), card, retired.result, retired.config_snapshot],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('releases a character for another player and leaves the new claim intact when replaying an old recycle', async () => {
    const r = await realm();
    const player = await provisionPlayer(db, r.id, 'reclaim@example.test', password);
    const first = await claim(r.id, r.packId),
      key = randomUUID();
    const receipt = await recycleCard(db, admin, r.id, first.cardIds[0], key);
    expect(
      (await getRealmView(db, admin, r.id)).packs.find((p) => p.id === r.packId)?.available,
    ).toBe(1);
    const second = await claim(r.id, r.packId, player);
    expect(second.characters[0].id).toBe(first.characters[0].id);
    expect(second.cardIds[0]).not.toBe(first.cardIds[0]);
    expect(await recycleCard(db, admin, r.id, first.cardIds[0], key)).toEqual(receipt);
    await expect(
      recycleCard(db, admin, r.id, first.cardIds[0], randomUUID()),
    ).rejects.toMatchObject({ code: 'CARD_UNAVAILABLE' });
    expect((await getRealmView(db, player, r.id)).cards[0].cardId).toBe(second.cardIds[0]);
    expect(
      (await db.query('SELECT 1 FROM cards WHERE realm_id=$1 AND recycled_at IS NULL', [r.id]))
        .rowCount,
    ).toBe(1);
    expect((await db.query('SELECT 1 FROM cards WHERE realm_id=$1', [r.id])).rowCount).toBe(2);
    await expect(
      db.query(
        'INSERT INTO cards(realm_id,id,character_id,owner_id,request_key) SELECT realm_id,$1,character_id,owner_id,request_key FROM cards WHERE id=$2',
        [randomUUID(), second.cardIds[0]],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('rejects another owner, a nonmember, and a card ID from another realm without changing state', async () => {
    const a = await realm(),
      b = await realm();
    const player = await provisionPlayer(db, a.id, 'owner@example.test', password);
    const card = (await claim(a.id, a.packId, player)).cardIds[0];
    await expect(recycleCard(db, admin, a.id, card, randomUUID())).rejects.toMatchObject({
      code: 'CARD_UNAVAILABLE',
    });
    await expect(recycleCard(db, randomUUID(), a.id, card, randomUUID())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(recycleCard(db, admin, b.id, card, randomUUID())).rejects.toMatchObject({
      code: 'CARD_UNAVAILABLE',
    });
    expect((await getRealmView(db, player, a.id)).cards).toHaveLength(1);
    expect(
      (await db.query('SELECT 1 FROM recyclings WHERE realm_id=ANY($1::uuid[])', [[a.id, b.id]]))
        .rowCount,
    ).toBe(0);
  });
  it('binds a recycle key to its card and namespaces it separately from pack-opening keys', async () => {
    const r = await realm(defaultConfig, false),
      key = randomUUID();
    const a = await claim(r.id, r.packId, admin, key),
      b = await claim(r.id, r.packId);
    const result = await recycleCard(db, admin, r.id, a.cardIds[0], key);
    expect(result.ok).toBe(true);
    await expect(recycleCard(db, admin, r.id, b.cardIds[0], key)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect((await getRealmView(db, admin, r.id)).cards.map((c) => c.cardId)).toEqual([
      b.cardIds[0],
    ]);
    expect(
      (
        await db.query(
          'SELECT operation_key FROM wallet_ledger WHERE realm_id=$1 ORDER BY operation_key',
          [r.id],
        )
      ).rows.map((row) => row.operation_key),
    ).toContain(`recycle:${key}`);
  });
  it('rolls retirement, credit, and receipt back together after a late database failure', async () => {
    const r = await realm(),
      card = (await claim(r.id, r.packId)).cardIds[0],
      key = randomUUID();
    await db.query(
      "CREATE FUNCTION test_abort_recycling() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected recycling rollback'; END $$",
    );
    await db.query(
      "CREATE TRIGGER test_abort_recycle BEFORE INSERT ON wallet_ledger FOR EACH ROW WHEN (NEW.reason='recycling') EXECUTE FUNCTION test_abort_recycling()",
    );
    try {
      await expect(recycleCard(db, admin, r.id, card, key)).rejects.toThrow(
        'injected recycling rollback',
      );
    } finally {
      await db.query('DROP TRIGGER test_abort_recycle ON wallet_ledger');
      await db.query('DROP FUNCTION test_abort_recycling()');
    }
    expect((await getRealmView(db, admin, r.id)).balance).toBe(90);
    expect((await getRealmView(db, admin, r.id)).cards).toHaveLength(1);
    expect((await db.query('SELECT 1 FROM recyclings WHERE realm_id=$1', [r.id])).rowCount).toBe(0);
    expect((await recycleCard(db, admin, r.id, card, key)).balance).toBe(92);
  });
  it('uses configured and zero rewards, and rejects wallet overflow without retiring the card', async () => {
    for (const reward of [0, 7]) {
      const r = await realm({
        ...defaultConfig,
        recycleRewards: { ...defaultConfig.recycleRewards, common: reward, uncommon: 4, rare: 6 },
      });
      const card = (await claim(r.id, r.packId)).cardIds[0];
      expect(await recycleCard(db, admin, r.id, card, randomUUID())).toMatchObject({
        credited: reward,
        balance: 90 + reward,
      });
    }
    const r = await realm({ ...defaultConfig, packPrice: 0 });
    await db.query('UPDATE memberships SET balance=2147483647 WHERE realm_id=$1', [r.id]);
    await db.query(
      "UPDATE wallet_ledger SET amount=2147483647,balance_after=2147483647 WHERE realm_id=$1 AND reason='starting_grant'",
      [r.id],
    );
    const card = (await claim(r.id, r.packId)).cardIds[0];
    await expect(recycleCard(db, admin, r.id, card, randomUUID())).rejects.toMatchObject({
      code: 'WALLET_LIMIT',
    });
    expect((await getRealmView(db, admin, r.id)).cards).toHaveLength(1);
    expect((await db.query('SELECT 1 FROM recyclings WHERE realm_id=$1', [r.id])).rowCount).toBe(0);
  });
  it('serializes opening against recycling and never creates two active owners', async () => {
    const r = await realm(),
      first = await claim(r.id, r.packId);
    const results = await Promise.all([
      recycleCard(db, admin, r.id, first.cardIds[0], randomUUID()),
      openPack(db, admin, r.id, r.packId, randomUUID()),
    ]);
    expect(results[0].ok).toBe(true);
    if (!results[1].ok) await claim(r.id, r.packId);
    expect((await getRealmView(db, admin, r.id)).balance).toBe(82);
    expect(
      (await db.query('SELECT 1 FROM cards WHERE realm_id=$1 AND recycled_at IS NULL', [r.id]))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await db.query("SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND reason='recycling'", [
          r.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it('keeps the same character and recycling rewards independent across realms', async () => {
    const a = await realm(),
      b = await realm();
    const first = await claim(a.id, a.packId),
      second = await claim(b.id, b.packId);
    await recycleCard(db, admin, a.id, first.cardIds[0], randomUUID());
    expect((await getRealmView(db, admin, b.id)).cards[0].cardId).toBe(second.cardIds[0]);
    expect((await getRealmView(db, admin, b.id)).balance).toBe(90);
    expect((await getRealmView(db, admin, a.id)).balance).toBe(92);
  });
  it('exports versioned personal recycling history and restores receipts into a fresh database', async () => {
    const r = await realm(),
      first = await claim(r.id, r.packId),
      key = randomUUID();
    const receipt = await recycleCard(db, admin, r.id, first.cardIds[0], key);
    await claim(r.id, r.packId);
    const archive = await exportPlayer(db, admin, r.id);
    expect(archive.schemaVersion).toBe(12);
    expect(archive.cards).toHaveLength(1);
    expect(archive.recyclings[0]).toMatchObject({
      cardId: first.cardIds[0],
      characterId: first.characters[0].id,
      credited: 2,
    });
    expect(parsePlayerArchive(JSON.parse(JSON.stringify(archive)))).toEqual(archive);
    expect(JSON.stringify(archive)).not.toMatch(/password|email|token|account_identities/);
    const v1 = withoutTradeArchiveFields({ ...archive, schemaVersion: 1 });
    delete v1.recyclings;
    delete v1.xpLedger;
    delete v1.progression;
    delete v1.basePackPrice;
    delete v1.upgradeRules;
    delete v1.wishlistRules;
    const legacyArchive = withoutTradeArchiveFields({
      ...archive,
      schemaVersion: 2,
      recyclings: [],
    });
    delete legacyArchive.xpLedger;
    delete legacyArchive.progression;
    delete legacyArchive.basePackPrice;
    delete legacyArchive.upgradeRules;
    delete legacyArchive.wishlistRules;
    expect(parsePlayerArchive(v1)).toEqual(legacyArchive);
    const passphrase = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, passphrase);
    const restored = (await postgres.database('recycling_restore')).db;
    try {
      await restoreBackup(restored, backup, passphrase);
      expect(await recycleCard(restored, admin, r.id, first.cardIds[0], key)).toEqual(receipt);
      const copy = await exportPlayer(restored, admin, r.id);
      expect({ ...copy, exportedAt: archive.exportedAt }).toEqual(archive);
      for (const table of ['cards', 'recyclings', 'wallet_ledger']) {
        const query = `SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t`;
        expect((await restored.query(query)).rows).toEqual((await db.query(query)).rows);
      }
      expect((await getRealmView(restored, admin, r.id)).cards).toHaveLength(1);
    } finally {
      await restored.end();
    }
  });
  it('upgrades a populated v1-config database without resetting IDs, balances, or receipts', async () => {
    const legacy = (await postgres.database('recycling_upgrade', false)).db;
    try {
      await installLegacySchema(legacy, 2);
      const actor = await bootstrap(legacy, 'upgrade@example.test', password);
      const customized = { ...legacyConfig, packPrice: 7, startingGems: 42, minimumPoolSize: 3 };
      const old = await seedLegacyRealm(legacy, actor, customized);
      await migrate(legacy);
      await migrate(legacy);
      const upgraded = (await legacy.query('SELECT config FROM realms WHERE id=$1', [old.realmId]))
        .rows[0].config;
      expect(upgraded).toEqual(parseRealmConfig(customized));
      expect((await getRealmView(legacy, actor, old.realmId)).balance).toBe(35);
      expect((await getRealmView(legacy, actor, old.realmId)).cards[0].cardId).toBe(old.cardId);
      expect(await openPack(legacy, actor, old.realmId, old.packId, old.requestKey)).toEqual(
        old.result,
      );
      expect(
        (await recycleCard(legacy, actor, old.realmId, old.cardId, randomUUID())).balance,
      ).toBe(37);
      const next = await openPack(legacy, actor, old.realmId, old.packId, randomUUID());
      expect(next.ok).toBe(true);
      if (next.ok) expect(next.cardIds[0]).not.toBe(old.cardId);
    } finally {
      await legacy.end();
    }
  });
  it('restores pre-recycling backups from both earlier schema revisions into the current schema', async () => {
    for (const version of [1, 2] as const) {
      const source = (
        await postgres.database(version === 1 ? 'snapshot_one' : 'snapshot_two', false)
      ).db;
      const target = (await postgres.database(version === 1 ? 'restore_one' : 'restore_two')).db;
      try {
        await installLegacySchema(source, version);
        const actor = await bootstrap(source, 'old-backup@example.test', password);
        const previous = await seedLegacyRealm(source, actor);
        const passphrase = randomBytes(24).toString('hex');
        const backup = await makeBackup(source, passphrase);
        await restoreBackup(target, backup, passphrase);
        const view = await getRealmView(target, actor, previous.realmId);
        expect(view.config).toEqual(parseRealmConfig(legacyConfig));
        expect(view.balance).toBe(90);
        expect(view.cards[0].cardId).toBe(previous.cardId);
        expect(
          await openPack(target, actor, previous.realmId, previous.packId, previous.requestKey),
        ).toEqual(previous.result);
        expect(
          (await recycleCard(target, actor, previous.realmId, previous.cardId, randomUUID()))
            .balance,
        ).toBe(92);
      } finally {
        await source.end();
        await target.end();
      }
    }
  });
  it('rejects inconsistent recycling history and rolls the entire restore back', async () => {
    const r = await realm(),
      first = await claim(r.id, r.packId);
    const receipt = await recycleCard(db, admin, r.id, first.cardIds[0], randomUUID());
    const passphrase = randomBytes(24).toString('hex');
    let backup: string;
    await db.query(
      "UPDATE recyclings SET result=jsonb_set(result,'{credited}','999') WHERE id=$1",
      [receipt.recyclingId],
    );
    try {
      backup = await makeBackup(db, passphrase);
    } finally {
      await db.query('UPDATE recyclings SET result=$2 WHERE id=$1', [receipt.recyclingId, receipt]);
    }
    const restored = (await postgres.database('invalid_recycling_restore')).db;
    try {
      await expect(restoreBackup(restored, backup!, passphrase)).rejects.toThrow(
        'recycling history does not reconcile',
      );
      expect((await restored.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
      expect((await restored.query('SELECT 1 FROM cards')).rowCount).toBe(0);
    } finally {
      await restored.end();
    }
  });
});
