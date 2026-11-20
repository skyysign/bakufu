# XP and levels

XP and levels are implemented. **Collector ranks** shows your current level, total
XP, and progress to the next level, including the next threshold and award rule.
A successful pack receipt shows its XP
award and announces a level increase. Each realm has separate player progress.

By default, a player earns **10 XP** the first time they collect a particular
character through a successful pack opening in that realm. There are **100
levels**; thresholds are cumulative, and the step to the next level grows by
10 XP every two levels (20, 20, 30, 30, 40, …):

| Level | Total XP required | New characters (at 10 XP) |
| ----- | ----------------- | ------------------------- |
| 1     | 0                 | 0                         |
| 2     | 20                | 2                         |
| 3     | 40                | 4                         |
| 4     | 70                | 7                         |
| 5     | 100               | 10                        |
| 10    | 340               | 34                        |
| 20    | 1,190             | 119                       |
| 30    | 2,540             | 254                       |
| 50    | 6,740             | 674                       |
| 75    | 14,800            | 1,480                     |
| 100   | 25,990            | 2,599                     |

Recycling gives gems but no XP. Reclaiming a previously collected character
gives no XP, even after recycling it or after another player has owned it.
Another player can earn their own first-collection XP for the same character.
The first-collection record remains when its original card is recycled.
Multi-card packs award XP for each character new to that player.

XP continues accumulating at the highest configured level; the cap is
displayed explicitly. Change the threshold list (up to 100 levels) through
**Administration → Game rules → Progression** without resetting XP.

### Realms from before the 100 levels

Until realm config v14 the default was five levels, capped at 100 XP. Players
at that cap kept earning XP, so migration `0033_level_curve.sql` gives every
realm still on those five levels (0, 20, 40, 70, 100) the 100-level curve, and
each player gets the level their XP is already worth: with 500 XP, level 12
instead of 5. The first five levels are the same, so nobody goes down, and XP,
cards, gems and the settings revision don't change. The next opening announces
only the levels it actually gains. Realms whose admin set their own levels keep
them; an admin can still choose any curve in Game rules. Backups taken before
the update restore with the new curve. The separate XP-gated discount shop is retired;
its older purchased benefits remain active. [Collector rank tracks](collector-ranks.md)
now provide the gem-purchased upgrade path. There is no automatic gem reward or
cooldown change from XP alone.

## Configuration

Instance administrators can set **XP per new character** and **Level thresholds
(total XP)** in the **Rules** step of **Administration → New realm**. Realm configuration version **3** introduced
these rules (with the original five levels); current v14 has the 100-level
default. An excerpt:

```json
{
  "schemaVersion": 3,
  "progression": {
    "xpPerNewCharacter": 10,
    "levelThresholds": [0, 20, 40, 70, 100, 140, 180, 230, …, 25990]
  }
}
```

This is an excerpt; all other realm settings are still required. XP rewards
must be integers from 0 to 1,000,000. Thresholds must contain 1–100 strictly
increasing integers, begin with 0, and stay within PostgreSQL's supported
integer range (0–2,147,483,647). A zero reward disables XP awards but still
records first collections, so changing rules cannot reward repeat claims.
One threshold, `[0]`, defines a single-level realm. XP overflow rejects an
opening without charging, claiming cards, or consuming cooldown.

The parser validates and explicitly upgrades v1/v2 realm settings with these
defaults while preserving previous economy overrides. Unknown versions fail
validation. No new environment variables are required. [Live settings](settings.md)
now support reviewed XP/level changes, preserving XP and owned upgrade benefits.

## Transactions and migration

The server calculates XP from stored realm settings and first-collection
history; API clients cannot choose XP or levels. Pack receipt, card claims,
gem debit, cooldown, membership XP, and XP ledger entries commit in one
transaction under the existing realm lock. A unique database index permits
only one first-collection event per realm/player/character. Failed draws and
rolled-back transactions award no XP. Replaying a committed request returns
the original receipt without granting anything again.

Migration `0004_progression.sql` upgrades existing realm settings and records
existing active and recycled characters as previously collected with zero XP.
It preserves existing membership XP, recording any nonzero balance as a
`migration_baseline` event. It makes no retroactive awards and leaves cards,
gems, cooldowns, and historical opening receipts intact. Historical receipts
have no progression field; new successful receipts include `xpAwarded`,
`levelsGained`, and the resulting progression. Level is derived from XP and
realm thresholds rather than stored as a second mutable balance.

## Export and recovery

Player archive **v3** introduced total XP, the realm's progression rules,
derived level, and the player's `xpLedger`, including zero-award historical
discoveries and any migration baseline. Stable event, character, card, and
request IDs are preserved. The validator checks that ledger amounts sum to
XP and that the level agrees with the exported rules. No credentials or
other players' history are included. Earlier v1/v2 archives remain readable
as legacy v2 data; missing XP history/rules are not invented. Current archives
are [v11](collector-ranks.md), also carrying preserved upgrades, rank tracks, wishlists and timed gem claims.

The encrypted backup format remains **v1**, with migration manifests identifying
database revisions. Restore supports original through progression revisions
(0001-0010, including upgrades, wishlists, and settings audits). Older backups receive the same historical first-collection and
baseline records as the migration. Current backups must contain complete,
reconciled XP history. A restore rejects inconsistent XP totals, missing
first-collection history, inconsistent event/card links, award-policy
mismatches, and receipt/award mismatches, rolling back the entire restore.

Unit, PostgreSQL integration, and production browser checks cover thresholds,
custom/disabled XP, multi-card awards, concurrency, retry and rollback,
recycling/reclaim protection, permissions, realm isolation, migration,
archives, fresh-database recovery, and desktop/mobile progression display.
Automated tests use original fixtures and do not call Discord or catalog APIs.
