ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config = (config || '{"schemaVersion":2,"recycleRewards":{"common":2,"uncommon":4,"rare":6}}'::jsonb)
  WHERE config->>'schemaVersion' = '1';
ALTER TABLE realms ADD CONSTRAINT realms_config_check
  CHECK (config->>'schemaVersion' = '2' AND config->>'ownership' = 'unique');

ALTER TABLE cards ADD COLUMN recycled_at timestamptz;
-- Install the active uniqueness constraint before replacing the old constraint.
CREATE UNIQUE INDEX cards_active_character ON cards(realm_id, character_id)
  WHERE recycled_at IS NULL;
ALTER TABLE cards DROP CONSTRAINT cards_realm_id_character_id_key;

CREATE TABLE recyclings (
  realm_id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  id uuid NOT NULL UNIQUE,
  card_id uuid NOT NULL,
  result jsonb NOT NULL CHECK (result->>'ok' = 'true'),
  config_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id, account_id, request_key),
  UNIQUE (realm_id, card_id),
  FOREIGN KEY (realm_id, account_id) REFERENCES memberships(realm_id, account_id),
  FOREIGN KEY (realm_id, card_id) REFERENCES cards(realm_id, id)
);

ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_reason_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check
  CHECK (reason IN ('starting_grant', 'pack_opening', 'recycling'));
