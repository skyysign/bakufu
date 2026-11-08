# Opening 1, 5 or 10 packs

Choose a large pack on Discover, then select one, five or ten on its dedicated
opening view. The displayed
price is the player's effective price per pack multiplied by the selected count.
Collector-rank and purchased pack discounts apply to every pack. The number of
cards per pack stays governed by the realm settings; ten five-card packs reveal
50 cards in total.

A bundle is one atomic operation. All requested cards must be available in the
weighted pool before anything is charged. The service samples without replacement
across the whole bundle, records all cards and first-collection XP, debits the
total cost once and starts any configured realm pack cooldown. The new-realm
default is zero: after completing or closing the reveal, another opening is
available immediately. Existing realms keep their saved cooldown until reviewed
settings change it. Insufficient gems, an enabled cooldown,
an incomplete eligible pool or a rolled-back transaction awards no partial cards
and spends no gems or cooldown. Concurrent web/Discord operations use the same
realm lock and ownership constraints.

The opening request's `packCount` accepts exactly `1`, `5` or `10`; omission means
one pack. The request key binds both the pack and its count. If a response is lost,
keep the page open and retry the saved request to recover its exact receipt. A
successful replay does not spend again, award XP again or restart the cooldown.
Changing the count while reusing a committed key is a conflict.

Bundle receipts include `packCount`, `cardsPerPack` and `unitPrice`, with flat
character/card arrays ordered by pack. The reveal preserves those groups using
pack-number badges in one portrait gallery and uses the actual saved rarities.
Opening starts artwork preparation immediately; see [reveal loading and controls](pack-reveals.md).
Preparation, the bundle fan, rarity entrances and the final gallery stay inline
in the same full opening room. They do not open another popup. Large galleries
scroll with the page. **Open more packs** returns to that room's quantity controls;
**View collection** navigates to Collection. All bundle wrappers use the same
character-free symbolic pack design as Discover.
Reduced-motion and reveal opt-out controls
remain available. Single-pack and older receipts keep their existing shape.

Migration 0017 adds `openings.pack_count` with a default of one; it does not rewrite
historical results or configuration snapshots. Player archives retain version 10
because their cards, wallets and XP journals already describe bundle progress.
Encrypted instance backups preserve bundle counts and receipts; fresh restore
checks the total price, card grouping, ownership and matching wallet entry.
