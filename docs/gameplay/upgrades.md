# Purchasable pack discounts

This page records the legacy upgrade system and its historical prototype
defaults. Its separate shop is retired in the current experience; use the six
[collector rank tracks](collector-ranks.md) for new progression. Existing
purchases, benefits and successful retries remain valid. The reviewed economy
preset blocks new legacy purchases without deleting their history.

The dashboard's **Pack discount** shop lets players spend earned gems on
permanent discounts within their realm. Reach the required level, choose
**Buy rank**, review the cost/effect, and choose **Confirm upgrade**. **Cancel
upgrade** leaves everything unchanged. Purchases never spend XP.

| Rank | Required level | Purchase cost | Total discount per pack | Default pack price |
| --- | --- | --- | --- | --- |
| 0 | — | — | 0 gems | 10 gems |
| 1 | 2 | 10 gems | 1 gem | 9 gems |
| 2 | 3 | 20 gems | 2 gems | 8 gems |

Ranks must be bought in order. Each discount is the total for that rank,
rather than an additional discount stacked on earlier ranks. A purchase
changes that player's future openings in this realm. Other players and realms
keep their own prices. The wallet, pack buttons, affordability checks, and
server opening transaction all use the same effective price. Pack size, odds,
ownership, XP awards, and cooldown are unaffected. Historical opening receipts
retain their original prices.

## Configuration

Realm configuration **v4** introduced this field; current config v11 preserves
it for historical purchases alongside [collector tracks](collector-ranks.md)
and [wishlist rules](wishlist.md). The original v4 excerpt was:

```json
{
  "schemaVersion": 4,
  "upgrades": {
    "packDiscount": [
      { "cost": 10, "requiredLevel": 2, "discount": 1 },
      { "cost": 20, "requiredLevel": 3, "discount": 2 }
    ]
  }
}
```

The **New realm** wizard (Rules step) exposes 0–5 ranks and each rank's cost, level requirement, and
discount. Zero ranks disables purchases. Costs are integers from 0 to 1,000,000;
discounts are integers from 1 to 1,000,000; required levels range from 1 to 100.
Discounts must strictly increase and requirements must not decrease. A rank
requiring a level above the realm's highest configured level remains locked.
Operators should choose reachable requirements, particularly for custom curves
or realms with XP awards disabled.

Effective price is `max(0, base pack price - rank discount)`. Custom rules may
therefore allow free packs or free upgrades. The defaults keep even the highest
discounted one-card pack price above the largest recycling reward. Custom
multi-card packs, prices, and recycling rewards can change that economy.
No passive/daily gem grants are introduced.

The strict parser explicitly upgrades v1–v3 configurations with default ranks
while preserving prior rules. Migration `0005_upgrades.sql` adds the purchase
table and upgrade ledger reason, upgrades realm settings, and grants no ranks
or wallet adjustments. Existing XP, collections, cooldowns, and receipts remain
intact. No new environment variables or dependencies are needed. [Live settings](settings.md)
can change unpurchased ranks while protecting every rank already purchased.
Manual database edits are not a supported settings workflow.

## Service and API

Authenticated, same-origin `POST /api/upgrades/buy` accepts:

```json
{
  "realmId": "<realm UUID>",
  "upgradeId": "pack_discount",
  "targetRank": 1,
  "requestKey": "<fresh idempotency UUID>",
  "expectedRevision": 1
}
```

The server uses the authenticated account and stored realm rules. It rejects
nonmembers, skipped/stale ranks, insufficient levels/gems, and disabled/maxed
upgrades without changing state. Ordinary members may buy their own upgrades;
they cannot configure the realm or select another buyer. Client-supplied price,
discount, level, or account fields have no authority.

Purchase receipt, rank ownership, gem debit, and a wallet ledger entry commit
together under the same realm lock as opening and recycling. Composite keys
scope purchases to realm/player; uniqueness protects both rank ownership and
request replay. Ledger operation keys use `upgrade:<request UUID>`, distinct
from opening and recycling keys. Concurrent commands target an explicit rank
so a second request cannot accidentally buy the next rank. A committed request
replays its original receipt, even after later purchases. Reusing a key for a
different rank is a conflict.

After a network/server error, the UI retains the key and target rank and offers
**Retry upgrade purchase**. Other game actions are disabled while its outcome
is uncertain. The browser test commits a purchase, drops its response, retries,
and verifies one rank, one debit, and the discounted next opening. As with the
existing opening/recycling UI, pending keys live in the current page; reloading
loses an unresolved client attempt. Server rank uniqueness still prevents
buying the same rank twice. There is no refund/respec UI in this slice.

## Export, recovery, and scope

Player archive **v4** introduced `upgradeRules`, `basePackPrice`, and an `upgrades`
purchase history with stable purchase/request IDs, rank, cost, discount, level
requirement, and timestamp. The reader validates contiguous ranks, configured
values, and unique IDs. v3 archives remain v3; v1/v2 remain readable as legacy
v2 without invented upgrade history. Exports contain only the player's realm
history and no credentials. They do not authorize importing purchases into a
live economy. Current [v11 archives](../deployment/backups.md) also preserve
wishlist, gem-claim and collector-track history.

Encrypted backup envelope **v1** recognizes database revisions 0001-0023.
Current backups preserve all purchase rows and policy snapshots. Restore to
an empty database validates contiguous ranks, receipt IDs/values, level gates,
snapshot costs/effects, and matching wallet debits before committing. Missing
or inconsistent purchase history rolls back the whole restore. Earlier backups
upgrade settings and restore with no purchased ranks. XP history follows its
existing explicit migration policy.

Verified with unit, real PostgreSQL, and production desktop/mobile browser
checks, including concurrent requests, final-gem races, rollback, isolation,
level/fund gates, free/disabled custom rules, historical receipt replay,
archives, and fresh-database recovery. Larger-pack and daily-pull upgrades
remain planned; extra wishlist slots are available through collector tracks.
[Base wishlists and targeting](wishlist.md) and [reviewed live settings](settings.md)
are implemented. Two-party [trading](trading.md),
[signed Discord pack commands](../deployment/discord-gameplay.md),
[member lookup](members.md), and verified-server [admission](admission.md) are available.

Collector-rank discounts stack with retained legacy discounts. The server quotes,
applies and snapshots the effective price consistently. See [collector ranks](collector-ranks.md).
