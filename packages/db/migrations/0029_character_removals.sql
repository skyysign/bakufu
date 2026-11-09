-- Removed characters stay as rows (stable IDs for receipts, history and
-- exports) but leave the game: no draws, no glossary entry, no new wishes.
-- Adding the same character again clears retired_at.
ALTER TABLE characters ADD COLUMN retired_at timestamptz;

-- Every removal an admin made: which characters, and the refund paid to each
-- owner (their card was recycled for its value, see recyclings).
CREATE TABLE character_removals (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  preview_hash text NOT NULL CHECK (length(preview_hash)=64),
  character_ids jsonb NOT NULL CHECK (jsonb_typeof(character_ids)='array' AND jsonb_array_length(character_ids)>0),
  refunds jsonb NOT NULL CHECK (jsonb_typeof(refunds)='array'),
  result jsonb NOT NULL CHECK (result->>'ok'='true'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (realm_id,id),
  UNIQUE (realm_id,account_id,request_key),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
