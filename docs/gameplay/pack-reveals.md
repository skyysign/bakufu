# Pack reveals

After a successful web opening, a reveal shows the actual cards from that opening.
It works in existing and new realms, including original JSON/CSV catalogs and
renamed starter packs. No artwork, audio, external service, or setup is required.

1. Choose a pack on **Discover**, leave **Show card reveals** checked on its
   dedicated view, then open a pack.
   An inline preparation stage appears immediately in the same opening room while the request completes
   and awarded artwork is decoded. Its progress represents actual asset work.
2. Choose **Reveal card 1**, or **Open 5/10 packs** for a bundle. The pack charges,
   unseals and reveals its actual card. **Next card** starts the next reveal
   directly. **Skip animation** completes the entrance immediately.
3. Choose **Show all cards** to skip directly to the complete pack contents.
   **View all cards** also appears after the last manual reveal.
4. **Return to pack**, **Open more packs**, or Escape returns to the opening
   controls in that room. **View collection** on the summary navigates to
   Collection. Opening progress is already saved; leaving presentation does not
   cancel it or charge again.

Preparation, unsealing, rarity entrances and summaries render directly in the
full opening page. They do not open a modal, lock body scrolling or trap keyboard
focus. The room keeps its compact navigation; card inspection remains a separate
dialog only when a player deliberately selects a card.

Revealed faces use the same fixed 5:7 portrait cards as Collection, with colored
rarity frames and no genre lists. Select a face to inspect enlarged artwork and
current character-value evidence. Escape closes that inspection first and
returns focus to the revealed card; the saved pack result remains underneath.
Every card inspector (reveal, collection, glossary, market and live pulls)
replays the end of that card's reveal: its rarity effect layer (foil sweep,
crossing orbits, summoning circle or ascension gate) settles behind the card while
the card makes its tier arrival. Reduced motion shows the card without effects.
Live pulls open the same details as the collection: character value, recycling
estimate, saved popularity, collector demand and who owns the card now.

The opening must succeed before any awarded cards appear. The pending preparation
screen contains an original sealed pack, never invented outcomes. A network failure keeps **Retry this opening**, using
the existing request key. The successful retry displays the original saved
result and spends/awards once. Unavailable packs keep their no-charge failure.
Revealing, advancing, skipping, and closing make no gameplay request and do not
choose or reroll outcomes. There are no simulated near misses or randomized tiers.

Only assets for the saved opening are prepared, with at most four image loads at
once and a six-second overall deadline. Duplicate URLs share a decoded resource.
Reveals reuse the decoded image directly; repeated images use a decorative canvas
copy without another request or pixel readback. Failed/late artwork uses original
fallback art and is not retried as the card enters. A bounded, browser-memory cache
stores public artwork resources; it contains no account/realm IDs and writes no
files or persistent browser data. Collection thumbnails remain lazy-loaded.
The local cinematic is warmed only when a rare, epic or legendary card was actually awarded.

Returning to the pack during preparation hides the stage while the transaction finishes. It
does not cancel a saved opening, discard an uncertain retry key or reopen the
animation later. After a reload, check the collection and saved result normally.

**Show all cards** uses one bounded portrait gallery, with pack-number badges
for bundles. Cards keep their aspect ratio for single-card packs and up to fifty
awarded cards. The gallery adapts to desktop/mobile and scrolls with the main
page. Return/open-more controls remain available. Summary cards do not replay entrances.

The reveal is a view of that opening's receipt. The collection shows current
ownership if later web/Discord actions recycle or trade a card. Reloading,
switching realms, or returning from Discord shows the latest receipt normally
without automatically replaying a reveal. Closing before revealing every card
still keeps all cards/progress awarded by the opening.

Focus moves to the preparation heading, current reveal control or summary
heading as the stage changes. Tab follows the ordinary page order; Enter/Space
operate buttons and Escape returns to the pack controls. Focus returns to the
opening button when available, otherwise to the pack heading. Controls have
visible labels/focus styles, and the page scrolls on small screens. No
presentation timer changes spending or prevents returning to the pack.

With **reduced motion** enabled in the device/browser, prepared pack contents
appear as a static summary without charging or video. Artwork still gets the same
bounded preparation/fallback. Enabling reduced motion during a reveal also
shows that summary and disables its animation and sound. There is no strobing.

Uncheck **Show card reveals** for direct results in the existing discovery and
collection panels. This choice is stored in this browser as a versioned on/off
value, shared across its tabs/accounts/realms. No receipt, card, account, or realm
identifier is stored with it. If browser storage is unavailable, the choice works
for the current page. Opening controls wait for this preference to load. This
preference does not change server rules, Discord commands, exports, or backups.

The inline reveal needs JavaScript and a modern browser. Optional card inspection
uses native dialog support.
Reveal presentation itself adds no environment setting or gameplay record.
The expanded tiers were introduced in config v10; current config v11 retains
them and adds character values. See the rarity migration described in
[rarity and economy](rarity-economy.md). Live pack editing, extra upgrade effects
and Discord-specific reveals remain separate future work.


## Rarity presentation after the player rework

Common uses a foil peel and sweep; uncommon adds crossing orbits and drifting
crystal fragments; rare uses summoning circles, a rising column, a star burst and
the locally bundled silent star/aurora video behind the revealed card. These
use distinct structures and entrance motion, not just different durations.
The original foil seam
tears away before the ready artwork enters. All effects have immediate skip,
show-all and close controls.
The existing rarity assignment/odds and server opening receipt remain authoritative.
Epic adds an opening gate and wings; legendary adds a gold corona and crown
presentation. Each uses its actual saved tier with its own motion and
synthesized score; there is no separate cosmetic video lottery. All effects can
be skipped or closed immediately. Static summary mode and reduced-motion disable
video/animation, including runtime preference changes. The video is muted,
inline, has no external request, and falls back to CSS if playback fails.
Original portraits are supplied for the demo roster; permitted provider artwork
uses the same preparation flow, with original fallback art for unavailable images.
See [asset provenance](../content/demo-art.md) and [provider artwork](../content/providers.md#artwork-on-demand).

## Opening sounds

**Sound on / Sound off** is available before opening and in preparation/reveal
headers. Its versioned browser-local preference contains no player identifiers.
The built-in scores are original Web Audio synthesis (`app/reveal-audio.ts`):
common is a whoosh and a soft pluck; uncommon a rising arpeggio and a glassy
chime; rare a filtered-noise riser, then a pitch-dropping impact under a bright
chord and a sparkle; epic heartbeat thumps and a swell into a choir-like chord
with a bell cascade; legendary a long riser with accelerating ticks, a heavy
impact, a brass-like fanfare and a descending sparkle cascade. Where the browser
supports it, every cue runs through a gentle compressor and a generated reverb
whose size grows with rarity; noise textures (whooshes, risers, impact bodies,
glitter) are filtered white noise generated on the device. There are no
downloaded samples, external requests or background music.

**Custom sounds per rarity.** Realm admins can open **Administration → Reveal
sounds**, confirm they may use the audio, and upload one sound per rarity (any
format the browser can decode: MP3, OGG, WAV, M4A…). The browser cuts it to the
first 30 seconds (with a short fade-out), mixes it to mono, resamples it to
32 kHz and uploads 16-bit PCM WAV; the server re-checks the WAV header and the
30-second limit and stores it in `realm_tier_sounds` (migration 0024, included
in backups). A custom sound replaces the built-in arrival cue for that rarity;
the charge cue stays synthesized. Players download it from
`GET /api/tier-sound` (members only) when the reveal starts; if it cannot load
or decode, the built-in cue plays. **Play**, **Replace** and **Remove** are
available per rarity.

**Character sounds.** Under **By character** on the same page, search a character
of the realm and upload a sound for it (same 30-second limit and format). A
character's sound takes priority over its rarity sound, which takes priority over
the built-in cue. They are stored in `realm_character_sounds` (migration 0025,
included in backups) and served from `GET /api/character-sound` to members; the
realm view lists which characters have one. Background video clips are not
implemented yet.

**Pack wrappers and the tear.** Pack art is original CSS/SVG
(`app/pack-premium.css`, palettes in `app/pack-palettes.ts`): every pack theme
(battle, romance, night, isekai, …) has its own palette, with a holographic foil
film and light sweep, ridged crimp seals with a sawtooth edge, a dashed tear line
with side notches, corner rivets and a glowing emblem behind the theme sigil.
When a pack opens, the themed seal strip tears off while a flash runs along the
tear line and sixteen foil scraps fly out; every charge cue starts with a short
synthesized foil rip (crackling filtered noise). Reduced motion disables the
sheen, the emblem pulse and the tear effects.

**Animated background.** `app/reveal-backdrop.tsx` draws a canvas behind the
opening room: a tier-tinted aurora and a particle field that drifts while
waiting, spirals inward and speeds up while a pack charges, and bursts outward
with shockwave rings on arrival (two rings for epic, three for legendary, plus
rotating light rays; legendary adds twinkling glitter). It caps the pixel ratio,
pauses in hidden tabs and is not rendered for reduced motion. Loading a
page or selecting a pack plays nothing; a user gesture unlocks audio before a
charge/arrival cue can play. Browser audio restrictions fall back to silence.

Muting, skipping, showing all, closing, hiding the tab, changing to reduced motion
or leaving the reveal stops active and scheduled notes. Reduced motion and static
summaries remain silent. Audio does not influence rarity, draws or spending.
