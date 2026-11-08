ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config=config || '{"schemaVersion":6,"trading":{"enabled":true,"maxCardsPerSide":5,"maxGemsPerSide":1000000,"maxPendingPerPlayer":10,"expiresAfterMinutes":1440}}'::jsonb
  WHERE config->>'schemaVersion'='5';
ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion'='6' AND config->>'ownership'='unique');
ALTER TABLE memberships ADD COLUMN trade_code uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE memberships ADD UNIQUE(realm_id,trade_code);

ALTER TABLE cards ADD COLUMN original_owner_id uuid;
UPDATE cards SET original_owner_id=owner_id;
ALTER TABLE cards ALTER COLUMN original_owner_id SET NOT NULL;
ALTER TABLE cards DROP CONSTRAINT cards_realm_id_owner_id_request_key_fkey;
ALTER TABLE cards ADD FOREIGN KEY(realm_id,original_owner_id,request_key) REFERENCES openings(realm_id,account_id,request_key);
CREATE FUNCTION preserve_card_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='INSERT' AND NEW.original_owner_id IS NULL THEN NEW.original_owner_id=NEW.owner_id; END IF;
  IF TG_OP='UPDATE' AND NEW.original_owner_id IS DISTINCT FROM OLD.original_owner_id THEN RAISE EXCEPTION 'Card origin is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_card_origin BEFORE INSERT OR UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION preserve_card_origin();

CREATE TABLE trades (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  creator_id uuid NOT NULL,
  counterparty_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN('pending','completed','cancelled','expired')),
  offer_version integer NOT NULL CHECK(offer_version>=1),
  config_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY(realm_id,id),
  CHECK(creator_id!=counterparty_id),
  CHECK((status='completed')=(completed_at IS NOT NULL)),
  FOREIGN KEY(realm_id,creator_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY(realm_id,counterparty_id) REFERENCES memberships(realm_id,account_id)
);
CREATE TABLE trade_versions (
  realm_id uuid NOT NULL,
  trade_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>=1),
  changed_by uuid NOT NULL,
  creator_offer jsonb NOT NULL,
  counterparty_offer jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(realm_id,trade_id,version),
  FOREIGN KEY(realm_id,trade_id) REFERENCES trades(realm_id,id),
  FOREIGN KEY(realm_id,changed_by) REFERENCES memberships(realm_id,account_id)
);
CREATE TABLE trade_confirmations (
  realm_id uuid NOT NULL,
  trade_id uuid NOT NULL,
  version integer NOT NULL,
  account_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(realm_id,trade_id,version,account_id),
  FOREIGN KEY(realm_id,trade_id,version) REFERENCES trade_versions(realm_id,trade_id,version),
  FOREIGN KEY(realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
CREATE TABLE trade_cards (
  realm_id uuid NOT NULL,
  trade_id uuid NOT NULL,
  offer_version integer NOT NULL,
  card_id uuid NOT NULL,
  account_id uuid NOT NULL,
  released_at timestamptz,
  PRIMARY KEY(realm_id,trade_id,offer_version,card_id),
  FOREIGN KEY(realm_id,trade_id,offer_version) REFERENCES trade_versions(realm_id,trade_id,version),
  FOREIGN KEY(realm_id,card_id) REFERENCES cards(realm_id,id),
  FOREIGN KEY(realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
CREATE UNIQUE INDEX active_trade_card ON trade_cards(realm_id,card_id) WHERE released_at IS NULL;
CREATE TABLE card_transfers (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  trade_id uuid NOT NULL,
  card_id uuid NOT NULL,
  sequence integer NOT NULL CHECK(sequence>=1),
  from_id uuid NOT NULL,
  to_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(realm_id,id),
  UNIQUE(realm_id,trade_id,card_id),
  UNIQUE(realm_id,card_id,sequence),
  CHECK(from_id!=to_id),
  FOREIGN KEY(realm_id,trade_id) REFERENCES trades(realm_id,id),
  FOREIGN KEY(realm_id,card_id) REFERENCES cards(realm_id,id),
  FOREIGN KEY(realm_id,from_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY(realm_id,to_id) REFERENCES memberships(realm_id,account_id)
);
CREATE TABLE trade_requests (
  realm_id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  trade_id uuid NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(realm_id,account_id,request_key),
  FOREIGN KEY(realm_id,account_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY(realm_id,trade_id) REFERENCES trades(realm_id,id)
);

ALTER TABLE xp_ledger ADD COLUMN trade_id uuid;
ALTER TABLE xp_ledger ADD FOREIGN KEY(realm_id,trade_id) REFERENCES trades(realm_id,id);
ALTER TABLE xp_ledger DROP CONSTRAINT xp_ledger_reason_check;
ALTER TABLE xp_ledger ADD CONSTRAINT xp_ledger_reason_check CHECK(reason IN('first_collection','migration_baseline','trade_collection'));
ALTER TABLE xp_ledger DROP CONSTRAINT xp_ledger_check;
ALTER TABLE xp_ledger ADD CONSTRAINT xp_ledger_acquisition_check CHECK(
  (reason='first_collection' AND character_id IS NOT NULL AND card_id IS NOT NULL AND request_key IS NOT NULL AND trade_id IS NULL AND (policy_version=1 OR amount=0))
  OR(reason='migration_baseline' AND character_id IS NULL AND card_id IS NULL AND request_key IS NULL AND trade_id IS NULL AND policy_version=0)
  OR(reason='trade_collection' AND character_id IS NOT NULL AND card_id IS NOT NULL AND request_key IS NULL AND trade_id IS NOT NULL AND policy_version=1 AND amount=0)
);
DROP INDEX xp_first_collection;
CREATE UNIQUE INDEX xp_first_collection ON xp_ledger(realm_id,account_id,character_id) WHERE reason IN('first_collection','trade_collection');
ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_reason_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check CHECK(reason IN('starting_grant','pack_opening','recycling','upgrade_purchase','trade'));
