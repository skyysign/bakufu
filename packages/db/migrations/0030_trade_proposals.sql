-- Trade protocol 2 ("proposals"): the creator chooses both sides (what they
-- give and which of the other player's cards and gems they ask for) and sending
-- confirms their side. Either player can counter with a new version of both
-- sides; the other player accepts, counters or declines. A player's cards are
-- reserved only once that player has confirmed the current version, so asking
-- for someone's card never locks it. Trades created earlier keep protocol 1.
ALTER TABLE trades ADD COLUMN protocol smallint NOT NULL DEFAULT 1 CHECK (protocol IN (1,2));
