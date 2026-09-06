// Domain types for the tierlists module.

/** Who may cast a ballot on a community tier list. */
export type VoteAccess = "anonymous" | "members";

/** Row shape as stored — `data` is the tier list's document ({tiers,
 *  pool}) as raw JSON text, kept opaque all the way down (same treatment
 *  as `blocks` in modules/murals/domain/types.ts's MuralRow): parsed
 *  only at the edges (service.ts parses on read, stringifies on write).
 *  This module doesn't validate the document's shape beyond "is it an
 *  object."
 *
 *  The voting columns are the one exception to that opacity, and only
 *  for community copies: see service.ts's openVoting and validatePlacements. */
export interface TierlistRow {
  id: string;
  owner_user_id: string;
  name: string;
  data: string;
  /** NULL on an ordinary tier list; a short public code on a community copy. */
  vote_code: string | null;
  vote_access: VoteAccess;
  /** SQLite has no BOOLEAN — 0 or 1. */
  voting_open: number;
  /** NULL unless this row is a community copy, then the original's id. */
  source_tierlist_id: string | null;
  created_at: string;
  updated_at: string;
}

/** What the service hands back to routes.ts — `data` here is the parsed
 *  JSON value, not the raw text. */
export interface Tierlist {
  id: string;
  name: string;
  data: unknown;
  voteCode: string | null;
  voteAccess: VoteAccess;
  votingOpen: boolean;
  sourceTierlistId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One person's submission on a community tier list. `voter_user_id` is
 *  NULL for an anonymous ballot, in which case `id` (handed back once, on
 *  first submission) is the only handle the voter has to edit it. */
export interface BallotRow {
  id: string;
  tierlist_id: string;
  voter_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/** One book placed in one tier by one ballot. A book the voter left
 *  unranked simply has no Placement — that is how "no opinion" is stored. */
export interface Placement {
  bookKey: string;
  tierId: string;
}

/** How many ballots put `bookKey` in `tierId`. Cells with zero votes are
 *  absent, so a histogram is at most pool_size × tier_count entries
 *  regardless of how many people voted. */
export interface HistogramCell {
  bookKey: string;
  tierId: string;
  votes: number;
}
