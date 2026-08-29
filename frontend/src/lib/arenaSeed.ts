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
import type { SeedBook } from "../api/arena";
import { normalizeImageId, normalizeIsbn } from "./covers";
import { bookKey } from "./merge";

export async function toSeedBook(book: Record<string, unknown>): Promise<SeedBook> {
  const existing = typeof book._coverUrl === "string" ? book._coverUrl : null;
  const cover = existing ?? (await resolveBookCover(book));
  return {
    key: bookKey(book),
    title: String(book.Title ?? "Untitled"),
    author: String(book.Attribution ?? "Unknown author"),
    cover
  };
}

async function resolveBookCover(book: Record<string, unknown>): Promise<string | null> {
  const isbn = normalizeIsbn(book.ISBN);
  const imageId = normalizeImageId(book.ImageId);
  const title = String(book.Title ?? "").trim();
  if (!isbn && !imageId && !title) return null;
  try {
    return await resolveCover({
      isbn: isbn || undefined,
      imageId: imageId || undefined,
      title: title || undefined,
      author: book.Attribution ? String(book.Attribution) : undefined
    });
  } catch {
    // Same "a lookup failure is just a miss" contract CoverImage itself
    // follows — never block seeding on a flaky/rate-limited cover lookup.
    return null;
  }
}
