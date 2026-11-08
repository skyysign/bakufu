import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RealmConfig } from '../../packages/config/src/index';
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
  transaction,
  type Database,
} from '../../packages/db/src/index';
import { listMarket, marketCommand } from '../../packages/db/src/market';
import { validateMarketBackup } from '../../packages/db/src/market-backup';
import { validateTradeBackup } from '../../packages/db/src/trade-backup';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, seller: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('market_test')).db;
  seller = await bootstrap(db, 'market-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
async function setup(config: RealmConfig = defaultConfig) {
  const realm = await createRealm(db, seller, 'Original market fixture', config);
  const buyer = await provisionPlayer(db, realm, 'market-buyer@example.test', password);
  const third = await provisionPlayer(db, realm, 'market-third@example.test', password);
  const view = await getRealmView(db, seller, realm),
    pack = view.packs.find((p) => p.name === 'All Characters')!;
  const receipt = await openPack(db, seller, realm, pack.id, randomUUID());
  if (!receipt.ok) throw new Error('Fixture opening failed.');
  return { realm, buyer, third, card: (await getRealmView(db, seller, realm)).cards[0].cardId };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const list = (r: Fixture, price = 15, key = randomUUID()) =>
  marketCommand(db, seller, r.realm, { action: 'list', cardId: r.card, price }, key);
const buy = (r: Fixture, id: string, actor = r.buyer, key = randomUUID(), revision?: number) =>
  marketCommand(db, actor, r.realm, { action: 'buy', listingId: id }, key, revision);
const cancel = (r: Fixture, id: string, actor = seller, key = randomUUID()) =>
  marketCommand(db, actor, r.realm, { action: 'cancel', listingId: id }, key);
const audit = () =>
  transaction(db, async (tx) => {
    await validateTradeBackup(tx);
    await validateMarketBackup(tx);
  });

describe('realm fixed-price card market', () => {
  it('lists once under concurrent normalized retries without moving card or gems', async () => {
    const r = await setup(),
      key = randomUUID();
    const results = await Promise.all([
      list(r, 15, key),
      marketCommand(
        db,
        seller,
        r.realm,
        { action: 'list', cardId: r.card.toUpperCase(), price: 15 },
        key.toUpperCase(),
      ),
      list(r, 15, key),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(
      (await db.query('SELECT 1 FROM market_listings WHERE realm_id=$1', [r.realm])).rowCount,
    ).toBe(1);
    expect(
      (await db.query('SELECT 1 FROM market_requests WHERE realm_id=$1', [r.realm])).rowCount,
    ).toBe(1);
    expect((await getRealmView(db, seller, r.realm)).balance).toBe(90);
    expect((await getRealmView(db, seller, r.realm)).cards.map((c) => c.cardId)).toContain(r.card);
    await expect(list(r)).rejects.toMatchObject({ code: 'CARD_LOCKED' });
  });
  it('transfers the card and exactly the asking price with preserved origin and no purchase XP', async () => {
    const r = await setup(),
      listing = await list(r, 17),
      result = await buy(r, listing.listingId);
    expect(result).toMatchObject({ status: 'sold', price: 17, balance: 83 });
    expect((await getRealmView(db, seller, r.realm)).balance).toBe(107);
    const buyer = await getRealmView(db, r.buyer, r.realm);
    expect(buyer.progression.totalXp).toBe(0);
    expect(buyer.cards.map((c) => c.cardId)).toContain(r.card);
    expect(
      (
        await db.query('SELECT original_owner_id FROM cards WHERE realm_id=$1 AND id=$2', [
          r.realm,
          r.card,
        ])
      ).rows[0].original_owner_id,
    ).toBe(seller);
    expect(
      (
        await db.query('SELECT 1 FROM trade_confirmations WHERE realm_id=$1 AND trade_id=$2', [
          r.realm,
          result.tradeId,
        ])
      ).rowCount,
    ).toBe(2);
    const ledger = (
      await db.query(
        'SELECT amount FROM wallet_ledger WHERE realm_id=$1 AND operation_key=$2 ORDER BY amount',
        [r.realm, `trade:${result.tradeId}`],
      )
    ).rows;
    expect(ledger.map((row) => row.amount)).toEqual([-17, 17]);
    const archive = await exportPlayer(db, r.buyer, r.realm);
    expect(archive.cards.find((c) => c.cardId === r.card)?.receivedAt).not.toBeNull();
    expect(archive.trades.find((t) => t.id === result.tradeId)).toMatchObject({
      status: 'completed',
      myConfirmed: true,
      theirConfirmed: true,
    });
    await audit();
  });
  it('allows only one of two concurrent buyers to acquire a listing', async () => {
    const r = await setup(),
      listing = await list(r),
      results = await Promise.allSettled([
        buy(r, listing.listingId),
        buy(r, listing.listingId, r.third),
      ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'LISTING_CLOSED' },
    });
    expect(
      (await db.query('SELECT 1 FROM card_transfers WHERE realm_id=$1', [r.realm])).rowCount,
    ).toBe(1);
    expect(
      (
        await db.query(
          'SELECT balance FROM memberships WHERE realm_id=$1 AND account_id=ANY($2::uuid[]) ORDER BY balance',
          [r.realm, [r.buyer, r.third]],
        )
      ).rows.map((row) => row.balance),
    ).toEqual([85, 100]);
  });
  it('replays immutable creation and purchase receipts after later gameplay and rejects changed commands', async () => {
    const r = await setup(),
      listKey = randomUUID(),
      buyKey = randomUUID(),
      listing = await list(r, 15, listKey),
      sold = await buy(r, listing.listingId, r.buyer, buyKey);
    expect(await list(r, 15, listKey)).toEqual(listing);
    await recycleCard(db, r.buyer, r.realm, r.card, randomUUID());
    expect(await buy(r, listing.listingId, r.buyer, buyKey)).toEqual(sold);
    await expect(list(r, 16, listKey)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      marketCommand(
        db,
        r.buyer,
        r.realm,
        { action: 'cancel', listingId: listing.listingId },
        buyKey,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await audit();
  });
  it('restricts cancellation to the seller, rejects self-buy and safely relists after cancellation', async () => {
    const r = await setup(),
      listing = await list(r),
      key = randomUUID();
    await expect(cancel(r, listing.listingId, r.buyer)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(buy(r, listing.listingId, seller)).rejects.toMatchObject({ code: 'OWN_LISTING' });
    const receipt = await cancel(r, listing.listingId, seller, key);
    expect(receipt.status).toBe('cancelled');
    expect(await cancel(r, listing.listingId, seller, key)).toEqual(receipt);
    const relisted = await list(r, 21);
    expect(relisted.listingId).not.toBe(listing.listingId);
    await expect(buy(r, listing.listingId)).rejects.toMatchObject({ code: 'LISTING_CLOSED' });
    expect(
      (await listMarket(db, seller, r.realm, { scope: 'mine' })).listings
        .map((row) => row.status)
        .sort(),
    ).toEqual(['active', 'cancelled']);
  });
  it('enforces realm membership, card ownership and input price limits', async () => {
    const r = await setup(),
      other = await setup(),
      stranger = randomUUID();
    await expect(listMarket(db, stranger, r.realm)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      marketCommand(
        db,
        stranger,
        r.realm,
        { action: 'list', cardId: r.card, price: 1 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      marketCommand(
        db,
        r.buyer,
        r.realm,
        { action: 'list', cardId: r.card, price: 1 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'CARD_UNAVAILABLE' });
    await expect(
      marketCommand(
        db,
        seller,
        other.realm,
        { action: 'list', cardId: r.card, price: 1 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'CARD_UNAVAILABLE' });
    for (const price of [0, -1, 1.5, 1000001]) await expect(list(r, price)).rejects.toThrow();
    const listing = await list(r);
    await expect(buy({ ...r, realm: other.realm }, listing.listingId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('uses current configured gem limits and rejects stale writes without charging', async () => {
    const r = await setup({
      ...defaultConfig,
      trading: { ...defaultConfig.trading, maxGemsPerSide: 20 },
    });
    await expect(list(r, 21)).rejects.toMatchObject({ code: 'INVALID_PRICE' });
    const listing = await list(r, 20);
    await expect(buy(r, listing.listingId, r.buyer, randomUUID(), 0)).rejects.toMatchObject({
      code: 'SETTINGS_CHANGED',
    });
    const config = (await getRealmView(db, seller, r.realm)).config;
    const preview = await previewRealmSettings(db, seller, r.realm, {
      ...config,
      trading: { ...config.trading, maxGemsPerSide: 19 },
    });
    await applyRealmSettings(db, seller, r.realm, preview.id, randomUUID());
    await expect(buy(r, listing.listingId, r.buyer, randomUUID(), 2)).rejects.toMatchObject({
      code: 'INVALID_PRICE',
    });
    expect((await getRealmView(db, r.buyer, r.realm)).balance).toBe(100);
    await cancel(r, listing.listingId);
  });
  it('blocks new market activity when trading is disabled but allows cancellation and receipt replay', async () => {
    const r = await setup(),
      key = randomUUID(),
      listing = await list(r, 15, key),
      config = (await getRealmView(db, seller, r.realm)).config;
    const preview = await previewRealmSettings(db, seller, r.realm, {
      ...config,
      trading: { ...config.trading, enabled: false },
    });
    await applyRealmSettings(db, seller, r.realm, preview.id, randomUUID());
    await expect(buy(r, listing.listingId)).rejects.toMatchObject({ code: 'TRADING_DISABLED' });
    await expect(list(r)).rejects.toMatchObject({ code: 'TRADING_DISABLED' });
    expect(await list(r, 15, key)).toEqual(listing);
    expect((await listMarket(db, r.buyer, r.realm)).tradingEnabled).toBe(false);
    expect((await cancel(r, listing.listingId)).status).toBe('cancelled');
  });
  it('reserves listings against recycling and direct trades, and respects existing trade reservations', async () => {
    const r = await setup(),
      listing = await list(r),
      code = (await getRealmView(db, r.buyer, r.realm)).tradeCode;
    await expect(recycleCard(db, seller, r.realm, r.card, randomUUID())).rejects.toMatchObject({
      code: 'CARD_LOCKED',
    });
    await expect(
      tradeCommand(
        db,
        seller,
        r.realm,
        { action: 'create', counterpartyCode: code, offer: { cardIds: [r.card], gems: 0 } },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'CARD_LOCKED' });
    await cancel(r, listing.listingId);
    const trade = await tradeCommand(
      db,
      seller,
      r.realm,
      { action: 'create', counterpartyCode: code, offer: { cardIds: [r.card], gems: 0 } },
      randomUUID(),
    );
    await expect(list(r)).rejects.toMatchObject({ code: 'CARD_LOCKED' });
    await tradeCommand(
      db,
      seller,
      r.realm,
      { action: 'cancel', tradeId: trade.tradeId, version: 1 },
      randomUUID(),
    );
    expect((await list(r)).status).toBe('active');
  });
  it('has one outcome when listing competes with recycling', async () => {
    const r = await setup(),
      outcomes = await Promise.allSettled([
        list(r),
        recycleCard(db, seller, r.realm, r.card, randomUUID()),
      ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const active = (
      await db.query("SELECT 1 FROM market_listings WHERE realm_id=$1 AND status='active'", [
        r.realm,
      ])
    ).rowCount;
    const recycled = (
      await db.query('SELECT 1 FROM recyclings WHERE realm_id=$1 AND card_id=$2', [r.realm, r.card])
    ).rowCount;
    expect(Number(active) + Number(recycled)).toBe(1);
  });
  it('rejects insufficient buyer balance and seller overflow before transferring assets', async () => {
    const r = await setup(),
      listing = await list(r, 101);
    await expect(buy(r, listing.listingId)).rejects.toMatchObject({ code: 'INSUFFICIENT_GEMS' });
    await cancel(r, listing.listingId);
    const affordable = await list(r, 10);
    await db.query(
      'UPDATE memberships SET balance=2147483647 WHERE realm_id=$1 AND account_id=$2',
      [r.realm, seller],
    );
    try {
      await expect(buy(r, affordable.listingId)).rejects.toMatchObject({ code: 'WALLET_LIMIT' });
    } finally {
      await db.query('UPDATE memberships SET balance=90 WHERE realm_id=$1 AND account_id=$2', [
        r.realm,
        seller,
      ]);
    }
    expect(
      (await db.query('SELECT 1 FROM card_transfers WHERE realm_id=$1', [r.realm])).rowCount,
    ).toBe(0);
    expect((await listMarket(db, r.buyer, r.realm)).listings).toHaveLength(1);
  });
  it('rolls an interrupted purchase and its journals back, then accepts the same request key', async () => {
    const r = await setup(),
      listing = await list(r),
      key = randomUUID();
    const before = await exportPlayer(db, r.buyer, r.realm);
    await db.query(
      `CREATE FUNCTION deny_market_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER deny_market_fixture BEFORE INSERT ON market_requests FOR EACH ROW EXECUTE FUNCTION deny_market_fixture();`,
    );
    try {
      await expect(buy(r, listing.listingId, r.buyer, key)).rejects.toThrow();
    } finally {
      await db.query(
        'DROP TRIGGER deny_market_fixture ON market_requests; DROP FUNCTION deny_market_fixture();',
      );
    }
    const after = await exportPlayer(db, r.buyer, r.realm);
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
    expect(
      (await db.query('SELECT 1 FROM card_transfers WHERE realm_id=$1', [r.realm])).rowCount,
    ).toBe(0);
    expect((await listMarket(db, r.buyer, r.realm)).listings[0].status).toBe('active');
    const result = await buy(r, listing.listingId, r.buyer, key);
    expect(await buy(r, listing.listingId, r.buyer, key)).toEqual(result);
  });
  it('returns searchable paginated realm listings without private accounts or credentials', async () => {
    const r = await setup(),
      other = await setup();
    await list(r);
    await list(other);
    const view = await getRealmView(db, seller, r.realm),
      pack = view.packs.find((p) => p.name === 'All Characters')!;
    await openPack(db, seller, r.realm, pack.id, randomUUID());
    const card = (await getRealmView(db, seller, r.realm)).cards.find((c) => c.cardId !== r.card)!;
    await marketCommand(
      db,
      seller,
      r.realm,
      { action: 'list', cardId: card.cardId, price: 2 },
      randomUUID(),
    );
    const first = await listMarket(db, r.buyer, r.realm, { limit: 1 });
    expect(first.nextOffset).toBe(1);
    const second = await listMarket(db, r.buyer, r.realm, { limit: 1, offset: first.nextOffset });
    expect(second.nextOffset).toBeNull();
    expect(second.listings[0].id).not.toBe(first.listings[0].id);
    expect(
      (await listMarket(db, r.buyer, r.realm, { query: first.listings[0].name })).listings.map(
        (row) => row.id,
      ),
    ).toContain(first.listings[0].id);
    expect((await listMarket(db, r.buyer, r.realm, { scope: 'mine' })).listings).toEqual([]);
    expect(JSON.stringify(first)).not.toMatch(/email|password|accountId|seller_id|buyer_id/);
    expect(JSON.stringify(first)).not.toContain(seller);
  });
  it('preserves sales, active reservations and exact receipt replay after encrypted fresh recovery', async () => {
    const sold = await setup(),
      listing = await list(sold),
      key = randomUUID(),
      receipt = await buy(sold, listing.listingId, sold.buyer, key),
      active = await setup();
    await list(active);
    const before = await exportPlayer(db, sold.buyer, sold.realm),
      passphrase = randomBytes(24).toString('hex'),
      archive = await makeBackup(db, passphrase),
      fresh = (await server.database('market_restored')).db;
    try {
      await restoreBackup(fresh, archive, passphrase);
      await assertBackupRestored(fresh, archive, passphrase);
      const after = await exportPlayer(fresh, sold.buyer, sold.realm);
      expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
      expect(
        await marketCommand(
          fresh,
          sold.buyer,
          sold.realm,
          { action: 'buy', listingId: listing.listingId },
          key,
        ),
      ).toEqual(receipt);
      await expect(
        recycleCard(fresh, seller, active.realm, active.card, randomUUID()),
      ).rejects.toMatchObject({ code: 'CARD_LOCKED' });
    } finally {
      await fresh.end();
    }
  });
  it('rejects an inconsistent sale archive and restores nothing', async () => {
    const r = await setup(),
      listing = await list(r);
    await buy(r, listing.listingId);
    const passphrase = randomBytes(24).toString('hex'),
      fresh = (await server.database('market_corrupt_restore')).db;
    let archive: string;
    try {
      await db.query('UPDATE market_listings SET price=price+1 WHERE realm_id=$1 AND id=$2', [
        r.realm,
        listing.listingId,
      ]);
      try {
        archive = await makeBackup(db, passphrase);
      } finally {
        await db.query('UPDATE market_listings SET price=price-1 WHERE realm_id=$1 AND id=$2', [
          r.realm,
          listing.listingId,
        ]);
      }
      await expect(restoreBackup(fresh, archive!, passphrase)).rejects.toThrow('market history');
      expect((await fresh.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    } finally {
      await fresh.end();
    }
  });
  it('rejects a replay receipt whose recorded balance disagrees with its sale debit', async () => {
    const r = await setup(),
      listing = await list(r),
      key = randomUUID();
    await buy(r, listing.listingId, r.buyer, key);
    const passphrase = randomBytes(24).toString('hex'),
      fresh = (await server.database('market_receipt_restore')).db;
    let archive: string;
    try {
      await db.query(
        "UPDATE market_requests SET result=jsonb_set(result,'{balance}',to_jsonb((result->>'balance')::integer+1)) WHERE realm_id=$1 AND account_id=$2 AND request_key=$3",
        [r.realm, r.buyer, key],
      );
      try {
        archive = await makeBackup(db, passphrase);
      } finally {
        await db.query(
          "UPDATE market_requests SET result=jsonb_set(result,'{balance}',to_jsonb((result->>'balance')::integer-1)) WHERE realm_id=$1 AND account_id=$2 AND request_key=$3",
          [r.realm, r.buyer, key],
        );
      }
      await expect(restoreBackup(fresh, archive!, passphrase)).rejects.toThrow('market history');
      expect((await fresh.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    } finally {
      await fresh.end();
    }
  });
});
