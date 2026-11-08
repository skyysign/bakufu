-- Existing local accounts and their stable IDs remain intact.
ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE accounts ADD CONSTRAINT local_credentials_pair
  CHECK ((email IS NULL) = (password_hash IS NULL));

CREATE TABLE account_identities (
  provider text NOT NULL CHECK (provider = 'discord'),
  subject text NOT NULL CHECK (subject ~ '^[0-9]{17,20}$'),
  account_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (account_id, provider)
);

-- Short-lived login state, deliberately excluded from backups and exports.
CREATE TABLE oauth_flows (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX oauth_flows_expiry ON oauth_flows(expires_at);
