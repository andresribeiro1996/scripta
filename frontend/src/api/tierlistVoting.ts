import { createTierlistsApi, type BallotResponse } from "@scripta/shared";
import { ApiError } from "./client";
import { request } from "./request";

export type { BallotResponse, HistogramCell, VotedTierlist, VotingBoard } from "@scripta/shared";

export const {
  fetchVotedTierlists,
  fetchVotingBoard,
  submitBallot: submitBallotApi,
  fetchBallot,
  fetchMyBallot,
  fetchTierlistResults: fetchTierlistResultsApi,
  openVoting: openVotingApi,
  setVotingState: setVotingStateApi,
} = createTierlistsApi(request);

export async function ballotOrNull(load: () => Promise<BallotResponse>): Promise<BallotResponse | null> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
