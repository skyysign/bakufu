import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
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
  buyUpgrade,
  createDiscordDatabase,
  createRealm,
  getRealmView,
  inviteDiscordPlayer,
  linkDiscordAccount,
  openPack,
  previewRealmSettings,
  recycleCard,
  applyRealmSettings,
  setDiscordGuild,
  type Database,
} from '../../packages/db/src/index';
import { makeBackup, restoreBackup } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { transaction } from '../../packages/db/src/connection';
import { handleDiscordRequest } from '../../apps/web/lib/discord-interactions';
import { discordQuoteId } from '../../packages/db/src/discord-protocol';
import { startPostgres } from '../support/postgres';
import { installLegacySchema, seedLegacyRealm } from '../support/legacy';
let postgres: Awaited<ReturnType<typeof startPostgres>>,
  db: Database,
  bounded: Database,
  admin: string;
const password = randomBytes(24).toString('hex'),
  app = '900000000000000001',
  aSubject = '100000000000000001',
  bSubject = '200000000000000001';
const keys = generateKeyPairSync('ed25519'),
  publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'),
  settings = { applicationId: app, publicKey };
let sequence = 1n;
const nextId = () => String(700000000000000000n + sequence++);
beforeAll(async () => {
  postgres = await startPostgres();
  const target = await postgres.database('interaction_test');
  db = target.db;
  bounded = createDiscordDatabase(target.url);
  admin = await bootstrap(db, 'discord-command-admin@example.test', password);
  await linkDiscordAccount(db, 'discord-command-admin@example.test', aSubject);
});
afterAll(async () => {
  await bounded?.end();
  await db?.end();
  await postgres?.stop();
});
async function setup(config: RealmConfig = defaultConfig) {
  const id = await createRealm(db, admin, 'Discord command fixture', config),
    guildId = nextId(),
    player = await inviteDiscordPlayer(db, admin, id, bSubject);
  await setDiscordGuild(db, admin, id, guildId);
  const packId = (await getRealmView(db, admin, id)).packs.find(
    (p) => p.name === 'All Characters',
  )!.id;
  return { id, guildId, player, packId };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function deliver(payload: unknown, pool = db, shared = false) {
  const raw = JSON.stringify(payload),
    timestamp = String(Math.floor(Date.now() / 1000)),
    signature = sign(null, Buffer.from(timestamp + raw), keys.privateKey).toString('hex');
  const response = await handleDiscordRequest(
    new Request('http://localhost/api/discord/interactions', {
      method: 'POST',
      headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
      body: raw,
    }),
    settings,
    () => pool,
  );
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({
    type: 4,
    data: { flags: shared ? 0 : 64, allowed_mentions: { parse: [] } },
  });
  return result;
}
function command(r: Fixture, name: string, pack?: string, subject = aSubject, id = nextId()) {
  return {
    id,
    application_id: app,
    type: 2,
    guild_id: r.guildId,
    member: { user: { id: subject } },
    data: {
      name: 'bakufu',
      type: 1,
      options: [
        { type: 1, name, ...(pack ? { options: [{ name: 'pack', type: 3, value: pack }] } : {}) },
      ],
    },
  };
}
async function quote(r: Fixture, subject = aSubject) {
  const payload = command(r, 'open', 'All Characters', subject),
    result = await deliver(payload);
  const id = discordQuoteId(app, payload.id);
  expect(result.data.components[0].components[0].custom_id).toBe(`atlas:open:${id}`);
  return id;
}
function collection(r: Fixture, page = 1, share = false, subject = aSubject) {
  const payload = command(r, 'collection', undefined, subject);
  return {
    ...payload,
    data: {
      ...payload.data,
      options: [
        {
          type: 1,
          name: 'collection',
          options: [
            { type: 4, name: 'page', value: page },
            { type: 5, name: 'share', value: share },
          ],
        },
      ],
    },
  };
}
const click = (r: Fixture, id: string, subject = aSubject, pool = db) =>
  deliver(
    {
      id: nextId(),
      application_id: app,
      type: 3,
      guild_id: r.guildId,
      member: { user: { id: subject } },
      data: { component_type: 2, custom_id: `atlas:open:${id}` },
    },
    pool,
  );
const openings = async (r: Fixture) =>
  (await db.query('SELECT 1 FROM openings WHERE realm_id=$1', [r.id])).rowCount;
describe('signed Discord gameplay with shared PostgreSQL state', () => {
  it('enforces realm-admin binding scope and one server per realm without granting membership', async () => {
    const r = await setup(),
      other = await setup();
    await expect(setDiscordGuild(db, r.player, r.id, nextId())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(setDiscordGuild(db, admin, other.id, r.guildId)).rejects.toMatchObject({
      code: 'GUILD_IN_USE',
    });
    expect((await getRealmView(db, r.player, r.id)).discordGuildId).toBeNull();
    expect((await getRealmView(db, admin, r.id)).discordGuildId).toBe(r.guildId);
    expect((await db.query('SELECT 1 FROM memberships WHERE realm_id=$1', [r.id])).rowCount).toBe(
      2,
    );
  });
  it('rejects unlinked servers and uninvited identities without leaking realm data', async () => {
    const r = await setup();
    expect((await deliver(command({ ...r, guildId: nextId() }, 'status'))).data.content).toContain(
      'not linked',
    );
    expect(
      (await deliver(command(r, 'status', undefined, '300000000000000001'))).data.content,
    ).toContain('invite or link');
    const isolated = await createRealm(db, admin, 'Private realm', defaultConfig),
      isolatedGuild = nextId();
    await setDiscordGuild(db, admin, isolated, isolatedGuild);
    const result = await deliver(
      command({ ...r, id: isolated, guildId: isolatedGuild }, 'status', undefined, bSubject),
    );
    expect(result.data.content).not.toContain('Private realm');
    expect(await openings(r)).toBe(0);
  });
  it("shows only the invoking member's status and realm packs with no asset changes", async () => {
    const r = await setup();
    const status = await deliver(command(r, 'status')),
      packs = await deliver(command(r, 'packs'));
    expect(status.data.content).toContain('100 gems');
    expect(status.data.content).toContain('0 active cards');
    expect(packs.data.content).toContain('All Characters');
    expect(packs.data.content).toContain(r.packId);
    expect(JSON.stringify([status, packs])).not.toMatch(
      /email|password|discord-command-admin|account_id/,
    );
    expect(await openings(r)).toBe(0);
  });
  it('lists paginated current ownership only and shares only when explicitly requested without changing gameplay', async () => {
    const r = await setup({ ...defaultConfig, startingGems: 1000 }),
      other = await setup();
    for (let index = 0; index < 11; index++) {
      const result = await openPack(db, admin, r.id, r.packId, randomUUID());
      expect(result.ok).toBe(true);
    }
    const otherPlayer = await openPack(db, r.player, r.id, r.packId, randomUUID());
    expect(otherPlayer.ok).toBe(true);
    const unrelated = await openPack(db, admin, other.id, other.packId, randomUUID());
    expect(unrelated.ok).toBe(true);
    const cards = (await getRealmView(db, admin, r.id)).cards;
    const snapshot = async () =>
      (
        await db.query(
          `SELECT jsonb_build_object(
      'members',(SELECT jsonb_agg(to_jsonb(t) ORDER BY account_id) FROM memberships t WHERE realm_id=$1),
      'cards',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM cards t WHERE realm_id=$1),
      'openings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM openings t WHERE realm_id=$1),
      'wallet',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM wallet_ledger t WHERE realm_id=$1),
      'xp',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM xp_ledger t WHERE realm_id=$1)
    ) AS state`,
          [r.id],
        )
      ).rows[0].state;
    const before = await snapshot(),
      first = await deliver(collection(r)),
      second = await deliver(collection(r, 2)),
      shared = await deliver(collection(r, 2, true), db, true);
    expect(first.data.content).toContain('11 cards · Page 1/2');
    expect(first.data.content).toContain('Next: /bakufu collection page:2');
    expect(second.data.content).toContain('11 cards · Page 2/2');
    expect(shared.data.content).toContain('Shared in this channel');
    expect(first.data.content).toContain('Only you can see this page');
    for (const card of cards) {
      expect(
        [first.data.content.includes(card.name), second.data.content.includes(card.name)].filter(
          Boolean,
        ),
      ).toHaveLength(1);
      expect(first.data.content + second.data.content).toContain(card.series);
    }
    if (!otherPlayer.ok) throw new Error('Fixture');
    expect(first.data.content + second.data.content).not.toContain(otherPlayer.characters[0].name);
    expect(JSON.stringify([first, second, shared])).not.toMatch(
      /email|password|account_id|discord-command-admin/,
    );
    expect(await snapshot()).toEqual(before);
    await recycleCard(db, admin, r.id, cards[0].cardId, randomUUID());
    const current = await deliver(collection(r));
    expect(current.data.content).toContain('10 cards · Page 1/1');
    expect(current.data.content).not.toContain(cards[0].name);
    expect((await deliver(collection(r, 2, true))).data.content).toContain('1 page');
  });
  it('keeps empty, denied and missing-server collection responses private and realm-scoped', async () => {
    const r = await setup(),
      isolated = await createRealm(db, admin, 'Secret collection realm', defaultConfig),
      isolatedGuild = nextId();
    await setDiscordGuild(db, admin, isolated, isolatedGuild);
    expect((await deliver(collection(r, 1, true))).data.content).toContain('collection is empty');
    expect((await deliver(collection(r, 1, true, '300000000000000001'))).data.content).toContain(
      'invite or link',
    );
    expect(
      (await deliver(collection({ ...r, guildId: nextId() }, 1, true))).data.content,
    ).toContain('not linked');
    const denied = await deliver(collection({ ...r, guildId: isolatedGuild }, 1, true, bSubject));
    expect(denied.data.content).not.toContain('Secret collection realm');
    expect(await openings(r)).toBe(0);
  });
  it('bounds hostile collection names and series while disabling mentions for a shared page', async () => {
    const r = await setup({ ...defaultConfig, startingGems: 1000 });
    for (let index = 0; index < 10; index++)
      expect((await openPack(db, admin, r.id, r.packId, randomUUID())).ok).toBe(true);
    await db.query('UPDATE realms SET name=$2 WHERE id=$1', [r.id, '@'.repeat(80)]);
    await db.query('UPDATE characters SET name=$2,series=$3 WHERE realm_id=$1', [
      r.id,
      '@'.repeat(160),
      '*'.repeat(160),
    ]);
    const result = await deliver(collection(r, 1, true), db, true);
    expect(result.data.content.length).toBeLessThanOrEqual(1900);
    expect(result.data.content).toContain('10. ');
    expect(result.data.content).toContain('Manage cards and trades on the website.');
    expect(result.data.content).toContain('\\@');
    expect(result.data.content).toContain('\\*');
    expect(result.data.allowed_mentions).toEqual({ parse: [] });
  });
  it('lists genre and demographic packs for new Discord requests while preserving prior confirmation receipts', async () => {
    const r = await setup(),
      genrePack = (
        await db.query(
          'SELECT id FROM packs WHERE realm_id=$1 AND category IS NOT NULL ORDER BY id LIMIT 1',
          [r.id],
        )
      ).rows[0].id,
      demographicPack = randomUUID();
    await db.query(
      "UPDATE packs SET name='Battle Arena',category='Action' WHERE realm_id=$1 AND id=$2",
      [r.id, genrePack],
    );
    await db.query(
      "UPDATE characters SET categories=array_append(categories,'Action') WHERE realm_id=$1",
      [r.id],
    );
    const priorPayload = command(r, 'open', 'Battle Arena'),
      prior = await deliver(priorPayload),
      priorQuote = discordQuoteId(app, priorPayload.id);
    expect(prior.data.content).toContain('Battle Arena');
    await db.query(
      "UPDATE characters SET categories=array_append(categories,'Shounen') WHERE realm_id=$1",
      [r.id],
    );
    await db.query(
      "INSERT INTO packs(realm_id,id,name,category) VALUES($1,$2,'Shounen','Shounen')",
      [r.id, demographicPack],
    );
    const listing = await deliver(command(r, 'packs'));
    expect(listing.data.content).toContain('Shōnen');
    expect(listing.data.content).toContain('All Characters');
    // Genre packs stay visible next to demographic packs (web and Discord alike).
    expect(listing.data.content).toContain('Battle Arena');
    expect((await deliver(command(r, 'open', 'Battle Arena'))).data.content).toContain(
      'Confirm within',
    );
    expect((await deliver(command(r, 'open', genrePack))).data.content).toContain('Confirm within');
    expect((await deliver(command(r, 'open', 'Shōnen'))).data.content).toContain('Confirm within');
    const first = await click(r, priorQuote);
    expect(first.data.content).toContain('Pack opened');
    expect(await click(r, priorQuote)).toEqual(first);
  });
  it('creates a private review without spending and rejects cards/packs from another realm', async () => {
    const r = await setup(),
      other = await setup();
    await quote(r);
    expect((await getRealmView(db, admin, r.id)).balance).toBe(100);
    expect(await openings(r)).toBe(0);
    expect((await deliver(command(r, 'open', other.packId))).data.content).toContain('exact pack');
  });
  it('requires the same participant, realm, and server on confirmation', async () => {
    const r = await setup(),
      other = await setup(),
      id = await quote(r);
    expect((await click(r, id, bSubject)).data.content).toContain('unavailable');
    expect((await click(other, id)).data.content).toContain('unavailable');
    expect(await openings(r)).toBe(0);
  });
  it('deduplicates review deliveries and repeated confirmation clicks with immutable receipts', async () => {
    const r = await setup(),
      payload = command(r, 'open', 'All Characters');
    const reviews = await Promise.all([deliver(payload), deliver(payload)]);
    expect(reviews[0]).toEqual(reviews[1]);
    const id = discordQuoteId(app, payload.id),
      results = await Promise.all(Array.from({ length: 6 }, () => click(r, id)));
    results.forEach((result) => expect(result).toEqual(results[0]));
    const view = await getRealmView(db, admin, r.id);
    expect(view.balance).toBe(90);
    expect(view.cards).toHaveLength(1);
    expect(view.progression.totalXp).toBe(10);
    expect(await openings(r)).toBe(1);
    const receipt = await openPack(db, admin, r.id, r.packId, id);
    expect(receipt).toMatchObject({ ok: true, charged: 10, cardIds: [view.cards[0].cardId] });
  });
  it('shares one transaction and retry key with an equivalent concurrent web opening', async () => {
    const r = await setup(),
      id = await quote(r);
    const [discord, web] = await Promise.all([
      click(r, id),
      openPack(db, admin, r.id, r.packId, id, 1),
    ]);
    expect(discord.data.content).toContain('Pack opened');
    expect(web).toMatchObject({ ok: true, charged: 10 });
    expect(await openings(r)).toBe(1);
  });
  it('preserves unique ownership when Discord and web players race for the same last character', async () => {
    const r = await setup({ ...defaultConfig, minimumPoolSize: 1 });
    const character = (
      await db.query('SELECT id FROM characters WHERE realm_id=$1 ORDER BY id LIMIT 1', [r.id])
    ).rows[0].id;
    await db.query(
      "UPDATE characters SET categories=ARRAY['one-discord-fixture'] WHERE realm_id=$1 AND id=$2",
      [r.id, character],
    );
    await db.query("UPDATE packs SET category='one-discord-fixture' WHERE realm_id=$1 AND id=$2", [
      r.id,
      r.packId,
    ]);
    const id = await quote(r);
    await Promise.all([click(r, id), openPack(db, r.player, r.id, r.packId, randomUUID(), 1)]);
    const av = await getRealmView(db, admin, r.id),
      bv = await getRealmView(db, r.player, r.id);
    expect(av.cards.length + bv.cards.length).toBe(1);
    expect(av.balance + bv.balance).toBe(190);
    expect(av.progression.totalXp + bv.progression.totalXp).toBe(10);
  });
  it('rejects stale priced reviews after a config change and accepts a freshly reviewed price', async () => {
    const r = await setup(),
      id = await quote(r),
      p = await previewRealmSettings(db, admin, r.id, { ...defaultConfig, packPrice: 12 });
    await applyRealmSettings(db, admin, r.id, p.id, randomUUID());
    expect((await click(r, id)).data.content).toMatch(/settings|rules/i);
    expect(await openings(r)).toBe(0);
    const fresh = await quote(r);
    expect((await click(r, fresh)).data.content).toContain('Spent 12 gems');
    expect((await getRealmView(db, admin, r.id)).balance).toBe(88);
  });
  it('uses a newly purchased discount without exceeding the reviewed maximum', async () => {
    const r = await setup({
        ...defaultConfig,
        upgrades: { packDiscount: [{ requiredLevel: 1, cost: 1, discount: 2 }] },
      }),
      id = await quote(r);
    await buyUpgrade(db, admin, r.id, 'pack_discount', 1, randomUUID());
    expect((await click(r, id)).data.content).toContain('Spent 8 gems');
    expect((await getRealmView(db, admin, r.id)).balance).toBe(91);
  });
  it('keeps insufficient-fund and cooldown failures deterministic and free of debit or XP', async () => {
    const poor = await setup({ ...defaultConfig, startingGems: 0 }),
      poorQuote = await quote(poor);
    const failed = await click(poor, poorQuote);
    expect(failed.data.content).toContain('enough gems');
    expect(await click(poor, poorQuote)).toEqual(failed);
    expect((await getRealmView(db, admin, poor.id)).cards).toHaveLength(0);
    const r = await setup({ ...defaultConfig, cooldownSeconds: 60 });
    await click(r, await quote(r));
    const id = await quote(r);
    expect((await click(r, id)).data.content).toContain('cooldown');
    expect((await getRealmView(db, admin, r.id)).balance).toBe(90);
  });
  it('expires unused reviews but replays committed receipts after expiry', async () => {
    const r = await setup(),
      id = await quote(r);
    await db.query(
      "UPDATE discord_pack_quotes SET expires_at=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    expect((await click(r, id)).data.content).toContain('expired');
    expect(await openings(r)).toBe(0);
    const used = await quote(r),
      result = await click(r, used);
    await db.query(
      "UPDATE discord_pack_quotes SET expires_at=now()-interval '1 second' WHERE id=$1",
      [used],
    );
    expect(await click(r, used)).toEqual(result);
  });
  it('invalidates old reviews on unlink/relink while keeping no-op links stable', async () => {
    const r = await setup(),
      id = await quote(r);
    await setDiscordGuild(db, admin, r.id, r.guildId);
    expect((await click(r, id)).data.content).toContain('Pack opened');
    const stale = await quote(r);
    await setDiscordGuild(db, admin, r.id, null);
    await setDiscordGuild(db, admin, r.id, r.guildId);
    expect((await click(r, stale)).data.content).toContain('unavailable');
    expect((await getRealmView(db, admin, r.id)).balance).toBe(90);
  });
  it('returns promptly under lock contention and lets the same review retry safely', async () => {
    const r = await setup(),
      id = await quote(r),
      lock = await db.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT 1 FROM realms WHERE id=$1 FOR UPDATE', [r.id]);
    const began = Date.now();
    try {
      expect((await click(r, id, aSubject, bounded)).data.content).toContain('busy');
      expect(Date.now() - began).toBeLessThan(2700);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    expect(await openings(r)).toBe(0);
    expect((await click(r, id, aSubject, bounded)).data.content).toContain('Pack opened');
  });
  it('rolls back a timed-out late debit and recovers the pool for a safe retry', async () => {
    const r = await setup(),
      id = await quote(r);
    await db.query(
      `CREATE FUNCTION slow_discord_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.realm_id='${r.id}' AND NEW.reason='pack_opening' THEN PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $$; CREATE TRIGGER slow_discord_fixture BEFORE INSERT ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION slow_discord_fixture()`,
    );
    try {
      expect((await click(r, id, aSubject, bounded)).data.content).toContain('busy');
    } finally {
      await db.query(
        'DROP TRIGGER slow_discord_fixture ON wallet_ledger; DROP FUNCTION slow_discord_fixture()',
      );
    }
    const view = await getRealmView(db, admin, r.id);
    expect(view.balance).toBe(100);
    expect(view.progression.totalXp).toBe(0);
    expect(view.cards).toHaveLength(0);
    expect(await openings(r)).toBe(0);
    expect((await click(r, id, aSubject, bounded)).data.content).toContain('Pack opened');
  });
  it('terminates an over-budget whole transaction and replaces the failed connection', async () => {
    const client = await bounded.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_sleep(0.8)');
      await expect(client.query('SELECT pg_sleep(0.8)')).rejects.toThrow();
    } finally {
      client.release(true);
    }
    const r = await setup();
    expect((await deliver(command(r, 'status'), bounded)).data.content).toContain('100 gems');
  });
  it('bounds a stalled connection even if PostgreSQL timeouts are disabled in that transaction', async () => {
    const began = Date.now();
    await expect(
      transaction(bounded, async (tx) => {
        await tx.query('SET LOCAL transaction_timeout=0');
        await tx.query('SET LOCAL statement_timeout=0');
        await tx.query('SELECT pg_sleep(3)');
      }),
    ).rejects.toThrow();
    expect(Date.now() - began).toBeLessThan(2700);
    const r = await setup();
    expect((await deliver(command(r, 'status'), bounded)).data.content).toContain('100 gems');
  });
  it('restores server mappings and openings into a fresh database while discarding transient reviews', async () => {
    const r = await setup(),
      used = await quote(r);
    await click(r, used);
    const pending = await quote(r);
    const backup = await makeBackup(db, password),
      target = (await postgres.database('interaction_restored')).db;
    try {
      await restoreBackup(target, backup, password);
      expect(
        (await target.query('SELECT * FROM discord_guild_realms ORDER BY guild_id')).rows,
      ).toEqual((await db.query('SELECT * FROM discord_guild_realms ORDER BY guild_id')).rows);
      expect((await target.query('SELECT 1 FROM discord_pack_quotes')).rowCount).toBe(0);
      expect((await click(r, pending, aSubject, target)).data.content).toContain('unavailable');
      expect(await openPack(target, admin, r.id, r.packId, used)).toEqual(
        await openPack(db, admin, r.id, r.packId, used),
      );
    } finally {
      await target.end();
    }
  });
  it('migrates/restores trading-era snapshots without changing existing rows or introducing bindings', async () => {
    const source = (await postgres.database('before_interactions', false)).db,
      target = (await postgres.database('old_interaction_restore')).db;
    try {
      await installLegacySchema(source, 8);
      const actor = await bootstrap(source, 'old-discord-command@example.test', password),
        old = await seedLegacyRealm(source, actor);
      const sql = `SELECT jsonb_build_object('realms',(SELECT jsonb_agg(to_jsonb(r)) FROM realms r),'members',(SELECT jsonb_agg(to_jsonb(m)) FROM memberships m),'cards',(SELECT jsonb_agg(to_jsonb(c)) FROM cards c),'receipts',(SELECT jsonb_agg(to_jsonb(o)) FROM openings o)) AS state`;
      const before = (await source.query(sql)).rows,
        backup = await makeBackup(source, password);
      const expected = structuredClone(before);
      for (const realm of expected[0].state.realms) {
        expect(realm.config.schemaVersion).toBe(6);
        realm.config = {
          ...realm.config,
          schemaVersion: 12,
          fameFloors: disabledFameFloors,
          legacyPurchasesRetired: false,
          rankTracks: { enabled: false, tracks: [] },
          characterValues: defaultConfig.characterValues,
          tierWeights: { ...realm.config.tierWeights, epic: 0, legendary: 0 },
          recycleRewards: { ...realm.config.recycleRewards, epic: 0, legendary: 0 },
          ranks: disabledCollectorRanks,
          gemRewards: disabledGemRewards,
        };
      }
      // Every receipt, membership, card and other realm field stays exact.
      expect(expected[0].state.receipts).toEqual(before[0].state.receipts);
      // Migration 0017 adds the bundle-count column without changing saved results.
      expected[0].state.receipts = expected[0].state.receipts.map((receipt: object) => ({
        ...receipt,
        pack_count: 1,
      }));
      await migrate(source);
      await migrate(source);
      expect((await source.query(sql)).rows).toEqual(expected);
      await restoreBackup(target, backup, password);
      expect((await target.query(sql)).rows).toEqual(expected);
      expect((await target.query('SELECT 1 FROM discord_guild_realms')).rowCount).toBe(0);
      expect(await openPack(target, actor, old.realmId, old.packId, old.requestKey)).toEqual(
        old.result,
      );
    } finally {
      await source.end();
      await target.end();
    }
  });
});
