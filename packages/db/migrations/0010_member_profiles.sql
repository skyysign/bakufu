CREATE TABLE discord_profiles (
  account_id uuid PRIMARY KEY,
  provider text NOT NULL DEFAULT 'discord' CHECK(provider='discord'),
  username text NOT NULL CHECK(char_length(username) BETWEEN 1 AND 64 AND username=btrim(username) AND username !~ '[[:cntrl:]]'),
  display_name text CHECK(display_name IS NULL OR (char_length(display_name) BETWEEN 1 AND 64 AND display_name=btrim(display_name) AND display_name !~ '[[:cntrl:]]')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(account_id,provider) REFERENCES account_identities(account_id,provider)
);
