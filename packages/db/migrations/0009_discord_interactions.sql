CREATE TABLE discord_guild_realms (
  guild_id text PRIMARY KEY CHECK(guild_id ~ '^[0-9]{17,20}$'),
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  realm_id uuid NOT NULL UNIQUE REFERENCES realms(id),
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(realm_id,linked_by) REFERENCES memberships(realm_id,account_id)
);

-- Short-lived reviews only. No interaction tokens or raw payloads are retained.
CREATE TABLE discord_pack_quotes (
  id uuid PRIMARY KEY,
  realm_id uuid NOT NULL,
  account_id uuid NOT NULL,
  guild_id text NOT NULL CHECK(guild_id ~ '^[0-9]{17,20}$'),
  pack_id uuid NOT NULL,
  config_revision integer NOT NULL CHECK(config_revision>=1),
  quoted_price integer NOT NULL CHECK(quoted_price>=0),
  pack_size integer NOT NULL CHECK(pack_size>=1),
  binding_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(realm_id,account_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY(realm_id,pack_id) REFERENCES packs(realm_id,id)
);
CREATE INDEX discord_quote_expiry ON discord_pack_quotes(realm_id,expires_at);
