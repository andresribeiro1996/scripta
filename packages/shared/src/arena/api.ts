import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { SeedBook, Tournament, TournamentView } from "./types.js";

export function createArenaApi(request: ApiRequest) {
  return {
    async createTournament(input: { name: string; bracketSize: number; roundDurationMinutes: number }): Promise<Tournament> {
      return (await request<{ tournament: Tournament }>("/arenas", { method: "POST", body: input, auth: "required" })).tournament;
    },
    async fetchMyTournaments(): Promise<Tournament[]> {
      return (await request<{ tournaments: Tournament[] }>("/arenas/mine", { auth: "required" })).tournaments;
    },
    async fetchVotedTournaments(): Promise<Tournament[]> {
      return (await request<{ tournaments: Tournament[] }>("/arenas/voted", { auth: "required" })).tournaments;
    },
    async fetchTournament(id: string, voterToken?: string): Promise<TournamentView> {
      const query = voterToken ? `?voterToken=${encodeURIComponent(voterToken)}` : "";
      return (await request<{ tournament: TournamentView }>(apiPath`/arenas/${id}` + query, { auth: "optional" })).tournament;
    },
    async setTournamentSlots(id: string, slots: Array<{ slotIndex: number; book: SeedBook }>): Promise<void> {
      await request(apiPath`/arenas/${id}/slots`, { method: "PUT", body: { slots }, auth: "required" });
    },
    async randomFillTournament(id: string, pool: SeedBook[]): Promise<void> {
      await request(apiPath`/arenas/${id}/random-fill`, { method: "POST", body: { pool }, auth: "required" });
    },
    async startTournament(id: string): Promise<void> {
      await request(apiPath`/arenas/${id}/start`, { method: "POST", auth: "required" });
    },
    async voteOnDuel(tournamentId: string, duelId: string, voterToken: string, workId: string): Promise<void> {
      await request(apiPath`/arenas/${tournamentId}/duels/${duelId}/vote`, { method: "POST", body: { voterToken, workId }, auth: "optional" });
    },
    async settleDuelEarly(tournamentId: string, duelId: string): Promise<void> {
      await request(apiPath`/arenas/${tournamentId}/duels/${duelId}/settle`, { method: "POST", auth: "required" });
    },
    async resolveTiebreak(tournamentId: string, duelId: string, winnerWorkId: string): Promise<void> {
      await request(apiPath`/arenas/${tournamentId}/duels/${duelId}/tiebreak`, { method: "POST", body: { winnerWorkId }, auth: "required" });
    },
    async renameTournament(id: string, name: string): Promise<void> {
      await request(apiPath`/arenas/${id}`, { method: "PATCH", body: { name }, auth: "required" });
    },
    async deleteTournament(id: string): Promise<void> {
      await request(apiPath`/arenas/${id}`, { method: "DELETE", auth: "required" });
    },
  };
}

export type ArenaApi = ReturnType<typeof createArenaApi>;
