// Thin wrapper functions over apiFetch/publicFetch for every /arenas
// route — same shape as api/gallery.ts (a standalone backend resource,
// not a field on the account's library document).

import { apiFetch, publicFetch } from "./client";

export interface SeedBook {
  key: string;
  title: string;
  author: string;
  cover: string | null;
}

export interface TournamentSummary {
  id: string;
  name: string;
  bracketSize: number;
  roundDurationMinutes: number;
  status: "seeding" | "active" | "completed";
  currentRound: number;
  createdAt: string;
  ownerUserId: string;
}

export interface DuelSide extends SeedBook {
  votes: number;
}

export interface Duel {
  id: string;
  roundNumber: number;
  duelIndex: number;
  bookA: DuelSide;
  bookB: DuelSide;
  winnerKey: string | null;
  status: "active" | "tied_pending_tiebreak" | "settled";
  opensAt: string;
  closesAt: string;
  hasVoted: boolean;
}

export interface TournamentView extends TournamentSummary {
  slots: Array<{ slotIndex: number } & SeedBook>;
  duels: Duel[];
}

export async function createTournament(input: { name: string; bracketSize: number; roundDurationMinutes: number }): Promise<TournamentSummary> {
  const body = (await apiFetch("/arenas", { method: "POST", body: JSON.stringify(input) })) as { tournament: TournamentSummary };
  return body.tournament;
}

export async function fetchMyTournaments(): Promise<TournamentSummary[]> {
  const body = (await apiFetch("/arenas/mine")) as { tournaments: TournamentSummary[] };
  return body.tournaments;
}

export async function fetchPublicTournaments(): Promise<TournamentSummary[]> {
  const body = (await publicFetch("/arenas/public")) as { tournaments: TournamentSummary[] };
  return body.tournaments;
}

/** Public — works with no session at all. `voterToken` lets the backend
 *  fill in each active duel's `hasVoted`. */
export async function fetchTournament(id: string, voterToken: string): Promise<TournamentView> {
  const body = (await publicFetch(`/arenas/${id}?voterToken=${encodeURIComponent(voterToken)}`)) as { tournament: TournamentView };
  return body.tournament;
}

/** Full-replace — same semantics as PUT /library. Send every slot the
 *  seeding UI currently has assigned, not just the changed ones. */
export async function setTournamentSlots(id: string, slots: Array<{ slotIndex: number; book: SeedBook }>): Promise<void> {
  await apiFetch(`/arenas/${id}/slots`, { method: "PUT", body: JSON.stringify({ slots }) });
}

export async function randomFillTournament(id: string, pool: SeedBook[]): Promise<void> {
  await apiFetch(`/arenas/${id}/random-fill`, { method: "POST", body: JSON.stringify({ pool }) });
}

export async function startTournament(id: string): Promise<void> {
  await apiFetch(`/arenas/${id}/start`, { method: "POST" });
}

/** Public — no session required, this is the whole point of BookArena. */
export async function voteOnDuel(tournamentId: string, duelId: string, voterToken: string, bookKey: string): Promise<void> {
  await publicFetch(`/arenas/${tournamentId}/duels/${duelId}/vote`, { method: "POST", body: JSON.stringify({ voterToken, bookKey }) });
}

export async function settleDuelEarly(tournamentId: string, duelId: string): Promise<void> {
  await apiFetch(`/arenas/${tournamentId}/duels/${duelId}/settle`, { method: "POST" });
}

export async function resolveTiebreak(tournamentId: string, duelId: string, winnerBookKey: string): Promise<void> {
  await apiFetch(`/arenas/${tournamentId}/duels/${duelId}/tiebreak`, { method: "POST", body: JSON.stringify({ winnerBookKey }) });
}

export async function deleteTournament(id: string): Promise<void> {
  await apiFetch(`/arenas/${id}`, { method: "DELETE" });
}
