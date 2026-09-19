import type { Duel, SeedBook } from "@scripta/shared";
import { apiClient } from "../../core/api";

export interface TournamentSummary {
  id: string;
  name: string;
  bracketSize: number;
  roundDurationMinutes: number;
  status: "seeding" | "active" | "completed";
  currentRound: number;
  createdAt: string;
  ownerUserId: string;
  /** Up to eight cover URLs from the seeded pool, for the list card. */
  covers: string[];
  filledSlots: number;
  /** The champion book, once this tournament's final duel has settled. */
  winner: SeedBook | null;
}

export interface TournamentView extends TournamentSummary {
  slots: Array<{ slotIndex: number } & SeedBook>;
  duels: Duel[];
}

export async function createTournament(name: string, bracketSize: number, roundDurationMinutes: number) {
  return (await apiClient.request<{ tournament: TournamentSummary }>("/arenas", {
    method: "POST",
    body: { name, bracketSize, roundDurationMinutes },
    auth: true,
  })).tournament;
}

export async function fetchMyTournaments() {
  return (await apiClient.request<{ tournaments: TournamentSummary[] }>("/arenas/mine", { auth: true })).tournaments;
}

/** Tournaments the account has voted in (own ones excluded server-side),
 *  most recent vote first. */
export async function fetchVotedTournaments() {
  return (await apiClient.request<{ tournaments: TournamentSummary[] }>("/arenas/voted", { auth: true })).tournaments;
}

export async function fetchPublicTournaments() {
  return (await apiClient.request<{ tournaments: TournamentSummary[] }>("/arenas/public")).tournaments;
}

export async function fetchTournament(id: string, voterToken?: string) {
  return (await apiClient.request<{ tournament: TournamentView }>(`/arenas/${id}${voterToken ? `?voterToken=${encodeURIComponent(voterToken)}` : ""}`)).tournament;
}

export function setTournamentSlots(id: string, slots: Array<{ slotIndex: number; book: SeedBook }>) {
  return apiClient.request(`/arenas/${id}/slots`, { method: "PUT", body: { slots }, auth: true });
}

export function randomFillTournament(id: string, pool: SeedBook[]) {
  return apiClient.request(`/arenas/${id}/random-fill`, { method: "POST", body: { pool }, auth: true });
}

export function startTournament(id: string) {
  return apiClient.request(`/arenas/${id}/start`, { method: "POST", auth: true });
}

/** Public route, but `authenticated` controls whether the caller's access
 *  token rides along — a signed-in voter's vote (and the browser token's
 *  whole history) is claimed for the account, an anonymous one stays
 *  anonymous. Same split submitBallot in features/tierlists/api.ts uses. */
export function voteOnDuel(tournamentId: string, duelId: string, voterToken: string, bookKey: string, authenticated: boolean) {
  return apiClient.request(`/arenas/${tournamentId}/duels/${duelId}/vote`, {
    method: "POST",
    body: { voterToken, bookKey },
    auth: authenticated,
  });
}

export function settleDuelEarly(tournamentId: string, duelId: string) {
  return apiClient.request(`/arenas/${tournamentId}/duels/${duelId}/settle`, { method: "POST", auth: true });
}

export function resolveTiebreak(tournamentId: string, duelId: string, winnerBookKey: string) {
  return apiClient.request(`/arenas/${tournamentId}/duels/${duelId}/tiebreak`, { method: "POST", body: { winnerBookKey }, auth: true });
}

export function deleteTournament(id: string) {
  return apiClient.request(`/arenas/${id}`, { method: "DELETE", auth: true });
}

export function renameTournament(id: string, name: string) {
  return apiClient.request(`/arenas/${id}`, { method: "PATCH", body: { name }, auth: true });
}

export async function resolveCover(book: Record<string, unknown>): Promise<string | null> {
  const query = new URLSearchParams();
  const isbn = String(book.ISBN ?? "").trim();
  const imageId = String(book.ImageId ?? "").trim();
  const title = String(book.Title ?? "").trim();
  const author = String(book.Attribution ?? "").trim();
  if (isbn) query.set("isbn", isbn);
  if (imageId) query.set("imageId", imageId);
  if (title) query.set("title", title);
  if (author) query.set("author", author);
  return (await apiClient.request<{ url: string | null }>(`/covers/resolve?${query}`, { auth: true })).url;
}
