CREATE TABLE market_listings (
  realm_id uuid NOT NULL,
  id uuid NOT NULL,
  seller_id uuid NOT NULL,
  card_id uuid NOT NULL,
  price integer NOT NULL CHECK (price BETWEEN 1 AND 1000000),
  status text NOT NULL CHECK (status IN ('active','sold','cancelled')),
  buyer_id uuid,
  sale_trade_id uuid,
  created_at timestamptz NOT NULL,
  closed_at timestamptz,
  PRIMARY KEY (realm_id,id),
  CHECK (buyer_id IS NULL OR buyer_id <> seller_id),
  CHECK ((status='active') = (closed_at IS NULL)),
  CHECK (closed_at IS NULL OR closed_at >= created_at),
  CHECK ((status='sold') = (buyer_id IS NOT NULL AND sale_trade_id IS NOT NULL)),
  CHECK (status='sold' OR (buyer_id IS NULL AND sale_trade_id IS NULL)),
  FOREIGN KEY (realm_id,seller_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY (realm_id,buyer_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY (realm_id,card_id) REFERENCES cards(realm_id,id),
  FOREIGN KEY (realm_id,sale_trade_id) REFERENCES trades(realm_id,id)
);
CREATE UNIQUE INDEX active_market_card ON market_listings(realm_id,card_id) WHERE status='active';
CREATE UNIQUE INDEX market_sale_trade ON market_listings(realm_id,sale_trade_id) WHERE sale_trade_id IS NOT NULL;
CREATE INDEX market_browse ON market_listings(realm_id,status,created_at DESC,id);
CREATE TABLE market_requests (
  realm_id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_key uuid NOT NULL,
  listing_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  command jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (realm_id,account_id,request_key),
  FOREIGN KEY (realm_id,account_id) REFERENCES memberships(realm_id,account_id),
  FOREIGN KEY (realm_id,listing_id) REFERENCES market_listings(realm_id,id)
);
