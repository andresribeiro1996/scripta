import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchTierlistResultsApi, fetchVotingBoard, submitBallotApi, type BallotResponse, type HistogramCell } from "../api/tierlistVoting";

// The anonymous voter's ONLY handle on their ballot. A signed-in voter
// doesn't need it: the backend keys their ballot to their account, and
// ignores whatever id we send. Written solely from a server response —
// never generated here, or two browsers would collide on one id.
function ballotStorageKey(code: string) {
  return `tierlist-ballot:${code}`;
}

export function useTierlistVoting(code: string) {
  // `enabled`: callers pass "" for a tier list that has no vote code at all
  // (TierListEditorPage does, on every ordinary tier list), and a request
  // for an empty code can only ever 404 — while still spending the public
  // routes' shared 30-per-minute budget, on load AND on every window focus.
  // `retry: false`: a genuinely unknown code is a miss, not a blip, so the
  // page should say "not found" rather than sit on "Loading…" through
  // react-query's default retry backoff.
  const query = useQuery({
    queryKey: ["tierlists", "voting", code],
    queryFn: () => fetchVotingBoard(code),
    enabled: code.length > 0,
    retry: false
  });
  const [ballot, setBallot] = useState<BallotResponse | null>(null);

  async function submit(placements: Array<{ bookKey: string; tierId: string }>): Promise<BallotResponse> {
    const stored = localStorage.getItem(ballotStorageKey(code));
    const response = await submitBallotApi(code, placements, stored);
    localStorage.setItem(ballotStorageKey(code), response.ballotId);
    setBallot(response);
    return response;
  }

  return {
    board: query.data?.board,
    books: query.data?.books ?? [],
    isLoading: query.isLoading,
    error: query.error,
    ballot,
    storedBallotId: localStorage.getItem(ballotStorageKey(code)),
    submit
  };
}

/** The OWNER's view of their own poll's results, through the
 *  ownership-checked GET /tierlists/:id/results. The public board omits the
 *  histogram while voting is open (results-after-you-submit is enforced
 *  server-side), and the owner is the one caller the spec exempts from that
 *  gate — so their editor page reads the standings here instead. */
export function useTierlistResults(id: string | undefined): { histogram: HistogramCell[]; ballotCount: number } | undefined {
  const query = useQuery({
    queryKey: ["tierlists", "results", id ?? ""],
    queryFn: () => fetchTierlistResultsApi(id!),
    enabled: Boolean(id),
    retry: false
  });
  return query.data;
}
