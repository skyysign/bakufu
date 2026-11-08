# Anime and manga catalog pipeline

This guide covers **selected Wikidata metadata**. The realm wizard no longer
offers Wikidata as a content option (the MyAnimeList and AniList rosters cover
anime and manga with popularity and artwork). The importer remains available to
scripts as `POST /api/catalog/wikidata` (instance admins): send 1-25 character
item IDs, the series, the medium, `revision` and `providerConsent: true`, then pass
the returned catalog JSON to the ordinary preview and creation API, or save it
and upload it through **Your JSON file**.

For selected AniList lookups, authorized AniList/Jikan JSON responses or an
original 1,000-character scale test, use the [provider guide](providers.md).

This is a small, manual selection, not a full franchise/database crawler. A Q ID
must have an English label. The operator supplies the series and medium; the
adapter does not independently prove those classifications or silently scrape
relationships. Wikidata search and multi-series source selection remain
future work. Names are plain text, popularity is absent and characters use the
existing neutral/common fallback. No rankings or fictional rarity claims are
inferred from source IDs.

The adapter emits the same version-1 JSON catalog as manual imports. Wikidata Q
IDs map deterministically to stable UUIDv5 character IDs and `wikidata:q...` source
keys, enabling reuse across isolated realms and future provider pipelines.
Creation stores source/revision/license provenance. Catalog IDs and progress
remain portable through personal archives and encrypted recovery. Existing realm
catalog replacement/merging remains planned; this flow creates a new realm.

Wikidata's structured data is CC0; this does **not** license franchise artwork.
The adapter requests names only and never downloads images, biographies or
remote page HTML. Original demo portraits are separate local project assets;
other characters use original fallback artwork. JSON/CSV imports remain available
for original or appropriately licensed anime/manga datasets. Permission and
metadata normalization remain separate from any future artwork adapter.

Every provider lookup requires instance-admin authorization and explicit consent,
is limited to six requests per admin per minute across web processes, requests a
fixed HTTPS API host with maxlag, has an eight-second timeout and two-MiB response
limit, and follows no redirects or automatic retries. Remote errors are sanitized.
Automated tests inject synthetic fixture responses and make no live API calls.
Core gameplay and self-hosted deployments remain usable without this provider.

Sources checked during implementation:

- [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing): CC0
  structured data; other namespaces and artwork have separate terms.
- [Wikibase API](https://www.mediawiki.org/wiki/Wikibase/API): bounded
  `wbgetentities` label requests for selected IDs.
- [Wikidata data-access guidance](https://www.wikidata.org/wiki/Wikidata:Data_access):
  identifying User-Agent, maxlag, rate-limit handling and no excessive requests.
- [AniList API terms](https://docs.anilist.co/guide/terms-of-use): restrict mass
  collection and competing services. No AniList/Jikan scraping or automatic
  full-database import is included in this rework.
