# Collector ranks

Collector ranks contains XP/level progress, manual gem claims and six permanent
rank tracks. Bronze, Silver and Gold can be improved independently. Their levels
unlock Sapphire, Ruby and Emerald. Every track has four levels by default, and
each successive level costs more.

The recommended ranks follow each realm's own rules: costs are counted in
packs, and each perk is a share of what it improves (pack price, opening
cooldown, a common card's base value). With the default 200-gem pack and
30-gem commons:

| Rank | Costs for levels I / II / III / IV (in packs) | Unlock requirements | Benefits for levels I–IV |
| --- | --- | --- | --- |
| Bronze | 500 / 1,500 / 3,000 / 6,000 (2.5 / 7.5 / 15 / 30) | None | 5 / 10 / 15 / 20% off the pack price |
| Silver | 1,000 / 2,500 / 5,000 / 10,000 (5 / 12.5 / 25 / 50) | None | +1/15 to 4/15 of a common's value per recycling (2 / 4 / 6 / 8 gems) |
| Gold | 1,500 / 3,500 / 7,500 / 15,000 (7.5 / 17.5 / 37.5 / 75) | None | +1 / 2 / 3 / 4 wishlist slots |
| Sapphire | 5,000 / 10,000 / 20,000 / 40,000 (25 / 50 / 100 / 200) | Bronze II, Silver II, Gold II | 5 / 10 / 17.5 / 25% off packs and 5 / 10 / 15 / 20% off the cooldown |
| Ruby | 7,500 / 15,000 / 30,000 / 60,000 (37.5 / 75 / 150 / 300) | Bronze IV, Silver III, Gold II | +2/15 to 10/15 of a common's value per recycling (4 / 8 / 12 / 20 gems) |
| Emerald | 10,000 / 25,000 / 50,000 / 100,000 (50 / 125 / 250 / 500) | Bronze IV, Silver IV, Gold IV, Sapphire II, Ruby II | 5 / 10 / 15 / 20% off packs, +1 / 2 / 4 / 6 wishlist slots, 5 / 10 / 20 / 30% off the cooldown |

A realm with a 6-hour cooldown therefore gets Sapphire cuts of 18 / 36 / 54 / 72
minutes and Emerald cuts of 18 / 36 / 72 / 108 minutes (half the wait at the
top of both); a realm without a cooldown gets no cooldown perks. Costs round to
readable figures and stop at 1,000,000 gems (packs above 2,000 gems don't raise
them further); free packs count costs as if a pack cost 200 gems.

Costs are gem prices for each purchase. Benefits are totals within a track,
not the sum of its earlier levels. Different tracks add their current benefits.
Prices and cooldowns floor at zero, wishlist capacity caps at 20 and per-card
base recycling rewards cap at 1,000,000 before character-value bonuses.
Neither rank tracks nor XP change rarity odds. The Ranks page shows cooldown
cuts in minutes and hours.

The page shows your current level, the next level's cost/benefits and unmet
requirements. Clicking **Level up** buys the next level immediately, with no
second confirmation. The server enforces the next
level, prerequisites, wallet, realm membership and settings revision under the
realm transaction lock. A lost-response retry recovers the same saved result
and cannot spend twice; keep the page open until recovery completes.

New realms enable the six-track progression, fitted to the rules chosen in the
wizard: while the ranks still match the recommendation, changing the pack price,
cooldown or card values there updates them too. Realms from before rank tracks
migrate with tracks disabled so old rules and purchases remain intact. Realm
admins use **Administration → Game rules → Collector ranks → Fit ranks to these
rules** (shown while the ranks differ from the recommendation for the rules in
the form; the JSON stays editable under **Edit ranks as JSON**), then review and
apply the change. Levels a player already bought keep their cost and perks (and
their track its name and requirements, as the review requires); only levels
nobody owns change, and they never cost less or give less than an owned level
before them. Tracks outside the recommendation stay while someone owns a level
or a kept track requires them. The summary lists each track's top-level perks. The reviewed collector economy preset also enables
the tracks. Track IDs, names, costs, benefits and prerequisites are versioned realm
configuration; already purchased levels and their requirements are protected.

The separate XP-gated pack-discount shop is retired. Old upgrade and linear-rank
purchases retain their benefits and immutable receipts; they are not reset or
converted into invented new track levels.

Config v10 adds rankTracks and migration 0020 adds the append-only purchase
journal. Current config v13 retains these rules. Personal archive v12 includes
track rules, owned levels and purchase
receipts; encrypted instance backups preserve and validate the journal during
fresh recovery. Earlier archives remain readable.

New realms start with 2,000 gems, charge 200 per ordinary pack, and offer 1,000
gems every six hours through [manual claims](gem-claims.md). Recycling and market
sales provide other progression paths. These are configurable prototype values,
not a completed long-term economy balance or an exact Mudae pricing clone.
