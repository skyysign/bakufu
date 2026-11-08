-- Admins can remove category packs. Openings and Discord reviews reference
-- their pack, so a removed pack is retired (hidden and unopenable) instead of
-- deleted; adding the same category again brings it back.
ALTER TABLE packs ADD COLUMN retired_at timestamptz;
