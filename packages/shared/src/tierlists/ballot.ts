// Rebuilding a rankable board out of a published tier list plus one
// ballot. Opening voting MOVES the owner's ranking out of the tier list
// document and into their seeded ballot — the published document's tiers
// are always empty and its pool always holds every book, because that
// document is the blank template every voter ranks. So a ballot is the
// only thing that can fill a board back in, for a returning voter and for
// the owner alike.

import type { TierlistData } from "./types.js";

/** A published tier list's frozen structure: the tiers everyone ranks
 *  into, and the full book pool. Its tiers carry no books. */
export interface PublishedBoard {
  tiers: Array<{ id: string; label: string; color: string }>;
  pool: string[];
}

export interface Placement {
  bookKey: string;
  tierId: string;
}

export function blankBoard(board: PublishedBoard): TierlistData {
  return { tiers: board.tiers.map((tier) => ({ ...tier, bookKeys: [] })), pool: board.pool };
}

export function ballotBoard(board: PublishedBoard, placements: Placement[]): TierlistData {
  const tiers = board.tiers.map((tier) => ({ ...tier, bookKeys: placements.filter((placement) => placement.tierId === tier.id).map((placement) => placement.bookKey) }));
  // Derived from what actually landed in a tier, not from the placements:
  // a placement naming a tier the board no longer has must leave its book
  // in the pool rather than drop it off the board entirely.
  const ranked = new Set(tiers.flatMap((tier) => tier.bookKeys));
  return { tiers, pool: board.pool.filter((key) => !ranked.has(key)) };
}
