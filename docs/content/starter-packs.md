# Starter pack selection (Milestone 5C)

An instance administrator can choose category packs and their display names when
creating a **new realm**, using the original demo, original JSON, or original CSV.
The default remains automatic selection. Existing realms keep their packs and
progress. No environment changes, external services, or additional assets are needed.

1. Open **Administration → New realm**, name the realm, choose its characters and
   select **Preview catalog and packs**. The wizard moves to the **Packs** step and
   loads the catalog's category counts.
2. In **Starter packs** on that step, set **Minimum characters per pack pool** (default 2)
   and **Maximum category packs** (default 10). Choose **Choose categories and
   pack names** under **Category pack selection**.
3. Search the catalog categories, check those you want, and edit **Pack name for
   …**. Search shows the first 50 matches; refine the search for larger catalogs.
   Selected names stay visible even when their categories are filtered out.
4. Choose **Preview catalog and packs** again. Review the selected names, total
   pools, playable status, tier counts, and first-draw odds. Fix invalid selections
   or adjust the minimum/maximum before proceeding.
5. Confirm with **Create realm** on the Review step.
   Creation installs the reviewed catalog, packs, realm, and starting membership
   together. A rejected or failed installation leaves no partial realm or grant.

Only **All Characters** is required. Every other pack can be left out at creation
(**Choose myself** with no categories) and removed later under **Administration →
Packs**; a removed pack disappears from the Packs page, Discord and new openings,
while cards and receipts stay intact, and adding the category again restores it
(migration 0026, `retireRealmPack`).

**All Characters** is always included separately and does not count toward the
category maximum. Selecting no categories creates only this fallback. A maximum
of zero also permits a fallback-only realm. At least one pack must be playable.
Changing the file/catalog type resets category choices and names; changing CSV
source/revision/permission metadata retains them and requires another preview.
Searching categories alone does not invalidate an already reviewed proposal.

Manual category filters use the exact spelling/case from the catalog. Each
category must exist, meet the minimum total pool, and appear at most once. Pack
names are trimmed, 1–80 characters, and cannot contain ASCII control characters.
Names must differ ignoring case; **All Characters** is reserved for the fallback.
The UI prevents adding packs beyond the configured maximum; the service enforces
all constraints independently. Lowering a maximum never silently removes choices:
remove excess packs or raise the maximum before previewing again.

Automatic selection uses real demographic categories first when present.
Provider-only MAL/AniList catalogs without them get the All Characters fallback;
genre-only metadata is never relabeled as Shōnen or Seinen. Demographic pools
still meet the configured minimum/maximum, and distinct demographics remain
separate even when their character pools overlap. Original category catalogs
retain the previous distinct-count/name order and 90% Jaccard overlap rule.
Manual selection may intentionally keep overlapping or identical category pools.
Renaming a pack changes its display name, not its filter or rarity rules.
Demographic defaults are Shōnen, Seinen, Shōjo, Josei and Kodomo, recognizing
common source spellings such as Shounen and Shoujo. Existing demographic edition
labels project to these plain names without renaming stored records or receipts.
Original genre catalogs retain their themed names. Custom names remain unchanged.
Current provider browsing omits old automatic genre packs; their stored rows and
historical IDs stay intact. Manual creation plans still use their exact reviewed
categories and names. The information control shows the actual source category.
Unique ownership remains **realm-wide**, so a claim through one pack removes that
character from every overlapping pack. Recycling releases the character once;
another realm can own the same character independently.

Pack price, cards per opening, rarity weights, cooldown, discounts, and wishlists
continue using the shared realm rules. Initial odds are conditional on each pool
and available positive tier weights. They describe the first draw, before claims
or wishes; multiple draws and later availability change the result. A category
can meet the total pool minimum but still be unable to fill the configured draw.
The preview marks it unplayable; gameplay rejects an unfillable opening without
spending gems or awarding cards/XP. The fallback may remain playable.

The API accepts an optional creation plan alongside existing `config`/`catalog`:

```json
{
  "schemaVersion": 1,
  "categories": [
    {"category": "paper makers", "name": "Paper Trail"},
    {"category": "wind walkers", "name": "Wind Notes"}
  ]
}
```

Send this object as `packPlan` to `POST /api/realms/preview`. Send the same plan
and its returned `fingerprint` as `expectedPreview` to `POST /api/realms`.
Both services require instance-admin access. Manual plans require a matching
preview even with the demo. The digest binds normalized selection/names, the
complete realm config, catalog, and import format. Changed names/categories,
catalog, config, or manual/automatic selection require a new review. Omit the
plan for automatic category selection; unsupported plan versions/fields fail.

The plan version is separate from realm config (introduced in v7, currently v11).
Minimum/maximum values already exist; no schema migration or new archive/encryption version is
needed. Installed pack UUIDs/names/category filters live in the existing
realm-scoped `packs` table and survive encrypted backup/fresh-database recovery.
The original creation plan is not retained as a separate editable document.

This slice supports initial single-category packs and their names. Series,
combined-category, hand-picked filters, live pack editing/regeneration, removing
the fallback, and per-pack prices/sizes remain future work. It does not modify
owned character tiers or claims. Realm creation uses durable retry receipts:
keep an uncertain creation page open and retry the same request. After a reload,
check the realm list before starting another creation. Pack openings and economy
operations retain their own retry receipts.
