ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config=config || '{"schemaVersion":5,"wishlist":{"slots":3,"weightMultiplier":2}}'::jsonb
  WHERE config->>'schemaVersion'='4';
ALTER TABLE realms ADD CONSTRAINT realms_config_check
  CHECK (config->>'schemaVersion'='5' AND config->>'ownership'='unique');

CREATE TABLE wishlist_entries (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  character_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id,id),
  UNIQUE (realm_id,account_id,character_id),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY (realm_id,character_id) REFERENCES characters(realm_id,id)
);
CREATE TABLE wishlist_changes (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  character_id uuid NOT NULL,
  present boolean NOT NULL,
  result jsonb NOT NULL CHECK (result->>'ok'='true'),
  config_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id,id),
  UNIQUE (realm_id,account_id,request_key),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY (realm_id,character_id) REFERENCES characters(realm_id,id)
);
