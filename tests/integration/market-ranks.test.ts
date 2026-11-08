import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RealmConfig } from '../../packages/config/src/index';
import { defaultConfig } from '../support/prototype-config';
import {
  bootstrap,
  createRealm,
  provisionPlayer,
  getRealmView,
  openPack,
  buyUpgrade,
  recycleCard,
  setWishlistEntry,
  exportPlayer,
  parsePlayerArchive,
  type Database,
} from '../../packages/db/src/index';
import { buyCollectorRank } from '../../packages/db/src/ranks';
import { marketCommand, listMarket } from '../../packages/db/src/market';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('market_rank_journey')).db;
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

describe('ranked player market journey', () => {
  it('applies earned benefits through opening, legacy upgrades, wishlist, recycling, sale and fresh recovery', async () => {
    const password = randomBytes(24).toString('hex'),
      seller = await bootstrap(db, 'rank-market-seller@example.test', password);
    const config: RealmConfig = {
      ...defaultConfig,
      startingGems: 200,
      cooldownSeconds: 60,
      tierWeights: { ...defaultConfig.tierWeights, common: 1, uncommon: 0, rare: 0 },
      upgrades: { packDiscount: [{ cost: 5, requiredLevel: 1, discount: 1 }] },
      ranks: {
        enabled: true,
        levels: [
          {
            name: 'Bronze',
            cost: 10,
            packDiscount: 2,
            recycleBonus: 3,
            wishlistSlots: 2,
            cooldownReductionSeconds: 60,
          },
        ],
      },
    };
    const realm = await createRealm(db, seller, 'Ranked market journey', config),
      buyer = await provisionPlayer(db, realm, 'rank-market-buyer@example.test', password),
      rankKey = randomUUID();
    const rank = await buyCollectorRank(db, seller, realm, 1, rankKey, 1);
    expect(rank).toMatchObject({ rank: 1, charged: 10, balance: 190 });
    const ranked = await getRealmView(db, seller, realm);
    expect(ranked.packPrice).toBe(8);
    expect(ranked.effectiveCooldownSeconds).toBe(0);
    expect(ranked.effectiveWishlistSlots).toBe(5);
    expect(ranked.effectiveRecycleRewards.common).toBe(5);
    const upgrade = await buyUpgrade(db, seller, realm, 'pack_discount', 1, randomUUID(), 1);
    expect(upgrade).toMatchObject({ packPrice: 7, charged: 5, balance: 185 });
    const pack = ranked.packs.find((pack) => pack.name === 'All Characters')!;
    for (const character of ranked.catalog.slice(0, 5))
      await setWishlistEntry(db, seller, realm, character.id, true, randomUUID(), 1);
    expect((await getRealmView(db, seller, realm)).wishlist).toHaveLength(5);
    const first = await openPack(db, seller, realm, pack.id, randomUUID(), 1),
      second = await openPack(db, seller, realm, pack.id, randomUUID(), 1);
    expect(first).toMatchObject({ ok: true, charged: 7, balance: 178 });
    expect(second).toMatchObject({ ok: true, charged: 7, balance: 171 });
    if (!first.ok || !second.ok) throw new Error('Original journey opening failed.');
    const recycled = await recycleCard(db, seller, realm, second.cardIds[0], randomUUID(), 1);
    expect(recycled).toMatchObject({ credited: 5, balance: 176 });
    const listing = await marketCommand(
        db,
        seller,
        realm,
        { action: 'list', cardId: first.cardIds[0], price: 40 },
        randomUUID(),
        1,
      ),
      buyKey = randomUUID();
    const sale = await marketCommand(
      db,
      buyer,
      realm,
      { action: 'buy', listingId: listing.listingId },
      buyKey,
      1,
    );
    expect(sale).toMatchObject({ status: 'sold', price: 40, balance: 160 });
    expect((await getRealmView(db, seller, realm)).balance).toBe(216);
    expect((await getRealmView(db, buyer, realm)).progression.totalXp).toBe(0);
    const sellerArchive = await exportPlayer(db, seller, realm),
      buyerArchive = await exportPlayer(db, buyer, realm);
    expect(sellerArchive.schemaVersion).toBe(12);
    expect(buyerArchive.schemaVersion).toBe(12);
    expect(sellerArchive.wishlist).toHaveLength(5);
    expect(sellerArchive.gems).toBe(216);
    expect(buyerArchive.cards.map((card) => card.cardId)).toContain(first.cardIds[0]);
    expect(parsePlayerArchive(sellerArchive)).toEqual(sellerArchive);
    const key = randomBytes(24).toString('hex'),
      backup = await makeBackup(db, key),
      fresh = (await server.database('market_rank_recovered')).db;
    try {
      await restoreBackup(fresh, backup, key);
      await assertBackupRestored(fresh, backup, key);
      const restoredSeller = await exportPlayer(fresh, seller, realm),
        restoredBuyer = await exportPlayer(fresh, buyer, realm);
      expect({ ...restoredSeller, exportedAt: sellerArchive.exportedAt }).toEqual(sellerArchive);
      expect({ ...restoredBuyer, exportedAt: buyerArchive.exportedAt }).toEqual(buyerArchive);
      expect(await buyCollectorRank(fresh, seller, realm, 1, rankKey, 1)).toEqual(rank);
      expect(
        await marketCommand(
          fresh,
          buyer,
          realm,
          { action: 'buy', listingId: listing.listingId },
          buyKey,
          1,
        ),
      ).toEqual(sale);
      const recovered = await getRealmView(fresh, seller, realm);
      expect(recovered.packPrice).toBe(7);
      expect(recovered.effectiveWishlistSlots).toBe(5);
      expect(recovered.wishlist).toHaveLength(5);
      expect((await listMarket(fresh, seller, realm, { scope: 'mine' })).listings[0].status).toBe(
        'sold',
      );
    } finally {
      await fresh.end();
    }
  });
});
