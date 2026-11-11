# Player profiles

Every player has a page in each realm they play in. It shows what they
collected, lets them present themselves, and is the quickest way to start a
trade with them.

## Finding a profile

- **Your own page:** select your profile picture at the top right. The arrow
  next to the picture still opens the account menu, which also lists **Your
  profile** and **Players**.
- **Players:** the directory of everyone in the realm: the **Players** tab on
  any profile page, or **Players** in the account menu. (It is not in the top
  navigation, which keeps room for the game screens.) Search by Discord name or paste a
  trade ID; sort by most cards, rarest cards (legendary, then epic, then rare)
  or name. Without a search, the list is a leaderboard with ranks.
- **Sellers** on the market link to their page.

Only members of a realm can open its profiles and its directory. A profile
link for someone who is not in the realm shows "This profile is not available."

## What a page shows

- Name and picture (from Discord sign-in), level, a **Realm admin** badge and
  the collector ranks the player owns (for example "Bronze II").
- The player's text, up to 280 characters.
- Cards owned, collection value (the sum of the cards' market values), the
  share of the realm's characters, the number of series, and cards by rarity.
- **Showcase:** up to six cards the player pinned, in their order. Without
  pinned cards the page shows the six most valuable ones. A pinned card that
  was traded, sold or recycled simply disappears from the showcase.
- **Wishlist:** only if the player turned on **Show my wishlist**. Cards you own
  are marked "You own this card".
- **On your wishlist:** on another player's page, the cards they own that you
  wish for.
- **Collection:** on another player's page, **Browse all N cards** loads their
  whole collection with search and a rarity filter. Your own page links to
  your Collection.
- **Propose a trade** (other players, while trading is on): opens Trades with a
  new offer to that player.

Gems are never shown on a profile or in the directory.

## Editing your page

**Edit profile** on your own page: the text, one of six page colours (violet,
rose, ocean, emerald, amber, slate), the showcase cards and the wishlist
switch. Saving replaces the page; saving the same page again is harmless.
The server accepts only cards you hold at that moment
(`SHOWCASE_INVALID` otherwise), at most six different ones, a known colour
and a text of at most 280 characters; control characters and line breaks
become spaces.

## API and storage

- `GET /api/profile?realmId=…[&player=<trade ID>]` (`getPlayerProfile`).
- `GET /api/players?realmId=…[&query=…][&sort=cards|rarest|name][&offset=…]`
  (`listPlayers`, 24 per page).
- `POST /api/profile` with `realmId`, `bio`, `theme`, `showcase` (card IDs) and
  `showWishlist` (`updateProfilePage`).

All three require realm membership, checked in the service. Migration 0032
adds `profile_pages` (one row per member who customized their page); statistics
are computed, not stored. The page is part of the player archive
(`profilePage`, an optional field of archive v12, present once customized)
and of encrypted backups, with a restore check. Backups from before 0032
restore with default pages.

## Verification and limits

`tests/integration/profile-pages.test.ts` covers membership checks, the
validation of saved pages, showcase cards leaving the collection, wishlist
privacy and matches, the directory orders, the archive and backup round trips
(including a database from before profiles). `tests/support/profile-browser.ts`
drives the pages on desktop and phone: profile picture, editor, directory,
another player's page, their collection, and **Propose a trade**.

Not built: profiles outside a realm (public links), custom banner images,
following players, and Discord commands for profiles. Names in the Live pulls
feed do not link to profiles yet.
