# Milestone 2A: recycling cards

In **Your collection**, clicking **Recycle** acts immediately at the displayed
estimate, with no second confirmation. A successful recycle removes that card
from your active collection, credits gems once, and releases its character to
the realm-wide pack pool. Another player may then claim it in a new card instance.

| Rarity | Default base reward |
| --- | --- |
| Common | 30 gems |
| Uncommon | 60 gems |
| Rare | 120 gems |
| Epic | 260 gems |
| Legendary | 620 gems |

These base values double as each tier's card value. With the default 75%
popularity bonus, cards range from 30 gems (least popular common) to about 1,085
gems (most popular legendary), similar to Mudae's kakera spread; collector
interest adds up to 25% more. The **New realm** wizard (Rules → Customize →
Collection) and **Game rules → Collection** edit them in the **Rarity: chance and
value** table; **Use recommended values** restores these defaults.
Enabled [character values](character-values.md) add saved-popularity and bounded
other-collector wishlist bonuses, so cards in the same tier can return different
amounts. The player's rank bonus is added too. Inspect a card for its evidence;
the committed server receipt records the actual credit.
Migration 0003 originally introduced the legacy 2/4/6-gem rewards. Existing
realms keep their saved values until a reviewed settings change or
[economy preset](rarity-economy.md) is applied. Account IDs, cards, balances,
and previous opening receipts remain intact.
[Live realm settings](settings.md) now let realm admins review and change
future rewards. Historical recycling receipts retain their original values.
Rewards are gameplay settings, not `.env`
values. A default one-card pack costs 200 gems before rank discounts. Recycling
releases cards, and rewards or depleted/custom pools may allow profitable
recycling; see the [economy limits](rarity-economy.md#economy-limits).
Recycling does not award XP or reset a pack cooldown.

## Configuration and operation contracts

Realm configuration schema version **2** introduced recycling rewards; current
[version 11](rarity-economy.md) also includes the five-tier economy, collector
tracks and character-value rules. The historical v2 addition was:

```json
{
  "schemaVersion": 2,
  "recycleRewards": { "common": 2, "uncommon": 4, "rare": 6 }
}
```

This is an excerpt: the other required realm fields remain unchanged. The
parser strictly validates v1 data before upgrading it; unknown future versions
and invalid/negative/fractional rewards are rejected. Each tier allows 0 to
1,000,000 gems. Current settings are snapshotted in every committed receipt.

Authenticated `POST /api/recycle` accepts:

```json
{
  "realmId": "<realm UUID>",
  "cardId": "<owned card UUID>",
  "requestKey": "<fresh idempotency UUID>",
  "expectedRevision": 1
}
```

The client cannot choose its reward. The server verifies the current owner in
that realm and calculates credit from the saved character evidence, current
eligible demand, tier bases, settings and rank bonuses. Success
returns `ok`, `recyclingId`, `cardId`, `characterId`, `name`, `tier`, `credited`,
the resulting `balance`, and `recycledAt`. Replaying the same successful key
and card returns this historical receipt even if the character has since been
claimed again. Reusing the key for another card is a conflict. Invalid, retired,
or other players' cards produce no reward or receipt. A new retry key cannot
recycle a retired card again. A wallet overflow fails without changing state.

The UI retains the original key after network/server errors and offers **Retry
recycling**. Its browser regression test commits a recycle, drops the response,
and verifies that retrying produces one credit. Failed client requests do not
reserve cards or consume cooldowns.

## Persistence, exports, and recovery

Cards retain acquisition history and stable IDs with `recycled_at` set. A
partial unique index restricts active claims to one character per realm. New
claims receive new card UUIDs. Historical opening receipts never recreate
retired cards. Trading rejects retired cards; reserved trade cards cannot be recycled.

Recycling, retirement, gem credit, ledger entry, and receipt commit in one
transaction under the same realm lock as pack opening. PostgreSQL enforces one
receipt per card and one receipt per player/request key. Ledger keys use the
`recycle:` namespace, separate from opening UUIDs.

Player archive version **2** introduced active cards, the wallet ledger, and the
player's `recyclings` history with card/character/source IDs, reward, acquisition
time, and recycling time. It excludes other players and credentials. Parsing
an older v1 archive explicitly adds empty history without changing existing
IDs or values; information absent from an old archive cannot be reconstructed.
Current archives are [v12](../deployment/backups.md), including historical
recycling value evidence, [progression and XP history](progression.md),
[upgrade purchases](upgrades.md), and [wishlist entries](wishlist.md).

Encrypted instance backups preserve all card history, receipts, settings, and
ledger entries. Restore to a fresh database verifies ownership history and
ledger reconciliation, with all inserts rolled back on failure. Snapshots from
the original schema and the Discord schema are explicitly supported and
upgraded during restore; unknown migrations/checksum mismatches are rejected.

## Verification and remaining work

Tests cover concurrent same/different-key requests, late rollback, ownership
and realm isolation, opening/recycling races, character re-claiming, immutable
old receipts, custom/zero rewards, wallet overflow, v1 settings migration,
personal export round trips, and fresh-database recovery (including older
backups and inconsistent history rejection). Browser checks cover custom
creation values, direct keyboard activation, response-loss retry,
updated wallet/availability, export history, permission checks, and mobile UI.

XP and levels are now implemented through first collections, with persistent
history preventing recycle/re-claim XP farming. [Collector rank tracks](collector-ranks.md)
provide discounts, recycling bonuses, wishlist slots and cooldown reduction;
the old separate discount shop is retired with purchased benefits retained.
Wishlists, targeting and reviewed live settings are implemented. Additional upgrade effects,
Discord trading/recycling/upgrade commands remain unimplemented. [Signed Discord pack commands](../deployment/discord-gameplay.md) are available. Two-party [trading](trading.md) is available.
