import type { Transaction } from './connection';

// Explicit compatibility migration for original/Discord/recycling-era backups.
// Keep this seed policy aligned with migration 0004; regression tests cover both paths.
export async function seedHistoricalXp(tx: Transaction) {
  await tx.query(`INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version)
    SELECT realm_id,gen_random_uuid(),account_id,'migration_baseline',xp,0 FROM memberships WHERE xp>0`);
  await tx.query(`INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version,character_id,card_id,request_key,created_at)
    SELECT realm_id,gen_random_uuid(),owner_id,'first_collection',0,0,character_id,id,request_key,acquired_at
    FROM (SELECT DISTINCT ON (realm_id,owner_id,character_id) * FROM cards
      ORDER BY realm_id,owner_id,character_id,acquired_at,id) first_cards`);
}
