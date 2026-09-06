import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchVotingBoard, submitBallotApi, type BallotResponse } from "../api/tierlistVoting";

// The anonymous voter's ONLY handle on their ballot. A signed-in voter
// doesn't need it: the backend keys their ballot to their account, and
// ignores whatever id we send. Written solely from a server response —
// never generated here, or two browsers would collide on one id.
function ballotStorageKey(code: string) {
  return `tierlist-ballot:${code}`;
}

export function useTierlistVoting(code: string) {
  const query = useQuery({ queryKey: ["tierlists", "voting", code], queryFn: () => fetchVotingBoard(code) });
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
