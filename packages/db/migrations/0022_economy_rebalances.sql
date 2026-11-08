CREATE TABLE economy_rebalances (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  preview_hash text NOT NULL CHECK(length(preview_hash)=64),
  before_config jsonb NOT NULL,
  after_config jsonb NOT NULL,
  tier_changes jsonb NOT NULL CHECK(jsonb_typeof(tier_changes)='array'),
  result jsonb NOT NULL CHECK(result->>'ok'='true'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(realm_id,id),
  UNIQUE(realm_id,account_id,request_key),
  FOREIGN KEY(realm_id,account_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY(realm_id,id) REFERENCES realm_config_changes(realm_id,id)
);
