export const gameScreens = [
  'packs',
  'collection',
  'market',
  'trades',
  'ranks',
  'wishlist',
  'admin',
  'account',
] as const;
export type GameScreen = (typeof gameScreens)[number];
export function screenHref(screen: GameScreen, realmId?: string) {
  return `/${screen}${realmId ? `?realm=${encodeURIComponent(realmId)}` : ''}`;
}
export const screenTitles: Record<GameScreen, string> = {
  packs: 'Discover packs',
  collection: 'Your collection',
  market: 'Community market',
  trades: 'Your trades',
  ranks: 'Collector ranks',
  wishlist: 'Your wishlist',
  admin: 'Realm administration',
  account: 'Your account',
};
