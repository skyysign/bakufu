CREATE TABLE realm_admission_policies (
  realm_id uuid PRIMARY KEY REFERENCES realms(id),
  schema_version integer NOT NULL CHECK(schema_version=1),
  revision integer NOT NULL CHECK(revision>=1),
  mode text NOT NULL CHECK(mode IN('invite_only','discord_server')),
  guild_id text CHECK(guild_id ~ '^[0-9]{17,20}$'),
  join_code uuid UNIQUE,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK((mode='invite_only' AND guild_id IS NULL AND join_code IS NULL) OR(mode='discord_server' AND guild_id IS NOT NULL AND join_code IS NOT NULL)),
  FOREIGN KEY(realm_id,updated_by) REFERENCES memberships(realm_id,account_id)
);
CREATE TABLE realm_admission_changes (
  realm_id uuid NOT NULL REFERENCES realms(id),
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  fingerprint text NOT NULL,
  from_revision integer NOT NULL CHECK(from_revision>=0),
  to_revision integer NOT NULL CHECK(to_revision=from_revision+1),
  before_policy jsonb NOT NULL,
  after_policy jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(realm_id,id),
  UNIQUE(realm_id,to_revision),
  UNIQUE(realm_id,account_id,request_key),
  FOREIGN KEY(realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
CREATE TABLE realm_admissions (
  realm_id uuid NOT NULL,
  account_id uuid NOT NULL,
  id uuid NOT NULL UNIQUE,
  method text NOT NULL CHECK(method='discord_server'),
  policy_revision integer NOT NULL,
  guild_id text NOT NULL CHECK(guild_id ~ '^[0-9]{17,20}$'),
  starting_gems integer NOT NULL CHECK(starting_gems BETWEEN 0 AND 1000000),
  admitted_at timestamptz NOT NULL,
  PRIMARY KEY(realm_id,account_id),
  FOREIGN KEY(realm_id,account_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY(realm_id,policy_revision) REFERENCES realm_admission_changes(realm_id,to_revision)
);
ALTER TABLE oauth_flows ADD COLUMN admission jsonb CHECK(admission IS NULL OR jsonb_typeof(admission)='object');
