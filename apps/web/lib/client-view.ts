import type { RealmView } from '@card-engine/db';

type CatalogCharacter = RealmView['catalog'][number];

/**
 * The browser receives the realm view without its complete catalog. Large
 * provider rosters (thousands of characters) would otherwise be serialized on
 * every navigation and refresh. Screens that browse the whole catalog page it
 * through `/api/catalog`; everything else needs only the characters it shows.
 */
export type ClientRealmView = Omit<RealmView, 'catalog'> & {
  catalogSize: number;
  catalogStatus: Record<CatalogCharacter['status'], number>;
  /** Characters referenced by owned cards, wishes, trades and spotlights. */
  characters: Record<string, CatalogCharacter>;
};

export function toClientView(view: RealmView): ClientRealmView {
  const referenced = new Set<string>();
  for (const card of view.cards) referenced.add(card.id);
  for (const wish of view.wishlist) referenced.add(wish.id);
  for (const trade of view.trades)
    for (const offer of [trade.myOffer, trade.theirOffer])
      for (const card of offer.cards) referenced.add(card.characterId);
  for (const character of view.featuredCharacters) referenced.add(character.id);
  for (const pack of view.packs) for (const character of pack.spotlights) referenced.add(character.id);
  if (view.lastOpening?.ok)
    for (const character of view.lastOpening.characters) referenced.add(character.id);
  const { catalog, characterValues, ...rest } = view;
  const catalogStatus = { yours: 0, claimed: 0, available: 0 };
  const characters: Record<string, CatalogCharacter> = {};
  for (const character of catalog) {
    catalogStatus[character.status]++;
    if (referenced.has(character.id)) characters[character.id] = character;
  }
  return {
    ...rest,
    catalogSize: catalog.length,
    catalogStatus,
    characters,
    characterValues: Object.fromEntries(
      [...referenced]
        .filter((id) => characterValues[id] !== undefined)
        .map((id) => [id, characterValues[id]]),
    ),
  };
}
