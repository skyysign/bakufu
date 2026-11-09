import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../packages/config/src/index';
import {
  addRealmCharacters,
  adminCollectionCommand,
  bootstrap,
  browseRealmCatalog,
  createRealm,
  getRealmView,
  marketCommand,
  openPack,
  previewCharacterRemoval,
  previewRealmCatalog,
  provisionPlayer,
  realmCharacterSummary,
  removeCharacters,
  setWishlistEntry,
  transaction,
  type Database,
} from '../../packages/db/src/index';
import { validateCharacterRemovals } from '../../packages/db/src/character-removal';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { providerCharacterId } from '../../packages/importers/src/providers';
import { startPostgres } from '../support/postgres';

// Original fictional provider-shaped roster: even characters have a picture.
const entry = (index: number) => ({
  id: providerCharacterId('mal', 960000000 + index),
  sourceKey: `mal:${960000000 + index}`,
  name: `Original Lantern Keeper ${index}`,
  series: `Original Saga ${index % 4}`,
  categories: ['Action', '2020s'],
  popularity: 5_000 - index * 10,
  ...(index % 2 === 0
    ? {
        artwork: {
          url: `https://cdn.myanimelist.net/images/characters/1/original-${index}.jpg`,
          sourceUrl: `https://myanimelist.net/character/${960000000 + index}`,
          permission: 'Original fixture permission statement',
        },
      }
    : {}),
});
const roster = {
  schemaVersion: 1,
  source: 'mal',
  revision: 'original-removal-fixture',
  license: 'Original fictional provider-shaped fixture, MIT',
  characters: Array.from({ length: 40 }, (_, index) => entry(index)),
};

let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
let players = 0;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('character_removal_test')).db;
  admin = await bootstrap(db, 'removal-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

async function setup() {
  const config = { ...defaultConfig, startingGems: 20_000 };
  const catalog = { data: roster, rightsConfirmed: true };
  const preview = await previewRealmCatalog(db, admin, config, catalog);
  const realm = await createRealm(
    db,
    admin,
    'Removal fixture',
    config,
    catalog,
    preview.fingerprint,
  );
  const player = await provisionPlayer(db, realm, `removal-${++players}@example.test`, password);
  const view = await getRealmView(db, player, realm);
  const pack = view.packs.find((p) => p.name === 'All Characters')!.id;
  // The player owns 20 of the 40 characters.
  const opening = await openPack(db, player, realm, pack, randomUUID(), view.configRevision, 10);
  const second = await openPack(db, player, realm, pack, randomUUID(), view.configRevision, 10);
  if (!opening.ok || !second.ok) throw new Error('Fixture opening failed.');
  return { realm, player, pack, revision: view.configRevision };
}
const characters = async (realm: string) =>
  (
    await db.query(
      `SELECT c.id,c.name,c.provenance ? 'artwork' AS artwork,c.retired_at,o.id AS card_id,o.owner_id
      FROM characters c LEFT JOIN cards o ON o.realm_id=c.realm_id AND o.character_id=c.id AND o.recycled_at IS NULL
      WHERE c.realm_id=$1 ORDER BY c.name`,
      [realm],
    )
  ).rows as {
    id: string;
    name: string;
    artwork: boolean;
    retired_at: Date | null;
    card_id: string | null;
    owner_id: string | null;
  }[];

describe('removing characters', () => {
  it('is for catalog administrators only', async () => {
    const r = await setup();
    const selection = { withoutArtwork: true };
    await expect(previewCharacterRemoval(db, r.player, r.realm, selection)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      removeCharacters(db, r.player, r.realm, {
        selection,
        previewHash: 'a'.repeat(64),
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('removes every character without a picture and refunds their owners', async () => {
    const r = await setup();
    const before = await characters(r.realm);
    const noPicture = before.filter((c) => !c.artwork);
    const owned = noPicture.filter((c) => c.card_id);
    expect(owned.length).toBeGreaterThan(1);
    // One owned card is on the market: that character stays.
    const listed = owned[0];
    await marketCommand(
      db,
      r.player,
      r.realm,
      { action: 'list', cardId: listed.card_id!, price: 90 },
      randomUUID(),
    );
    // The player wished for an unowned character that will be removed.
    const wished = noPicture.find((c) => !c.card_id)!;
    await setWishlistEntry(db, r.player, r.realm, wished.id, true, randomUUID(), r.revision);
    const balance = (await getRealmView(db, r.player, r.realm)).balance;

    const preview = await previewCharacterRemoval(db, admin, r.realm, { withoutArtwork: true });
    expect(preview.removable).toBe(noPicture.length - 1);
    expect(preview.owned).toBe(owned.length - 1);
    expect(preview.refundGems).toBeGreaterThan(0);
    expect(preview.skipped).toEqual([
      { characterId: listed.id, name: listed.name, reason: 'market' },
    ]);
    const requestKey = randomUUID();
    const result = await removeCharacters(db, admin, r.realm, {
      selection: { withoutArtwork: true },
      previewHash: preview.previewHash,
      requestKey,
    });
    expect(result).toMatchObject({
      ok: true,
      removed: preview.removable,
      refundedCards: preview.owned,
      refundedGems: preview.refundGems,
      skipped: 1,
      wishesCleared: 1,
    });
    // Owners got the recycle value; their cards are gone, the listed one stays.
    const view = await getRealmView(db, r.player, r.realm);
    expect(view.balance).toBe(balance + preview.refundGems);
    const after = await characters(r.realm);
    for (const character of after) {
      const removed = !character.artwork && character.id !== listed.id;
      expect(!!character.retired_at).toBe(removed);
      if (removed) expect(character.card_id).toBeNull();
    }
    expect(after.find((c) => c.id === listed.id)!.card_id).toBe(listed.card_id);
    // Removed characters are out of the glossary, the counts and every future pull.
    const glossary = await browseRealmCatalog(db, r.player, r.realm, { limit: 60 });
    expect(glossary.total).toBe(40 - preview.removable);
    expect((await realmCharacterSummary(db, admin, r.realm)).characterCount).toBe(
      40 - preview.removable,
    );
    const retired = new Set(after.filter((c) => c.retired_at).map((c) => c.id));
    const more = await openPack(db, r.player, r.realm, r.pack, randomUUID(), r.revision, 10);
    if (more.ok) expect(more.characters.some((c) => retired.has(c.id))).toBe(false);
    else expect(more.code).toBe('POOL_EXHAUSTED');

    // Retry replays; a different review with the same key conflicts.
    await expect(
      removeCharacters(db, admin, r.realm, {
        selection: { withoutArtwork: true },
        previewHash: preview.previewHash,
        requestKey,
      }),
    ).resolves.toEqual(result);
    await expect(
      removeCharacters(db, admin, r.realm, {
        selection: { withoutArtwork: true },
        previewHash: 'b'.repeat(64),
        requestKey,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    // A refunded card can't be restored while its character is removed.
    const refunded = owned[1];
    const recycling = (
      await db.query('SELECT 1 FROM recyclings WHERE realm_id=$1 AND card_id=$2', [
        r.realm,
        refunded.card_id,
      ])
    ).rowCount;
    expect(recycling).toBe(1);
    await expect(
      adminCollectionCommand(db, admin, r.realm, {
        kind: 'restore_card',
        requestKey: randomUUID(),
        memberCode: view.tradeCode,
        cardId: refunded.card_id,
        takeBackGems: true,
        note: 'Removed by mistake',
      }),
    ).rejects.toMatchObject({ code: 'CHARACTER_REMOVED' });

    // Adding it again brings the character back with its saved tier.
    const back = await addRealmCharacters(db, admin, r.realm, {
      characters: [roster.characters.find((c) => c.id === refunded.id)!],
      rightsConfirmed: true,
    });
    expect(back.added.map((c) => c.id)).toEqual([refunded.id]);
    expect((await characters(r.realm)).find((c) => c.id === refunded.id)!.retired_at).toBeNull();
    await transaction(db, (tx) => validateCharacterRemovals(tx));
  });

  it('removes one character, refuses a stale review and restores to a fresh database', async () => {
    const r = await setup();
    const target = (await characters(r.realm)).find((c) => c.artwork && c.card_id)!;
    const stale = await previewCharacterRemoval(db, admin, r.realm, {
      characterIds: [target.id],
    });
    expect(stale).toMatchObject({ removable: 1, owned: 1 });
    // The owner lists the card in between: the review no longer matches.
    const listing = await marketCommand(
      db,
      r.player,
      r.realm,
      { action: 'list', cardId: target.card_id!, price: 50 },
      randomUUID(),
    );
    await expect(
      removeCharacters(db, admin, r.realm, {
        selection: { characterIds: [target.id] },
        previewHash: stale.previewHash,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    const listed = await previewCharacterRemoval(db, admin, r.realm, {
      characterIds: [target.id],
    });
    expect(listed).toMatchObject({ removable: 0, skipped: [{ characterId: target.id }] });
    await expect(
      removeCharacters(db, admin, r.realm, {
        selection: { characterIds: [target.id] },
        previewHash: listed.previewHash,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NO_CHANGES' });
    // After the listing is cancelled the removal goes through with a refund.
    await marketCommand(
      db,
      r.player,
      r.realm,
      { action: 'cancel', listingId: (listing as { listingId: string }).listingId },
      randomUUID(),
    );
    const fresh = await previewCharacterRemoval(db, admin, r.realm, {
      characterIds: [target.id],
    });
    await expect(
      removeCharacters(db, admin, r.realm, {
        selection: { characterIds: [target.id] },
        previewHash: fresh.previewHash,
        requestKey: randomUUID(),
      }),
    ).resolves.toMatchObject({ removed: 1, refundedCards: 1 });
    await expect(
      previewCharacterRemoval(db, admin, r.realm, { characterIds: [target.id] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const passphrase = randomBytes(24).toString('hex');
    const backup = await makeBackup(db, passphrase);
    const restored = (await server.database('character_removal_restore')).db;
    try {
      await restoreBackup(restored, backup, passphrase);
      for (const query of [
        'SELECT jsonb_agg(to_jsonb(t) ORDER BY t.realm_id,t.id) AS data FROM character_removals t',
        'SELECT jsonb_agg(jsonb_build_array(realm_id,id,retired_at) ORDER BY realm_id,id) AS data FROM characters',
      ])
        expect((await restored.query(query)).rows).toEqual((await db.query(query)).rows);
    } finally {
      await restored.end();
    }
    // A character marked removed without a journal entry doesn't reconcile.
    const rollback = new Error('rollback');
    await expect(
      transaction(db, async (tx) => {
        await tx.query(
          `UPDATE characters SET retired_at=now() WHERE realm_id=$1 AND id=(
            SELECT c.id FROM characters c WHERE c.realm_id=$1 AND c.retired_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM cards o WHERE o.realm_id=c.realm_id AND o.character_id=c.id AND o.recycled_at IS NULL) LIMIT 1)`,
          [r.realm],
        );
        await expect(validateCharacterRemovals(tx)).rejects.toThrow(/unjournaled removal/);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
