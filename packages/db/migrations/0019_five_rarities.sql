ALTER TABLE characters DROP CONSTRAINT characters_tier_check;
ALTER TABLE characters ADD CONSTRAINT characters_tier_check CHECK(tier IN ('common','uncommon','rare','epic','legendary'));
ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config=jsonb_set(jsonb_set(config||'{"schemaVersion":9}'::jsonb,'{tierWeights}',(config->'tierWeights')||'{"epic":0,"legendary":0}'::jsonb),'{recycleRewards}',(config->'recycleRewards')||'{"epic":0,"legendary":0}'::jsonb) WHERE config->>'schemaVersion'='8';
ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion'='9' AND config->>'ownership'='unique');
