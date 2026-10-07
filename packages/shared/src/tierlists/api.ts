import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { PublicBookData } from "../public/types.js";
import type { Placement } from "./ballot.js";
import type { HistogramCell } from "./results.js";
import type { BallotResponse, Tierlist, TierlistData, VotedTierlist, VotingBoard } from "./types.js";

type Access = "anonymous" | "members";

export function createTierlistsApi(request: ApiRequest) {
  return {
    async fetchTierlists(): Promise<Tierlist[]> {
      return (await request<{ tierlists: Tierlist[] }>("/tierlists", { auth: "required" })).tierlists;
    },
    fetchTierlist(id: string): Promise<Tierlist> {
      return request<Tierlist>(apiPath`/tierlists/${id}`, { auth: "required" });
    },
    createTierlist(name: string, data?: TierlistData, access?: Access): Promise<Tierlist> {
      return request<Tierlist>("/tierlists", { method: "POST", body: { name, data, access }, auth: "required" });
    },
    updateTierlist(id: string, patch: { name?: string; data?: TierlistData }): Promise<Tierlist> {
      return request<Tierlist>(apiPath`/tierlists/${id}`, { method: "PUT", body: patch, auth: "required" });
    },
    async deleteTierlist(id: string): Promise<void> {
      await request(apiPath`/tierlists/${id}`, { method: "DELETE", auth: "required" });
    },
    async fetchVotedTierlists(): Promise<VotedTierlist[]> {
      return (await request<{ tierlists: VotedTierlist[] }>("/tierlists/voted", { auth: "required" })).tierlists;
    },
    fetchVotingBoard(code: string): Promise<{ board: VotingBoard; books: PublicBookData[] }> {
      return request(apiPath`/tierlists/voting/${code}`, { auth: "none" });
    },
    submitBallot(code: string, placements: Placement[], ballotId: string | null): Promise<BallotResponse> {
      const path = ballotId === null ? apiPath`/tierlists/voting/${code}/ballot` : apiPath`/tierlists/voting/${code}/ballot/${ballotId}`;
      return request<BallotResponse>(path, { method: ballotId === null ? "POST" : "PUT", body: { placements }, auth: "optional" });
    },
    fetchBallot(code: string, ballotId: string): Promise<BallotResponse> {
      return request<BallotResponse>(apiPath`/tierlists/voting/${code}/ballot/${ballotId}`, { auth: "optional" });
    },
    fetchMyBallot(code: string): Promise<BallotResponse> {
      return request<BallotResponse>(apiPath`/tierlists/voting/${code}/ballot`, { auth: "optional" });
    },
    fetchTierlistResults(id: string): Promise<{ histogram: HistogramCell[]; ballotCount: number }> {
      return request(apiPath`/tierlists/${id}/results`, { auth: "required" });
    },
    openVoting(id: string, access: Access): Promise<{ tierlist: Tierlist; voteCode: string }> {
      return request(apiPath`/tierlists/${id}/open-voting`, { method: "POST", body: { access }, auth: "required" });
    },
    async setVotingState(id: string, patch: { access?: Access; open?: boolean }): Promise<Tierlist> {
      return (await request<{ tierlist: Tierlist }>(apiPath`/tierlists/${id}/voting`, { method: "PUT", body: patch, auth: "required" })).tierlist;
    },
  };
}

export type TierlistsApi = ReturnType<typeof createTierlistsApi>;
