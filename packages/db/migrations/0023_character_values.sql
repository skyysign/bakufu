ALTER TABLE characters ADD COLUMN popularity bigint CHECK(popularity IS NULL OR (popularity>=0 AND popularity<=9007199254740991));
ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config=config||'{"schemaVersion":11,"characterValues":{"schemaVersion":1,"enabled":false,"popularityBoostBps":7500,"wishlistBoostBps":500,"maxWishlistBoostBps":2500}}'::jsonb WHERE config->>'schemaVersion'='10';
ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion'='11' AND config->>'ownership'='unique');
