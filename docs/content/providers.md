# Anime/manga providers and scale testing

The creation workflow accepts a canonical catalog regardless of provider. Each
adapter maps source identity, names, series, categories and one compatible
popularity cohort to version-1 catalog JSON. Core draws, packs, ownership and
backups do not know how a source request was made.

New catalog installations retain the supplied numeric popularity alongside its
existing source/revision provenance. Config v11 can use that evidence for
[character values](../gameplay/character-values.md), independently of rarity.
Draws make no new provider lookup. Older catalogs keep missing scores neutral;
an admin can review restoration from an authorized saved catalog with matching
stable IDs, source keys, source and revision, without replacing the roster.

## Roster size

Provider rosters (catalogs whose source is `mal` or `anilist`) may contain up to
**100,000 characters** per realm, sent in a creation request of at most 100 MiB
(a typical entry with an artwork reference is 0.4–0.6 KB, so 100,000 characters
are roughly 40–60 MiB). This ceiling is a request-size and memory safeguard; the
admin chooses the actual size with the roster slider. Hand-made JSON and CSV
uploads keep their original limits of 1,000 characters and 2 MiB. A preview
returns the counts, packs and odds for the whole roster but only a 300-character
sample of the assignments.

Measured on a desktop PC with the embedded test PostgreSQL (synthetic roster
with artwork references, one admin):

| Characters | Preview | Create | Realm page data | Open one pack |
| ---: | ---: | ---: | ---: | ---: |
| 10,000 | 0.2 s | 0.5 s | 0.3 s | < 0.1 s |
| 25,000 | 0.5 s | 1.3 s | 0.3 s | 0.15 s |
| 100,000 | 2.0 s | 6.2 s | 1.3 s | 0.7 s |

Realm pages still load every character of the realm on the server, so beyond
about 25,000 characters each navigation becomes noticeably slower, more so on
small servers; the slider says so. Characters are inserted in batches inside the single creation
transaction, so a failure still leaves no partial realm. The browser receives a
slim realm view: Collection, trades and the market only load the characters they
show, and the character glossary/wishlist picker page the catalog on the server
(`GET /api/catalog`, members only).

## MyAnimeList roster (Tenrai / Jikan-compatible API)

Open **Administration → New realm**, step **Characters**: **Anime & manga
roster** is selected by default and **MyAnimeList** is its default source.
**Tenrai** is the default service. It
implements the Jikan v4 response format using MAL identifiers. The separate
**Jikan legacy public API** option retains the original transport, but that
public endpoint was unreachable during an earlier manual check; its project
tracker reports the public-service discontinuation. No automatic host switch
takes place after consent.

Review the selected service's usage requirements and enable its explicit request
consent. Tick the **kinds of series** to walk, then choose one of two ways to
build the roster:

| Kind | MyAnimeList list and type | Category added to its characters |
| --- | --- | --- |
| Anime (TV) | anime, `tv` | Anime |
| Web anime (ONA), includes most donghua | anime, `ona` | Web Anime |
| Anime films | anime, `movie` | Anime, Anime Film |
| Manga | manga, `manga` | Manga |
| Manhwa (Korean) | manga, `manhwa` | Manhwa |
| Manhua (Chinese) | manga, `manhua` | Manhua |
| Light novels | manga, `lightnovel` | Light Novel |

MyAnimeList has no separate donghua type: Chinese animation is listed almost
entirely as web anime (ONA), next to some Japanese web series. These medium
categories make **medium packs** (Anime, Manga, Manhwa, …) for fans of one
medium: new realms create them right after the demographic packs (unless one
medium covers nearly the whole roster, which would repeat All Characters), and
**Packs** can add one later. AniList tags Anime, Donghua, Manga, Manhwa, Manhua
and Light Novel from type, country of origin and format.

Characters imported before medium categories have none. **Administration →
Characters → Tag series by medium** (MyAnimeList realms) reads MyAnimeList's
popular series lists of the chosen kinds (titles only, 25 per request) and tags
every realm series whose title matches (`tagRealmSeries`,
`POST /api/realm-characters/series-tags`). A title found in both lists (an
anime and its manga) gets both categories.
Several kinds alternate page by page, most popular series first.


- **Popular roster.** Choose a roster size with the slider (100 to 100,000
  characters, finer steps for small rosters) or type an exact number (50 to
  100,000), choose the number of characters per series (10, 15, 25, 50 or 100), then
  **Prepare popular roster**. The page estimates the preparation time (about
  1 minute for 1,000 characters, about 1.8 hours for 100,000 at 25 per series). The browser walks the most popular series in order (the chosen kinds'
  pages alternate) and takes each series' main characters
  first, then its most favourited supporting cast. Fewer characters per series
  means more series and more variety.
- **Choose series.** Search or browse popular series, tick the ones you want and
  choose **Prepare selected series**. Only those series are requested.

Preparation shows progress, supports pause/resume within the page, and can
download the prepared selection as catalog JSON. Editing the service, medium,
roster size, characters per series, selected series or artwork permission
invalidates the prepared proposal. Keep the page open while preparing: requests
never run in the background.

Each service call makes one GET to a fixed allowlisted host. Setup advances
sequentially and stays below each service's published limits (`jikanPacing`):
Tenrai allows 120 requests/minute and 4/second, so calls are 0.65 s apart with an
instance-wide budget of 100 per minute; the legacy Jikan API allows 60/minute, so
calls are 1.1 s apart with a budget of 55 per minute. Budgets are shared across
web processes and admins (per service). A lookup has a fifteen-second
timeout and eight-MiB response cap; redirects and automatic retries are disabled.
An upstream 429 or failure pauses preparation. A preparation reads at most 400
series pages (25 series each) per medium and stops at the chosen roster size.
Anime setup uses TV series and the provider's SFW filter; manga setup uses manga.
MyAnimeList's anime and manga series IDs are tracked separately; a character that
appears in both is stored once with merged categories. No user profiles,
biographies, voice actor records or full-database mirror are stored.

The series response's genres, themes and demographics become catalog
categories; no additional request is made for these fields. This retains actual
tags such as Isekai, Mecha or Shounen. Missing tags are not inferred from Action
or Fantasy. Each series also contributes an **era** category from its first
release year (for example `2010s`). Favourites are compared within this MAL
catalog cohort. MyAnimeList lists names as `Family, Given`; new imports store
them in reading order (`Kaneki, Ken` → `Ken Kaneki`), keeping particles such as
`Monkey D., Luffy` → `Monkey D. Luffy`. Stable IDs and source keys are unchanged
by this formatting, and existing realms keep the names they were created with.

Tenrai's published terms permit private application storage, caching, indexing
and transformation of API responses subject to technical limits and third-party
rights. Its documented public limits are 120 requests/minute and four/second;
the engine uses the lower budget above. See [Tenrai terms](https://tenrai.org/terms)
and [API reference](https://api.tenrai.org/llms.txt). The service remains optional;
there is no key, paid feature or runtime dependency required for ordinary play.

The engine retains the reviewed roster's stable IDs, names, categories, tier
assignment and permitted artwork references. Draws use that eligible roster and
the realm's existing server-side rarity weights. Choosing arbitrary remote IDs
at draw time would neither identify missing IDs nor preserve category membership
and source-percentile tiers. Saved local gameplay state keeps ownership, actual
available odds, retries and backups usable during a provider outage.

For an explicit operator-run preparation outside the automated suite:

```sh
pnpm exec tsx scripts/prepare-jikan.ts --service tenrai --medium both --characters 5000 --per-series 25 --output .test-data/anime-5000.catalog.json --confirm-provider-use
```

To include artwork references, add `--artwork-permission` followed by your
permitted-use statement. Add `--resume` after a paused attempt; checkpoints bind
the chosen service, medium and target, and older single-medium checkpoints are
still accepted. The command prints counts, saves a local selection/checkpoint
and never downloads artwork. Keep real provider data out of committed fixtures;
`.test-data/` is ignored. The saved canonical JSON can be reviewed through the
manual JSON creation flow or the MyAnimeList browser's downloaded catalog.

To show pictures, tick **Include character artwork through API, permission
needed** and enter your permitted-use statement before preparing. Without it,
cards show initials, and the catalog preview warns that the roster has no
pictures.

## AniList series browser

Open **Administration → New realm → Anime & manga roster → AniList**. Confirm that you reviewed AniList's terms, optionally
enable artwork references with a permission statement, choose what to search
(anime or manga of every country, or only donghua, manhwa, manhua or light
novels, using AniList's country of origin and format; works are tagged Donghua,
Manhwa, Manhua or Light Novel accordingly),
then search AniList or browse its most popular series and **tick the series you
want** (up to 100 per catalog). **Prepare selected series** requests each chosen
series' characters — main cast first, up to 10, 15, 25, 50 or 100 per series
(AniList returns 25 per request, so 100 takes four requests) — and merges
them into one catalog for the ordinary review.

AniList's terms prohibit mass collection, so there is deliberately no automated
"popular roster" sweep for AniList: every series request corresponds to an
explicit admin choice. Requests are paced 2.5 seconds apart in the browser and
share an instance-wide budget of 24 requests per minute (AniList currently
publishes 30 per minute while degraded, 90 normally). The transport is fixed to
`https://graphql.anilist.co` with an eight-second timeout, a two-MiB response
cap, no redirects or cookies, and no automatic retries; a 429 pauses preparation.

Categories are the series' genres, AniList's real **Demographic** tags (such as
Shounen, Seinen, Josei, Shoujo or Kids) and the release era. Other community
tags are not imported. Favourites become the popularity cohort. Names use
AniList's preferred display name. With artwork enabled, the adapter stores the
`s4.anilist.co` character image URL and an `anilist.co/character/<id>`
attribution — references only, never image bytes.

## AniList selected lookup

Open **Administration → New realm**. Under **Content for this new realm**,
choose **Anime & manga roster → Other formats**, then **AniList lookup**. Choose
Anime or Manga and enter up to **25 numeric AniList character IDs**. Review
[AniList terms](https://docs.anilist.co/guide/terms-of-use), confirm that this
selected use is permitted, explicitly opt into the request and choose
**Prepare provider catalog**. Confirm metadata permission in the ordinary catalog
review, preview packs/tiers, and create a new realm.

The single GraphQL request selects only those IDs, favourites and up to five
related works of the chosen medium, including genre names. The most popular
returned work supplies the displayed series; genres supply categories such as
Action, Adventure, Fantasy or Sci-Fi. These choices are visible before creation.
Favourites are compared only inside that selected AniList cohort. Missing values
use the existing neutral/common fallback. They do not alter already owned tiers.
The instance-admin service limits these lookups to six per minute per admin and
authorizes before any upstream request.

AniList permits non-commercial use subject to its terms, prohibits mass data
collection and competing tracker services, and does not license character
artwork merely by returning an API field. This engine does not independently
validate an operator's rights statement. No API key or external service is
required for core gameplay.

## Authorized response adapters

**AniList JSON** accepts an authorized GraphQL response shaped as
`data.Page.characters[]`, with id, name.full, favourites and
media.nodes[].type/title/genres. **Jikan JSON** accepts a Jikan v4 character
`data` object or array with mal_id/name/favorites; the operator supplies its
series and major categories. A permission statement is required. These raw
response adapters discard images, biographies and unrelated fields. The API
browsers support explicit artwork references as described above. Canonical
catalog JSON can also carry the validated optional `artwork` object for manual
extensions. Jikan's software license is not a license for MyAnimeList data or
franchise artwork.

AniList identities use `anilist:<id>` and Jikan identities use `mal:<id>`; their
deterministic UUID namespaces are different, so numeric IDs never collide across
providers. Do not mix raw favourites from different sources into one cohort.
To add another database, add its descriptor/schema/normalizer at the provider
boundary and return canonical catalog v1; gameplay and persistence stay unchanged.

The current adapters create a new realm. Existing catalog merging/replacement
and cross-source character deduplication remain future work. Provider payloads
and raw files are not stored as a re-import archive; keep your permitted source
file separately. Installed source keys, source/revision/license provenance,
character IDs and progress survive encrypted recovery.

## Packs for anime/manga catalogs

Anime/manga catalogs lead with their actual **Shōnen, Seinen, Shōjo, Josei and
Kodomo** tags, then fill the remaining automatic slots with the largest
**distinct** genre, theme and era pools for variety — for example Battle Arena
(Action), Fantasy Realms, Isekai Gateways or 2010s Stars. A category that covers
85% or more of the roster is skipped because it would only repeat All
Characters, and a pool that is at least 90% identical to an already chosen pool
is skipped as a near-duplicate (distinct demographic groups are always kept).
Genres are never relabelled as demographics; every pack draws from its exact
saved category. The default is ten category packs; admins can choose up to 30
when creating a realm.

Existing realms keep every saved pack row, including older automatic genre packs
that were previously hidden from the anime gallery; they are visible again and
still draw from their saved category. Realm admins can add more packs to an
existing realm from **Administration → Packs**: pick catalog categories (grouped
as demographics, genres, themes and eras), name the packs and add them. This
inserts new pack rows only — ownership, cards, balances and opening receipts are
untouched — and retrying an applied request reports the packs as already present.

## Adding missing characters to an existing realm

**Administration → Characters** (instance admins who administer the realm) looks
up one series at a time on the realm's own provider — MyAnimeList through
Tenrai/Jikan, or AniList — in any of the kinds above, and lists its cast (up to
100 characters per series). Characters already in the realm are marked and
cannot be selected; the rest show the rarity they would get. **Add N characters**
installs the selection:

- New rows only: existing characters, cards, packs, balances and receipts are
  untouched, and the realm's config revision does not change.
- Each new character joins **All Characters** and every pack of its categories
  immediately. Categories the realm did not have before are reported so you can
  add a pack for them under **Packs**.
- Rarity uses the same source-percentile rules as realm creation, ranked against
  the popularity already saved for the realm (a character more popular than the
  whole roster becomes legendary). Without popularity evidence it is common.
- Stable IDs and source keys make a retry report the characters as already
  present instead of duplicating them; an ID that belongs to a different source
  key is rejected.
- Artwork references follow the same opt-in as realm creation; the permission
  statement defaults to the one most of the realm's artwork already uses.

Each lookup is one explicit request inside the instance-wide provider budget;
nothing is collected in the background. Realms built from your own JSON or CSV
file keep their original catalog. The service is `addRealmCharacters` in
`packages/db/src/realm-characters.ts` (`GET/POST /api/realm-characters`,
`POST /api/realm-characters/check`).

### Growing a MyAnimeList roster

**Grow the roster** (same screen, MyAnimeList realms) is the wizard's popular
roster for an existing realm: tick the kinds of series, set how many characters
to add (slider or exact number, up to 10,000) and the characters per series (up
to 100), then start. It walks the most popular series and adds only characters
the realm doesn't have yet, so it fills in new series and, with a higher
per-series count than the realm was created with, the rest of each long
series' cast. Rarity follows the realm's ranking and fame floors, like any
addition. Batches of up to 200 are saved as they arrive: **Pause** keeps
everything added so far and **Resume** continues the walk. Afterwards run
**Detect genders** so the new characters join the Waifus and Husbandos packs.
AniList realms grow series by series with the lookup above; AniList's terms rule
out a bulk walk.

## Removing characters

Characters keep the artwork reference they were imported with; there is no
later artwork walk (pictures load from the provider, nothing is stored).
**Remove characters without a picture** (Administration → Characters, every
realm) removes all of them in one go; **Remove one character** below it removes
a single character found by name or series. Each removal is reviewed first: how many characters, which ones players
own, and the gems their owners get back.

- A removed character leaves packs, the glossary, wishlists (its wishes are
  cleared) and every future pull. Its row stays, so pull receipts, trades,
  exports and backups keep stable IDs.
- An owned card is recycled for its owner: they get the card's recycle value,
  exactly as if they had recycled it themselves (same recycling journal and
  wallet entry).
- A character whose card is listed on the market or reserved in a pending trade
  is skipped until that ends.
- Packs left with fewer characters than the realm's minimum pool are named in the
  review.
- The review is bound to the realm's state: a pull, trade or listing in between
  makes it stale and the removal is refused. A retry with the same request key
  replays the result.
- Adding the character again (lookup or growth) brings it back with its saved
  tier. Until then **Player collections** can't restore its refunded card.

Each removal is journaled in `character_removals` (migration 0029) and checked
on restore. The service is `packages/db/src/character-removal.ts`
(`POST /api/character-removal/preview`, `POST /api/character-removal`).

## Waifus and husbandos

New MyAnimeList rosters can detect them while they are prepared: **Detect waifus &
husbandos** (on by default under **Popular roster**) adds one profile lookup per
character, so preparation takes about twice as long, and the realm is created with
the Female/Male categories (the automatic pack choice then usually includes
Waifus and Husbandos). Characters checked this way carry only the category; the
existing-realm panel below may look again at characters whose gender stayed
unknown.


The **Waifus** and **Husbandos** packs draw from the `Female` and `Male` character
categories. AniList series imports include AniList's gender field, so new AniList
rosters get these categories directly. MyAnimeList has no gender field (Tenrai and
Jikan only return a free-text biography), so **Administration → Characters →
Waifus & husbandos** checks each character's profile once (one paced request per
character, most popular first, pausable): an explicit "Gender:"/"Sex:" line wins,
otherwise at least three pronouns must agree two to one; anything else stays
unknown. Only the result (and when it was checked) is stored, never the biography
(`setRealmCharacterGenders`, `GET/POST /api/realm-characters/genders`).
**Create Waifus & Husbandos packs** then adds both packs. A 2,500-character realm
takes about 30 minutes with Tenrai; you can stop any time and continue later, and newly added
characters are checked on the next run.

## Original 1,000-character scale catalog

The wizard no longer offers this as a separate option. In **Administration → New
realm → Characters**, choose **Your JSON file**, use the **1,000-character test
catalog** download link and upload that file (the **12-character demo catalog**
link works the same way). It is a 277-KiB fictional dataset that generates up to
ten major-category packs plus All Characters. The roster and series are original test content,
not an anime database or a claim of provider coverage. It has stable UUIDs,
source keys and a 100/250/650 rare/uncommon/common source-percentile cohort.

The same file is downloadable at `/catalog-scale.v1.json`. Generate it locally:

```sh
pnpm exec tsx scripts/generate-catalog.ts 1000 original-scale.json
```

The optional second argument is the destination; omit it to print JSON. Counts
from 12 to 1000 are supported. This command makes no network request. Unit and
real-PG tests verify the full fixture, preview/category names, concurrent
retry-safe opening, stable exports and fresh encrypted backup recovery. A
5,000-character provider-shaped fixture (original names only) verifies batch
installation, demographic/genre/era packs, in-memory pack pools against real
draws, server-side catalog paging and adding packs to an existing realm.
Provider tests use synthetic original labels and injected fetch responses, never
external live APIs.

Primary API references checked during implementation:

- [AniList GraphQL request format](https://docs.anilist.co/guide/graphql/)
- [Character fields/media connection](https://docs.anilist.co/reference/object/character)
- [Media genre, tag and title metadata](https://docs.anilist.co/reference/object/media)
- [AniList terms](https://docs.anilist.co/guide/terms-of-use)
- [AniList rate limiting](https://docs.anilist.co/guide/rate-limiting)
- [Jikan v4 schema](https://github.com/jikan-me/jikan-rest/blob/master/storage/api-docs/api-docs.json)
- [Jikan public-service discussion](https://github.com/jikan-me/jikan-rest/issues/610)
- [Tenrai Jikan-compatible reference and limits](https://api.tenrai.org/llms.txt)
- [Tenrai API usage terms](https://tenrai.org/terms)
