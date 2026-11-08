ALTER TABLE discord_profiles ADD COLUMN avatar_url text
  CHECK(avatar_url IS NULL OR avatar_url ~ '^https://cdn[.]discordapp[.]com/(avatars/[0-9]{17,20}/(a_)?[0-9a-f]{32}[.]png[?]size=128|embed/avatars/[0-5][.]png)$');
