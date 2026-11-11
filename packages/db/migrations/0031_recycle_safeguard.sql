-- Realm config v13 adds the recycling safeguard: epic and legendary cards need
-- a second confirmation to recycle and are never part of a bulk recycling.
-- Existing realms start with it on; an admin can turn it off under Game rules.
ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config=config||'{"schemaVersion":13,"recycleSafeguard":true}'::jsonb WHERE config->>'schemaVersion'='12';
ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion'='13' AND config->>'ownership'='unique');
-- Unsaved settings previews (five-minute drafts) still hold the v12 shape.
DELETE FROM realm_config_previews;
