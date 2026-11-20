-- Realm config v14: realms still on the original five-level curve
-- (0, 20, 40, 70, 100 XP) get the 100-level default. Its first five levels are
-- the same, so no level goes down; XP is unchanged and levels follow from it,
-- so every player gets the level their XP already earned. Realms whose admin
-- set their own levels keep them.
ALTER TABLE realms DROP CONSTRAINT realms_config_check;
UPDATE realms SET config=jsonb_set(config,'{progression,levelThresholds}','[0,20,40,70,100,140,180,230,280,340,400,470,540,620,700,790,880,980,1080,1190,1300,1420,1540,1670,1800,1940,2080,2230,2380,2540,2700,2870,3040,3220,3400,3590,3780,3980,4180,4390,4600,4820,5040,5270,5500,5740,5980,6230,6480,6740,7000,7270,7540,7820,8100,8390,8680,8980,9280,9590,9900,10220,10540,10870,11200,11540,11880,12230,12580,12940,13300,13670,14040,14420,14800,15190,15580,15980,16380,16790,17200,17620,18040,18470,18900,19340,19780,20230,20680,21140,21600,22070,22540,23020,23500,23990,24480,24980,25480,25990]'::jsonb)
  WHERE config->>'schemaVersion'='13' AND config->'progression'->'levelThresholds'='[0,20,40,70,100]'::jsonb;
UPDATE realms SET config=config||'{"schemaVersion":14}'::jsonb WHERE config->>'schemaVersion'='13';
ALTER TABLE realms ADD CONSTRAINT realms_config_check CHECK(config->>'schemaVersion'='14' AND config->>'ownership'='unique');
-- Unsaved settings previews (five-minute drafts) still hold the v13 shape.
DELETE FROM realm_config_previews;
