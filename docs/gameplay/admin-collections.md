# Player collections (admin repair)

Realm administrators can look at any member's collection and fix mistakes in
**Administration → Player collections**. Pick a member to see:

- their gems, card count and XP,
- **Recently recycled** cards (with the gems recycling paid),
- **Traded or sold away** cards (trade, market sale with its price, or an earlier
  admin move) and who has each card now,
- the collection itself (newest first, filterable), with cards in a pending trade
  or market listing marked,
- the admin action history and recent wallet activity.

## Actions

Every action needs a short reason, which is saved in the history together with the
admin who made it.

| Action | What it does |
| --- | --- |
| **Restore** a recycled card | Puts the same card back in the member's collection. By default it also takes back the gems recycling paid (refused if the member no longer has them; untick it to restore without taking gems). Not possible once someone else pulled that character again. |
| **Return** a card | Moves a card from its current holder back to this member. Only possible for someone who owned the card before, and not while the holder has it in a pending trade or market listing. Gems are not moved. |
| **Adjust gems** | Adds or removes gems (up to 1,000,000 at a time; a wallet can't go below 0). |

To undo an accidental market sale: open the seller, **Return** the card, then use
**Adjust gems** twice: give the buyer back the price and take it from the seller
(the sale price is shown next to the card).

## Guarantees

- Only realm administrators can view or change another member's collection; the
  server checks this for every request. Members are addressed by their member
  code, never by account ID.
- Actions run under the realm lock like openings and trades, and each one is
  idempotent: a retried request returns the same receipt, a reused request key
  with different details is refused.
- Card history stays intact: a restored card is the same card (same origin and
  XP history), and a returned card records an admin move next to its trades.
- If the player retries the original recycling request after a restore, they get
  the old receipt and the card stays in their collection.
- Backups include the action history, and a restore checks that every action
  matches its wallet entry, card move or undone recycling. Player exports show the
  adjustments as wallet entries with the reason "admin_adjustment".

Not included yet: granting an arbitrary character that the member never owned,
or removing a card from a member without moving it to someone else.
