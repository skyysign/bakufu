# AGENTS.md — Instructions for Coding Agents

Read `README.md` and `docs/specification.md` in full before changing code. This file sets implementation rules; the specification describes intended product behavior and `docs/implementation-status.md` what is built. The game is playable (alpha); `docs/implementation-status.md` says what is built and what is not.

## Mission

Build a **free, open-source, host-neutral collectible card game engine** with a self-hosted web experience and optional Discord integration. Keep each realm's economy isolated, every piece of progress exportable, and gameplay thoroughly testable. Use original demo assets; do not depend on anime data or Discord to run core tests.

## Non-negotiables

1. **No unlicensed content or scraping.** Do not commit third-party anime/game/movie artwork, unauthorized data dumps, or automated mass-import scrapers. Provider adapters must be opt-in, respect terms, and separate metadata from artwork permissions.
2. **Portable deployment.** Docker Compose is the reference quickstart; do not build game logic around Vercel or any other vendor. Abstract the backup scheduler, storage, and external identity integrations.
3. **Secure state.** Every gameplay record belongs to a realm; use database transactions and constraints for unique ownership, gem spending, and trading. Protect against retries, replay, and concurrent Discord/web actions.
4. **No secret leakage.** Commit `.env.example` only. Never store real tokens, credentials, or user data in the repo, logs, tests, exports, or screenshots.
5. **Auth before writes.** Enforce realm RBAC in service/API functions; UI-only restrictions are insufficient. Discord HTTP requests must be signature-checked using the raw body.
6. **Export and recover.** Keep IDs stable and formats versioned. Design migrations and test data round trips early; implement usable player export and restore-capable admin backups during MVP.
7. **No surprise hosting dependencies.** Use persistent PostgreSQL; don't rely on serverless local filesystem, an always-running request handler, or vendor-specific cron to protect data.
8. **No fabricated completion.** If something is a stub, TODO, or future milestone, say so clearly. Never mark a checkbox implemented without a passing test or manual verification.

## Preferred design

- `packages/core`: framework-free functions/services for packs, probability, economy, XP, upgrades, and trade state transitions.
- `packages/db`: PostgreSQL schema and transactional repositories.
- `packages/config`: typed, versioned presets; safe validation and migrations.
- `packages/importers`: original JSON/CSV adapter first; optional constrained source integrations later.
- `apps/web`: responsive website and HTTP API; optional signed Discord interactions endpoint.
- `apps/worker`: optional backup/scheduler jobs (not necessary for ordinary gameplay requests).
- `infra/docker`: minimal production and development Compose setup.

Use TypeScript, pnpm, PostgreSQL, and a sensible ORM/schema validation tool unless a real blocker justifies change. Prefer readable code to infrastructure cleverness.

## Sequence of work

1. Inspect repository and report what already exists. Do not invent packages or scripts.
2. Document **one** architecture decision covering realm scoping, unique ownership, and transaction boundaries.
3. Work in **thin vertical slices** with original, tiny fixture data.
4. Define and test service functions before adding decorative pack animations or source integrations.
5. Implement only what is needed for the stated slice; update `docs/implementation-status.md`, `CHANGELOG.md`, the README (when setup changes) and `.env.example` with actual commands.
6. Run available lint, typecheck, unit, and integration tests. Report the exact commands and whether they passed.

## Testing priorities

- Unique ownership survives two concurrent pack openings in the same realm.
- Identical character can be claimed in two different realms.
- Aborted/retried pack opening does not double debit or award cards.
- Empty eligible pool has a deterministic no-charge failure.
- Recycling is idempotent and releases a unique character.
- Trading is atomic and requires both participants' confirmations.
- Admin configuration cannot be changed by ordinary players.
- JSON import/export round trips preserve stable IDs without leaking secrets.
- Backups are tested by restoring to a fresh database, not by merely asserting that a file exists.

## Definition of done for any change

- Code, tests, schema migrations, configuration examples, and short documentation agree.
- No external live API calls from automated tests; use fixtures.
- Accessibility basics on interactive web UI: keyboard, visible labels, error states, mobile layout.
- All new gameplay values can be overridden through versioned realm config where appropriate.
- Any tradeoff/remaining limitation is recorded in docs or the final implementation report.

## When uncertain

Choose the smallest safe, portable solution consistent with the specification. Ask only for decisions that block implementation; otherwise state the chosen assumption. Do not silently change core gameplay semantics.
