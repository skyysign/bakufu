import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrap,
  createRealm,
  getRealmView,
  linkDiscordAccount,
  openPack,
  provisionPlayer,
  readCharacterSound,
  readTierSound,
  removeCharacterSound,
  setCharacterSound,
  recentPulls,
  removeTierSound,
  setTierSound,
  type Database,
} from '../../packages/db/src/index';
import { encodeWav, toBase64 } from '../../apps/web/app/sound-prepare';
import { defaultConfig } from '../../packages/config/src/index';
import { startPostgres } from '../support/postgres';

const config = { ...defaultConfig, startingGems: 20000 };
const wav = (seconds: number) =>
  toBase64(
    encodeWav(
      Float32Array.from({ length: Math.round(seconds * 8000) }, (_, i) => Math.sin(i / 5) * 0.4),
      8000,
    ),
  );

let server: Awaited<ReturnType<typeof startPostgres>>,
  db: Database,
  admin: string,
  player: string,
  outsider: string,
  realm: string,
  other: string;
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('pulls_sounds')).db;
  admin = await bootstrap(db, 'pulls-admin@example.test', randomBytes(24).toString('hex'));
  realm = await createRealm(db, admin, 'Original pulls realm', config);
  other = await createRealm(db, admin, 'Original other realm', config);
  player = await provisionPlayer(
    db,
    realm,
    'pulls-player@example.test',
    randomBytes(24).toString('hex'),
  );
  outsider = await provisionPlayer(
    db,
    other,
    'pulls-outsider@example.test',
    randomBytes(24).toString('hex'),
  );
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});

describe('live pulls', () => {
  it('lists the newest awarded cards first, for members only, without emails', async () => {
    expect((await recentPulls(db, player, realm)).pulls).toEqual([]);
    const view = await getRealmView(db, admin, realm);
    const all = view.packs.find((pack) => pack.category === null)!;
    const first = await openPack(db, admin, realm, all.id, randomUUID(), view.configRevision);
    const playerView = await getRealmView(db, player, realm);
    const second = await openPack(
      db,
      player,
      realm,
      all.id,
      randomUUID(),
      playerView.configRevision,
      5,
    );
    if (!first.ok || !second.ok) throw new Error('Original fixture openings failed.');
    const feed = await recentPulls(db, player, realm, {
      tiers: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
    });
    // By default the Packs page shows rare and above only.
    const notable = (await recentPulls(db, player, realm)).pulls;
    expect(notable.map((pull) => pull.key)).toEqual(
      feed.pulls
        .filter((pull) => ['rare', 'epic', 'legendary'].includes(pull.tier))
        .map((pull) => pull.key),
    );
    expect(feed.pulls.map((pull) => pull.characterId)).toEqual([
      ...second.characters.map((character) => character.id).reverse(),
      first.characters[0].id,
    ]);
    expect(feed.pulls[0]).toMatchObject({
      mine: true,
      packName: 'All Characters',
      collector: null,
      tier: second.characters[4].tier,
    });
    expect(feed.pulls[5].mine).toBe(false);
    // The inspector gets the same details as collection and glossary cards.
    expect(feed.pulls[0].status).toBe('yours');
    expect(feed.pulls[5].status).toBe('claimed');
    expect(feed.pulls[0].valuation).toMatchObject({
      marketValue: expect.any(Number),
      recycleValue: expect.any(Number),
    });
    expect(JSON.stringify(feed)).not.toContain('@example.test');
    expect((await recentPulls(db, admin, other)).pulls).toEqual([]);
    await expect(recentPulls(db, outsider, realm)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('names who holds each pulled character, never by email', async () => {
    await linkDiscordAccount(db, 'pulls-admin@example.test', '500000000000000777');
    await db.query(
      'INSERT INTO discord_profiles(account_id,username,display_name) VALUES($1,$2,$3)',
      [admin, 'original_pulls_admin', 'Original Pulls Admin'],
    );
    const all = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
    const adminCode = (await getRealmView(db, admin, realm)).tradeCode,
      playerCode = (await getRealmView(db, player, realm)).tradeCode;
    const seen = await recentPulls(db, player, realm, { tiers: all });
    const claimed = seen.pulls.filter((pull) => pull.status === 'claimed');
    expect(claimed.length).toBeGreaterThan(0);
    for (const pull of claimed)
      expect(pull.owner).toEqual({
        tradeCode: adminCode,
        displayName: 'Original Pulls Admin',
        username: 'original_pulls_admin',
      });
    // Your own cards carry no owner; the other member sees you by trade ID.
    for (const pull of seen.pulls.filter((entry) => entry.status === 'yours'))
      expect(pull.owner).toBeUndefined();
    const fromAdmin = await recentPulls(db, admin, realm, { tiers: all });
    for (const pull of fromAdmin.pulls.filter((entry) => entry.status === 'claimed'))
      expect(pull.owner).toEqual({ tradeCode: playerCode, displayName: null, username: null });
    expect(JSON.stringify([seen, fromAdmin])).not.toContain('@example.test');
  });

  it('pages further back in the same order, also inside one opening', async () => {
    const all = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
    const whole = await recentPulls(db, player, realm, { tiers: all, limit: 48 });
    // One opening of five cards and one of a single card.
    expect(whole.pulls).toHaveLength(6);
    expect(whole.more).toBe(false);
    const cursor = (key: string) => {
      const [openingId, index] = key.split(':');
      return { openingId, index: Number(index) };
    };
    for (const limit of [1, 2, 4, 5]) {
      const pages = [await recentPulls(db, player, realm, { tiers: all, limit })];
      while (pages.at(-1)!.more)
        pages.push(
          await recentPulls(db, player, realm, {
            tiers: all,
            limit,
            before: cursor(pages.at(-1)!.pulls.at(-1)!.key),
          }),
        );
      expect(pages.flatMap((page) => page.pulls.map((pull) => pull.key))).toEqual(
        whole.pulls.map((pull) => pull.key),
      );
      expect(pages.slice(0, -1).every((page) => page.pulls.length === limit)).toBe(true);
    }
    // After the oldest pull, or from an unknown pull, there is nothing more.
    expect(
      await recentPulls(db, player, realm, {
        tiers: all,
        before: cursor(whole.pulls.at(-1)!.key),
      }),
    ).toEqual({ pulls: [], more: false });
    expect(
      await recentPulls(db, player, realm, { before: { openingId: randomUUID(), index: 0 } }),
    ).toEqual({ pulls: [], more: false });
    await expect(
      recentPulls(db, player, realm, { before: { openingId: 'not-an-id', index: 0 } }),
    ).rejects.toThrow();
    await expect(
      recentPulls(db, outsider, realm, { before: cursor(whole.pulls[0].key) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('admin reveal sounds per tier', () => {
  it('stores validated sounds, exposes them in the realm view and serves members', async () => {
    const sounds = await setTierSound(db, admin, realm, {
      tier: 'legendary',
      fileName: 'original-fanfare.mp3',
      audio: wav(2),
      rightsConfirmed: true,
    });
    expect(sounds.legendary).toMatchObject({ fileName: 'original-fanfare.mp3', durationMs: 2000 });
    expect((await getRealmView(db, player, realm)).tierSounds.legendary?.durationMs).toBe(2000);
    expect((await getRealmView(db, admin, other)).tierSounds).toEqual({});
    const served = await readTierSound(db, player, realm, 'legendary');
    expect(served?.audio.subarray(0, 4).toString()).toBe('RIFF');
    expect(await readTierSound(db, player, realm, 'common')).toBeNull();
    await expect(readTierSound(db, outsider, realm, 'legendary')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // Replacing keeps one row per tier.
    await setTierSound(db, admin, realm, {
      tier: 'legendary',
      fileName: 'original-fanfare-2.wav',
      audio: wav(1),
      rightsConfirmed: true,
    });
    const rows = await db.query(
      'SELECT tier,file_name,duration_ms FROM realm_tier_sounds WHERE realm_id=$1',
      [realm],
    );
    expect(rows.rows).toEqual([
      { tier: 'legendary', file_name: 'original-fanfare-2.wav', duration_ms: 1000 },
    ]);
    expect(await removeTierSound(db, admin, realm, 'legendary')).toEqual({});
  });

  it('rejects players, long or invalid audio and missing permission', async () => {
    const valid = { tier: 'rare', fileName: 'chime.wav', audio: wav(1), rightsConfirmed: true };
    await expect(setTierSound(db, player, realm, valid)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      setTierSound(db, admin, realm, { ...valid, audio: wav(31) }),
    ).rejects.toMatchObject({
      code: 'SOUND_TOO_LONG',
    });
    await expect(
      setTierSound(db, admin, realm, {
        ...valid,
        audio: Buffer.from('x'.repeat(200)).toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'SOUND_INVALID' });
    await expect(
      setTierSound(db, admin, realm, { ...valid, rightsConfirmed: false }),
    ).rejects.toThrow();
    await expect(setTierSound(db, admin, realm, { ...valid, tier: 'mythic' })).rejects.toThrow();
    await expect(removeTierSound(db, player, realm, 'rare')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const count = await db.query('SELECT count(*)::int AS count FROM realm_tier_sounds');
    expect(count.rows[0].count).toBe(0);
  });
});

describe('admin reveal sounds per character', () => {
  it('stores a character sound that the realm view lists separately from tier sounds', async () => {
    const view = await getRealmView(db, admin, realm);
    const character = view.catalog[0];
    const sounds = await setCharacterSound(db, admin, realm, {
      characterId: character.id,
      fileName: 'original-theme.ogg',
      audio: wav(1.5),
      rightsConfirmed: true,
    });
    expect(sounds[character.id]).toMatchObject({
      fileName: 'original-theme.ogg',
      durationMs: 1500,
      name: character.name,
      tier: character.tier,
    });
    const playerView = await getRealmView(db, player, realm);
    expect(Object.keys(playerView.characterSounds)).toEqual([character.id]);
    expect(playerView.tierSounds).toEqual({});
    expect(
      (await readCharacterSound(db, player, realm, character.id))?.audio.subarray(0, 4).toString(),
    ).toBe('RIFF');
    await expect(readCharacterSound(db, outsider, realm, character.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      setCharacterSound(db, player, realm, {
        characterId: character.id,
        fileName: 'x.wav',
        audio: wav(1),
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      setCharacterSound(db, admin, realm, {
        characterId: randomUUID(),
        fileName: 'x.wav',
        audio: wav(1),
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      setCharacterSound(db, admin, realm, {
        characterId: character.id,
        fileName: 'long.wav',
        audio: wav(31),
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'SOUND_TOO_LONG' });
    expect(await removeCharacterSound(db, admin, realm, character.id)).toEqual({});
    expect(await readCharacterSound(db, player, realm, character.id)).toBeNull();
  });
});
