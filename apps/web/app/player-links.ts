/** Who a player is shown as, and where their profile page is (realm members only). */
type NamedPlayer = { displayName: string | null; username: string | null; tradeCode: string };

/** Players without a Discord name are shown by the start of their trade ID. */
export function playerName(player: NamedPlayer) {
  return player.displayName ?? player.username ?? `Player ${player.tradeCode.slice(0, 6)}`;
}
export function profileHref(realmId: string, tradeCode?: string) {
  return `/profile?realm=${encodeURIComponent(realmId)}${tradeCode ? `&player=${encodeURIComponent(tradeCode)}` : ''}`;
}
