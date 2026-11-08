ALTER TABLE realms ADD COLUMN config_revision integer NOT NULL DEFAULT 1 CHECK (config_revision >= 1);

CREATE TABLE realm_config_previews (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  base_revision integer NOT NULL CHECK (base_revision >= 1),
  state_hash text NOT NULL,
  proposed_config jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id,id),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
CREATE INDEX realm_config_preview_expiry ON realm_config_previews(expires_at);

CREATE TABLE realm_config_changes (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  preview_id uuid NOT NULL,
  from_revision integer NOT NULL CHECK (from_revision >= 1),
  to_revision integer NOT NULL CHECK (to_revision = from_revision + 1),
  before_config jsonb NOT NULL,
  after_config jsonb NOT NULL,
  result jsonb NOT NULL CHECK (result->>'ok'='true'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id,id),
  UNIQUE (realm_id,account_id,request_key),
  UNIQUE (realm_id,to_revision),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
