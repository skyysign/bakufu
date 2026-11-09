import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../packages/config/src/index';
import {
  bootstrap,
  createRealm,
  getRealmView,
  marketCommand,
  openPack,
  provisionPlayer,
  tradeCommand,
  tradePartnerCards,
  transaction,
  type Database,
} from '../../packages/db/src/index';
import { validateTradeBackup } from '../../packages/db/src/trade-backup';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
let players = 0;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('trade_proposals_test')).db;
  admin = await bootstrap(db, 'proposals-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

/** Two players with two cards each in the demo realm. */
async function setup() {
  const realm = await createRealm(db, admin, 'Trade proposal fixture', {
    ...defaultConfig,
    startingGems: 5_000,
  });
  const a = await provisionPlayer(db, realm, `proposal-${++players}@example.test`, password),
    b = await provisionPlayer(db, realm, `proposal-${++players}@example.test`, password);
  const viewA = await getRealmView(db, a, realm);
  const pack = viewA.packs.find((p) => p.name === 'All Characters')!.id;
  for (const player of [a, b, a, b])
    if (!(await openPack(db, player, realm, pack, randomUUID(), viewA.configRevision)).ok)
      throw new Error('Fixture opening failed.');
  const view = async (player: string) => getRealmView(db, player, realm);
  return { realm, a, b, view, revision: viewA.configRevision };
}
const command = (
  r: { realm: string; revision: number },
  actor: string,
  input: Record<string, unknown>,
) => tradeCommand(db, actor, r.realm, input, randomUUID(), r.revision);
const audit = () => transaction(db, (tx) => validateTradeBackup(tx));

describe('trade proposals', () => {
  it('asks for the other player’s card without locking it and completes on accept', async () => {
    const r = await setup();
    const [aCards, bCards] = [(await r.view(r.a)).cards, (await r.view(r.b)).cards];
    const bCode = (await r.view(r.b)).tradeCode;
    const partner = await tradePartnerCards(db, r.a, r.realm, bCode);
    expect(partner.cards.map((c) => c.cardId).sort()).toEqual(bCards.map((c) => c.cardId).sort());
    const created = await command(r, r.a, {
      action: 'create',
      counterpartyCode: bCode,
      offer: { cardIds: [aCards[0].cardId], gems: 10 },
      request: { cardIds: [bCards[0].cardId], gems: 0 },
    });
    expect(created).toMatchObject({ status: 'pending', version: 1 });
    // The creator's side is confirmed and reserved; the requested card is free.
    const [mine, theirs] = [(await r.view(r.a)).trades[0], (await r.view(r.b)).trades[0]];
    expect(mine).toMatchObject({ protocol: 2, myConfirmed: true, changedByMe: true });
    expect(theirs).toMatchObject({ myConfirmed: false, theirConfirmed: true, changedByMe: false });
    expect(theirs.myOffer.cards.map((c) => c.cardId)).toEqual([bCards[0].cardId]);
    expect(
      (await r.view(r.a)).cards.find((c) => c.cardId === aCards[0].cardId)!.lockedForTrade,
    ).toBe(true);
    expect(
      (await r.view(r.b)).cards.find((c) => c.cardId === bCards[0].cardId)!.lockedForTrade,
    ).toBe(false);
    await audit();
    const balanceA = (await r.view(r.a)).balance,
      balanceB = (await r.view(r.b)).balance;
    const accepted = await command(r, r.b, {
      action: 'confirm',
      tradeId: created.tradeId,
      version: 1,
    });
    expect(accepted.status).toBe('completed');
    const [afterA, afterB] = [await r.view(r.a), await r.view(r.b)];
    expect(afterA.cards.map((c) => c.cardId)).toContain(bCards[0].cardId);
    expect(afterB.cards.map((c) => c.cardId)).toContain(aCards[0].cardId);
    expect(afterA.balance).toBe(balanceA - 10);
    expect(afterB.balance).toBe(balanceB + 10);
    await audit();
  });

  it('counters with both sides, then the creator accepts', async () => {
    const r = await setup();
    const [aCards, bCards] = [(await r.view(r.a)).cards, (await r.view(r.b)).cards];
    const created = await command(r, r.a, {
      action: 'create',
      counterpartyCode: (await r.view(r.b)).tradeCode,
      offer: { cardIds: [aCards[0].cardId], gems: 0 },
      request: { cardIds: [bCards[0].cardId, bCards[1].cardId], gems: 0 },
    });
    // The other player asks for both of A's cards and gives only one card.
    const countered = await command(r, r.b, {
      action: 'edit',
      tradeId: created.tradeId,
      version: 1,
      offer: { cardIds: [bCards[1].cardId], gems: 0 },
      request: { cardIds: [aCards[0].cardId, aCards[1].cardId], gems: 0 },
    });
    expect(countered.version).toBe(2);
    const viewA = await r.view(r.a);
    expect(viewA.trades[0]).toMatchObject({ version: 2, myConfirmed: false, theirConfirmed: true });
    // A's cards are free again until A accepts; B's offered card is reserved.
    expect(viewA.cards.every((c) => !c.lockedForTrade)).toBe(true);
    expect(
      (await r.view(r.b)).cards.find((c) => c.cardId === bCards[1].cardId)!.lockedForTrade,
    ).toBe(true);
    await audit();
    // A stale accept of version 1 is refused.
    await expect(
      command(r, r.a, { action: 'confirm', tradeId: created.tradeId, version: 1 }),
    ).rejects.toMatchObject({ code: 'TRADE_CHANGED' });
    const done = await command(r, r.a, { action: 'confirm', tradeId: created.tradeId, version: 2 });
    expect(done.status).toBe('completed');
    expect((await r.view(r.b)).cards.map((c) => c.cardId).sort()).toEqual(
      [bCards[0].cardId, aCards[0].cardId, aCards[1].cardId].sort(),
    );
    await audit();
  });

  it('refuses unavailable requested cards and declines cleanly', async () => {
    const r = await setup();
    const [aCards, bCards] = [(await r.view(r.a)).cards, (await r.view(r.b)).cards];
    const bCode = (await r.view(r.b)).tradeCode;
    await marketCommand(
      db,
      r.b,
      r.realm,
      { action: 'list', cardId: bCards[0].cardId, price: 50 },
      randomUUID(),
    );
    await expect(
      command(r, r.a, {
        action: 'create',
        counterpartyCode: bCode,
        offer: { cardIds: [aCards[0].cardId], gems: 0 },
        request: { cardIds: [bCards[0].cardId], gems: 0 },
      }),
    ).rejects.toMatchObject({ code: 'CARD_LOCKED' });
    await expect(
      command(r, r.a, {
        action: 'create',
        counterpartyCode: bCode,
        offer: { cardIds: [aCards[0].cardId], gems: 0 },
        request: { cardIds: [aCards[1].cardId], gems: 0 },
      }),
    ).rejects.toMatchObject({ code: 'CARD_UNAVAILABLE' });
    // The requested card is listed after the offer: accepting no longer works.
    const trade = await command(r, r.a, {
      action: 'create',
      counterpartyCode: bCode,
      offer: { cardIds: [aCards[0].cardId], gems: 0 },
      request: { cardIds: [bCards[1].cardId], gems: 0 },
    });
    await marketCommand(
      db,
      r.b,
      r.realm,
      { action: 'list', cardId: bCards[1].cardId, price: 50 },
      randomUUID(),
    );
    await expect(
      command(r, r.b, { action: 'confirm', tradeId: trade.tradeId, version: 1 }),
    ).rejects.toMatchObject({ code: 'CARD_LOCKED' });
    const declined = await command(r, r.b, {
      action: 'cancel',
      tradeId: trade.tradeId,
      version: 1,
    });
    expect(declined.status).toBe('cancelled');
    expect((await r.view(r.a)).cards.every((c) => !c.lockedForTrade)).toBe(true);
    await audit();
    // Partner lookups are for realm members and other players only.
    await expect(
      tradePartnerCards(db, r.a, r.realm, (await r.view(r.a)).tradeCode),
    ).rejects.toMatchObject({ code: 'INVALID_PARTNER' });
  });

  it('keeps older trades on their own protocol and restores proposals to a fresh database', async () => {
    const r = await setup();
    const [aCards, bCards] = [(await r.view(r.a)).cards, (await r.view(r.b)).cards];
    const bCode = (await r.view(r.b)).tradeCode;
    const legacy = await command(r, r.a, {
      action: 'create',
      counterpartyCode: bCode,
      offer: { cardIds: [aCards[0].cardId], gems: 0 },
    });
    expect((await r.view(r.a)).trades[0]).toMatchObject({ protocol: 1, myConfirmed: false });
    await expect(
      command(r, r.b, {
        action: 'edit',
        tradeId: legacy.tradeId,
        version: 1,
        offer: { cardIds: [], gems: 1 },
        request: { cardIds: [], gems: 0 },
      }),
    ).rejects.toMatchObject({ code: 'TRADE_PROTOCOL' });
    await command(r, r.a, {
      action: 'create',
      counterpartyCode: bCode,
      offer: { cardIds: [aCards[1].cardId], gems: 0 },
      request: { cardIds: [bCards[0].cardId], gems: 0 },
    });
    await audit();
    const passphrase = randomBytes(24).toString('hex');
    const backup = await makeBackup(db, passphrase);
    const restored = (await server.database('trade_proposals_restore')).db;
    try {
      await restoreBackup(restored, backup, passphrase);
      for (const table of ['trades', 'trade_versions', 'trade_confirmations', 'trade_cards']) {
        const query = `SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t`;
        expect((await restored.query(query)).rows).toEqual((await db.query(query)).rows);
      }
    } finally {
      await restored.end();
    }
    // Reserving a requested card the other player never accepted doesn't reconcile.
    const rollback = new Error('rollback');
    await expect(
      transaction(db, async (tx) => {
        const trade = (
          await tx.query(
            "SELECT id FROM trades WHERE realm_id=$1 AND protocol=2 AND status='pending'",
            [r.realm],
          )
        ).rows[0];
        await tx.query(
          'INSERT INTO trade_cards(realm_id,trade_id,offer_version,card_id,account_id) VALUES($1,$2,1,$3,$4)',
          [r.realm, trade.id, bCards[0].cardId, r.b],
        );
        await expect(validateTradeBackup(tx)).rejects.toThrow(/does not reconcile/);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
