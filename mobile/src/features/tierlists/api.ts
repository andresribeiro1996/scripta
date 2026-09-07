import type { HistogramCell, TierlistData } from "@scripta/shared";
import { apiClient } from "../../core/api";

export interface Tierlist {
  id: string;
  name: string;
  data: TierlistData;
  createdAt: string;
  updatedAt: string;
  voteCode: string | null;
  voteAccess: "anonymous" | "members";
  votingOpen: boolean;
  sourceTierlistId: string | null;
}

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
  histogram?: HistogramCell[];
}

export interface PublicBook {
  key?: string;
  title: string;
  author?: string;
  isbn?: string;
  imageId?: string;
  coverUrl?: string | null;
}

export interface BallotResponse {
  ballotId: string;
  placements: Array<{ bookKey: string; tierId: string }>;
  results: { histogram: HistogramCell[]; ballotCount: number };
}

export async function fetchTierlists() {
  return (await apiClient.request<{ tierlists: Tierlist[] }>("/tierlists", { auth: true })).tierlists;
}

export function createTierlist(name: string) {
  return apiClient.request<Tierlist>("/tierlists", { method: "POST", body: { name }, auth: true });
}

export function updateTierlist(id: string, patch: { name?: string; data?: TierlistData }) {
  return apiClient.request<Tierlist>(`/tierlists/${id}`, { method: "PUT", body: patch, auth: true });
}

export function deleteTierlist(id: string) {
  return apiClient.request(`/tierlists/${id}`, { method: "DELETE", auth: true });
}

export async function fetchPublicTierlists() {
  return (await apiClient.request<{ tierlists: PublicTierlistSummary[] }>("/tierlists/public")).tierlists;
}

export function fetchVotingBoard(code: string) {
  return apiClient.request<{ board: VotingBoard; books: PublicBook[] }>(`/tierlists/voting/${encodeURIComponent(code)}`);
}

export function submitBallot(code: string, placements: Array<{ bookKey: string; tierId: string }>, ballotId: string | null, authenticated: boolean) {
  const suffix = ballotId ? `/${encodeURIComponent(ballotId)}` : "";
  return apiClient.request<BallotResponse>(`/tierlists/voting/${encodeURIComponent(code)}/ballot${suffix}`, {
    method: ballotId ? "PUT" : "POST",
    body: { placements },
    auth: authenticated,
  });
}

export function fetchBallot(code: string, ballotId: string, authenticated: boolean) {
  return apiClient.request<BallotResponse>(`/tierlists/voting/${encodeURIComponent(code)}/ballot/${encodeURIComponent(ballotId)}`, { auth: authenticated });
}

export function openVoting(id: string, access: "anonymous" | "members") {
  return apiClient.request<{ tierlist: Tierlist; voteCode: string }>(`/tierlists/${id}/open-voting`, { method: "POST", body: { access }, auth: true });
}

export async function setVotingState(id: string, patch: { access?: "anonymous" | "members"; open?: boolean }) {
  return (await apiClient.request<{ tierlist: Tierlist }>(`/tierlists/${id}/voting`, { method: "PUT", body: patch, auth: true })).tierlist;
}

export function fetchTierlistResults(id: string) {
  return apiClient.request<{ histogram: HistogramCell[]; ballotCount: number }>(`/tierlists/${id}/results`, { auth: true });
}
