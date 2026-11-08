-- Realm-wide "live pulls" read the newest successful openings first.
CREATE INDEX openings_realm_recent ON openings(realm_id, created_at DESC, id DESC);

-- Admin-provided reveal sounds per rarity tier. The browser trims uploads to
-- at most 30 seconds and encodes 16-bit PCM WAV; the server re-validates the
-- header and duration. Stored as base64 text so JSON backups stay portable.
CREATE TABLE realm_tier_sounds (
  realm_id uuid NOT NULL REFERENCES realms(id),
  tier text NOT NULL CHECK(tier IN ('common','uncommon','rare','epic','legendary')),
  file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 120 AND file_name !~ '[[:cntrl:]]'),
  duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 1 AND 30000),
  audio text NOT NULL CHECK(char_length(audio) BETWEEN 64 AND 4000000),
  rights_confirmed boolean NOT NULL CHECK(rights_confirmed),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(realm_id, tier),
  FOREIGN KEY(realm_id, updated_by) REFERENCES memberships(realm_id, account_id)
);
