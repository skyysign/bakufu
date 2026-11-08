# Interface design notes

The web interface is a dark, artwork-first collector UI. These notes keep new
screens consistent with it.

## Readability rules

- Body copy is 16px; interface text never goes below 13px. Rarity badges on card
  faces (12px, uppercase) and decorative text inside pack wrappers are the only
  exceptions.
- One heading per screen: use `PageHeader` (`app/app-shell.tsx`) for the page
  title, a one-sentence lede and the screen's actions. Do not add eyebrow labels
  or repeat the title, the gem balance (already in the top bar) or long rule
  explanations. Put rules in the pack information control, a field help line
  (`.field-help`) or a disclosure.
- Buttons and form controls are at least 44px tall; links and controls keep the
  shared focus ring.

## Files

| File | Contents |
| --- | --- |
| `app/theme.css` | Tokens (colors, rarity colors, radii, spacing), type scale, buttons, forms. |
| `app/shell.css` | Top bar, main navigation (bottom tab bar below 1024px), account menu, page header, footer. |
| `app/cards.css` | 5:7 card faces, card grids, inspection and picker dialogs, pack/portrait art primitives. |
| `app/screens.css` | Screen layouts: Packs, Collection, Wishlist, Market, Trades, Ranks, Account, sign-in. |
| `app/admin.css` | Administration hub (section nav, overview checklist, players & access steps, character lookup), the create-realm wizard, character source cards and the market sell panel. |
| `app/forms.css` | Settings design language (groups, setting rows, unit inputs, switches, rarity table), roster-size slider and provider source switch. |
| `app/opening.css` | Opening room and reveal choreography (kept verbatim from the earlier design), followed by a readability pass. |
| `app/rarity-motion.css`, `app/inline-reveal.css`, `app/pack-art.css` | Tier-specific reveal motion, the inline opening room and pack wrappers. |

Fonts are self-hosted from the `@fontsource-variable/inter` and
`@fontsource-variable/bricolage-grotesque` packages (SIL Open Font License), so
the strict `default-src 'self'` Content Security Policy needs no font host.
Inter is the interface face; Bricolage Grotesque is used for page titles and
display headings.

## Administration

Administration is a hub, not one long page. `app/admin-hub.tsx` shows one task at
a time (**Overview, Game rules, Packs, Characters, Players & access, New realm**);
`?task=` (`rules`, `packs`, `characters`, `access`, `create`) opens a section
directly. **Characters** (`app/realm-characters.tsx`) is shown to instance admins
who administer the realm. The overview's
setup checklist marks finished items and links each open item to its section.

`app/create-realm.tsx` is a five-step wizard (name, characters, packs, rules,
review). All steps stay mounted and hidden, so a single form submission still
carries every setting; invalid fields open the step that contains them. The
server preview (`Preview catalog and packs`) must match the proposal before
**Create realm** is offered, and a failed creation keeps its request key for
**Retry realm creation**.

## Settings forms

Game rules and the wizard's **Customize gameplay rules** render the same groups
from `app/rules-fields.tsx`, filtered by the same category tabs. Each setting is
one row: label and help text on the left, the control in a shared right-hand
column (170–230px), so controls line up whatever the label length. Numbers show
their unit inside the field (`gems`, `hours`, `%`); on/off settings are switches
on real checkboxes. Rarity weight, resulting chance and base value share one
table. A **Use recommended …** link appears in a group's header only while that
group differs from the defaults, so it never looks like a button that does
nothing. Below 680px the control moves under its label (switches stay on the
right).

## Live pulls

`app/pull-tracker.tsx` sits below the pack grid and shows the realm's latest
rare, epic and legendary pulls (`GET /api/pulls`, members only; service `recentPulls` in
`packages/db/src/pull-feed.ts`, backed by the `openings_realm_recent` index).
It renders one row of card faces without scrolling (six on desktop, four on
tablets, a 3×2 grid on phones); selecting a card opens the usual card inspector.
It polls every 15 seconds while the tab is visible and right after your own
opening, and new cards slide in. Collectors appear by Discord display name (never an email), or
"A collector" without a Discord profile.

## Page frame

`body` is a column flex container and `main` grows to fill the viewport, so the
footer sits at the bottom of the window on short pages and never jumps up while
a section loads or a wizard step is shorter.

## Tokens

Primary actions are light buttons on the dark background; `.accent` buttons use
the violet-to-pink gradient for the most important game action on a screen
(open a pack, claim gems, confirm a trade). Gem amounts use the teal gem color.
Rarity colors (`--r-common` … `--r-legendary`) are reserved for card frames,
rarity chips and odds; do not reuse them for unrelated UI.

## Layout

Content is capped at 1360px with responsive side padding. Card grids use
`repeat(auto-fill, minmax(min(184px, 40vw), 1fr))`, which gives six columns on a
1440px screen and two on a 390px phone. A `backdrop-filter` on an ancestor makes
it the containing block for `position: fixed` children, so the header drops its
blur below 1024px where the fixed tab bar lives inside it.
