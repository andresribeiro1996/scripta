import { createArenaApi } from "@scripta/shared";
import { request } from "./request";

export type { Duel, DuelSide, SeedBook, Tournament, TournamentView } from "@scripta/shared";

export const {
  createTournament,
  fetchMyTournaments,
  fetchVotedTournaments,
  fetchTournament,
  setTournamentSlots,
  randomFillTournament,
  startTournament,
  voteOnDuel,
  settleDuelEarly,
  resolveTiebreak,
  renameTournament,
  deleteTournament,
} = createArenaApi(request);
