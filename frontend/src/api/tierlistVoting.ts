import { createTierlistsApi } from "@scripta/shared";
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
