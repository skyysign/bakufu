# Milestone 3A: two-party trading

Open **Trades** on the dashboard. Both players must already belong to the same
realm. Copy **Your trade ID in this realm** and share it with the other player.
This ID is an address for offers, not a login credential. There is no public
player directory, and a trade never exposes the other player's email or Discord ID.

Browse/search existing members by Discord username/display name with the
[member picker](members.md), or paste a realm trade ID. Names refresh after
verified Discord sign-in; identities and offers still use stable codes.

1. Expand **Start a trade**, choose a member or paste their ID, and choose cards and/or
   gems to give. **Browse your collection** opens a searchable visual card picker;
   reserved cards are unavailable. Choose **Send trade offer**. The recipient initially offers nothing.
2. The recipient opens the same realm and chooses **Refresh trades**. Either
   player can choose **Edit my offer** and save their own side. Every actual edit
   creates a new version and resets both confirmations.
3. Review **You give** and **You receive**, then choose **Confirm this offer**.
   Both players must confirm the same version. The second confirmation transfers
   all cards and gems in one database transaction. Gifts are allowed.
4. Either participant can **Cancel trade** while pending. Refresh to see changes
   made by the other player; notifications and automatic polling are not implemented.

## Defaults and configuration

Configuration v6 adds `trading`:

```json
{
  "enabled": true,
  "maxCardsPerSide": 5,
  "maxGemsPerSide": 1000000,
  "maxPendingPerPlayer": 10,
  "expiresAfterMinutes": 1440
}
```

Realm creation and **Game rules** expose these fields. Bounds are 1–10 cards
per side, 0–1,000,000 gems per side, 1–50 pending trades per player, and 5–10,080
minutes until expiry. Disabling trading blocks new offers. Existing offers keep
their creation rules and fixed expiry, including when edited. Preview warns
about pending trades affected by the policy choice.

Offered cards are reserved until cancellation, completion, or expiry; they
cannot be recycled or offered elsewhere. Gems remain spendable. Both balances
are checked again at confirmation, including integer wallet limits. Insufficient
funds transfer nothing and do not save the second confirmation; edit the offer
or replenish the wallet before trying again. An empty trade is rejected.

Trades expire after 24 hours by default. Reads immediately show expired trades
and unlock their cards logically. The next valid trade/recycling mutation records
expiry and releases reservations under the realm lock. No background scheduler
is needed. Editing never extends expiry.

Trading grants **no XP**. Received characters count as known in that player/realm,
so recycling and reclaiming them cannot farm first-collection XP. Existing XP,
upgrades, and wishes stay with their player. Card IDs, original opening, and
original acquisition timestamps survive transfers. Retired cards cannot trade.

## API and retry behavior

Authenticated, same-origin `POST /api/trades` accepts `realmId`, `requestKey`
(fresh UUID), `expectedRevision`, and `command`. Command forms are:

```text
{action:"create", counterpartyCode:"<realm trade ID>", offer:{cardIds:[], gems:1}}
{action:"edit", tradeId:"<UUID>", version:1, offer:{cardIds:[], gems:2}}
{action:"confirm", tradeId:"<UUID>", version:2}
{action:"cancel", tradeId:"<UUID>", version:2}
```

The server authorizes the participant, validates realm membership and ownership,
and locks the realm before writes. Confirm/cancel/edit require the displayed
offer version; stale offers cannot silently settle. Creation/edit/confirmation
also check the displayed configuration revision. Cancellation may release cards
after a settings change. Ordinary players cannot override realm rules.

Successful replies contain `ok`, `tradeId`, `version`, `status`, and `message`.
The request key is bound to its canonical command. Repeating it returns the
original receipt, even after the trade closes or rules change. Reusing it for
another command is rejected. The UI keeps uncertain requests in page memory
and offers **Retry trade request**; retry before navigating away. Refreshing
or closing the page loses that client key; inspect current state before starting
another action. Server receipts remain durable.

## Preservation and limits

Migration `0008_trading.sql` preserves current owners as immutable original
owners, adds private per-realm trade IDs, version/confirmation/reservation
history, request receipts, and a per-card transfer journal. Existing balances,
XP, cards, wishes, purchases, opening receipts, and settings audits are preserved.

Player archive **v6** introduced the player's trade ID, current trading rules,
all their trades with both agreed sides and confirmation state, zero-XP trade
discoveries, and current cards' nullable `receivedAt`. `acquiredAt` remains the
original opening time. Legacy v1–v6 readers preserve the information those
formats actually recorded. There is no player-archive import into a live economy.

Encrypted backup envelope v1 supports revisions 0001-0023, including all trade
history and IDs. Restore checks version history, confirmations, reservations,
zero-sum gem transfers, ownership chains, known-character markers, and current
owners in a fresh database. Earlier snapshots gain default trading rules and
new realm trade IDs with no invented trade history; settings snapshots retain
their original version and are normalized only for validation.

The dashboard shows up to 100 trades, pending first; exports include full
personal history. Current [archive v12](../deployment/backups.md) also includes the player's own cached Discord profile, nullable admission receipt, gem claims, collector track history and character-value evidence. No cross-realm trades, escrowed gems, trade
notifications, admin override, or Discord trading commands are implemented.
[Signed Discord pack commands](../deployment/discord-gameplay.md) are available separately.
See [backup recovery](../deployment/backups.md) and [privacy](../privacy.md).

The reworked [realm market](market.md) adds fixed-price gem sales to realm
members. Active listings reserve their cards from direct offers; completed sales
appear as fully confirmed trades in this same history. Public in this context
means other authorized realm members, never unrestricted visitors.
