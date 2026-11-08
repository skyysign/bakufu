-- Realm administrators can repair a player's collection: restore a recycled
-- card, return a card to an earlier owner, or adjust a wallet. Each action is
-- one audited, idempotent row; card moves keep the card's ownership history in
-- card_transfers (now either a trade move or an admin move).
CREATE TABLE admin_collection_actions (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_key uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('restore_card','return_card','adjust_gems')),
  account_id uuid NOT NULL,
  card_id uuid,
  from_id uuid,
  amount integer NOT NULL DEFAULT 0,
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 200),
  result jsonb NOT NULL CHECK (result->>'ok' = 'true'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (realm_id,id),
  UNIQUE (realm_id,actor_id,request_key),
  FOREIGN KEY (realm_id,actor_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY (realm_id,from_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY (realm_id,card_id) REFERENCES cards(realm_id,id),
  CHECK ((kind = 'adjust_gems') = (card_id IS NULL)),
  CHECK ((kind = 'return_card') = (from_id IS NOT NULL)),
  CHECK (from_id IS NULL OR from_id != account_id),
  CHECK (kind != 'adjust_gems' OR amount != 0),
  CHECK (kind != 'return_card' OR amount = 0),
  CHECK (kind != 'restore_card' OR amount <= 0)
);
CREATE INDEX admin_collection_actions_account ON admin_collection_actions(realm_id,account_id,created_at);

ALTER TABLE card_transfers ALTER COLUMN trade_id DROP NOT NULL;
ALTER TABLE card_transfers ADD COLUMN admin_action_id uuid;
ALTER TABLE card_transfers ADD FOREIGN KEY (realm_id,admin_action_id)
  REFERENCES admin_collection_actions(realm_id,id);
ALTER TABLE card_transfers ADD CONSTRAINT card_transfers_origin_check
  CHECK ((trade_id IS NULL) != (admin_action_id IS NULL));

ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_reason_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check CHECK(reason IN('starting_grant','pack_opening','recycling','upgrade_purchase','trade','rank_purchase','gem_reward','admin_grant','rank_track_purchase','admin_adjustment'));
