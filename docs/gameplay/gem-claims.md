# Timed gem claims

New realms enable **1,000 gems every six hours**. Open **Collector ranks** and choose
**Claim gems**. The first claim is available immediately. A successful claim
credits the wallet once and starts a rolling wait from that claim's server time.
The header displays readiness or the next-claim countdown on every play screen.
Clicking the header's claim/countdown opens Collector ranks; it does not spend
or claim automatically. That page also shows the next claim's local day/time.
Disabled claims are shown
explicitly. Gems are credited when the player claims; reaching zero on the timer
does not automatically refill the wallet.

Claims are manual. Waiting twelve hours with a six-hour interval still makes
one claim available; missed claims do not accumulate. Claiming awards no XP,
cards or rank progress. Wallets and claim timing remain independent in each realm.
The Sapphire and Emerald [collector ranks](collector-ranks.md) shorten a player's
claim interval (by up to half of it together); the countdown and each claim use
the player's own interval, which the claim receipt records.
The current web API supports claims; a Discord claim command is future work.

## Configure a realm

A realm admin can open **Administration → Game rules → Economy** and edit
**Free gem claims**. **Use recommended: 1,000 gems every 6 h** appears while the
rules differ from that preset and restores it; otherwise switch **Timed gem claims**
on or off and set gems per claim and the claim interval. Choose **Preview settings
changes**, inspect the impact and apply the reviewed proposal.

The amount accepts whole numbers from 1 to 1,000,000 gems. The interval accepts
whole seconds from 60 seconds to 31 days; the form expresses this in hours.
Changes affect future claims. Eligibility uses the last successful claim time
plus the current interval, so reducing or increasing the interval can move the
next available claim. Disabling claims preserves balances and history; enabling
again continues from the last successful claim. A saved receipt keeps its
original amount, rules and quoted next-claim time.

Configuration version 8 introduced `gemRewards`; current config v11 keeps its
shape. New realms use:

```json
{
  "enabled": true,
  "amount": 1000,
  "intervalSeconds": 21600
}
```

Migration 0016 upgrades existing realms with `enabled: false`, amount 25 and
interval 21,600 seconds. It preserves existing cards, balances, collector ranks
and receipts, and grants no gems during migration. Enable claims through the
reviewed settings flow when ready to introduce recurring income into that realm.
Later rarity/rank migrations preserve those historical rules too. The reviewed
collector economy preset changes existing claims only when explicitly applied.

## Retries and recovery

`POST /api/gems/claim` requires an authenticated realm member, same-origin write
and the current settings revision. The server determines the amount and time.
It serializes on the realm row, then records the claim receipt, wallet credit
and namespaced ledger entry in one transaction. Concurrent fresh requests can
award only once per interval. A request key belongs to one player and realm;
replaying a successful request returns that saved result without crediting again.

If the response is lost, keep the page open and choose **Retry gem claim** to
recover the same request. The pending key stays in page memory. After a reload,
the server's current wallet and cooldown show whether it committed. A previously
successful request can still be recovered after settings change or claims are
disabled, provided the caller remains a realm member.

Player archive version 11 includes current claim rules, personal claim receipts
and their wallet entries. Older archive versions remain readable. Encrypted
instance backups include claim timing and immutable rule snapshots; restore
validates rewards, cooldown history and matching wallet entries. Restoring an
older backup adds disabled claims without inventing historical rewards. The
encrypted backup envelope remains version 1.
