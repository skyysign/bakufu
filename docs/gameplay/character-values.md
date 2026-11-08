# Character values

Characters in the same rarity can have different gem values. The card face
shows the current character value; inspecting it shows saved source popularity,
collector demand and the recycling estimate with your rank bonuses. Market
sellers still choose their own asking price. Existing listings are never repriced.

The version-1 formula starts with the realm's base recycling value for that tier:

- Saved popularity adds up to **75%** of the base value by default. Percentiles
  compare characters in the same source and tier; AniList and MAL scores are
  never mixed. Equal scores receive equal percentiles. Missing evidence adds no
  popularity bonus, and a one-character cohort receives no invented bonus.
- Each other collector's current wishlist adds **5%**, capped at **25%** by
  default. An active owner's own wish is excluded. Counts stay within the realm
  and reveal no individual wishlist or account identity.
- Recycling adds the player's existing flat rank bonus to that character value.
  The server calculates the committed amount under the realm transaction lock.

Bonuses round down to whole gems. The displayed amount is an estimate: demand
can change before an action commits. The actual recycling receipt records its
rules, popularity evidence, demand count, bonuses and final credit. Retrying that
request returns the same receipt even after demand or settings change. Values
do not change rarity, pull odds, card IDs or ownership.

Config v11 includes these configurable rules:

```json
{
  "characterValues": {
    "schemaVersion": 1,
    "enabled": true,
    "popularityBoostBps": 7500,
    "wishlistBoostBps": 500,
    "maxWishlistBoostBps": 2500
  }
}
```

Basis points use 10,000 for 100%. New realms enable the formula. Migration 0023
adds nullable saved popularity and leaves valuation disabled in existing realms;
realm admins can review a settings change to enable it. The migration preserves
wallets, cards, tiers, previous purchases and receipts. It does not populate
missing provider data or make an API request. New catalog installations retain
the numeric popularity already supplied by the selected adapter or local catalog.

For an older catalog, the admin-only `previewCharacterPopularity` and
`applyCharacterPopularity` services can restore missing numbers from an
authorized saved catalog. They require matching stable character IDs, source
keys, source and revision, a matching preview hash and realm-admin membership.
Only null values are filled; conflicting existing evidence is rejected. No
roster replacement, artwork download, reranking or new provider lookup occurs.

The operator command accepts a matching permitted JSON catalog and returns only
counts and a preview hash. With Docker and PowerShell:

```powershell
Get-Content -Raw -LiteralPath .\permitted-catalog.json |
  docker compose exec -T web pnpm exec tsx scripts/character-popularity.ts REALM_UUID -
Get-Content -Raw -LiteralPath .\permitted-catalog.json |
  docker compose exec -T web pnpm exec tsx scripts/character-popularity.ts REALM_UUID - PREVIEW_HASH
```

The second command requires the reviewed hash. The command selects a single
instance administrator and also checks realm-admin membership; ambiguous
administrator selection is refused. Host operators may pass a local JSON path
instead of `-`, with `DATABASE_URL` configured privately.

Player archive v12 includes current values for the player's own cards and wishes
and historical recycling valuation evidence. Encrypted instance recovery keeps
saved popularity and validates historical quotes against their saved rules and
credits, rather than today's wishlist counts. Older archives remain readable.

This is a configurable playtesting formula, not an auction-price oracle or a
guarantee against profitable recycling in depleted pools. Dated market-price
charts and richer valuation history remain future work.
