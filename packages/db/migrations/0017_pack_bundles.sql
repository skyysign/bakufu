-- Keep historical results and config snapshots immutable; omitted bundle counts
-- are exactly the preceding release's single-pack request.
ALTER TABLE openings ADD COLUMN pack_count integer NOT NULL DEFAULT 1
  CHECK (pack_count IN (1,5,10));
