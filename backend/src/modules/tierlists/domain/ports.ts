// The port: everything the tierlists domain (service.ts) needs from
// persistence. Same shape of contract as modules/murals/domain/ports.ts —
// service.ts is written against this interface only, with no idea whether
// SQLite, Postgres, or an in-memory fake is on the other side.

import type { TierlistRow, BallotRow, HistogramCell, Placement, VoteAccess } from "./types.js";

export interface TierlistsRepository {
  listByUser(userId: string): TierlistRow[];
  /** Ownership-checked lookup — undefined if no row with that id exists,
   *  or it exists but isn't owned by userId. service.ts treats both cases
   *  identically (a caller-facing 404, not a server error). */
  getOwned(id: string, userId: string): TierlistRow | undefined;
  insert(row: TierlistRow): void;
  /** Ownership-checked partial update — merges `patch` onto the existing
   *  row (only the keys present in `patch` change) and returns the
   *  merged, persisted row. Returns undefined if no row with that id was
   *  owned by userId. */
  update(id: string, userId: string, patch: Partial<Pick<TierlistRow, "name" | "data">>): TierlistRow | undefined;
  /** Returns true if a row was actually deleted (i.e. it existed AND was
   *  owned by userId). */
  delete(id: string, userId: string): boolean;

  /** Lookup by public code — NOT ownership-checked: this backs the public
   *  voting routes, where the caller has no session at all. */
  getByVoteCode(code: string): TierlistRow | undefined;
  /** The community copy and its seeded owner ballot in ONE transaction —
   *  a copy that exists without its owner's vote, or a ballot orphaned by
   *  a failed insert, would both be corrupt states no caller can repair. */
  insertCommunityCopy(row: TierlistRow, ballot: BallotRow, placements: Placement[]): void;
  setVoting(id: string, userId: string, patch: { vote_access?: VoteAccess; voting_open?: number }): TierlistRow | undefined;
  /** Every community copy, newest first. Ordinary tier lists are excluded. */
  listPublic(limit: number, offset: number): TierlistRow[];
  getBallotById(tierlistId: string, ballotId: string): BallotRow | undefined;
  getBallotByVoter(tierlistId: string, voterUserId: string): BallotRow | undefined;
  /** Insert-or-replace a ballot and REPLACE its placements wholesale (a
   *  re-vote that moves a book must not leave the old placement behind). */
  saveBallot(ballot: BallotRow, placements: Placement[]): void;
  getPlacements(ballotId: string): Placement[];
  histogram(tierlistId: string): HistogramCell[];
  ballotCount(tierlistId: string): number;
  /** Ballot totals for every tier list at once — one grouped count, so
   *  listing the public directory doesn't fire a query per row. */
  ballotCountsByTierlist(): Map<string, number>;
}
