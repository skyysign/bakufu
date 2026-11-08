-- Preserve existing economies: operators explicitly enable their rank ladder.
ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config = config || '{"schemaVersion":7,"ranks":{"enabled":false,"levels":[]}}'::jsonb WHERE config->>'schemaVersion' = '6';
ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion' = '7' AND config->>'ownership' = 'unique');

CREATE TABLE rank_purchases (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  rank integer NOT NULL CHECK(rank BETWEEN 1 AND 10),
  result jsonb NOT NULL CHECK(result->>'ok' = 'true'),
  config_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(realm_id,id),
  UNIQUE(realm_id,account_id,request_key),
  UNIQUE(realm_id,account_id,rank),
  FOREIGN KEY(realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_reason_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check CHECK(reason IN('starting_grant','pack_opening','recycling','upgrade_purchase','trade','rank_purchase'));
