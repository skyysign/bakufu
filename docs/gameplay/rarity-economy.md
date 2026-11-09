# Five-tier economy preset

New realms use the following configurable rules. Displayed odds always use the
actual remaining pool; these baseline percentages apply when all tiers contain
eligible characters.

| Tier | Share of a new roster | Baseline draw chance | Base value | Value range with popularity bonus |
| --- | ---: | ---: | ---: | ---: |
| Common | 60% | 65% | 30 gems | 30–52 gems |
| Uncommon | 28% | 26% | 60 gems | 60–105 gems |
| Rare | 9% | 7% | 120 gems | 120–210 gems |
| Epic | 2.5% | 1.7% | 260 gems | 260–455 gems |
| Legendary | 0.5% | 0.3% | 620 gems | 620–1,085 gems |

The draw chances were raised from 80 / 17 / 2.7 / 0.29 / 0.01%. At the old odds an
epic took about 345 pulls and a legendary about 10,000, so with ~20 packs a day a
legendary was effectively out of reach. The new chances stay close to each tier's
share of the roster, slightly favouring commons so the few top characters are not
claimed in the first days: one pull in 14 is rare or better, one in 50 epic or
better and one in about 330 legendary. Existing realms keep their saved weights
until an admin applies **Game rules → Collection → Use recommended values**.

### How a pull works

Each card first picks a rarity by these weights, then a character inside that
rarity (wishlist entries count extra there). The random number comes from
`node:crypto`; a statistical unit test draws 200,000 cards and checks every tier
against its displayed chance. Because each character can belong to only one
collector, a tier with no unclaimed characters left in a pack's pool drops out and
the remaining weights are spread over the tiers that are left. A pool whose cheap
cards are all claimed therefore pays out rare and better cards far more often, and
a category pack whose members are mostly top characters does the same. This is
expected behavior, not a bug, and the pack's displayed odds always show it.

### How characters get their rarity

New five-tier rosters (calculation `source-standing-v3`) rank characters by a
standing score instead of raw favourites alone:

- 60% overall popularity rank in the roster,
- 40% rank inside the character's own series,
- +10% for the main cast (MyAnimeList and AniList report main or supporting).

The top 0.5% become legendary, then 2.5% epic, 9% rare and 28% uncommon; the rest
are common. Main characters and the most popular character of each series are
never common. A niche series' leads therefore outrank the tenth supporting
character of a hit, while a hit's leads stay at the top. Popularity alone (the
previous `source-percentile-v2`) made rosters prepared from popular series look
top-heavy: their deep supporting casts out-favourite the leads of smaller series,
so many well-known characters landed in common no matter how big the roster was.
A bigger roster only helps when it adds less popular series below them.

Characters added later through **Administration → Characters** are placed among
the realm's saved standings with the same rules. Existing realms keep their saved
tiers; only new realms use the standing formula. Three-tier legacy realms keep
popularity-only percentiles.

### Fame floors and manual tiers

The standing bands are relative to the realm's own roster. In a realm built only
from hit series, dozens of characters out-favourite a well-known one: in a test
roster of the 10 biggest series (250 characters), a villain with 13,000
MyAnimeList favourites ranked 46th and missed the rare band, which holds only the
top 12%. MyAnimeList and AniList agree on such rankings (AniList usually reports
fewer favourites), so switching provider doesn't help.

**Fame floors** set a minimum rarity by favourites, whatever the rest of the
roster looks like. The defaults for new realms:

| Floor     | Favourites | Characters above it in a 1,000-character roster of popular series |
| --------- | ---------- | ----------------------------------------------------------------- |
| Rare      | 10,000     | about 78                                                          |
| Epic      | 30,000     | about 27                                                          |
| Legendary | 100,000    | about 7                                                           |

- A floor only ever raises a character; it never lowers the tier its standing gave
  it.
- Floors apply only to MyAnimeList and AniList characters. Own JSON/CSV catalogs
  have no shared popularity scale and are never affected.
- A floor never lifts a character into a tier no pack can draw (zero odds); it
  stops at the highest drawable tier.
- They are calibrated on MyAnimeList. AniList counts are similar for recent
  series and lower for older ones, so AniList realms may want lower floors.
- Realm creation applies the floors before the preview, so the tier counts the
  wizard shows are the ones the realm gets. Characters added later get them too.

Floors live in realm config v12 (`fameFloors`; empty means off). Realms created
before this release start with floors off and keep their tiers until an admin
applies floors under **Administration → Rarity**. There the admin edits the
floors (or picks **Use recommended**), reviews every tier change (tier counts
before and after, each changed character, and how many are in players'
collections), then applies. Applying saves the floors as a new settings revision
and re-tiers the roster in one transaction. A retry with the same request key
replays the result, and a review made stale by any other change is refused.
Lowering or removing floors returns characters to their computed tier, which is
kept in `provenance.tierBeforeAdjustment`. The ordinary **Game rules** form can't
change floors, so floors and tiers never drift apart.

A **manual tier** fixes one character's rarity (any tier packs can draw). Fame
floors no longer move that character until the admin returns it to
**Automatic**. Manual tiers are listed with the tier the character would get
automatically.

Changing a tier affects owned cards: recycling values, the suggested market price
and future pull odds follow the new tier. Opening receipts keep the tier a card
was pulled at. Every change is journaled in `tier_adjustments` and included in
backups; a restore checks that each character's tier history (rebalances and
adjustments) reconciles with its saved tier. The operator economy preset below
leaves floored and manually tiered characters alone.

The values were rescaled (previously 20 / 60 / 200 / 1,000 / 5,000 gems) so the
rarest, most popular characters are worth a little over 1,000 gems, close to
Mudae's kakera values, instead of 250–500 times a common card. The range column
uses the default 75% maximum popularity bonus; collector wishlist demand can add
up to 25% on top. New realms use these values. Existing realms keep their saved
values until an admin opens **Administration → Game rules → Collection**, selects
**Use recommended values**, previews and applies the change; historical receipts
keep the values they were made with.

A pack costs 200 gems before earned discounts. Starting gems are 2,000, and
manual claims grant 1,000 gems every six hours. New realms have no opening
cooldown, so a completed opening can be followed immediately by another one,
five or ten-pack opening. Bundles keep their
atomic total price and no-partial-charge behavior. These are engine defaults,
not a claim to reproduce another game's prices exactly.

Common, uncommon, rare, epic and legendary each have their own original opening
motion and synthesized sound. Skip, sound off and reduced motion remain
available. New catalogs assign tiers within their own popularity cohort; rarity
assignment and draw probability are separate decisions.

Card recycling values are not fixed marketplace asking prices. Sellers still
choose their listing price; the listing form starts with the selected character's
current value. [Character values](character-values.md) use saved source popularity
within a compatible source/tier cohort and bounded demand from other collectors'
wishlists. Recycling also includes the player's actual rank bonus. The table
above gives formula bases, not identical final values for every card in a tier.

## Existing realms and saved progress

Migrations 0019/0020 normalize old realm settings to config version 10 by adding
zero weights/rewards for the new tiers and disabled rank tracks. They preserve
prices, cooldowns, owned cards, rarity snapshots, purchases and balances. A
migration alone does not rebalance an existing economy.
Migration 0023 advances current config to v11, retains old cooldown settings and
leaves character valuation disabled for existing realms. To remove a previous
60-second wait, review and apply **Economy → Cooldown (seconds) → 0** in Realm
settings. Starting grants and historical opening times are not reset.

An authorized operator can review and apply the new preset:

```sh
docker compose exec web pnpm exec tsx scripts/economy-preset.ts REALM_UUID
docker compose exec web pnpm exec tsx scripts/economy-preset.ts REALM_UUID REQUEST_UUID PREVIEW_HASH
```

The first command returns rules, tier counts and a preview hash. The second
requires the matching reviewed hash and a stable request UUID; a retry returns
the same receipt. The command refuses ambiguous instance-admin selection, and
the service also requires realm-admin membership. It serializes with gameplay
under the realm lock, rejects stale previews and journals configuration and
character-tier changes together.

Only characters that have **never been awarded** can change tiers. This includes
protecting previously recycled characters. Prior owners, collections, wallets,
XP, trades, purchased benefits and opening receipts remain intact. Older imports
did not retain numeric popularity, so this reviewed expansion orders remaining
characters by saved rarity and stable ID. It does not invent live popularity or
make a provider request. Newly imported catalogs can use their supplied source
popularity normally.

The preset enables the six leveled ranks and retires further purchases from the
old linear ladder and separate discount shop. Existing benefits and successful
retry receipts remain valid. Player archive v12 includes the new progression and
character valuation evidence;
encrypted instance recovery also preserves operator rebalance journals.

## Economy limits

The preset is a starting point for playtesting. Unique ownership depletes pools,
and empty-tier renormalization changes later odds. Recycling releases cards;
high-value returns and rank perks can become profitable in depleted or custom
pools. There is no default opening wait; administrators can configure one if
their realm needs it. Neither the formula nor a cooldown is a universal
negative-return guarantee.
Operators can review weights, prices, rewards and
cooldowns without silently rewriting existing receipts. Further economy
balancing remains on the roadmap.
