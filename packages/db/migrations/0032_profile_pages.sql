-- A player's profile page in one realm: a short text, a colour theme, up to
-- eight showcased cards and whether their wishlist is shown to other members.
-- Only what the player chose is stored; collection statistics are computed.
-- A showcased card that left the collection (traded, sold, recycled) is simply
-- not shown any more, so there is no foreign key to cards.
CREATE TABLE profile_pages (
  realm_id uuid NOT NULL,
  account_id uuid NOT NULL,
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 280 AND bio=btrim(bio) AND bio !~ '[[:cntrl:]]'),
  theme text NOT NULL DEFAULT 'violet' CHECK (theme IN ('violet','rose','ocean','emerald','amber','slate')),
  showcase jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(showcase)='array' AND jsonb_array_length(showcase) <= 8),
  show_wishlist boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (realm_id,account_id),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id)
);
