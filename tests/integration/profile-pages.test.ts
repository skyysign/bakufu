import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../packages/config/src/index';
import {
  bootstrap,
  createRealm,
  exportPlayer,
  getPlayerProfile,
  getRealmView,
  listPlayers,
  openPack,
  parsePlayerArchive,
  provisionPlayer,
  recycleCards,
  setWishlistEntry,
  updateProfilePage,
  type Database,
} from '../../packages/db/src/index';
import { assertBackupRestored, makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { startPostgres } from '../support/postgres';

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex'),
  passphrase = randomBytes(24).toString('hex');
let players = 0;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('profile_pages_test')).db;
  admin = await bootstrap(db, 'profiles-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

/** A realm where Alice opened five packs and Bob three (the safeguard is off). */
async function fixture() {
  const realm = await createRealm(db, admin, 'Profile fixture', {
    ...defaultConfig,
    startingGems: 5_000,
    recycleSafeguard: false,
  });
  const join = () => provisionPlayer(db, realm, `profile-${++players}@example.test`, password);
  const alice = await join(),
    bob = await join();
  const open = async (player: string, count: 1 | 5) => {
    const view = await getRealmView(db, player, realm);
    const pack = view.packs.find((p) => p.name === 'All Characters')!.id;
    const opening = await openPack(
      db,
      player,
      realm,
      pack,
      randomUUID(),
      view.configRevision,
      count,
    );
    if (!opening.ok) throw new Error('Fixture opening failed.');
    return opening;
  };
  const aliceCards = await open(alice, 5);
  const bobCards = [await open(bob, 1), await open(bob, 1), await open(bob, 1)];
  const code = async (player: string) => (await getRealmView(db, player, realm)).tradeCode;
  return {
    realm,
    alice,
    bob,
    aliceCode: await code(alice),
    bobCode: await code(bob),
    aliceCards,
    bobCards: bobCards.flatMap((opening) => opening.cardIds),
    bobCharacters: bobCards.flatMap((opening) => opening.characters),
  };
}

describe('player profile pages', () => {
  it('shows a member their own page and other members a page without private data', async () => {
    const f = await fixture();
    const own = await getPlayerProfile(db, f.alice, f.realm);
    expect(own).toMatchObject({
      self: true,
      player: { tradeCode: f.aliceCode, admin: false, level: expect.any(Number) },
      page: { bio: '', theme: 'violet', showcase: [], showWishlist: false, updatedAt: null },
      stats: { cards: 5, rosterSize: 12 },
      showcase: { pinned: false },
      wishlist: [],
      wanted: [],
    });
    expect(Object.values(own.stats.tiers).reduce((sum, count) => sum + count, 0)).toBe(5);
    // Without pinned cards the most valuable ones are shown, best first.
    const view = await getRealmView(db, f.alice, f.realm);
    expect(own.stats.value).toBe(
      view.cards.reduce((sum, card) => sum + view.characterValues[card.id].marketValue, 0),
    );
    expect(own.showcase.cards).toHaveLength(5);
    const worth = own.showcase.cards.map((card) => card.valuation.marketValue);
    expect(worth).toEqual([...worth].sort((a, b) => b - a));
    // Another member sees the same collection, not the wishlist or any gems.
    const seen = await getPlayerProfile(db, f.bob, f.realm, f.aliceCode);
    expect(seen).toMatchObject({ self: false, wishlist: null, stats: own.stats });
    expect(seen.showcase).toEqual(own.showcase);
    expect(JSON.stringify(seen)).not.toMatch(/balance|gems|email/i);
    // The viewer's own code is their own page.
    expect((await getPlayerProfile(db, f.bob, f.realm, f.bobCode)).self).toBe(true);
  });

  it('is limited to members of the realm', async () => {
    const f = await fixture();
    const elsewhere = await createRealm(db, admin, 'Another realm');
    const stranger = await provisionPlayer(
      db,
      elsewhere,
      `profile-${++players}@example.test`,
      password,
    );
    const strangerCode = (await getRealmView(db, stranger, elsewhere)).tradeCode;
    await expect(getPlayerProfile(db, stranger, f.realm, f.aliceCode)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(listPlayers(db, stranger, f.realm)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      updateProfilePage(db, stranger, f.realm, {
        bio: '',
        theme: 'violet',
        showcase: [],
        showWishlist: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A code from another realm, or one nobody has, is not a player here.
    await expect(getPlayerProfile(db, f.alice, f.realm, strangerCode)).rejects.toMatchObject({
      code: 'PLAYER_NOT_FOUND',
      status: 404,
    });
    await expect(getPlayerProfile(db, f.alice, f.realm, randomUUID())).rejects.toMatchObject({
      code: 'PLAYER_NOT_FOUND',
    });
  });

  it('saves only valid pages of the player’s own cards', async () => {
    const f = await fixture();
    const pinned = [f.aliceCards.cardIds[3], f.aliceCards.cardIds[0]];
    const saved = await updateProfilePage(db, f.alice, f.realm, {
      bio: '  Collecting every\n\twayfinder​ I can find.  ',
      theme: 'ocean',
      showcase: pinned,
      showWishlist: true,
    });
    expect(saved).toMatchObject({
      bio: 'Collecting every wayfinder I can find.',
      theme: 'ocean',
      showcase: pinned,
      showWishlist: true,
    });
    const seen = await getPlayerProfile(db, f.bob, f.realm, f.aliceCode);
    expect(seen.page).toEqual(saved);
    expect(seen.showcase.pinned).toBe(true);
    expect(seen.showcase.cards.map((card) => card.cardId)).toEqual(pinned);
    // Someone else's card, too many cards, a repeated card, an unknown theme or a
    // long text are refused, and the saved page stays.
    const page = { bio: 'x', theme: 'rose', showcase: [] as string[], showWishlist: false };
    await expect(
      updateProfilePage(db, f.alice, f.realm, { ...page, showcase: [f.bobCards[0]] }),
    ).rejects.toMatchObject({ code: 'SHOWCASE_INVALID', status: 409 });
    for (const invalid of [
      { ...page, showcase: [pinned[0], pinned[0]] },
      { ...page, showcase: Array.from({ length: 7 }, () => randomUUID()) },
      { ...page, theme: 'neon' },
      { ...page, bio: 'b'.repeat(281) },
      { ...page, extra: true },
    ])
      await expect(updateProfilePage(db, f.alice, f.realm, invalid)).rejects.toThrow();
    expect((await getPlayerProfile(db, f.alice, f.realm)).page).toEqual(saved);
    // A showcased card that leaves the collection is no longer shown; with none
    // left the page falls back to the most valuable cards.
    const revision = (await getRealmView(db, f.alice, f.realm)).configRevision;
    const recycle = (cardIds: string[]) =>
      recycleCards(db, f.alice, f.realm, {
        cardIds,
        requestKey: randomUUID(),
        expectedRevision: revision,
      });
    await recycle([pinned[0]]);
    expect(
      (await getPlayerProfile(db, f.bob, f.realm, f.aliceCode)).showcase.cards.map(
        (card) => card.cardId,
      ),
    ).toEqual([pinned[1]]);
    await recycle([pinned[1]]);
    const after = await getPlayerProfile(db, f.bob, f.realm, f.aliceCode);
    expect(after.showcase.pinned).toBe(false);
    expect(after.showcase.cards).toHaveLength(3);
    expect(after.stats.cards).toBe(3);
  });

  it('shows a wishlist only with consent and points out matching cards', async () => {
    const f = await fixture();
    const revision = (await getRealmView(db, f.alice, f.realm)).configRevision;
    // Alice wishes for one of Bob's characters; Bob wishes for one of Alice's.
    await setWishlistEntry(
      db,
      f.alice,
      f.realm,
      f.bobCharacters[0].id,
      true,
      randomUUID(),
      revision,
    );
    await setWishlistEntry(
      db,
      f.bob,
      f.realm,
      f.aliceCards.characters[1].id,
      true,
      randomUUID(),
      revision,
    );
    // Private by default, also for the admin.
    expect((await getPlayerProfile(db, f.bob, f.realm, f.aliceCode)).wishlist).toBeNull();
    expect((await getPlayerProfile(db, admin, f.realm, f.aliceCode)).wishlist).toBeNull();
    expect((await getPlayerProfile(db, f.alice, f.realm)).wishlist).toHaveLength(1);
    await updateProfilePage(db, f.alice, f.realm, {
      bio: '',
      theme: 'violet',
      showcase: [],
      showWishlist: true,
    });
    const seen = await getPlayerProfile(db, f.bob, f.realm, f.aliceCode);
    expect(seen.wishlist).toEqual([
      expect.objectContaining({ id: f.bobCharacters[0].id, viewerOwns: true }),
    ]);
    // Alice holds a card Bob wishes for.
    expect(seen.wanted.map((card) => card.cardId)).toEqual([f.aliceCards.cardIds[1]]);
    expect((await getPlayerProfile(db, admin, f.realm, f.aliceCode)).wanted).toEqual([]);
  });

  it('lists the realm’s players by collection, rarity or name', async () => {
    const f = await fixture();
    const all = await listPlayers(db, f.bob, f.realm);
    expect(all.total).toBe(3);
    expect(all.players.map((player) => [player.tradeCode, player.cards, player.self])).toEqual([
      [f.aliceCode, 5, false],
      [f.bobCode, 3, true],
      [(await getRealmView(db, admin, f.realm)).tradeCode, 0, false],
    ]);
    expect(all.players[0].tiers).toEqual(
      (await getPlayerProfile(db, f.alice, f.realm)).stats.tiers,
    );
    expect(JSON.stringify(all)).not.toMatch(/balance|gems|email/i);
    const found = await listPlayers(db, f.bob, f.realm, { query: f.aliceCode });
    expect(found).toMatchObject({ total: 1, players: [{ tradeCode: f.aliceCode }] });
    expect(await listPlayers(db, f.bob, f.realm, { query: 'nobody by this name' })).toEqual({
      total: 0,
      players: [],
    });
    const rarest = await listPlayers(db, f.bob, f.realm, { sort: 'rarest' });
    const rank = (player: (typeof rarest.players)[number]) =>
      [player.tiers.legendary, player.tiers.epic, player.tiers.rare, player.cards]
        .map((count) => String(count).padStart(4, '0'))
        .join('');
    expect(rarest.players.map(rank)).toEqual([...rarest.players.map(rank)].sort().reverse());
    // Paging keeps the total.
    expect(await listPlayers(db, f.bob, f.realm, { offset: 50 })).toEqual({
      total: 3,
      players: [],
    });
    await expect(listPlayers(db, f.bob, f.realm, { sort: 'gems' })).rejects.toThrow();
  });

  it('is part of the player archive and of backups, including older ones', async () => {
    const f = await fixture();
    const saved = await updateProfilePage(db, f.alice, f.realm, {
      bio: 'Open to trades.',
      theme: 'emerald',
      showcase: [f.aliceCards.cardIds[2]],
      showWishlist: true,
    });
    const archive = await exportPlayer(db, f.alice, f.realm);
    expect(archive.profilePage).toEqual(saved);
    expect(parsePlayerArchive(archive)).toEqual(archive);
    expect(await exportPlayer(db, f.bob, f.realm)).not.toHaveProperty('profilePage');
    // Archives written before profile pages have no such field.
    const { profilePage: _page, ...older } = archive;
    void _page;
    expect(parsePlayerArchive(older)).toEqual(older);

    const backup = await makeBackup(db, passphrase);
    const fresh = (await server.database('profile_pages_restore')).db;
    try {
      await restoreBackup(fresh, backup, passphrase);
      await assertBackupRestored(fresh, backup, passphrase);
      expect((await getPlayerProfile(fresh, f.bob, f.realm, f.aliceCode)).page).toEqual(saved);
      // A corrupt page fails the restore check.
      const broken = (await server.database('profile_pages_broken')).db;
      try {
        await restoreBackup(broken, backup, passphrase);
        await broken.query(
          `UPDATE profile_pages SET showcase='["not-a-card"]'::jsonb WHERE account_id=$1`,
          [f.alice],
        );
        await expect(
          broken.query('SELECT 1').then(async () => {
            const { validateProfilePages } = await import('../../packages/db/src/profile-pages');
            const { transaction } = await import('../../packages/db/src/connection');
            await transaction(broken, (tx) => validateProfilePages(tx), true);
          }),
        ).rejects.toThrow('profile pages');
      } finally {
        await broken.end();
      }
    } finally {
      await fresh.end();
    }

    // A database from before profile pages: its backup restores into this
    // release, and updating it in place adds the (empty) table.
    const old = (await server.database('profile_pages_old')).db;
    const target = (await server.database('profile_pages_from_old')).db;
    try {
      await restoreBackup(old, backup, passphrase);
      await old.query(
        "DROP TABLE profile_pages; DELETE FROM schema_migrations WHERE name='0032_profile_pages.sql'",
      );
      const before = await makeBackup(old, passphrase);
      await restoreBackup(target, before, passphrase);
      await assertBackupRestored(target, before, passphrase);
      expect(
        (await getPlayerProfile(target, f.bob, f.realm, f.aliceCode)).page.updatedAt,
      ).toBeNull();
      await migrate(old);
      const migrated = await getPlayerProfile(old, f.alice, f.realm);
      expect(migrated.page.updatedAt).toBeNull();
      expect(migrated.stats.cards).toBe(5);
    } finally {
      await target.end();
      await old.end();
    }
  });
});
