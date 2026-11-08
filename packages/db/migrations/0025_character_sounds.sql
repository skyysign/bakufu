-- Admin-provided reveal sounds for specific characters. They take priority over
-- the character's rarity sound. Same format and limits as realm_tier_sounds.
CREATE TABLE realm_character_sounds (
  realm_id uuid NOT NULL,
  character_id uuid NOT NULL,
  file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 120 AND file_name !~ '[[:cntrl:]]'),
  duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 1 AND 30000),
  audio text NOT NULL CHECK(char_length(audio) BETWEEN 64 AND 4000000),
  rights_confirmed boolean NOT NULL CHECK(rights_confirmed),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(realm_id, character_id),
  FOREIGN KEY(realm_id, character_id) REFERENCES characters(realm_id, id),
  FOREIGN KEY(realm_id, updated_by) REFERENCES memberships(realm_id, account_id)
);
