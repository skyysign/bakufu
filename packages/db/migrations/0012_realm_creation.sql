ALTER TABLE realms ADD CONSTRAINT realms_creator_key UNIQUE (id, created_by);
CREATE TABLE realm_creation_requests (
  account_id uuid NOT NULL REFERENCES accounts(id),
  request_key uuid NOT NULL,
  realm_id uuid NOT NULL UNIQUE,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, request_key),
  FOREIGN KEY (realm_id, account_id) REFERENCES realms(id, created_by)
);
