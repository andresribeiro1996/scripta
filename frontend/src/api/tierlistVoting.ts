// Thin apiFetch/publicFetch wrappers over the tierlists module's PUBLIC
// voting routes (backend's modules/tierlists/routes.ts's
// buildPublicTierlistRoutes) plus the two owner-only voting-state routes
// from buildTierlistRoutes — same "one function per backend route, no
// client-side logic" shape as api/tierlists.ts and api/arena.ts.
//
// `HistogramCell` is re-exported from lib/tierlistResults.ts, where the
// aggregation that consumes it lives, same api-reuses-lib-types split
// api/tierlists.ts already follows for TierDefinition.

import type { HistogramCell } from "../lib/tierlistResults";
import { apiFetch, publicFetch } from "./client";
import type { Tierlist } from "./tierlists";

export type { HistogramCell };

export interface PublicTierlistSummary {
  voteCode: string;
  name: string;
  poolSize: number;
  ballotCount: number;
  votingOpen: boolean;
}

export interface VotingBoard {
  name: string;
  tiers: Array<{ id: string; label: string; color: string }>;
  pool: string[];
  access: "anonymous" | "members";
  votingOpen: boolean;
  ballotCount: number;
  histogram: HistogramCell[];
}

export interface BallotResponse {
  ballotId: string;
  placements: Array<{ bookKey: string; tierId: string }>;
  results: { histogram: HistogramCell[]; ballotCount: number };
}

/** Public — the community voting directory (GET /tierlists/public). */
export async function fetchPublicTierlists(): Promise<PublicTierlistSummary[]> {
  const body = (await publicFetch("/tierlists/public")) as { tierlists: PublicTierlistSummary[] };
  return body.tierlists;
}

/** Public — a voting board resolved by its vote code, books already
 *  redacted to the public shape by the backend. */
export async function fetchVotingBoard(code: string): Promise<{ board: VotingBoard; books: Array<Record<string, unknown>> }> {
  return (await publicFetch(`/tierlists/voting/${encodeURIComponent(code)}`)) as { board: VotingBoard; books: Array<Record<string, unknown>> };
}

/** Public — casts or edits a ballot. POSTs a new ballot when `ballotId` is
 *  null, PUTs to the existing ballot otherwise. A signed-in caller's
 *  account is what the backend actually keys the ballot to; `ballotId` is
 *  only the anonymous voter's handle, ignored for a signed-in caller. */
export async function submitBallotApi(
  code: string,
  placements: Array<{ bookKey: string; tierId: string }>,
  ballotId: string | null
): Promise<BallotResponse> {
  const encodedCode = encodeURIComponent(code);
  const path = ballotId === null ? `/tierlists/voting/${encodedCode}/ballot` : `/tierlists/voting/${encodedCode}/ballot/${encodeURIComponent(ballotId)}`;
  return (await publicFetch(path, { method: ballotId === null ? "POST" : "PUT", body: JSON.stringify({ placements }) })) as BallotResponse;
}

/** Public — re-fetches an existing ballot by id. */
export async function fetchBallotApi(code: string, ballotId: string): Promise<BallotResponse> {
  return (await publicFetch(`/tierlists/voting/${encodeURIComponent(code)}/ballot/${encodeURIComponent(ballotId)}`)) as BallotResponse;
}

/** Owner-only — turns voting on for the first time, minting the vote code. */
export async function openVotingApi(id: string, access: "anonymous" | "members"): Promise<{ tierlist: Tierlist; voteCode: string }> {
  return (await apiFetch(`/tierlists/${id}/open-voting`, { method: "POST", body: JSON.stringify({ access }) })) as {
    tierlist: Tierlist;
    voteCode: string;
  };
}

/** Owner-only — flips access and/or open/closed on an already-opened poll. */
export async function setVotingStateApi(id: string, patch: { access?: "anonymous" | "members"; open?: boolean }): Promise<Tierlist> {
  const body = (await apiFetch(`/tierlists/${id}/voting`, { method: "PUT", body: JSON.stringify(patch) })) as { tierlist: Tierlist };
  return body.tierlist;
}
