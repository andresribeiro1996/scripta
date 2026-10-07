import { createArenaApi } from "@scripta/shared";
import { apiClient, request } from "../../core/api";

export type { Tournament, TournamentView } from "@scripta/shared";

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
