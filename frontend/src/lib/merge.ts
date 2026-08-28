// Merging a newly-imported library into the one already saved for this
// account. Only kicks in from the SECOND import onward — the first import
// has nothing to merge against, so it's saved as-is (see DashboardPage).
//
// This intentionally lives entirely on the frontend, not the backend: the
// `library` module was built to treat the document as an opaque blob (see
// backend/README.md's hexagonal-architecture section) — it doesn't
// understand book shape, and shouldn't have to just for this. The
// frontend already understands book shape (it's what parses every import
// format), so it merges locally and PUTs the result through the same
// unchanged `saveLibrary` call.

import type { LibraryData } from "../api/library";
import { normalizeIsbn } from "./covers";

/** Identifies "the same book" across sources whose native IDs aren't
 *  comparable at all (Kobo's ContentID vs Goodreads' synthetic
 *  "goodreads:123"). ISBN first, since it's an exact identifier; falls
 *  back to normalized title+author for books without one on either side
 *  (common for indie/sideloaded titles) — imprecise, but the only signal
 *  available across sources that don't share a real ISBN. */
export function bookKey(book: Record<string, unknown>): string {
  const isbn = normalizeIsbn(book.ISBN);
  if (isbn) return `isbn:${isbn}`;
  const title = normalizeForMatch(book.Title);
  const author = normalizeForMatch(book.Attribution);
  return `ta:${title}|${author}`;
}

function normalizeForMatch(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Combines two highlight lists, de-duplicated by BookmarkID — stable
 *  across repeated exports from the SAME source (so re-importing your
 *  Kobo library twice doesn't duplicate highlights), while a different
 *  source's highlights (e.g. a Goodreads review, which uses its own
 *  "goodreads-review:..." id scheme) never collides with a Kobo one, so
 *  both survive. */
function unionHighlights(existing: unknown, incoming: unknown): Array<Record<string, unknown>> {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const seen = new Set(existingList.map((h) => (h as Record<string, unknown>).BookmarkID));
  const merged = [...existingList];
  for (const h of incomingList) {
    const id = (h as Record<string, unknown>).BookmarkID;
    if (!seen.has(id)) {
      merged.push(h);
      seen.add(id);
    }
  }
  return merged;
}

/** For a book present in both — the newest import wins for everything
 *  (title, author, progress, status, ...), except: `_coverUrl` is kept
 *  from whichever side actually has one, and highlights union rather
 *  than replace. `_coverUrl` is set by lib/bookCovers.ts's setBookCover
 *  (a genuine custom gallery cover) — auto-resolved covers no longer
 *  write back here at all, now that resolution is a persistent, global
 *  cache server-side (backend/src/modules/covers) rather than something
 *  that needed preserving per-book across a re-import; a book with no
 *  custom cover just re-resolves the exact same answer from that shared
 *  cache regardless of which side of a merge it came from. An importer
 *  itself never sets this field either way.
 *
 *  `...existingBook` goes first (not just `...incomingBook` alone) so any
 *  app-managed field an importer never sets — `_order` (lib/libraryOrder.ts)
 *  chief among them — survives instead of silently disappearing the next
 *  time this book gets merged. Same fix, same reasoning, as
 *  mergeLibraryData below already got for the library-level equivalent
 *  (name, groups). `...incomingBook` after it so newest-wins still holds
 *  for anything an importer DOES set. */
function mergeBookPair(
  existingBook: Record<string, unknown>,
  incomingBook: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existingBook,
    ...incomingBook,
    _coverUrl: (incomingBook._coverUrl as string | null | undefined) || (existingBook._coverUrl as string | null | undefined) || null,
    highlights: unionHighlights(existingBook.highlights, incomingBook.highlights)
  };
}

/** Existing books keep their position (updated in place if matched);
 *  genuinely new incoming books are appended in their original import
 *  order. Deliberately does NOT deduplicate incoming's own internal
 *  entries against each other — only existing-vs-incoming matching is in
 *  scope here, so any duplicate-book quirks already present within a
 *  single import are left exactly as they were (not a behavior change
 *  this feature was asked to make). */
export function mergeBookLists(
  existingBooks: Array<Record<string, unknown>>,
  incomingBooks: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const incomingByKey = new Map<string, Record<string, unknown>>();
  for (const b of incomingBooks) {
    const key = bookKey(b);
    if (!incomingByKey.has(key)) incomingByKey.set(key, b);
  }

  const usedIncomingKeys = new Set<string>();
  const merged = existingBooks.map((existingBook) => {
    const key = bookKey(existingBook);
    const incomingMatch = incomingByKey.get(key);
    if (incomingMatch) {
      usedIncomingKeys.add(key);
      return mergeBookPair(existingBook, incomingMatch);
    }
    return existingBook;
  });

  for (const b of incomingBooks) {
    const key = bookKey(b);
    if (!usedIncomingKeys.has(key)) {
      merged.push(b);
      usedIncomingKeys.add(key);
    }
  }

  return merged;
}

export function mergeLibraryData(existing: LibraryData, incoming: LibraryData): LibraryData {
  const books = mergeBookLists(existing.books, incoming.books);
  return {
    // `...existing` first so fields an importer never sets — groups
    // (lib/groups.ts) and the user-given library name — survive a later
    // import instead of silently vanishing. `...incoming` after it so
    // "newest wins" still holds for anything an importer DOES set
    // (source, schema_version, ...).
    ...existing,
    ...incoming,
    books,
    book_count: books.length
  };
}
