# Game rules: reviewed live realm settings

Realm administrators can open **Administration → Game rules**, edit rules
under the Economy, Collection, Progression, Collector ranks or Trading tabs,
and choose **Preview settings changes**. Review the current/proposed
values, player impacts, warnings, and pack availability, then choose **Apply
reviewed settings**. **Discard preview** changes no rules; **Close settings**
leaves the live realm as it was. Ordinary players cannot preview or apply.

## Editable rules and protections

The editor supports pack price/size, future-member starting gems, cooldown,
rarity weights, recycling rewards, first-collection XP, level thresholds,
wishlist slots/weight, [collector rank tracks](collector-ranks.md),
[timed gem claims](gem-claims.md), and [trading rules](trading.md).
Existing trades retain their creation rules and fixed expiry; trading changes
apply to new offers. Config validation uses v11; no new environment variables are needed.
Versioned [character-value rules](character-values.md) control saved-popularity
and bounded wishlist-demand bonuses. Existing realms migrate with valuation
disabled. The default opening cooldown is zero; set **Economy → Cooldown
(seconds)** to zero and review/apply to remove an older realm's wait.

- Existing wallets, XP, cards, wishes, ranks, cooldown timestamps, and historical
  receipts remain intact. New rules govern future operations.
- Starting gems apply only to future memberships, including new invitations.
  Existing members never receive another starting grant.
- XP rewards apply only to future first collections. Known characters remain
  known. New level thresholds can raise or lower displayed levels, which the
  preview counts; owned upgrades keep their permanent benefits.
- Purchased collector levels retain their track identity, costs, benefits and
  prerequisites. Already purchased legacy ranks also retain their rules and
  benefits; their separate shop is retired. New track levels and unpurchased
  rules can be changed within the validated configuration bounds.
- Wishlist capacity cannot fall below the largest currently occupied list.
  Players must remove excess wishes before a lower capacity can be applied.
  Admins receive aggregate counts, not other players' private wish entries.
- Unique ownership, pack-generation minimum/maximum settings, and existing pack
  IDs are protected. Casual mode and live pack regeneration remain future work.

The preview shows changed values; counts of players gaining/losing derived
levels, paying more/less, able to afford a pack, or waiting on cooldown; and
per-pack eligible counts, complete-pack availability, and rarity odds. Warnings
call out unreachable rank requirements, potential profitable recycling, and
future-only rewards. Blockers disable saving and are checked on the server.
Custom economics are permitted when the proposal is otherwise valid.

Cooldown waiting counts are evaluated at preview time; time can naturally pass
before saving. Changes use the existing last-opening timestamps, so a longer
cooldown can extend a wait and a shorter one can end it earlier.

## Review, concurrency, and retries

Previews last five minutes and are stored against the reviewing admin, realm,
proposed configuration, current revision, and a fingerprint of relevant realm
state. Gameplay, purchases, wishlist edits, membership additions, or another
settings save can invalidate a preview. Re-preview before applying when the
server reports that state changed. Editing the form discards its displayed
preview. Only the server-stored proposal can be applied; extra configuration
fields sent with an apply request have no effect.

Preview/apply services check realm-admin membership inside a transaction and
use the same realm lock as gameplay and membership provisioning. Apply updates
rules/revision and inserts an immutable audit receipt together. Failure rolls
both back. Concurrent previews cannot overwrite one another's saved changes.
The UI retains an uncertain save and offers **Retry settings save**, using the
same preview ID/request key; this replays the original receipt even after
expiry, another save, or restore. Reusing that key for a different preview is
a conflict. Revoked admin permissions are checked even for receipt replay.

Pending keys live in page memory, as in the other gameplay forms. Refreshing or
closing the page can lose an unresolved client attempt; reload the current
realm state before preparing another proposal. Gameplay controls are disabled
while the editor has an unresolved request. There is no configuration history
timeline or one-click rollback UI; a prior safe configuration can be reviewed
and applied as a new change.

## HTTP contracts

Authenticated, same-origin `POST /api/settings/preview` accepts an object with
`realmId` (the realm UUID) and `config` (a complete valid v10 configuration object).
The response includes preview `id`, base `revision`, `expiresAt`, and
aggregate `impact`. Previewing stores only transient review state and changes
no gameplay rules, balances, or progress.

Authenticated, same-origin `POST /api/settings/apply` accepts:

```json
{
  "realmId": "<realm UUID>",
  "previewId": "<preview UUID>",
  "requestKey": "<fresh idempotency UUID>"
}
```

Success returns `ok`, stable `changeId`, new `revision`, and `appliedAt`.
The preview must belong to the caller and realm, be unexpired, still match
the reviewed state, and have no blockers. Initial realms start at revision 1.

New HTTP pack-opening, recycling, upgrade-purchase, wishlist and timed gem claim commands
include `expectedRevision` from the displayed realm. A mismatched, missing,
or invalid revision produces `SETTINGS_CHANGED` (409), with no gameplay write.
The UI refreshes and requires a fresh action, preventing a stale page from
spending at a newly increased price or accepting a changed reward. Pending
attempts retain their original revision. Committed receipts replay before
checking revision, preserving historical results and retry safety. Trusted
internal service callers may omit the guard to act on current rules; adapters
presenting a quoted offer should pass its displayed revision.

## Persistence and recovery

Migration `0007_realm_settings.sql` adds the revision, transient preview table,
and realm-scoped change audit. It changes no existing gameplay settings or
progress. Trading added config/player archive **[v6](trading.md)**; player exports use
the current public rules and preserve personal IDs and history. Purchased-rank
protection keeps older purchase history compatible with those current rules.

Encrypted backup envelope **v1** recognizes revisions 0001-0023. It preserves
configuration revisions and change receipts with before/after snapshots and
stable IDs. Previews are transient and excluded, like sessions and OAuth flows.
Fresh restore validates the contiguous revision chain, receipt metadata, and
agreement with current rules, in addition to existing wallet/XP/purchase/wishlist
checks. Earlier snapshots gain revision 1 and an empty audit, preserving their
rules and progress. Saved-action retries remain replayable after restore.

Verified with pure impact tests, real PostgreSQL concurrency/rollback/RBAC and
restore tests, and production desktop/mobile browser flows, including stale
player offers and lost-response saves. Fixtures make no live API calls. The
signed Discord pack commands now use these services; see [operator setup](../deployment/discord-gameplay.md).

The collector rework adds v7 rank rules. Purchased collector names/costs/benefits
are protected alongside old discount ranks, and preview capacity, price, cooldown
and recycling warnings account for rank bonuses. See [collector ranks](collector-ranks.md).

Config v8 introduced timed gem claims. In **Economy → Free gem claims**, choose
**Use recommended** (shown while the rules differ from 1,000 gems every 6 hours)
to enable the current preset in an existing realm, then preview and apply. Claims can invalidate a pending settings preview, just like other gameplay.
Player archives use v11 and preserve personal claim rules/receipts and collector
track progression. See [gem claims](gem-claims.md) and [collector ranks](collector-ranks.md).
