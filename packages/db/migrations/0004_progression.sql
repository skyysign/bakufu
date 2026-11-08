ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config = config || '{"schemaVersion":3,"progression":{"xpPerNewCharacter":10,"levelThresholds":[0,20,40,70,100]}}'::jsonb
  WHERE config->>'schemaVersion' = '2';
ALTER TABLE realms ADD CONSTRAINT realms_config_check
  CHECK (config->>'schemaVersion' = '3' AND config->>'ownership' = 'unique');

CREATE TABLE xp_ledger (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('first_collection','migration_baseline')),
  amount integer NOT NULL CHECK (amount >= 0),
  policy_version integer NOT NULL CHECK (policy_version IN (0,1)),
  character_id uuid,
  card_id uuid,
  request_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id,id),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY (realm_id,character_id) REFERENCES characters(realm_id,id),
  FOREIGN KEY (realm_id,card_id) REFERENCES cards(realm_id,id),
  FOREIGN KEY (realm_id,account_id,request_key) REFERENCES openings(realm_id,account_id,request_key),
  CHECK (
    (reason='first_collection' AND character_id IS NOT NULL AND card_id IS NOT NULL AND request_key IS NOT NULL AND (policy_version=1 OR amount=0))
    OR (reason='migration_baseline' AND character_id IS NULL AND card_id IS NULL AND request_key IS NULL AND policy_version=0)
  )
);
CREATE UNIQUE INDEX xp_first_collection ON xp_ledger(realm_id,account_id,character_id)
  WHERE reason='first_collection';
CREATE UNIQUE INDEX xp_migration_baseline ON xp_ledger(realm_id,account_id)
  WHERE reason='migration_baseline';

-- Preserve legacy XP without inventing retroactive awards.
INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version)
  SELECT realm_id,gen_random_uuid(),account_id,'migration_baseline',xp,0 FROM memberships WHERE xp>0;
INSERT INTO xp_ledger(realm_id,id,account_id,reason,amount,policy_version,character_id,card_id,request_key,created_at)
  SELECT realm_id,gen_random_uuid(),owner_id,'first_collection',0,0,character_id,id,request_key,acquired_at
  FROM (SELECT DISTINCT ON (realm_id,owner_id,character_id) * FROM cards
    ORDER BY realm_id,owner_id,character_id,acquired_at,id) first_cards;
