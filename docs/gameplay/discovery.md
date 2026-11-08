# Discovering and opening packs

## Navigation

Every play screen shares one slim top bar: the site home link, the
main navigation (**Packs, Collection, Wishlist, Market, Trades, Ranks**), the
gem wallet with the timed-claim pill, and the **account menu**. On phones and
tablets (below 1024px) the main navigation becomes a bottom tab bar with icons
and labels. The account menu holds the **Admin view** switch (realm admins
only), **Administration**, **Account settings** and **Sign out**. Navigation
links report `aria-disabled` and do nothing while an opening, purchase, trade or
other operation is still pending.

## The Packs screen

The banner shows the realm name, a short invitation, live roster stats
(characters, still unclaimed, yours) and up to three of the rarest characters
still claimable in that realm. It excludes claimed characters, tiers with zero
configured weight and packs unable to fill one ordinary pack. Cards use
Collection's shared 5:7 faces, colored rarity frames and character values.
Select a banner card to inspect it. Characters are ordered by rarity, then
stable ID; the banner does not promise an award or secretly change odds.

**Explore the packs** lists every pack with its foil wrapper, a short
description and how many characters are still unclaimed. Search by pack or
category name. When a realm has several kinds of packs, chips filter the
gallery by **Demographics, Genres, Themes and Eras**; All Characters always
stays visible. Ordinary foil packs use original abstract symbols and patterns,
without character portraits or a fixed game name.

Anime/manga catalogs lead with actual Shōnen, Seinen, Shōjo, Josei and Kodomo
tags, followed by the largest distinct genre, theme and era packs (see
[packs for anime/manga catalogs](../content/providers.md#packs-for-animemanga-catalogs)).
The source's exact category determines eligibility; an Action tag never implies
Shōnen. Untagged characters remain available from All Characters. Older provider
catalogs without demographic tags show a short note explaining why demographic
packs are missing; their saved genre packs remain visible and playable. Realm
admins can add packs to an existing realm from **Administration → Packs**.

The circled information control on each pack shows the pool, unclaimed count,
cards per pack, current rarity odds, wishlist chance, cooldown and ownership
rules. Hover with a mouse, press Enter/Space with keyboard focus, or tap it.
Escape closes it.

## The opening room

Select a pack to open `/packs?realm=REALM_ID&pack=PACK_ID`. This dedicated view
uses an immersive opening room with a large floating pack that follows mouse
movement, a 1/5/10 quantity selector, the card count, the exact total gem cost
and the balance left afterwards, and the opening controls. The normal top bar
and footer are hidden to leave room for the pack; **All packs** returns to the
gallery. The URL supports reload and Back/Forward. Selecting a pack is
read-only.

Preparation, pack unsealing, rarity effects, manual reveals and the summary all
occupy this same room as inline stages rather than modal popups. **Return to
pack** and **Open more packs** restore the room's controls; **View collection**
navigates to Collection. Returning from presentation never rerolls or spends.
After an opening, a short receipt (cards added, gems spent, XP) appears under the
open button — also when card reveals are turned off. Touch needs no tilt;
reduced motion disables decorative floating/tilt effects.

## Other screens

**Ranks** holds the level/XP card, the timed gem claim and the six collector
rank tracks. Claims remain explicit, manual and realm-scoped; the header pill
links there and shows a countdown or a ready state.

Realm selection and the ownership explanation live in **Account settings**, for
players and administrators alike. Navigation starts each destination at the top;
refreshing the current screen does not deliberately reset its scroll position.
Card-inspection and card-selection dialogs retain their own focus handling;
dismissing inspection returns focus without scrolling the page to a distant
control.

**Wishlist → Character glossary** browses the complete realm catalog, with
rarity, name/series, colored rarity frames and character value. Pages of 24
cards load from the server, so large rosters (tested up to 100,000 characters)
stay usable. Search
and rarity/ownership filters work across the whole catalog. The wishlist shows
empty slots, and the wishlist and trade forms use searchable, illustrated
selection dialogs; selection survives search/filter changes and commits only
when confirmed.

## Ownership and provider characters

The implemented Classic mode permits one active owner for each character across
all packs within a realm. AniList and MAL source identities pass through the same
canonical catalog, eligible pool, transaction lock and database unique index.
Overlapping packs, multiple clients and bundle openings cannot bypass uniqueness.
Another realm can own that character independently.

Recycling releases the character so it can be pulled again; uniqueness is not
a lifetime prohibition. Duplicate ownership and a live ownership-mode switch
remain unimplemented. No admin toggle is presented as working for those modes.
No API request is made to choose a new arbitrary remote ID during a draw.
