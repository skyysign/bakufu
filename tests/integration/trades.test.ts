import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  disabledCollectorRanks,
  disabledGemRewards,
  disabledFameFloors,
  type RealmConfig,
} from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import {
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  openPack,
  provisionPlayer,
  recycleCard,
  tradeCommand,
  previewRealmSettings,
  applyRealmSettings,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';
import { installLegacySchema, seedLegacyRealm } from '../support/legacy';
import { migrate } from '../../packages/db/src/migrate';
let postgres: Awaited<ReturnType<typeof startPostgres>>, db: Database, a: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  postgres = await startPostgres();
  db = (await postgres.database('trading_test')).db;
  a = await bootstrap(db, 'trade-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await postgres?.stop();
});
async function setup(config: RealmConfig = defaultConfig) {
  const id = await createRealm(db, a, 'Trading fixture', config);
  const b = await provisionPlayer(db, id, 'trade-player@example.test', password);
  const pack = (await getRealmView(db, a, id)).packs.find((p) => p.name === 'All Characters')!.id;
  const first = await openPack(db, a, id, pack, randomUUID()),
    second = await openPack(db, b, id, pack, randomUUID());
  if (!first.ok || !second.ok) throw new Error('Fixture draw failed.');
  const av = await getRealmView(db, a, id),
    bv = await getRealmView(db, b, id);
  return { id, b, pack, ac: av.cards[0].cardId, bc: bv.cards[0].cardId, code: bv.tradeCode };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const call = (r: Fixture, actor: string, command: unknown, key = randomUUID(), revision?: number) =>
  tradeCommand(db, actor, r.id, command, key, revision);
const create = (r: Fixture, gems = 5, key = randomUUID()) =>
  call(r, a, { action: 'create', counterpartyCode: r.code, offer: { cardIds: [r.ac], gems } }, key);
const act = (
  r: Fixture,
  actor: string,
  id: string,
  action: 'confirm' | 'cancel',
  version = 1,
  key = randomUUID(),
) => call(r, actor, { action, tradeId: id, version }, key);
const edit = (
  r: Fixture,
  actor: string,
  id: string,
  version: number,
  cardIds: string[],
  gems = 0,
) => call(r, actor, { action: 'edit', tradeId: id, version, offer: { cardIds, gems } });
async function complete(r: Fixture) {
  const t = await create(r);
  await edit(r, r.b, t.tradeId, 1, [r.bc], 2);
  await act(r, a, t.tradeId, 'confirm', 2);
  await act(r, r.b, t.tradeId, 'confirm', 2);
  return t;
}
describe('atomic two-party trading', () => {
  it('reserves cards without moving assets and keeps the view private', async () => {
    const r = await setup(),
      t = await create(r),
      view = await getRealmView(db, r.b, r.id);
    expect(view.balance).toBe(90);
    expect(view.trades[0]).toMatchObject({
      id: t.tradeId,
      status: 'pending',
      myConfirmed: false,
      theirConfirmed: false,
      myOffer: { cards: [], gems: 0 },
      theirOffer: { gems: 5 },
    });
    expect(JSON.stringify(view.trades)).not.toMatch(/accountId|owner_id|email|password/);
    expect(JSON.stringify(view.trades)).not.toContain(r.bc);
    expect((await getRealmView(db, a, r.id)).cards[0].lockedForTrade).toBe(true);
    expect(
      (await db.query('SELECT 1 FROM card_transfers WHERE realm_id=$1', [r.id])).rowCount,
    ).toBe(0);
  });
  it('atomically swaps stable card IDs and net gems after both confirmations, preserving origin and XP', async () => {
    const r = await setup();
    await complete(r);
    const av = await getRealmView(db, a, r.id),
      bv = await getRealmView(db, r.b, r.id);
    expect(av.balance).toBe(87);
    expect(bv.balance).toBe(93);
    expect(av.cards.map((c) => c.cardId)).toEqual([r.bc]);
    expect(bv.cards.map((c) => c.cardId)).toEqual([r.ac]);
    expect(av.progression.totalXp).toBe(10);
    expect(bv.progression.totalXp).toBe(10);
    expect(
      (
        await db.query('SELECT original_owner_id,owner_id FROM cards WHERE realm_id=$1 AND id=$2', [
          r.id,
          r.ac,
        ])
      ).rows[0],
    ).toEqual({ original_owner_id: a, owner_id: r.b });
    expect(
      (
        await db.query(
          "SELECT count(*)::integer n,sum(amount)::integer amount FROM wallet_ledger WHERE realm_id=$1 AND reason='trade'",
          [r.id],
        )
      ).rows[0],
    ).toEqual({ n: 2, amount: 0 });
    expect(
      (
        await db.query(
          "SELECT count(*)::integer n,sum(amount)::integer amount FROM xp_ledger WHERE realm_id=$1 AND reason='trade_collection'",
          [r.id],
        )
      ).rows[0],
    ).toEqual({ n: 2, amount: 0 });
  });
  it('resets both confirmations on edit and rejects stale offer versions', async () => {
    const r = await setup(),
      t = await create(r);
    await act(r, a, t.tradeId, 'confirm');
    await edit(r, r.b, t.tradeId, 1, [r.bc]);
    expect((await getRealmView(db, a, r.id)).trades[0]).toMatchObject({
      version: 2,
      myConfirmed: false,
      theirConfirmed: false,
    });
    await expect(act(r, r.b, t.tradeId, 'confirm')).rejects.toMatchObject({
      code: 'TRADE_CHANGED',
    });
    await act(r, r.b, t.tradeId, 'confirm', 2);
    expect((await getRealmView(db, a, r.id)).cards[0].cardId).toBe(r.ac);
    expect(await act(r, a, t.tradeId, 'confirm', 2)).toMatchObject({ status: 'completed' });
  });
  it('deduplicates concurrent requests and rejects competing reservations', async () => {
    const r = await setup(),
      key = randomUUID();
    const results = await Promise.all([create(r, 5, key), create(r, 5, key)]);
    expect(results[0]).toEqual(results[1]);
    await expect(create(r)).rejects.toMatchObject({ code: 'CARD_LOCKED' });
    await expect(create(r, 6, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const id = results[0].tradeId,
      confirmKey = randomUUID();
    await act(r, a, id, 'confirm');
    const finished = await Promise.all([
      act(r, r.b, id, 'confirm', 1, confirmKey),
      act(r, r.b, id, 'confirm', 1, confirmKey),
    ]);
    expect(finished[0]).toEqual(finished[1]);
    expect(finished[0].status).toBe('completed');
    expect(await create(r, 5, key)).toEqual(results[0]);
    expect(
      (await db.query('SELECT 1 FROM card_transfers WHERE realm_id=$1', [r.id])).rowCount,
    ).toBe(1);
  });
  it('enforces participant, ownership, and realm scope on the server', async () => {
    const r = await setup(),
      t = await create(r),
      other = await provisionPlayer(db, r.id, 'trade-outsider@example.test', password),
      another = await setup();
    await expect(act(r, other, t.tradeId, 'cancel')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(edit(r, r.b, t.tradeId, 1, [r.ac])).rejects.toMatchObject({
      code: 'CARD_UNAVAILABLE',
    });
    await expect(
      call(r, a, {
        action: 'create',
        counterpartyCode: another.code,
        offer: { cardIds: [], gems: 1 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARTNER' });
    await expect(
      call(r, a, {
        action: 'create',
        counterpartyCode: (await getRealmView(db, a, r.id)).tradeCode,
        offer: { cardIds: [], gems: 1 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARTNER' });
    expect((await getRealmView(db, other, r.id)).trades).toEqual([]);
  });
  it('prevents recycling reserved cards and serializes recycling against creation', async () => {
    const r = await setup();
    const results = await Promise.allSettled([
      create(r),
      recycleCard(db, a, r.id, r.ac, randomUUID()),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const r2 = await setup();
    await create(r2);
    await expect(recycleCard(db, a, r2.id, r2.ac, randomUUID())).rejects.toMatchObject({
      code: 'CARD_LOCKED',
    });
  });
  it('cancels from either side, releases cards, and replays cancellation without touching a newer trade', async () => {
    const r = await setup(),
      t = await create(r),
      key = randomUUID();
    const cancelled = await act(r, r.b, t.tradeId, 'cancel', 1, key);
    const next = await create(r);
    expect(await act(r, r.b, t.tradeId, 'cancel', 1, key)).toEqual(cancelled);
    expect((await getRealmView(db, a, r.id)).cards[0].lockedForTrade).toBe(true);
    await expect(act(r, a, t.tradeId, 'confirm')).rejects.toMatchObject({ code: 'TRADE_CLOSED' });
    await act(r, a, next.tradeId, 'cancel');
  });
  it('expires without a scheduler and releases locks on the next mutation', async () => {
    const r = await setup(),
      t = await create(r);
    await db.query(
      "UPDATE trades SET expires_at=clock_timestamp()-interval '1 second' WHERE realm_id=$1 AND id=$2",
      [r.id, t.tradeId],
    );
    const view = await getRealmView(db, a, r.id);
    expect(view.trades[0].status).toBe('expired');
    expect(view.cards[0].lockedForTrade).toBe(false);
    await recycleCard(db, a, r.id, r.ac, randomUUID());
    expect(
      (await db.query('SELECT status FROM trades WHERE realm_id=$1 AND id=$2', [r.id, t.tradeId]))
        .rows[0].status,
    ).toBe('expired');
  });
  it('enforces pending limits and retains creation rules after live settings disable new trades', async () => {
    const config = {
      ...defaultConfig,
      trading: { ...defaultConfig.trading, maxPendingPerPlayer: 1 },
    };
    const r = await setup(config),
      t = await create(r);
    await expect(
      call(r, r.b, {
        action: 'create',
        counterpartyCode: (await getRealmView(db, a, r.id)).tradeCode,
        offer: { cardIds: [], gems: 1 },
      }),
    ).rejects.toMatchObject({ code: 'TRADE_LIMIT' });
    const preview = await previewRealmSettings(db, a, r.id, {
      ...config,
      trading: { ...config.trading, enabled: false, maxCardsPerSide: 1 },
    });
    expect(preview.impact.pendingTrades).toBe(1);
    await applyRealmSettings(db, a, r.id, preview.id, randomUUID());
    const extra = await openPack(db, r.b, r.id, r.pack, randomUUID());
    if (!extra.ok) throw new Error('Fixture');
    const cards = (await getRealmView(db, r.b, r.id)).cards.map((c) => c.cardId);
    await edit(r, r.b, t.tradeId, 1, cards);
    await act(r, a, t.tradeId, 'confirm', 2);
    await act(r, r.b, t.tradeId, 'confirm', 2);
    await expect(create(r)).rejects.toMatchObject({ code: 'TRADING_DISABLED' });
  });
  it('checks current balances at completion without committing the second confirmation on failure', async () => {
    const r = await setup(),
      t = await create(r, 80);
    await act(r, a, t.tradeId, 'confirm');
    await openPack(db, a, r.id, r.pack, randomUUID());
    await openPack(db, a, r.id, r.pack, randomUUID());
    await expect(act(r, r.b, t.tradeId, 'confirm')).rejects.toMatchObject({
      code: 'INSUFFICIENT_GEMS',
    });
    expect((await getRealmView(db, r.b, r.id)).trades[0].myConfirmed).toBe(false);
    expect(
      (await db.query('SELECT 1 FROM card_transfers WHERE realm_id=$1', [r.id])).rowCount,
    ).toBe(0);
    await edit(r, a, t.tradeId, 1, [r.ac], 60);
    await act(r, a, t.tradeId, 'confirm', 2);
    await act(r, r.b, t.tradeId, 'confirm', 2);
    expect((await getRealmView(db, a, r.id)).balance).toBe(10);
  });
  it('rolls back transfers, wallets, XP, and confirmations after a late database failure', async () => {
    const r = await setup(),
      t = await create(r),
      key = randomUUID();
    await act(r, a, t.tradeId, 'confirm');
    await db.query(
      `CREATE FUNCTION reject_trade_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_key='${key}' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_trade_fixture BEFORE INSERT ON trade_requests FOR EACH ROW EXECUTE FUNCTION reject_trade_fixture()`,
    );
    try {
      await expect(act(r, r.b, t.tradeId, 'confirm', 1, key)).rejects.toThrow('fixture');
    } finally {
      await db.query(
        'DROP TRIGGER reject_trade_fixture ON trade_requests; DROP FUNCTION reject_trade_fixture()',
      );
    }
    expect((await getRealmView(db, a, r.id)).balance).toBe(90);
    expect((await getRealmView(db, r.b, r.id)).trades[0].myConfirmed).toBe(false);
    expect(
      (await db.query('SELECT 1 FROM card_transfers WHERE realm_id=$1', [r.id])).rowCount,
    ).toBe(0);
    expect(await act(r, r.b, t.tradeId, 'confirm', 1, key)).toMatchObject({ status: 'completed' });
  });
  it('preserves ownership provenance across a return trade and exports the latest receipt time', async () => {
    const r = await setup();
    await complete(r);
    const code = (await getRealmView(db, a, r.id)).tradeCode;
    const t = await call(r, r.b, {
      action: 'create',
      counterpartyCode: code,
      offer: { cardIds: [r.ac], gems: 0 },
    });
    await act(r, r.b, t.tradeId, 'confirm');
    await act(r, a, t.tradeId, 'confirm');
    const archive = await exportPlayer(db, a, r.id);
    expect(archive.schemaVersion).toBe(12);
    expect(archive.cards.find((c) => c.cardId === r.ac)?.receivedAt).not.toBeNull();
    expect(
      (
        await db.query(
          'SELECT sequence,from_id,to_id FROM card_transfers WHERE realm_id=$1 AND card_id=$2 ORDER BY sequence',
          [r.id, r.ac],
        )
      ).rows,
    ).toEqual([
      { sequence: 1, from_id: a, to_id: r.b },
      { sequence: 2, from_id: r.b, to_id: a },
    ]);
    await expect(
      db.query('UPDATE cards SET original_owner_id=$3 WHERE realm_id=$1 AND id=$2', [
        r.id,
        r.ac,
        r.b,
      ]),
    ).rejects.toThrow('immutable');
  });
  it('round trips current owners, offers, confirmations, transfer history, and replay receipts through a fresh database', async () => {
    const r = await setup();
    await complete(r);
    const r2 = await setup(),
      t = await create(r2),
      key = randomUUID();
    const receipt = await act(r2, a, t.tradeId, 'confirm', 1, key);
    const before = await exportPlayer(db, a, r.id),
      pending = await exportPlayer(db, a, r2.id);
    const encrypted = await makeBackup(db, password),
      target = (await postgres.database('trading_restored')).db;
    try {
      await restoreBackup(target, encrypted, password);
      const after = await exportPlayer(target, a, r.id),
        afterPending = await exportPlayer(target, a, r2.id);
      expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
      expect({ ...afterPending, exportedAt: pending.exportedAt }).toEqual(pending);
      expect(
        await tradeCommand(
          target,
          a,
          r2.id,
          { action: 'confirm', tradeId: t.tradeId, version: 1 },
          key,
        ),
      ).toEqual(receipt);
    } finally {
      await target.end();
    }
  });
  it('does not award XP after recycling and reclaiming a received character', async () => {
    const r = await setup({ ...defaultConfig, minimumPoolSize: 1 }),
      t = await create(r, 0);
    await act(r, a, t.tradeId, 'confirm');
    await act(r, r.b, t.tradeId, 'confirm');
    const character = (
      await db.query('SELECT character_id FROM cards WHERE realm_id=$1 AND id=$2', [r.id, r.ac])
    ).rows[0].character_id;
    await recycleCard(db, r.b, r.id, r.ac, randomUUID());
    await db.query(
      "UPDATE characters SET categories=ARRAY['trade-fixture-only'] WHERE realm_id=$1 AND id=$2",
      [r.id, character],
    );
    await db.query("UPDATE packs SET category='trade-fixture-only' WHERE realm_id=$1 AND id=$2", [
      r.id,
      r.pack,
    ]);
    const result = await openPack(db, r.b, r.id, r.pack, randomUUID());
    expect(result).toMatchObject({ ok: true, progression: { xpAwarded: 0, totalXp: 10 } });
  });
  it('rejects wallet overflow before any transfer', async () => {
    const r = await setup(),
      t = await create(r, 1);
    await db.query(
      'UPDATE memberships SET balance=2147483647 WHERE realm_id=$1 AND account_id=$2',
      [r.id, r.b],
    );
    try {
      await expect(act(r, a, t.tradeId, 'confirm')).rejects.toMatchObject({ code: 'WALLET_LIMIT' });
    } finally {
      await db.query('UPDATE memberships SET balance=90 WHERE realm_id=$1 AND account_id=$2', [
        r.id,
        r.b,
      ]);
    }
    expect((await getRealmView(db, a, r.id)).trades[0].myConfirmed).toBe(false);
  });
  it('rejects a broken ownership journal and restores nothing', async () => {
    const r = await setup();
    await complete(r);
    const target = (await postgres.database('trading_corrupt')).db;
    try {
      let encrypted: string;
      await db.query('UPDATE cards SET owner_id=$3 WHERE realm_id=$1 AND id=$2', [r.id, r.ac, a]);
      try {
        encrypted = await makeBackup(db, password);
      } finally {
        await db.query('UPDATE cards SET owner_id=$3 WHERE realm_id=$1 AND id=$2', [
          r.id,
          r.ac,
          r.b,
        ]);
      }
      await expect(restoreBackup(target, encrypted!, password)).rejects.toThrow(
        'trade history does not reconcile',
      );
      expect((await target.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    } finally {
      await target.end();
    }
  });
  it('rejects stale configuration, replays committed requests first, and permits cancellation after a rules change', async () => {
    const r = await setup(),
      key = randomUUID(),
      t = await create(r, 5, key);
    const p = await previewRealmSettings(db, a, r.id, { ...defaultConfig, packPrice: 12 });
    await applyRealmSettings(db, a, r.id, p.id, randomUUID());
    const command = { action: 'confirm', tradeId: t.tradeId, version: 1 };
    await expect(call(r, a, command, randomUUID(), 1)).rejects.toMatchObject({
      code: 'SETTINGS_CHANGED',
    });
    expect((await getRealmView(db, a, r.id)).trades[0].myConfirmed).toBe(false);
    expect(
      await call(
        r,
        a,
        { action: 'create', counterpartyCode: r.code, offer: { cardIds: [r.ac], gems: 5 } },
        key,
        1,
      ),
    ).toEqual(t);
    expect(
      await call(r, r.b, { action: 'cancel', tradeId: t.tradeId, version: 1 }, randomUUID(), 1),
    ).toMatchObject({ status: 'cancelled' });
    expect((await getRealmView(db, a, r.id)).cards[0].lockedForTrade).toBe(false);
  });
  it('migrates and restores settings-era history without rewriting old audit snapshots', async () => {
    const source = (await postgres.database('trading_legacy', false)).db,
      target = (await postgres.database('trading_legacy_restored')).db;
    try {
      await installLegacySchema(source, 7);
      const actor = await bootstrap(source, 'trade-legacy@example.test', password),
        r = await seedLegacyRealm(source, actor);
      const before = (await source.query('SELECT config FROM realms WHERE id=$1', [r.realmId]))
        .rows[0].config;
      const after = { ...before, packPrice: 12 },
        previewId = randomUUID(),
        requestKey = randomUUID(),
        changeId = randomUUID(),
        appliedAt = new Date();
      await source.query('UPDATE realms SET config=$2,config_revision=2 WHERE id=$1', [
        r.realmId,
        after,
      ]);
      await source.query(
        `INSERT INTO realm_config_changes(realm_id,id,account_id,request_key,preview_id,from_revision,to_revision,before_config,after_config,result,created_at) VALUES($1,$2,$3,$4,$5,1,2,$6,$7,$8,$9)`,
        [
          r.realmId,
          changeId,
          actor,
          requestKey,
          previewId,
          before,
          after,
          { ok: true, revision: 2, changeId, appliedAt: appliedAt.toISOString() },
          appliedAt,
        ],
      );
      const audit = (await source.query('SELECT * FROM realm_config_changes')).rows;
      const receipts = (await source.query('SELECT * FROM openings ORDER BY id')).rows;
      const encrypted = await makeBackup(source, password);
      await migrate(source);
      await migrate(source);
      expect((await source.query('SELECT * FROM realm_config_changes')).rows).toEqual(audit);
      expect((await source.query('SELECT * FROM openings ORDER BY id')).rows).toEqual(
        receipts.map((receipt) => ({ ...receipt, pack_count: 1 })),
      );
      await restoreBackup(target, encrypted, password);
      expect((await target.query('SELECT * FROM realm_config_changes')).rows).toEqual(audit);
      expect((await target.query('SELECT * FROM openings ORDER BY id')).rows).toEqual(
        receipts.map((receipt) => ({ ...receipt, pack_count: 1 })),
      );
      const view = await getRealmView(target, actor, r.realmId);
      expect(view).toMatchObject({
        balance: 90,
        configRevision: 2,
        config: {
          schemaVersion: 12,
          fameFloors: disabledFameFloors,
          packPrice: 12,
          trading: defaultConfig.trading,
          ranks: disabledCollectorRanks,
          gemRewards: disabledGemRewards,
        },
        trades: [],
      });
      expect(view.config).toEqual({
        ...after,
        schemaVersion: 12,
        fameFloors: disabledFameFloors,
        legacyPurchasesRetired: false,
        rankTracks: { enabled: false, tracks: [] },
        characterValues: defaultConfig.characterValues,
        tierWeights: { ...after.tierWeights, epic: 0, legendary: 0 },
        recycleRewards: { ...after.recycleRewards, epic: 0, legendary: 0 },
        trading: defaultConfig.trading,
        ranks: disabledCollectorRanks,
        gemRewards: disabledGemRewards,
      });
      expect(view.tradeCode).toMatch(/^[a-f0-9-]{36}$/);
      expect(
        (await target.query('SELECT original_owner_id=owner_id AS preserved FROM cards')).rows[0]
          .preserved,
      ).toBe(true);
    } finally {
      await source.end();
      await target.end();
    }
  });
});
