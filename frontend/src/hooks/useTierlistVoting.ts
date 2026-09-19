import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchBallotApi, fetchTierlistResultsApi, fetchVotingBoard, submitBallotApi, type BallotResponse, type HistogramCell } from "../api/tierlistVoting";
import { getSession } from "../auth/tokenStore";

// The anonymous voter's ONLY handle on their ballot. A signed-in voter
// doesn't need it: the backend keys their ballot to their account, and
// ignores whatever id we send. Written solely from a server response —
// never generated here, or two browsers would collide on one id.
function ballotStorageKey(code: string) {
  return `tierlist-ballot:${code}`;
}

export function useTierlistVoting(code: string) {
  const queryClient = useQueryClient();
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
  const [submitted, setSubmitted] = useState<BallotResponse | null>(null);
  const storedBallotId = localStorage.getItem(ballotStorageKey(code));
  // A ballot the caller already holds, from any earlier session. The owner
  // of a poll always holds one without ever having voted through this page:
  // openVoting moves their ranking out of the tier list document and seeds
  // it as their ballot, so this is the only route back to it. `retry: false`
  // because "you have no ballot here" comes back as a 404, not a blip.
  const existing = useQuery({
    queryKey: ["tierlists", "ballot", code, storedBallotId],
    queryFn: () => fetchBallotApi(code, storedBallotId),
    enabled: code.length > 0 && (storedBallotId !== null || Boolean(getSession())),
    retry: false
  });

  async function submit(placements: Array<{ bookKey: string; tierId: string }>): Promise<BallotResponse> {
    const response = await submitBallotApi(code, placements, storedBallotId);
    localStorage.setItem(ballotStorageKey(code), response.ballotId);
    setSubmitted(response);
    // The owner's editor reads this ballot too, and its ballot count and
    // standings both just moved.
    await queryClient.invalidateQueries({ queryKey: ["tierlists"] });
    return response;
  }

  return {
    board: query.data?.board,
    books: query.data?.books ?? [],
    // The ballot query counts: without it a returning voter is shown a blank
    // board for a frame before it flips to their results, which reads as the
    // very "my ranking is gone" bug this fetch exists to fix.
    isLoading: query.isLoading || existing.isLoading,
    error: query.error,
    /** This session's submission if there was one, else whatever ballot the
     *  caller already held. */
    ballot: submitted ?? existing.data ?? null,
    /** True only for a ballot cast through THIS page, this session — what
     *  the "Your ballot is in." confirmation is about. */
    justSubmitted: submitted !== null,
    storedBallotId,
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
