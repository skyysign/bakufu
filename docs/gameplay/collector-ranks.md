# Collector ranks

Collector ranks contains XP/level progress, manual gem claims and six permanent
rank tracks. Bronze, Silver and Gold can be improved independently. Their levels
unlock Sapphire, Ruby and Emerald. Every track has four levels by default, and
each successive level costs more.

| Rank | Costs for levels I / II / III / IV | Unlock requirements | Benefits |
| --- | --- | --- | --- |
| Bronze | 500 / 1,500 / 3,000 / 6,000 | None | Increasing pack discount |
| Silver | 1,000 / 2,500 / 5,000 / 10,000 | None | Increasing recycling bonus |
| Gold | 1,500 / 3,500 / 7,500 / 15,000 | None | Additional wishlist slots |
| Sapphire | 5,000 / 10,000 / 20,000 / 40,000 | Bronze II, Silver II, Gold II | Pack discount and shorter opening cooldown |
| Ruby | 7,500 / 15,000 / 30,000 / 60,000 | Bronze IV, Silver III, Gold II | Larger recycling bonuses |
| Emerald | 10,000 / 25,000 / 50,000 / 100,000 | Bronze IV, Silver IV, Gold IV, Sapphire II, Ruby II | Discount, wishlist slots and shorter cooldown |

Costs are gem prices for each purchase. Benefits are totals within a track,
not the sum of its earlier levels. Different tracks add their current benefits.
Prices and cooldowns floor at zero, wishlist capacity caps at 20 and per-card
base recycling rewards cap at 1,000,000 before character-value bonuses.
Neither rank tracks nor XP change rarity odds. Default opening cooldown is zero;
cooldown reductions still apply in realms that choose a positive wait.

The page shows your current level, the next level's cost/benefits and unmet
requirements. Clicking **Level up** buys the next level immediately, with no
second confirmation. The server enforces the next
level, prerequisites, wallet, realm membership and settings revision under the
realm transaction lock. A lost-response retry recovers the same saved result
and cannot spend twice; keep the page open until recovery completes.

New realms enable the six-track progression. Existing realms migrate with tracks
disabled so old rules and purchases remain intact. Realm admins can use
**Administration → Game rules → Collector ranks → Use the recommended six ranks**
(shown only while the tracks differ from the defaults; the JSON stays editable under
**Edit ranks as JSON**),
review and apply the change. The reviewed collector economy preset also enables
the tracks. Track IDs, names, costs, benefits and prerequisites are versioned realm
configuration; already purchased levels and their requirements are protected.

The separate XP-gated pack-discount shop is retired. Old upgrade and linear-rank
purchases retain their benefits and immutable receipts; they are not reset or
converted into invented new track levels.

Config v10 adds rankTracks and migration 0020 adds the append-only purchase
journal. Current config v11 retains these rules. Personal archive v12 includes
track rules, owned levels and purchase
receipts; encrypted instance backups preserve and validate the journal during
fresh recovery. Earlier archives remain readable.

New realms start with 2,000 gems, charge 200 per ordinary pack, and offer 1,000
gems every six hours through [manual claims](gem-claims.md). Recycling and market
sales provide other progression paths. These are configurable prototype values,
not a completed long-term economy balance or an exact Mudae pricing clone.
