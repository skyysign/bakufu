ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config=config || '{"schemaVersion":10,"legacyPurchasesRetired":false,"rankTracks":{"enabled":false,"tracks":[]}}'::jsonb WHERE config->>'schemaVersion'='9';
ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion'='10' AND config->>'ownership'='unique');
CREATE TABLE rank_track_purchases (
 realm_id uuid NOT NULL, id uuid NOT NULL, account_id uuid NOT NULL, request_key uuid NOT NULL,
 track_id text NOT NULL CHECK(track_id ~ '^[a-z][a-z0-9_-]{0,39}$'), level integer NOT NULL CHECK(level BETWEEN 1 AND 10),
 result jsonb NOT NULL CHECK(result->>'ok'='true'), config_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(realm_id,id), UNIQUE(realm_id,account_id,request_key), UNIQUE(realm_id,account_id,track_id,level),
 FOREIGN KEY(realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_reason_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check CHECK(reason IN('starting_grant','pack_opening','recycling','upgrade_purchase','trade','rank_purchase','gem_reward','admin_grant','rank_track_purchase'));
