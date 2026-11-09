# Original catalogs: version 1 JSON and CSV

`packages/importers/fixtures/demo.v1.json` contains 12 original fictional
characters from **The Lantern Atlas**, licensed with the project's original
MIT content. Their names, source IDs, categories, and scores are invented.
There are no fetched character records, image assets, or external API calls.
The web interface uses original local demo portraits and original fallback artwork.

`parseCatalog` validates a strict, bounded JSON format before producing a
preview of normalized characters and calculated tiers. Top-level fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Integer `1`; unknown versions are rejected. |
| `source` | Lowercase source namespace (max 64 characters), e.g. `lantern-demo`. |
| `revision` | Stable revision text for provenance. |
| `license` | Administrator's statement of content permissions. |
| `characters` | 1–100,000 entries with unique UUIDs and source-qualified keys. |

Each character has `id` (UUID), `sourceKey` (`namespace:key`, max 160 characters), `name`, `series`,
`categories` (normalized tag strings), and nullable integer `popularity`.
Every source key must match the declared namespace. Duplicated IDs and keys,
extra fields, and unknown versions fail validation. Reusing the same JSON
preserves internal/source IDs; realm IDs scope their installed copies.

A character may also include an optional `artwork` object with `url`, `sourceUrl`
and `permission`. This is a permitted remote-image reference, not image bytes.
The supported provider CDN character paths and attribution hosts are validated;
the browser loads images lazily and uses original fallback art on failure.
Keep artwork permission separate from the metadata statement. See
[provider artwork rules](providers.md#artwork-on-demand). CSV retains its existing
text-only columns; canonical JSON can carry these optional references.

Tier calculation `source-percentile-v1` ranks the scored characters within that
one source/import revision, with UUID ascending as a deterministic tie-break.
Ranks use zero-based index divided by scored count: top 10% are rare, next 25%
uncommon, remainder common. Missing popularity receives common. These are
synthetic demo scores, not claims about real-world popularity. Installed
provenance records source, revision, license, calculation version, and time.
The separate realm tier weights determine drawing probability; the neutral
fallback tier is fixed in v1 and would need a versioned policy extension.

Pack generation ranks category pools by distinct character count, then name,
skips pools smaller than the configured minimum, skips >=90% Jaccard-overlap
near-duplicates, and takes at most 10 (or the configured lower limit).
`All Characters` is added separately when the catalog meets the minimum.
The demo yields five categories plus this fallback. Ownership spans all packs.

## Create a realm with original JSON

Sign in as an **instance administrator**, open **Administration → New realm**,
and select **Your JSON file** under **Content for this new realm**.
Choose a JSON file, attest that you created the
content and have permission to use it, and enter the realm name/rules. Choose
**Preview catalog and packs**. Review the permission statement, source/revision,
character counts/tiers, generated pools, playable status, and first-draw odds.
Expand the character table to inspect names, series, tiers, and stable keys.
Then choose **Create realm**. Editing the file or any form field invalidates the
preview. The **Your JSON file** option links two original examples you can
download and upload unchanged: the 12-character demo catalog
(`/catalog-demo.v1.json`) and the 1,000-character test catalog
(`/catalog-scale.v1.json`).

For this slice, uploads allow **up to 1,000 characters**, with a total HTTP body
limit of **2 MiB**. The picker reserves 16 KiB for configuration/JSON wrapping.
The underlying JSON validator supports 100,000 entries (provider rosters);
that does not raise the web/service installation limit. Only the authenticated
instance-admin catalog endpoints receive the larger body allowance. Other API
writes retain their 16 KiB limit. No `.env` setting is needed.

A minimal original example (replace the invented content with your own):

```json
{
  "schemaVersion": 1,
  "source": "my-workshop",
  "revision": "1",
  "license": "Original content created by this realm administrator",
  "characters": [
    {
      "id": "e5000000-0000-4000-8000-000000000001",
      "sourceKey": "my-workshop:paper-keeper",
      "name": "Paper Keeper",
      "series": "My Workshop",
      "categories": ["paper makers"],
      "popularity": 20
    },
    {
      "id": "e5000000-0000-4000-8000-000000000002",
      "sourceKey": "my-workshop:wind-reader",
      "name": "Wind Reader",
      "series": "My Workshop",
      "categories": ["paper makers"],
      "popularity": null
    }
  ]
}
```

Keep UUIDs and source-qualified keys stable when reusing a file. Categories are
trimmed, deduplicated, and sorted; category spelling/case remains significant.
Only one source namespace/revision is allowed per file. Unknown fields, image
URLs, duplicate IDs/keys, mismatched namespaces, and unsupported versions fail.
The license/rights statement is an administrator attestation, not independent
verification or permission to use somebody else's content. No URL is fetched,
artwork copied, or external API called.

Preview is read-only and server-authorized. A SHA-256 digest binds the parsed
catalog and complete realm settings. The service revalidates both and requires
the matching digest for custom creation. Installation creates the realm,
admin membership/starting grant, characters/provenance, and generated packs in
one PostgreSQL transaction. At least one generated pack must be playable under
the chosen tier weights and pack size. Other packs may begin unavailable, as
shown in the preview. Odds describe the initial first draw; later claims,
multiple cards, and wishlists can change them. No gameplay values are changed
on existing realms.

Provenance stores source/revision/license, tier calculation version/time, and
original-import rights attestation. Installed IDs, assignments, and provenance
survive encrypted backup/restore; personal archives preserve collected IDs and
source keys. The raw file and original numeric popularity scores are not stored
as a re-import archive: retain your source JSON separately. No new database or
archive version is needed. Two realms may use the same character UUIDs because
installed definitions and ownership remain realm-scoped.

Creation does not replace or merge a live realm's catalog. Revisions/merges,
manual tiers and live pack editing remain planned. Selected metadata adapters
and an original scale catalog are available through the [provider pipeline](providers.md). Realm
creation uses a durable retry receipt for demo, JSON and CSV
catalogs. After an ambiguous failure, keep the page open and choose **Retry realm
creation**. The same proposal/key returns the original realm without another
starting grant, import or pack installation; fields stay locked until resolved.
Changing a proposal with an existing key is rejected. The receipt survives
encrypted backup/restore. Migration **0012** adds it without changing existing
realms. API creation requires a UUID `requestKey`; trusted internal library calls
may omit it and then have no retry guarantee. Reloading loses the browser's
pending proposal/key, so check the realm list before starting a new creation.


## Original CSV catalogs

CSV is an alternative way to create a **new** realm with your original content.
No provider, artwork, spreadsheet account, or additional environment setting is
required. It uses the same stable IDs, tier rules, preview, permission attestation,
and transactional installation as JSON. JSON and the original demo remain available.

1. Sign in as the instance administrator and open **Administration → New realm**.
2. Under **Content for this new realm**, choose **Your CSV file**.
3. Use **Download CSV headers** for a blank template. Add one character per row
   in your spreadsheet/text editor, then save as UTF-8 **comma-separated** CSV.
   Upload it with **Original catalog CSV file**. XLSX, UTF-16, semicolon-separated
   CSV, and delimiter detection are not supported in this slice.
4. Enter **CSV source namespace** (for example `workshop`), **CSV revision** (your
   version label), and **CSV permission statement** (your original-content rights).
   These describe the entire file. All source keys must use that namespace.
   The metadata format version is fixed at 1; unsupported API versions fail.
5. Confirm that you created the content and have permission to use it, name the
   realm, and choose **Preview catalog and packs**. Review the format, source,
   revision, permission statement, individual characters/tiers, pools, and odds.
6. Choose **Create with original catalog**. Changing the file, metadata, format,
   or settings requires another preview. The selected format and normalized
   catalog/settings are bound to the review. Equivalent CSV quoting/newline
   styles do not change the normalized content.

The six case-sensitive headers must occur exactly once, in any order:

```csv
id,sourceKey,name,series,categories,popularity
```

| Column | Rules |
| --- | --- |
| `id` | A stable UUID for this original character. Create it once and keep it. |
| `sourceKey` | Namespace and stable slug, e.g. `workshop:vale`. Lowercase letters, numbers, hyphens, one colon; max 160 characters. |
| `name` | Nonempty character name, max 100 characters. |
| `series` | Nonempty original series/universe name, max 100 characters. |
| `categories` | Optional tags separated by `|`; max 20 tags, 60 characters each. Empty cell means no tags. Empty tags within a list fail. |
| `popularity` | Blank for unknown, or nonnegative whole decimal digits up to JavaScript's safe-integer limit. Zero/leading zeros are valid; fractions, exponents, signs, `null`, and formulas fail. |

An original four-character example is provided in
[workshop.v1.csv](../../packages/importers/fixtures/workshop.v1.csv). Use source
`workshop`, revision `original-1`, and an appropriate permission statement when
reviewing that project's original MIT fixture. For your own dataset, create your
own content and keep its identifiers stable. In PowerShell, `[guid]::NewGuid().ToString()`
creates one new UUID for an entry; do not generate it again on each import.

UTF-8 BOMs and standard LF/CRLF/CR line endings are supported. Blank lines are
ignored. Cells/header names are trimmed at their outer edges. Names and other
quoted fields may include commas, double quotes (escaped as `""`), and line
breaks. Categories are trimmed, deduplicated, and sorted with spelling/case
preserved. A literal pipe within a category name requires JSON instead of CSV.
Unknown/duplicate headers, extra/missing fields, unmatched quotes, duplicate
UUIDs/keys, wrong source prefixes, null characters, and invalid rows reject the
whole file. No partial install or automatic row repair occurs. Error messages
name a record/field where available, without reflecting submitted field values
or raw parser diagnostics. Record numbers count CSV records, including the
header, rather than physical lines when quoted values span multiple lines.

Limits remain **1,000 characters** and a **2 MiB HTTP JSON request**, including
CSV text, metadata, and realm settings. The file picker reserves 16 KiB, and the
client checks the final request size because JSON escaping of quotes/newlines
can increase it. The CSV adapter separately caps text bytes, record size, and
row count while parsing. Empty catalogs and configurations with no playable
starter pack fail before installation. Other API writes retain their smaller
body limit.

The CSV adapter uses [csv-parse's synchronous API](https://csv.js.org/parse/api/sync/)
with strict field counts/quotes and bounded records, then passes the entire
catalog through JSON v1 validation and tiering. Installed provenance records
`original-csv-v1`, rights attestation, source/revision/license, and tier calculation
version/time. Private encrypted backups restore this metadata, IDs, and progress
without a new database or archive version. The raw CSV/popularity scores are not
retained as a separate import archive; keep the source file yourself. CSV import
cannot alter an existing realm, merge revisions, or overwrite claims. Live pack
editing, additional filter types and live merges remain future work. See the
[provider pipeline](providers.md) for selected metadata adapters and scale testing.


## Choose starter categories and names

JSON, CSV, and the demo all support [reviewed starter pack selection](starter-packs.md)
when creating a new realm. First preview the catalog to load its
category counts, then choose automatic selection or select/rename categories,
and preview the revised proposal. All Characters is always included. File/type
changes reset selection; metadata edits retain it but invalidate the review.
