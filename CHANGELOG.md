# Changelog

Versions follow `MAJOR.MINOR.PATCH`, with `-alpha.N` while the game is in private
and public alpha. Each release is a git tag (`v0.1.0-alpha.1`, …). Database
migrations only move forward; every release lists the newest migration so you
know which backups it can restore.

## Unreleased

Newest migration: `0028_tier_adjustments.sql` (realm config v12).

### Added

- **Fame floors**: MyAnimeList/AniList characters with enough favourites are at
  least rare (10,000), epic (30,000) or legendary (100,000), whatever the rest of
  the roster looks like. New realms use them; existing realms keep their tiers
  until an admin applies floors.
- **Administration → Rarity**: edit the floors, review every tier change (counts,
  changed characters, owned cards) and apply them; set one character's tier by
  hand or return it to automatic; see recent rarity changes. Realm admins only,
  retry-safe, journaled and included in backups with a restore check.
- Free hosting guide for **Vercel + Neon** (`docs/deployment/vercel-neon.md`):
  Discord sign-in stays the main login, `/bakufu` slash commands are off.
- Large uploads (rosters, sounds) are gzip-compressed by the browser; the server
  unpacks them under the same size cap. Fits Vercel's 4.5 MB request limit.
- `DATABASE_POOL_MAX` sets the database connections per server process (use 3
  with Neon's pooled connection); idle connections close after 10 seconds.
- API requests may run up to 60 seconds on hosts that limit request time.
- `pnpm discord:commands remove` removes `/bakufu` (and the old `/atlas`) from a
  server.

### Changed

- `pnpm backup` and `pnpm restore` say what went wrong (passphrase too short or
  not matching, file exists, folder not shared with Docker, empty or outdated
  database, login refused, host unreachable) instead of one generic message;
  they never print raw error text. An empty line at a hidden passphrase prompt
  is ignored.
- Realm creation and character additions apply fame floors, and the creation
  preview shows the resulting tier counts. The Game rules form can no longer
  change floors (use Rarity, which re-tiers with them). The operator economy
  preset leaves floored and manually tiered characters alone.
- Shorter README (features, quick start, hosting, docs index); the detailed
  status moved to `docs/implementation-status.md` and the product spec to
  `docs/specification.md`.
- Live pulls stop checking for new pulls after 5 minutes without input and
  resume on the next click or key press, so an open tab doesn't keep a
  sleeping database awake.

### Removed

- The Wikidata importer and its `/api/catalog/wikidata` endpoint (no longer
  offered in the realm wizard since the MyAnimeList and AniList rosters).

### Ideas

- A guided setup (installer or admin GUI) for self-hosters instead of working
  from the source code.

## 0.1.0-alpha.1 — 2026-11-08 (private preview)

First tracked version of Bakufu. Newest migration: `0027_admin_collections`.

### Added

- **Player collections** for realm admins (Administration → Player collections):
  look up a member's cards, wallet and recent losses; restore a recycled card
  (optionally taking the recycling gems back), return a card to an earlier owner,
  and add or remove gems. Every action needs a reason and is audited, idempotent
  and included in backups.
- Card inspection replays the card's opening reveal (tier effect and arrival).
- Live pulls open the full card inspector: character value, recycling estimate,
  popularity, collector demand and who owns the card now.
- Rarity by **standing** for new five-tier rosters: overall popularity, rank
  inside the character's own series and main-cast role. Main characters and each
  series' favourite are never common. Wider bands: 0.5% legendary, 2.5% epic,
  9% rare, 28% uncommon.
- CI workflow (lint, typecheck, unit, integration, build; browser suite on demand).

### Changed

- Default draw chances 65 / 26 / 7 / 1.7 / 0.3% (were 80 / 17 / 2.7 / 0.29 /
  0.01%). Existing realms keep their odds until an admin applies **Game rules →
  Collection → Use recommended values**.

### Earlier work (before version tracking)

Realms with unique ownership, packs and 1/5/10 bundles, recycling, trading,
market, wishlists, collector ranks and rank tracks, gem claims, Discord sign-in
and the `/bakufu` command, MyAnimeList and AniList roster preparation with
waifu/husbando detection, reveal sounds per tier and character, encrypted
backups with restore checks, and player exports. See `docs/implementation-report.md`.
