-- Realm config v12 adds fame floors. Existing realms keep the tiers they were
-- created with: their floors start off until an admin reviews and applies them.
ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config=config||'{"schemaVersion":12,"fameFloors":{"schemaVersion":1,"rare":null,"epic":null,"legendary":null}}'::jsonb WHERE config->>'schemaVersion'='11';
ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion'='12' AND config->>'ownership'='unique');

-- Every rarity change an admin makes: applying fame floors to the roster, or
-- setting/clearing one character's manual tier. The journal lets a restore
-- check that each character's tier history reconciles.
CREATE TABLE tier_adjustments (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('floors','override')),
  preview_hash text CHECK (preview_hash IS NULL OR length(preview_hash)=64),
  config_change_id uuid,
  before_floors jsonb,
  after_floors jsonb,
  character_id uuid,
  override_before text CHECK (override_before IS NULL OR override_before IN ('common','uncommon','rare','epic','legendary')),
  override_after text CHECK (override_after IS NULL OR override_after IN ('common','uncommon','rare','epic','legendary')),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes)='array'),
  result jsonb NOT NULL CHECK (result->>'ok'='true'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (realm_id,id),
  UNIQUE (realm_id,account_id,request_key),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY (realm_id,config_change_id) REFERENCES realm_config_changes(realm_id,id),
  FOREIGN KEY (realm_id,character_id) REFERENCES characters(realm_id,id),
  CHECK (
    (kind='floors' AND preview_hash IS NOT NULL AND before_floors IS NOT NULL AND after_floors IS NOT NULL
      AND character_id IS NULL AND override_before IS NULL AND override_after IS NULL)
    OR (kind='override' AND character_id IS NOT NULL AND preview_hash IS NULL AND config_change_id IS NULL
      AND before_floors IS NULL AND after_floors IS NULL AND override_before IS DISTINCT FROM override_after)
  )
);
CREATE INDEX tier_adjustments_history ON tier_adjustments(realm_id,created_at DESC);
