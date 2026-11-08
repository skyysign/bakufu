# Changelog

Versions follow `MAJOR.MINOR.PATCH`, with `-alpha.N` while the game is in private
and public alpha. Each release is a git tag (`v0.1.0-alpha.1`, …). Database
migrations only move forward; every release lists the newest migration so you
know which backups it can restore.

## Unreleased

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
