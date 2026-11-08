CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  instance_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_limits (
  email_key text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts >= 0),
  window_start timestamptz NOT NULL
);
CREATE TABLE realms (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  config jsonb NOT NULL CHECK (config->>'schemaVersion' = '1' AND config->>'ownership' = 'unique'),
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  realm_id uuid NOT NULL REFERENCES realms(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  role text NOT NULL CHECK (role IN ('admin', 'player')),
  balance integer NOT NULL CHECK (balance >= 0),
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  last_opened_at timestamptz,
  PRIMARY KEY (realm_id, account_id)
);
CREATE TABLE characters (
  realm_id uuid NOT NULL REFERENCES realms(id),
  id uuid NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  series text NOT NULL,
  categories text[] NOT NULL,
  tier text NOT NULL CHECK (tier IN ('common', 'uncommon', 'rare')),
  provenance jsonb NOT NULL,
  PRIMARY KEY (realm_id, id),
  UNIQUE (realm_id, source_key)
);
CREATE TABLE packs (
  realm_id uuid NOT NULL REFERENCES realms(id),
  id uuid NOT NULL,
  name text NOT NULL,
  category text,
  PRIMARY KEY (realm_id, id)
);
CREATE TABLE openings (
  realm_id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  id uuid NOT NULL UNIQUE,
  pack_id uuid NOT NULL,
  result jsonb NOT NULL,
  config_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id, account_id, request_key),
  FOREIGN KEY (realm_id, account_id) REFERENCES memberships(realm_id, account_id),
  FOREIGN KEY (realm_id, pack_id) REFERENCES packs(realm_id, id)
);
CREATE TABLE cards (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  character_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  request_key uuid NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id, id),
  UNIQUE (realm_id, character_id),
  FOREIGN KEY (realm_id, character_id) REFERENCES characters(realm_id, id),
  FOREIGN KEY (realm_id, owner_id) REFERENCES memberships(realm_id, account_id),
  FOREIGN KEY (realm_id, owner_id, request_key) REFERENCES openings(realm_id, account_id, request_key)
);
CREATE INDEX cards_owner ON cards(realm_id, owner_id);
CREATE TABLE wallet_ledger (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  operation_key text NOT NULL,
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL CHECK (reason IN ('starting_grant', 'pack_opening')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id, id),
  UNIQUE (realm_id, account_id, operation_key),
  FOREIGN KEY (realm_id, account_id) REFERENCES memberships(realm_id, account_id)
);
