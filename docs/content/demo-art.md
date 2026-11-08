# Original demo artwork

The Lantern Atlas portraits and rare-opening background were created for this
project. They depict the original demo roster, not existing anime characters.
They ship locally with the engine; gameplay requires no remote image or video
service. The repository MIT license covers these supplied demo assets.

- `apps/web/public/media/lantern-portraits.png`: one 3-column, 4-row atlas,
  row-major in the demo catalog order. Generated with the built-in imagegen tool,
  then inspected and copied into this repository. No reference artwork was used.
- `apps/web/public/media/rare-reveal.webm`: original 4.8-second silent procedural
  star/aurora background, generated locally by
  `pnpm exec tsx scripts/generate-reveal-video.ts`. Requires a local Playwright
  browser only when regenerating this developer asset. Production just serves
  the bundled video. Reduced-motion users get the static receipt summary.
- `apps/web/app/game-art.tsx`: original SVG pack frames, symbols and fallback
  portraits for catalogs with no licensed artwork. The atlas is mapped only to
  the original demo character IDs. Importing a character name never grants an
  image license or selects a third-party image.
- `apps/web/app/pack-art.css`: original foil gradients, crimped seams and symbolic
  wrapper typography. Ordinary category packs use abstract SVG sigils without
  character images. The same wrappers appear in Discover, preparation and bundle
  opening. A portrait requires an explicit franchise-art mode for a genuinely
  franchise-restricted pack; that component option does not add a series-pack
  creation feature or grant artwork rights.
- `apps/web/app/reveal-audio.ts`: original synthesized sweep, bell, harmony and
  chime scores for all five rarity tiers, generated at runtime with Web Audio.
  No samples, recordings or external audio service are used. The sound toggle
  and reduced-motion mode provide a silent opening.

The final image-generation prompt was:

> Use case: stylized-concept. Asset type: one production sprite atlas for an original anime/manga-inspired collectible card game called Lantern Atlas. Create ONE single rectangular illustration atlas, EXACTLY THREE equally wide columns and FOUR equally high rows, 12 portraits filling their cells perfectly edge to edge, no gaps, no borders, no text or logos. Each cell is a detailed clean hand-painted anime half-body character portrait, centered head and shoulders, entire face comfortably away from edges, luminous cinematic fantasy lighting, rich dark navy backgrounds with atmospheric magical accents. All twelve characters must be original, no existing anime or franchise likenesses. Row 1 left to right: Mira Tidekeeper, adult woman with flowing teal hair, ocean-blue eyes, navy explorer coat and tiny glowing water droplets; Oren Cloudwright, adult silver-haired male sky inventor with round goggles and pale blue wind scarf; Fern Mosskeeper, adult freckled woman with auburn bob hair, green cloak and small ferns. Row 2: Ivo Copperhand, adult dark-skinned male artisan, short warm black hair, copper gauntlet, orange sparks; Luma Starcartographer, adult woman with deep violet long hair, gold star earrings and constellation-blue robes; Brin Rootmender, adult male forest healer with tousled brown hair, moss-green shawl, golden botanical magic. Row 3: Sable Reefrunner, adult woman with short ink-blue hair, coral earrings and sea-green adventurous outfit; Pip Windpost, young adult male messenger with pink hair and sky-blue scarf, feather pin; Vale Emberpotter, adult woman with wavy copper-red hair, amber eyes and artisan apron. Row 4: Tavi Saltweaver, adult male with long white braided hair, dark skin and turquoise ceremonial scarf; Nell Kitewatch, adult woman with short lilac hair, pale gold eyes and violet flight jacket; Ro Pebblebard, adult male with wavy sandy hair, warm smile and burgundy traveling cloak. Portrait aesthetic should feel premium and cohesive with contemporary anime collectible cards, crisp facial features and painterly highlights. Exactly12portraits, uniform3by4grid, no other objects over borders, NO text. Tall atlas aspect ratio3:4.

Provider metadata and artwork permissions remain separate. Operators must have
permission for any additional images/videos they install. No Kyara assets,
branding, animations or character databases were downloaded or copied.
