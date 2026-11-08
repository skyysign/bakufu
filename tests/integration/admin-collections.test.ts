import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../packages/config/src/index';
import {
  adminCollectionCommand,
  adminMemberCollection,
  bootstrap,
  createRealm,
  exportPlayer,
  getRealmView,
  marketCommand,
  openPack,
  parsePlayerArchive,
  provisionPlayer,
  recycleCard,
  transaction,
  type Database,
} from '../../packages/db/src/index';
import { validateAdminCollectionBackup } from '../../packages/db/src/admin-collections';
import { validateMarketBackup } from '../../packages/db/src/market-backup';
import { validateTradeBackup } from '../../packages/db/src/trade-backup';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
let accounts = 0;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('admin_collections_test')).db;
  admin = await bootstrap(db, 'collections-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

/** A realm with one original demo character, so every opening awards it. */
async function setup(single = true) {
  const realm = await createRealm(db, admin, 'Collection repair fixture', defaultConfig);
  if (single)
    await db.query('DELETE FROM characters WHERE realm_id=$1 AND source_key != $2', [
      realm,
      'lantern-demo:ro',
    ]);
  const player = await provisionPlayer(db, realm, `collector-${++accounts}@example.test`, password);
  const view = await getRealmView(db, admin, realm),
    pack = view.packs.find((p) => p.name === 'All Characters')!.id;
  const code = async (account: string) => (await getRealmView(db, account, realm)).tradeCode;
  return { realm, player, pack, code };
}
async function open(realm: string, pack: string, actor: string) {
  const opening = await openPack(db, actor, realm, pack, randomUUID());
  if (!opening.ok) throw new Error(`Fixture opening failed: ${opening.code}`);
  return opening.cardIds[0];
}
const audit = () =>
  transaction(db, async (tx) => {
    await validateTradeBackup(tx);
    await validateMarketBackup(tx);
    await validateAdminCollectionBackup(tx);
  });
const balance = async (realm: string, account: string) =>
  (await getRealmView(db, account, realm)).balance;

describe('admin collection repair', () => {
  it('is for realm administrators only', async () => {
    const r = await setup();
    const own = await r.code(r.player);
    await expect(adminMemberCollection(db, r.player, r.realm, own)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      adminCollectionCommand(db, r.player, r.realm, {
        kind: 'adjust_gems',
        requestKey: randomUUID(),
        memberCode: own,
        amount: 500,
        note: 'free gems',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('restores a recycled card, takes the gems back and keeps recycling retries safe', async () => {
    const r = await setup();
    const card = await open(r.realm, r.pack, r.player);
    const before = await balance(r.realm, r.player);
    const recycleKey = randomUUID();
    const recycled = await recycleCard(db, r.player, r.realm, card, recycleKey);
    expect(recycled.credited).toBeGreaterThan(0);
    const code = await r.code(r.player);
    const view = await adminMemberCollection(db, admin, r.realm, code);
    expect(view.recycled).toMatchObject([
      { cardId: card, credited: recycled.credited, heldBy: null },
    ]);
    expect(view.cards).toHaveLength(0);

    const command = {
      kind: 'restore_card' as const,
      requestKey: randomUUID(),
      memberCode: code,
      cardId: card,
      takeBackGems: true,
      note: 'Recycled by accident',
    };
    const receipts = await Promise.all(
      [1, 2, 3].map(() => adminCollectionCommand(db, admin, r.realm, command)),
    );
    receipts.forEach((receipt) => expect(receipt).toEqual(receipts[0]));
    expect(receipts[0]).toMatchObject({
      kind: 'restore_card',
      amount: -recycled.credited,
      balance: before,
    });
    expect((await getRealmView(db, r.player, r.realm)).cards.map((c) => c.cardId)).toEqual([card]);
    expect(await balance(r.realm, r.player)).toBe(before);
    await expect(
      adminCollectionCommand(db, admin, r.realm, { ...command, note: 'Different reason' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    // A late retry of the undone recycling returns its old receipt and changes nothing.
    expect(await recycleCard(db, r.player, r.realm, card, recycleKey)).toEqual(recycled);
    expect((await getRealmView(db, r.player, r.realm)).cards).toHaveLength(1);
    // A new recycling of the restored card works normally.
    const again = await recycleCard(db, r.player, r.realm, card, randomUUID());
    expect(again.cardId).toBe(card);
    const after = await adminMemberCollection(db, admin, r.realm, code);
    expect(after.actions).toMatchObject([{ kind: 'restore_card', note: 'Recycled by accident' }]);
    expect(after.ledger.some((entry) => entry.reason === 'admin_adjustment')).toBe(true);
    await audit();
    expect(parsePlayerArchive(await exportPlayer(db, r.player, r.realm)).cards).toHaveLength(0);
  });

  it('refuses to restore a character someone pulled again', async () => {
    const r = await setup();
    const card = await open(r.realm, r.pack, r.player);
    await recycleCard(db, r.player, r.realm, card, randomUUID());
    await open(r.realm, r.pack, admin);
    const view = await adminMemberCollection(db, admin, r.realm, await r.code(r.player));
    expect(view.recycled[0].heldBy).not.toBeNull();
    await expect(
      adminCollectionCommand(db, admin, r.realm, {
        kind: 'restore_card',
        requestKey: randomUUID(),
        memberCode: await r.code(r.player),
        cardId: card,
        takeBackGems: false,
        note: 'Too late',
      }),
    ).rejects.toMatchObject({ code: 'CHARACTER_CLAIMED' });
  });

  it('returns a card sold on the market, refunds gems and survives a backup restore', async () => {
    const r = await setup(false);
    const card = await open(r.realm, r.pack, admin);
    const listing = await marketCommand(
      db,
      admin,
      r.realm,
      { action: 'list', cardId: card, price: 150 },
      randomUUID(),
    );
    if (!('listingId' in listing)) throw new Error('Fixture listing failed.');
    await marketCommand(
      db,
      r.player,
      r.realm,
      { action: 'buy', listingId: listing.listingId as string },
      randomUUID(),
    );
    expect((await getRealmView(db, r.player, r.realm)).cards.map((c) => c.cardId)).toEqual([card]);
    const sellerCode = await r.code(admin),
      buyerCode = await r.code(r.player);
    const away = await adminMemberCollection(db, admin, r.realm, sellerCode);
    expect(away.givenAway).toMatchObject([
      { cardId: card, via: 'market', price: 150, returnable: true },
    ]);

    // Only an earlier owner can get a card back.
    const third = await provisionPlayer(
      db,
      r.realm,
      `collector-${++accounts}@example.test`,
      password,
    );
    await expect(
      adminCollectionCommand(db, admin, r.realm, {
        kind: 'return_card',
        requestKey: randomUUID(),
        memberCode: await r.code(third),
        cardId: card,
        note: 'Not theirs',
      }),
    ).rejects.toMatchObject({ code: 'NOT_PREVIOUS_OWNER' });

    const sellerBefore = await balance(r.realm, admin),
      buyerBefore = await balance(r.realm, r.player);
    await adminCollectionCommand(db, admin, r.realm, {
      kind: 'return_card',
      requestKey: randomUUID(),
      memberCode: sellerCode,
      cardId: card,
      note: 'Sold by mistake',
    });
    await adminCollectionCommand(db, admin, r.realm, {
      kind: 'adjust_gems',
      requestKey: randomUUID(),
      memberCode: buyerCode,
      amount: 150,
      note: 'Refund for the returned card',
    });
    await adminCollectionCommand(db, admin, r.realm, {
      kind: 'adjust_gems',
      requestKey: randomUUID(),
      memberCode: sellerCode,
      amount: -150,
      note: 'Sale price returned',
    });
    expect((await getRealmView(db, admin, r.realm)).cards.map((c) => c.cardId)).toContain(card);
    expect((await getRealmView(db, r.player, r.realm)).cards).toHaveLength(0);
    expect(await balance(r.realm, r.player)).toBe(buyerBefore + 150);
    expect(await balance(r.realm, admin)).toBe(sellerBefore - 150);
    await expect(
      adminCollectionCommand(db, admin, r.realm, {
        kind: 'adjust_gems',
        requestKey: randomUUID(),
        memberCode: buyerCode,
        amount: -1_000_000,
        note: 'Too much',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_GEMS' });
    await audit();

    // The card can be traded on afterwards, and the history restores cleanly.
    const passphrase = randomBytes(24).toString('hex');
    const backup = await makeBackup(db, passphrase);
    const restored = (await server.database('admin_collections_restore')).db;
    try {
      await restoreBackup(restored, backup, passphrase);
      for (const table of [
        'admin_collection_actions',
        'card_transfers',
        'wallet_ledger',
        'cards',
      ]) {
        const query = `SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t`;
        expect((await restored.query(query)).rows).toEqual((await db.query(query)).rows);
      }
    } finally {
      await restored.end();
    }
  });

  it('will not move a card that is listed on the market', async () => {
    const r = await setup(false);
    const card = await open(r.realm, r.pack, admin);
    const listing = await marketCommand(
      db,
      admin,
      r.realm,
      { action: 'list', cardId: card, price: 90 },
      randomUUID(),
    );
    if (!('listingId' in listing)) throw new Error('Fixture listing failed.');
    await marketCommand(
      db,
      r.player,
      r.realm,
      { action: 'buy', listingId: listing.listingId as string },
      randomUUID(),
    );
    await marketCommand(
      db,
      r.player,
      r.realm,
      { action: 'list', cardId: card, price: 500 },
      randomUUID(),
    );
    await expect(
      adminCollectionCommand(db, admin, r.realm, {
        kind: 'return_card',
        requestKey: randomUUID(),
        memberCode: await r.code(admin),
        cardId: card,
        note: 'Listed again',
      }),
    ).rejects.toMatchObject({ code: 'CARD_LOCKED' });
  });
});
