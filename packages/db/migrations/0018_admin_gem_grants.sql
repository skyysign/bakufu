CREATE TABLE admin_gem_grants (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  result jsonb NOT NULL CHECK (result->>'ok' IS NOT DISTINCT FROM 'true'),
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (realm_id,id),
  UNIQUE (realm_id,account_id,request_key),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_reason_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check
CHECK (reason IN ('starting_grant','pack_opening','recycling','upgrade_purchase','trade','rank_purchase','gem_reward','admin_grant'));
