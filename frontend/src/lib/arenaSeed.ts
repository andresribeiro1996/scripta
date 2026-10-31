// Shared seeding logic for BookArena — turning a library book record into
// a SeedBook (backend/src/modules/arena's SeedBookInput), resolving a
// real cover URL up front rather than leaving `cover: null`.
//
// Done here, not on the public /arena/:id page, because cover resolution
// (GET /covers/resolve) requires authGuard — this only ever runs from the
// owner-authenticated seeding flow (SeedSlotGrid.tsx / ArenaSeedPage.tsx),
// so the resolved URL gets baked into the tournament's denormalized
// snapshot at seed time and the public voting page never needs to
// resolve anything itself; it just renders the stored URL directly.

import { resolveCover } from "../api/covers";
import type { SeedBook, Tournament } from "../api/arena";
import { getLocale } from "../i18n";
import { seedCoverLookup, toSeedBook as createSeedBook, type createArenaApi } from "@scripta/shared";

export const UNTITLED_TOURNAMENT = "Untitled tournament";

export function hasTournamentName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed !== "" && trimmed !== UNTITLED_TOURNAMENT;
}

export function slotPayload(slots: Array<SeedBook | null>): Array<{ slotIndex: number; book: SeedBook }> {
  return slots.flatMap((book, slotIndex) => (book ? [{ slotIndex, book }] : []));
}

export async function createSeededTournament(
  api: Pick<ReturnType<typeof createArenaApi>, "createTournament" | "setTournamentSlots">,
  input: { name: string; bracketSize: number; roundDurationMinutes: number },
  slots: Array<SeedBook | null>
): Promise<{ tournament: Tournament; slotsError: unknown }> {
  const tournament = await api.createTournament(input);
  const payload = slotPayload(slots);
  if (payload.length === 0) return { tournament, slotsError: null };
  try {
    await api.setTournamentSlots(tournament.id, payload);
  } catch (slotsError) {
    return { tournament, slotsError };
  }
  return { tournament, slotsError: null };
}

export async function toSeedBook(book: Record<string, unknown>): Promise<SeedBook | null> {
  const existing = typeof book._coverUrl === "string" ? book._coverUrl : null;
  const cover = existing ?? (await resolveBookCover(book));
  return createSeedBook(book, cover, getLocale());
}

async function resolveBookCover(book: Record<string, unknown>): Promise<string | null> {
  const params = seedCoverLookup(book);
  if (!params) return null;
  try {
    return await resolveCover(params, { poll: false });
  } catch {
    // Same "a lookup failure is just a miss" contract CoverImage itself
    // follows — never block seeding on a flaky/rate-limited cover lookup.
    return null;
  }
}
