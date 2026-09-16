// The public → private book-shape reconstruction SharedMuralPage.tsx and
// CommunityProfilePage.tsx both render murals through — see that page's top
// comment for why this indirection exists at all.
import type { PublicBookData, PublicHighlight } from "../api/sharedMurals";
import { bookKey } from "./merge";

/** The exact inverse of publicResolver.ts's toPublicBookData — see
 *  pages/SharedMuralPage.tsx's top comment. `highlights` starts empty; the
 *  caller (buildReconstructedBooks below) fills it in afterward once every
 *  book's own bookKey() is known, since a PublicHighlight only carries the
 *  bookKey it belongs to, not a nested position inside PublicBookData. */
export function toPrivateBook(pub: PublicBookData): Record<string, unknown> {
  return {
    Title: pub.title,
    Attribution: pub.author,
    ISBN: pub.isbn,
    ImageId: pub.imageId,
    _coverUrl: pub.coverUrl,
    ReadStatus: pub.readStatus,
    highlights: [] as Array<Record<string, unknown>>
  };
}

/** `books` and `currentlyReading` can overlap (a book that's both
 *  spotlighted/shelved AND currently in progress) — deduped by bookKey()
 *  so CurrentlyReadingBlockView (which just filters this same list for
 *  ReadStatus === 1) never shows the same book twice. Every matching
 *  highlight is attached by its own bookKey field (see
 *  api/sharedMurals.ts's PublicHighlight — the backend already computed
 *  this against the SAME bookKey() algorithm, see that route's own
 *  comment), mapped to {BookmarkID, Text, Annotation} so resolveQuote's
 *  `String(h.BookmarkID) === highlightId` match keeps working unchanged. */
export function buildReconstructedBooks(books: PublicBookData[], currentlyReading: PublicBookData[], highlights: PublicHighlight[]): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const pub of [...books, ...currentlyReading]) {
    const book = toPrivateBook(pub);
    const key = bookKey(book);
    if (!byKey.has(key)) byKey.set(key, book);
  }
  for (const h of highlights) {
    const book = byKey.get(h.bookKey);
    if (!book) continue; // stale/unresolvable reference — same tolerant convention lib/murals.ts's own resolvers use
    (book.highlights as Array<Record<string, unknown>>).push({ BookmarkID: h.highlightId, Text: h.text, Annotation: h.annotation });
  }
  return [...byKey.values()];
}
