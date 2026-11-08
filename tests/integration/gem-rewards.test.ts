import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  disabledGemRewards,
  parseRealmConfig,
  type RealmConfig,
} from '../../packages/config/src/index';
import { defaultConfig, legacyRules } from '../support/prototype-config';
import {
  bootstrap,
  createRealm,
  exportPlayer,
  parsePlayerArchive,
  previewRealmSettings,
  applyRealmSettings,
  provisionPlayer,
  getRealmView,
  type Database,
} from '../../packages/db/src/index';
import { claimGems, gemRewardState } from '../../packages/db/src/gem-rewards';
import { validateGemRewardBackup } from '../../packages/db/src/gem-reward-backup';
import { transaction } from '../../packages/db/src/connection';
import { makeBackup, restoreBackup, assertBackupRestored } from '../../packages/db/src/backup';
import { migrate } from '../../packages/db/src/migrate';
import { installLegacySchema } from '../support/legacy';
import { startPostgres } from '../support/postgres';
let server: Awaited<ReturnType<typeof startPostgres>>, db: Database, admin: string;
const password = randomBytes(24).toString('hex');
beforeAll(async () => {
  server = await startPostgres();
  db = (await server.database('gem_rewards')).db;
  admin = await bootstrap(db, 'gem-rewards-admin@example.test', password);
});
afterAll(async () => {
  await db?.end();
  await server?.stop();
});
const realm = (config: RealmConfig = defaultConfig) =>
  createRealm(db, admin, 'Timed rewards', config);
const claim = (id: string, key: string = randomUUID(), actor = admin, revision?: number) =>
  claimGems(db, actor, id, key, revision);
const state = (id: string, actor = admin) =>
  transaction(db, async (tx) =>
    gemRewardState(
      tx,
      id,
      actor,
      parseRealmConfig(
        (await tx.query('SELECT config FROM realms WHERE id=$1', [id])).rows[0].config,
      ),
    ),
  );
// Move one original-fixture claim consistently into the past to avoid sleeps and
// preserve the immutable-receipt/ledger shape used by fresh recovery tests.
async function expire(id: string, secondsAgo = 21601) {
  await transaction(db, async (tx) => {
    const row = (
      await tx.query(
        'SELECT id,request_key,created_at,config_snapshot FROM gem_reward_claims WHERE realm_id=$1 ORDER BY created_at DESC LIMIT 1',
        [id],
      )
    ).rows[0];
    const now = (await tx.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
    const at = new Date(now.getTime() - secondsAgo * 1000),
      next = new Date(at.getTime() + row.config_snapshot.gemRewards.intervalSeconds * 1000);
    await tx.query(
      `UPDATE gem_reward_claims SET created_at=$3,result=jsonb_set(jsonb_set(result,'{claimedAt}',to_jsonb($4::text)),'{nextClaimAt}',to_jsonb($5::text)) WHERE realm_id=$1 AND id=$2`,
      [id, row.id, at, at.toISOString(), next.toISOString()],
    );
    await tx.query(
      'UPDATE wallet_ledger SET created_at=$3 WHERE realm_id=$1 AND operation_key=$2',
      [id, `gem-reward:${row.request_key}`, at],
    );
  });
}
describe('transactional timed gem claims', () => {
  it('deduplicates concurrent same-key and uppercase retries without extra wallet awards or XP', async () => {
    const id = await realm(),
      key = randomUUID();
    const results = await Promise.all([
      claim(id, key),
      claim(id, key.toUpperCase()),
      claim(id, key),
    ]);
    results.forEach((result) => expect(result).toEqual(results[0]));
    expect(results[0]).toMatchObject({ ok: true, amount: 25, balance: 125 });
    expect(
      (await db.query('SELECT 1 FROM gem_reward_claims WHERE realm_id=$1', [id])).rowCount,
    ).toBe(1);
    expect(
      (
        await db.query("SELECT 1 FROM wallet_ledger WHERE realm_id=$1 AND reason='gem_reward'", [
          id,
        ])
      ).rowCount,
    ).toBe(1);
    expect((await getRealmView(db, admin, id)).progression.totalXp).toBe(0);
    expect(await state(id)).toMatchObject({
      claimable: false,
      lastClaimAt: results[0].claimedAt,
      nextClaimAt: results[0].nextClaimAt,
    });
  });
  it('awards only once when different keys race inside one window', async () => {
    const id = await realm(),
      results = await Promise.allSettled(Array.from({ length: 4 }, () => claim(id)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    results
      .filter((result) => result.status === 'rejected')
      .forEach((result) =>
        expect(result).toMatchObject({ reason: { code: 'GEM_REWARD_COOLDOWN', status: 409 } }),
      );
    expect((await getRealmView(db, admin, id)).balance).toBe(125);
  });
  it("archives only the player's claims and rejects forged or missing reward history", async () => {
    const id = await realm(),
      key = randomUUID(),
      receipt = await claim(id, key),
      other = await provisionPlayer(db, id, `${randomUUID()}@example.test`, password),
      otherReceipt = await claim(id, randomUUID(), other),
      archive = await exportPlayer(db, admin, id);
    const { ok, ...saved } = receipt;
    expect(ok).toBe(true);
    expect(parsePlayerArchive(archive)).toEqual(archive);
    expect(archive).toMatchObject({
      schemaVersion: 12,
      gemRewardRules: defaultConfig.gemRewards,
      gemRewardClaims: [{ ...saved, requestKey: key, rules: defaultConfig.gemRewards }],
    });
    expect(archive.gemRewardClaims).toHaveLength(1);
    expect(JSON.stringify(archive)).not.toContain(otherReceipt.claimId);
    expect(() => parsePlayerArchive({ ...archive, gemRewardClaims: [] })).toThrow();
    expect(() =>
      parsePlayerArchive({
        ...archive,
        gemRewardClaims: [{ ...archive.gemRewardClaims[0], nextClaimAt: receipt.claimedAt }],
      }),
    ).toThrow();
    expect(() =>
      parsePlayerArchive({
        ...archive,
        gemRewardClaims: [{ ...archive.gemRewardClaims[0], amount: receipt.amount + 1 }],
      }),
    ).toThrow();
  });
  it('requires membership even for replay and isolates each player and realm', async () => {
    const id = await realm(),
      other = await realm(),
      key = randomUUID();
    await claim(id, key);
    const outsider = await provisionPlayer(db, other, `${randomUUID()}@example.test`, password);
    await expect(claim(id, key, outsider)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await claim(other, key, outsider)).toMatchObject({ amount: 25, balance: 125 });
    await provisionPlayer(db, id, `${randomUUID()}@example.test`, password);
    expect(await claim(other, key)).toMatchObject({ amount: 25, balance: 125 });
  });
  it('rejects disabled rewards/stale pages and replays a committed receipt after disabling', async () => {
    const disabled = await realm({ ...defaultConfig, gemRewards: disabledGemRewards });
    await expect(claim(disabled)).rejects.toMatchObject({ code: 'GEM_REWARDS_DISABLED' });
    expect((await getRealmView(db, admin, disabled)).balance).toBe(100);
    const id = await realm(),
      key = randomUUID();
    await expect(claim(id, key, admin, 0)).rejects.toMatchObject({ code: 'SETTINGS_CHANGED' });
    const receipt = await claim(id, key, admin, 1);
    await db.query(
      "UPDATE realms SET config=jsonb_set(config,'{gemRewards,enabled}','false'),config_revision=config_revision+1 WHERE id=$1",
      [id],
    );
    expect(await claim(id, key, admin, 0)).toEqual(receipt);
    await expect(claim(id)).rejects.toMatchObject({ code: 'GEM_REWARDS_DISABLED' });
  });
  it('uses one reward after long absence, then current reviewed interval and amount', async () => {
    const id = await realm(),
      first = await claim(id);
    await expire(id, 21600 * 30);
    const second = await claim(id);
    expect(second.amount).toBe(first.amount);
    expect(second.balance).toBe(150);
    await db.query(
      "UPDATE realms SET config=jsonb_set(config,'{gemRewards}',$2::jsonb) WHERE id=$1",
      [id, { enabled: true, amount: 40, intervalSeconds: 60 }],
    );
    expect(await state(id)).toMatchObject({ claimable: false, amount: 40, intervalSeconds: 60 });
    await expire(id, 61);
    expect(await claim(id)).toMatchObject({ amount: 40, balance: 190 });
  });
  it('leaves no receipt, grant or balance change after a rejected wallet overflow', async () => {
    const id = await realm();
    await db.query('UPDATE memberships SET balance=2147483640 WHERE realm_id=$1', [id]);
    try {
      await expect(claim(id)).rejects.toMatchObject({ code: 'WALLET_LIMIT' });
      expect(
        (await db.query('SELECT 1 FROM gem_reward_claims WHERE realm_id=$1', [id])).rowCount,
      ).toBe(0);
      expect((await getRealmView(db, admin, id)).balance).toBe(2147483640);
    } finally {
      await db.query('UPDATE memberships SET balance=100 WHERE realm_id=$1', [id]);
    }
  });
  it('rolls back an injected ledger failure and permits the same request to recover', async () => {
    const id = await realm(),
      key = randomUUID();
    await db.query(
      `CREATE FUNCTION reject_gem_reward_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='gem_reward' THEN RAISE EXCEPTION 'fixture'; END IF;RETURN NEW;END $$;CREATE TRIGGER reject_gem_reward_fixture BEFORE INSERT ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION reject_gem_reward_fixture();`,
    );
    try {
      await expect(claim(id, key)).rejects.toThrow();
    } finally {
      await db.query(
        'DROP TRIGGER reject_gem_reward_fixture ON wallet_ledger;DROP FUNCTION reject_gem_reward_fixture();',
      );
    }
    expect(
      (await db.query('SELECT 1 FROM gem_reward_claims WHERE realm_id=$1', [id])).rowCount,
    ).toBe(0);
    expect((await getRealmView(db, admin, id)).balance).toBe(100);
    const receipt = await claim(id, key);
    expect(await claim(id, key)).toEqual(receipt);
  });
  it('preserves earned claims and replay through encrypted fresh-database recovery', async () => {
    const source = (await server.database('gem_rewards_backup')).db,
      fresh = (await server.database('gem_rewards_restored')).db;
    try {
      const actor = await bootstrap(source, 'reward-backup@example.test', password),
        id = await createRealm(source, actor, 'Reward backup', defaultConfig),
        key = randomUUID();
      const receipt = await claimGems(source, actor, id, key);
      const proposed = {
        ...defaultConfig,
        gemRewards: { enabled: true, amount: 40, intervalSeconds: 60 },
      };
      const review = await previewRealmSettings(source, actor, id, proposed);
      await applyRealmSettings(source, actor, id, review.id, randomUUID());
      // Make only the historical fixture clock older; both the receipt and
      // ledger retain their original 25-gem, six-hour policy snapshot.
      const old = new Date(Date.now() - 61000),
        historical = {
          ...receipt,
          claimedAt: old.toISOString(),
          nextClaimAt: new Date(old.getTime() + 21600000).toISOString(),
        };
      await source.query(
        'UPDATE gem_reward_claims SET created_at=$3,result=$4 WHERE realm_id=$1 AND request_key=$2',
        [id, key, old, historical],
      );
      await source.query(
        'UPDATE wallet_ledger SET created_at=$3 WHERE realm_id=$1 AND operation_key=$2',
        [id, `gem-reward:${key}`, old],
      );
      const nextKey = randomUUID(),
        second = await claimGems(source, actor, id, nextKey, 2);
      expect(second).toMatchObject({ amount: 40, balance: 165 });
      const playerArchive = await exportPlayer(source, actor, id);
      expect(parsePlayerArchive(playerArchive)).toEqual(playerArchive);
      expect(playerArchive.gemRewardClaims.map((entry) => entry.rules)).toEqual([
        defaultConfig.gemRewards,
        proposed.gemRewards,
      ]);
      await transaction(source, validateGemRewardBackup);
      const archive = await makeBackup(source, password);
      await restoreBackup(fresh, archive, password);
      await assertBackupRestored(fresh, archive, password);
      expect(await claimGems(fresh, actor, id, key, 0)).toEqual(historical);
      expect(await claimGems(fresh, actor, id, nextKey, 0)).toEqual(second);
      expect((await getRealmView(fresh, actor, id)).balance).toBe(165);
      await expect(claimGems(fresh, actor, id, randomUUID())).rejects.toMatchObject({
        code: 'GEM_REWARD_COOLDOWN',
      });
    } finally {
      await source.end();
      await fresh.end();
    }
  });
  it('rejects forged reward amounts and next-claim timing on fresh restore', async () => {
    const source = (await server.database('gem_rewards_forged')).db,
      fresh = (await server.database('gem_rewards_forged_restore')).db;
    try {
      const actor = await bootstrap(source, 'reward-forge@example.test', password),
        id = await createRealm(source, actor, 'Reward forged', defaultConfig);
      const receipt = await claimGems(source, actor, id, randomUUID());
      await source.query(
        "UPDATE gem_reward_claims SET result=jsonb_set(result,'{nextClaimAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE realm_id=$1",
        [id],
      );
      const archive = await makeBackup(source, password);
      await expect(restoreBackup(fresh, archive, password)).rejects.toThrow('gem reward');
      expect((await fresh.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
      // Keep the forged wallet, ledger and receipt internally balanced: restore
      // must still reject currency that exceeds the saved reward rule.
      await source.query('UPDATE gem_reward_claims SET result=$2 WHERE realm_id=$1', [
        id,
        { ...receipt, amount: 75, balance: 175 },
      ]);
      await source.query(
        "UPDATE wallet_ledger SET amount=75,balance_after=175 WHERE realm_id=$1 AND reason='gem_reward'",
        [id],
      );
      await source.query('UPDATE memberships SET balance=175 WHERE realm_id=$1', [id]);
      await expect(
        restoreBackup(fresh, await makeBackup(source, password), password),
      ).rejects.toThrow('gem reward');
      expect((await fresh.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    } finally {
      await source.end();
      await fresh.end();
    }
  });
  it('migrates the preceding schema and older backup with rewards disabled and prior records exact', async () => {
    const legacy = (await server.database('gem_rewards_legacy', false)).db,
      fresh = (await server.database('gem_rewards_legacy_restore')).db;
    try {
      await installLegacySchema(legacy, 15);
      const actor = await bootstrap(legacy, 'reward-legacy@example.test', password),
        id = randomUUID();
      const { gemRewards, ...base } = defaultConfig;
      void gemRewards;
      const previous = { ...legacyRules(base), schemaVersion: 7 };
      await legacy.query('INSERT INTO realms(id,name,config,created_by) VALUES($1,$2,$3,$4)', [
        id,
        'Reward legacy',
        previous,
        actor,
      ]);
      await legacy.query(
        "INSERT INTO memberships(realm_id,account_id,role,balance) VALUES($1,$2,'admin',100)",
        [id, actor],
      );
      await legacy.query(
        "INSERT INTO wallet_ledger(realm_id,id,account_id,operation_key,amount,balance_after,reason) VALUES($1,$2,$3,'starting-grant',100,100,'starting_grant')",
        [id, randomUUID(), actor],
      );
      const before = (
          await legacy.query('SELECT to_jsonb(m) AS row FROM memberships m WHERE realm_id=$1', [id])
        ).rows[0].row,
        archive = await makeBackup(legacy, password);
      await migrate(legacy);
      expect(
        (await legacy.query('SELECT config FROM realms WHERE id=$1', [id])).rows[0].config,
      ).toEqual({
        ...previous,
        schemaVersion: 11,
        legacyPurchasesRetired: false,
        rankTracks: { enabled: false, tracks: [] },
        characterValues: defaultConfig.characterValues,
        tierWeights: { ...previous.tierWeights, epic: 0, legendary: 0 },
        recycleRewards: { ...previous.recycleRewards, epic: 0, legendary: 0 },
        gemRewards: disabledGemRewards,
      });
      expect(
        (await legacy.query('SELECT to_jsonb(m) AS row FROM memberships m WHERE realm_id=$1', [id]))
          .rows[0].row,
      ).toEqual(before);
      await restoreBackup(fresh, archive, password);
      await assertBackupRestored(fresh, archive, password);
      await expect(claimGems(fresh, actor, id, randomUUID())).rejects.toMatchObject({
        code: 'GEM_REWARDS_DISABLED',
      });
    } finally {
      await legacy.end();
      await fresh.end();
    }
  });
});
