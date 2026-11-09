# Wishlist and targeting

**Your wishlist** lets each player choose characters they hope to collect within
one realm. Search the catalog, choose a character, and select **Add to wishlist**.
Use **Remove wish** to free a slot. Defaults provide **3 slots** and **2× selection
weight within the character's rarity tier**. These are free preference changes;
they spend no gems or XP, reserve no cards, and do not reset cooldowns.

Wishlists are private to each player and realm. A wish stays until removed,
including after collecting or recycling that character. Collected or claimed
wishes still use slots. A claimed character has zero draw chance until released
back to the realm pool. Its status shows **In your collection** or **Claimed in
this realm**, without exposing another player's identity or wishlist.

## Probability policy

The existing two-stage draw remains in place:

1. Draw an available rarity tier using the realm's tier weights, redistributing
   empty tiers as before. Wishlists do not alter these tier odds.
2. Within the selected tier, each eligible wished character has the configured
   weight, while every other character has weight 1. Draw from these weights.

For example, three eligible common characters with one wish and multiplier 2
have within-tier chances of 50%, 25%, and 25%. If common rarity has a 70% chance,
their overall next-draw chances are 35%, 17.5%, and 17.5%. Wishing for a rarity's
only character does not increase the chance of that rarity. If every eligible
character in a tier is wished, their relative odds remain equal.

The multiplier applies to weight, rather than directly multiplying probability.
Wishlists do not bypass ownership, category filters, or zero-weight tiers. They
do not guarantee a scarce character. A sole eligible character can naturally
have 100% chance even without a wish. Multi-card openings draw without replacement
and recalculate weights after each card.

Each wish has expandable **Next-draw chances** for every pack. Packs also show
the chance that the next drawn card is any of your wishes. These are next-draw
probabilities, not the chance of obtaining a wish anywhere in a multi-card pack.
Claimed, filtered-out, and zero-tier-weight characters have zero chance. A pack
unable to supply a complete opening shows zero wishlist chance. Odds can change
before opening if someone else claims or releases a character; the transaction
always uses the current authoritative pool.

## Configuration and migration

Realm configuration **v5** introduced this required field (excerpt):

```json
{
  "schemaVersion": 5,
  "wishlist": { "slots": 3, "weightMultiplier": 2 }
}
```

The **New realm** wizard (Rules step) exposes both values. Slots must be integers from 0 to 20;
zero disables wishlists. The multiplier must be an integer from 1 to 10;
1 keeps ordinary draw odds while retaining personal lists. Gold and Emerald
[collector ranks](collector-ranks.md) grant additional slots. [Live settings](settings.md) support reviewed base
slot/weight changes while blocking reductions below an occupied list's size.

The strict parser explicitly upgrades v1–v4 with defaults while preserving
existing economy, XP, and upgrade rules. Migration `0006_wishlist.sql` adds
entries and change receipts without granting wishes, cards, XP, gems, or ranks.
Existing accounts, collections, purchases, cooldowns, and old opening receipts
remain intact. No environment variables or dependencies were added.

## Service and retry behavior

Authenticated, same-origin `POST /api/wishlist` accepts:

```json
{
  "realmId": "<realm UUID>",
  "characterId": "<character UUID in that realm>",
  "present": true,
  "requestKey": "<fresh idempotency UUID>",
  "expectedRevision": 1
}
```

Set `present` to false to remove a wish. Membership and character scope are
checked on the server. Clients cannot select another player, grant slots,
choose the multiplier, or alter balances. Duplicate adds/removes are safe no-ops.
The realm transaction lock serializes capacity checks, preference writes, pack
openings, and other gameplay. Unique database keys protect entry membership
and request replay. A full/disabled list rejects new entries without changes.

Every successful change, including a no-op, records an immutable receipt. Replays
return that receipt without repeating its mutation: retrying an old add cannot
resurrect a removed wish, and retrying an old remove cannot delete a later
replacement. Reusing a key for another character or desired state is a conflict.
Late failures roll back both the entry change and receipt. New successful pack
receipts snapshot the player's wish IDs and multiplier inside the same claim,
spending, and XP transaction. Historical receipts remain unchanged.

The UI retains uncertain requests and offers **Retry wishlist change**, disabling
other game actions until resolved. Pending keys live in page memory, matching
existing opening/purchase/recycling behavior. Reloading loses an unresolved
client attempt; the refreshed list remains authoritative. Old retries from
other devices still use their saved receipts and do not undo subsequent edits.

## Export, recovery, and remaining scope

Player archive **v5** introduced `wishlistRules` and current `wishlist` entries
with stable entry/character/source IDs, character metadata, and added timestamps.
It excludes other players' wishes and credentials. v4/v3 archives remain readable
at their original versions; v1/v2 retain the existing legacy-v2 reader behavior.
Missing wishlist rules/history are not invented. Personal archives are not
authorized live-economy imports.

Encrypted backup envelope **v1** recognizes database revisions 0001-0023.
Current backups include entries, change receipts, and opening snapshots.
Fresh-database restore preserves IDs and timestamp precision, checks realm
foreign keys, uniqueness, slot capacity, change-receipt identity/counts, and
opening multiplier snapshots, and rolls back invalid restores. Older snapshots
gain default rules and empty wishlists while preserving prior progress.

Unit, PostgreSQL integration, and production browser tests cover exact weighted
intervals, unchanged rarity odds, unavailable wishes/packs, multi-card draws,
slot races, private access, stale retries, rollback, claims/recycling, XP
anti-farming, exports, older migrations/backups, and fresh-database recovery.
Tests use original fixtures and no live APIs. The character glossary browses
the full realm catalog with search, rarity/ownership filters and paginated
physical cards. **Browse characters** opens a searchable visual picker. Catalog
metadata is loaded in full; pagination limits rendered cards rather than server
query results. Wishlists provide no notifications or guaranteed pulls.
Reviewed live settings and two-party [trading](trading.md) are implemented;
[signed Discord pack commands](../deployment/discord-gameplay.md),
[member lookup](members.md), and verified-server [admission](admission.md) are available.
