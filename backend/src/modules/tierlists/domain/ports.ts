// The port: everything the tierlists domain (service.ts) needs from
// persistence. Same shape of contract as modules/murals/domain/ports.ts —
// service.ts is written against this interface only, with no idea whether
// SQLite, Postgres, or an in-memory fake is on the other side.

import type { TierlistRow, BallotRow, BallotTotals, HistogramCell, Placement, TierlistDiscoverRow, VoteAccess } from "./types.js";

export interface TierlistsRepository {
  deleteUserData(userId: string): void;
  rekeyBooks(userId: string, fromKeys: string[], toKey: string): void;
  listByUser(userId: string): TierlistRow[];
  /** Ownership-checked lookup — undefined if no row with that id exists,
   *  or it exists but isn't owned by userId. service.ts treats both cases
   *  identically (a caller-facing 404, not a server error). */
  getOwned(id: string, userId: string): TierlistRow | undefined;
  insert(row: TierlistRow, works?: Map<string, string | null>): void;
  /** Ownership-checked partial update — merges `patch` onto the existing
   *  row (only the keys present in `patch` change) and returns the
   *  merged, persisted row. Returns undefined if no row with that id was
   *  owned by userId. */
  update(id: string, userId: string, patch: Partial<Pick<TierlistRow, "name" | "data">>, works?: Map<string, string | null>): TierlistRow | undefined;
  /** Returns true if a row was actually deleted (i.e. it existed AND was
   *  owned by userId). */
  delete(id: string, userId: string): boolean;

  /** Lookup by public code — NOT ownership-checked: this backs the public
   *  voting routes, where the caller has no session at all. */
  getByVoteCode(code: string): TierlistRow | undefined;
  /** Publish the existing row and seed its owner ballot in one transaction. */
  publish(id: string, userId: string, data: string, access: VoteAccess, code: string, publicBooks: string, ballot: BallotRow, placements: Placement[]): TierlistRow | undefined;
  promote(id: string, at: string): void;
  eligibleVoteCount(id: string, originUserId: string): number;
  setVoting(id: string, userId: string, patch: { vote_access?: VoteAccess; voting_open?: number }): TierlistRow | undefined;
  /** Every public tier list, newest first. */
  listPublic(limit: number, offset: number): TierlistRow[];
  getPublicById(id: string): TierlistRow | undefined;
  listPublicByUser(ownerUserId: string): TierlistRow[];
  /** Public tier lists the account has a ballot on, latest ballot first.
   *  Own lists are excluded — they already show under listByUser, and
   *  "Voted on" means other people's content (the owner's seeded ballot
   *  on their own poll must not count as participation). */
  listVotedByUser(voterUserId: string): TierlistRow[];
  discoverWindow(needle: string, limit: number): TierlistDiscoverRow[];
  listPublicByIds(ids: string[]): TierlistRow[];
  ballotTotalsFor(ids: string[]): Map<string, BallotTotals>;
  votedAmong(voterUserId: string, ids: string[]): string[];
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
  listParticipation(ownerUserId: string, since: string): Array<{ id: string; name: string; public_books: string | null; participants: number; latest_at: string }>;
  listRecentVoters(tierlistId: string, ownerUserId: string, limit: number): Array<{ user_id: string; at: string }>;
}
