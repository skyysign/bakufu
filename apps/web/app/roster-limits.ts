/**
 * Above this many characters a roster uses up free hosted database transfer
 * noticeably faster (Vercel + Neon free plans): each new server instance and
 * each roster change downloads the whole roster once. See
 * docs/deployment/vercel-neon.md ("How big can a realm get?").
 */
export const freeHostingRosterLimit = 2000;
export const freeHostingRosterNote =
  'On free hosting (Vercel + Neon), keep rosters under about 2,000 characters: larger ones use up the free database transfer faster.';
