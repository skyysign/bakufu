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
  recycleCard,
  recycleCards,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
let players = 0;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('batch_recycling_test')).db;
  admin = await bootstrap(db, 'batch-recycling-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

/**
 * A player who opened five packs of the demo realm (five different characters).
 * The recycling safeguard is off unless a test turns it on: the demo cards'
 * rarities are random.
 */
async function opened(recycleSafeguard = false) {
  const realm = await createRealm(db, admin, 'Batch recycling fixture', {
    ...defaultConfig,
    startingGems: 5_000,
    recycleSafeguard,
  });
  const player = await provisionPlayer(db, realm, `batch-${++players}@example.test`, password);
  const view = await getRealmView(db, player, realm);
  const pack = view.packs.find((p) => p.name === 'All Characters')!.id;
  const opening = await openPack(db, player, realm, pack, randomUUID(), view.configRevision, 5);
  if (!opening.ok) throw new Error('Fixture opening failed.');
  return { realm, player, cards: opening.cardIds, revision: view.configRevision };
}
const balance = async (realm: string, account: string) =>
  (await getRealmView(db, account, realm)).balance;
const owned = async (realm: string, account: string) =>
  (await getRealmView(db, account, realm)).cards.map((card) => card.cardId).sort();

describe('recycling several cards from an opening', () => {
  it('recycles all of them in one step and replays a retry', async () => {
    const r = await opened();
    const before = await balance(r.realm, r.player);
    const requestKey = randomUUID();
    const chosen = r.cards.slice(0, 3);
    const result = await recycleCards(db, r.player, r.realm, {
      cardIds: chosen,
      requestKey,
      expectedRevision: r.revision,
    });
    expect(result.recycled.map((item) => item.cardId)).toEqual(chosen);
    expect(result.credited).toBe(result.recycled.reduce((sum, item) => sum + item.credited, 0));
    expect(result.credited).toBeGreaterThan(0);
    expect(result.balance).toBe(before + result.credited);
    expect(await balance(r.realm, r.player)).toBe(result.balance);
    expect(await owned(r.realm, r.player)).toEqual(r.cards.slice(3).sort());
    // Each card has its own recycling and ledger entry.
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM wallet_ledger WHERE realm_id=$1 AND account_id=$2 AND reason='recycling'",
          [r.realm, r.player],
        )
      ).rows[0].count,
    ).toBe(3);

    // A retry of a lost response pays nothing twice.
    await expect(
      recycleCards(db, r.player, r.realm, {
        cardIds: chosen,
        requestKey,
        expectedRevision: r.revision,
      }),
    ).resolves.toEqual(result);
    expect(await balance(r.realm, r.player)).toBe(result.balance);
    await expect(
      recycleCards(db, r.player, r.realm, {
        cardIds: r.cards.slice(0, 4),
        requestKey,
        expectedRevision: r.revision,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    // Single and batch recycling can be mixed; an already recycled card stops a batch.
    await recycleCard(db, r.player, r.realm, r.cards[3], randomUUID(), r.revision);
    await expect(
      recycleCards(db, r.player, r.realm, {
        cardIds: [r.cards[3], r.cards[4]],
        requestKey: randomUUID(),
        expectedRevision: r.revision,
      }),
    ).rejects.toMatchObject({ code: 'CARD_UNAVAILABLE' });
    expect(await owned(r.realm, r.player)).toEqual([r.cards[4]]);
  });

  it('is all or nothing', async () => {
    const r = await opened();
    const before = await balance(r.realm, r.player);
    await marketCommand(
      db,
      r.player,
      r.realm,
      { action: 'list', cardId: r.cards[2], price: 90 },
      randomUUID(),
    );
    await expect(
      recycleCards(db, r.player, r.realm, {
        cardIds: r.cards.slice(0, 3),
        requestKey: randomUUID(),
        expectedRevision: r.revision,
      }),
    ).rejects.toMatchObject({ code: 'CARD_LOCKED' });
    expect(await balance(r.realm, r.player)).toBe(before);
    expect(await owned(r.realm, r.player)).toEqual([...r.cards].sort());
    // Someone else's cards, stale pages and bad input are refused.
    const other = await provisionPlayer(db, r.realm, `batch-${++players}@example.test`, password);
    await expect(
      recycleCards(db, other, r.realm, {
        cardIds: r.cards.slice(0, 2),
        requestKey: randomUUID(),
        expectedRevision: r.revision,
      }),
    ).rejects.toMatchObject({ code: 'CARD_UNAVAILABLE' });
    await expect(
      recycleCards(db, r.player, r.realm, {
        cardIds: r.cards.slice(0, 2),
        requestKey: randomUUID(),
        expectedRevision: r.revision + 1,
      }),
    ).rejects.toMatchObject({ code: 'SETTINGS_CHANGED' });
    await expect(
      recycleCards(db, r.player, r.realm, {
        cardIds: [r.cards[0], r.cards[0]],
        requestKey: randomUUID(),
        expectedRevision: r.revision,
      }),
    ).rejects.toThrow();
    expect(await owned(r.realm, r.player)).toEqual([...r.cards].sort());
  });

  it('protects epic and legendary cards: one at a time, confirmed, while the safeguard is on', async () => {
    const r = await opened(true);
    const setTier = async (cardId: string, tier: string) =>
      db.query(
        'UPDATE characters c SET tier=$3 FROM cards owned WHERE owned.realm_id=$1 AND owned.id=$2 AND c.realm_id=owned.realm_id AND c.id=owned.character_id',
        [r.realm, cardId, tier],
      );
    const [legendary, epic, common, rare] = r.cards;
    await setTier(legendary, 'legendary');
    await setTier(epic, 'epic');
    await setTier(common, 'common');
    await setTier(rare, 'rare');
    const before = await balance(r.realm, r.player);
    // A bulk recycling never takes them, and nothing of it happens.
    await expect(
      recycleCards(db, r.player, r.realm, {
        cardIds: [common, rare, legendary],
        requestKey: randomUUID(),
        expectedRevision: r.revision,
      }),
    ).rejects.toMatchObject({ code: 'RECYCLE_CONFIRMATION_REQUIRED', status: 409 });
    // Alone, they need the confirmation.
    await expect(
      recycleCard(db, r.player, r.realm, legendary, randomUUID(), r.revision),
    ).rejects.toMatchObject({ code: 'RECYCLE_CONFIRMATION_REQUIRED' });
    expect(await balance(r.realm, r.player)).toBe(before);
    expect(await owned(r.realm, r.player)).toEqual([...r.cards].sort());
    const bulk = await recycleCards(db, r.player, r.realm, {
      cardIds: [common, rare],
      requestKey: randomUUID(),
      expectedRevision: r.revision,
    });
    expect(bulk.recycled.map((item) => item.tier)).toEqual(['common', 'rare']);
    const key = randomUUID();
    const confirmed = await recycleCard(db, r.player, r.realm, legendary, key, r.revision, true);
    expect(confirmed).toMatchObject({ cardId: legendary, tier: 'legendary' });
    // A retry replays the receipt.
    expect(await recycleCard(db, r.player, r.realm, legendary, key, r.revision, true)).toEqual(
      confirmed,
    );
    // Turned off, the epic goes with a bulk recycling like any other card.
    await db.query(
      "UPDATE realms SET config=jsonb_set(config,'{recycleSafeguard}','false') WHERE id=$1",
      [r.realm],
    );
    const off = await recycleCards(db, r.player, r.realm, {
      cardIds: [epic, r.cards[4]],
      requestKey: randomUUID(),
      expectedRevision: r.revision,
    });
    expect(off.recycled[0]).toMatchObject({ cardId: epic, tier: 'epic' });
    expect(await owned(r.realm, r.player)).toEqual([]);
  });

  it('restores to a fresh database with every recycling reconciled', async () => {
    const r = await opened();
    await recycleCards(db, r.player, r.realm, {
      cardIds: r.cards.slice(1),
      requestKey: randomUUID(),
      expectedRevision: r.revision,
    });
    const passphrase = randomBytes(24).toString('hex');
    const backup = await makeBackup(db, passphrase);
    const restored = (await server.database('batch_recycling_restore')).db;
    try {
      await restoreBackup(restored, backup, passphrase);
      const query =
        'SELECT jsonb_agg(to_jsonb(t) ORDER BY t.realm_id,t.id) AS data FROM recyclings t';
      expect((await restored.query(query)).rows).toEqual((await db.query(query)).rows);
    } finally {
      await restored.end();
    }
  });
});
