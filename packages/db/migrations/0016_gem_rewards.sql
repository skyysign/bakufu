-- Existing economies require an explicit reviewed opt-in to timed rewards.
ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config=config||'{"schemaVersion":8,"gemRewards":{"enabled":false,"amount":25,"intervalSeconds":21600}}'::jsonb WHERE config->>'schemaVersion'='7';
ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion'='8' AND config->>'ownership'='unique');
CREATE TABLE gem_reward_claims (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  result jsonb NOT NULL CHECK(result->>'ok' IS NOT DISTINCT FROM 'true'),
  config_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(realm_id,id),
  UNIQUE(realm_id,account_id,request_key),
  FOREIGN KEY(realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
CREATE INDEX gem_reward_claims_latest ON gem_reward_claims(realm_id,account_id,created_at DESC,id DESC);
ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_reason_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check CHECK(reason IN('starting_grant','pack_opening','recycling','upgrade_purchase','trade','rank_purchase','gem_reward'));
