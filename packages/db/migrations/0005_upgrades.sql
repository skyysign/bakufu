ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config = config || '{"schemaVersion":4,"upgrades":{"packDiscount":[{"cost":10,"requiredLevel":2,"discount":1},{"cost":20,"requiredLevel":3,"discount":2}]}}'::jsonb
  WHERE config->>'schemaVersion' = '3';
ALTER TABLE realms ADD CONSTRAINT realms_config_check
  CHECK (config->>'schemaVersion' = '4' AND config->>'ownership' = 'unique');

CREATE TABLE upgrade_purchases (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  upgrade_id text NOT NULL CHECK (upgrade_id = 'pack_discount'),
  rank integer NOT NULL CHECK (rank BETWEEN 1 AND 5),
  result jsonb NOT NULL CHECK (result->>'ok' = 'true'),
  config_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id,id),
  UNIQUE (realm_id,account_id,request_key),
  UNIQUE (realm_id,account_id,upgrade_id,rank),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);

ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_reason_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check
  CHECK (reason IN ('starting_grant','pack_opening','recycling','upgrade_purchase'));
