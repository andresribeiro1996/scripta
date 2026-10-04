import type { LibraryData } from "./types.js";
import { certainFacts, matchFacts } from "./bookMatch.js";
import { normalizeIsbn } from "./covers.js";

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
export function unionHighlights(existing: unknown, incoming: unknown): Array<Record<string, unknown>> {
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
 *  (progress, status, ...), except: `_coverUrl` is kept
 *  from whichever side actually has one, and highlights union rather
 *  than replace. `_coverUrl` is set by bookCovers.ts's setBookCover
 *  (a genuine custom gallery cover) — auto-resolved covers no longer
 *  write back here at all, now that resolution is a persistent, global
 *  cache server-side (backend/src/modules/books) rather than something
 *  that needed preserving per-book across a re-import; a book with no
 *  custom cover just re-resolves the exact same answer from that shared
 *  cache regardless of which side of a merge it came from. An importer
 *  itself never sets this field either way.
 *
 *  `...existingBook` goes first (not just `...incomingBook` alone) so any
 *  app-managed field an importer never sets — `_order` (libraryOrder.ts)
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

const IDENTITY_FIELDS = ["Title", "Attribution", "ISBN"] as const;

export function withIdentityOf(book: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const next = { ...book };
  for (const field of IDENTITY_FIELDS) {
    if (field in source) next[field] = source[field];
    else delete next[field];
  }
  return next;
}

function collapseCertain(books: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const kept: Array<Record<string, unknown>> = [];
  const facts: ReturnType<typeof matchFacts>[] = [];
  const isbns: Array<Set<string>> = [];
  for (const book of books) {
    const bookFacts = matchFacts(book);
    const index = facts.findIndex(
      (other, i) =>
        certainFacts(other, bookFacts) && (bookFacts.isbn === "" || [...isbns[i]!].every((isbn) => isbn === bookFacts.isbn))
    );
    if (index < 0) {
      kept.push(book);
      facts.push(bookFacts);
      isbns.push(new Set(bookFacts.isbn === "" ? [] : [bookFacts.isbn]));
    } else {
      kept[index] = withIdentityOf(mergeBookPair(kept[index]!, book), kept[index]!);
      if (bookFacts.isbn !== "") isbns[index]!.add(bookFacts.isbn);
    }
  }
  return kept;
}

/** Existing books keep their position (updated in place if matched);
 *  genuinely new incoming books are appended in their original import
 *  order. */
export function mergeBookLists(
  existingBooks: Array<Record<string, unknown>>,
  incomingBooks: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const existingFacts = existingBooks.map(matchFacts);
  const paired = new Set<number>();
  const merged = [...existingBooks];
  for (const book of collapseCertain(incomingBooks)) {
    const facts = matchFacts(book);
    const index = existingFacts.findIndex((other, i) => !paired.has(i) && certainFacts(other, facts));
    if (index < 0) {
      merged.push(book);
      continue;
    }
    paired.add(index);
    merged[index] = withIdentityOf(mergeBookPair(existingBooks[index]!, book), existingBooks[index]!);
  }
  return merged;
}

export function mergeLibraryData(existing: LibraryData, incoming: LibraryData): LibraryData {
  const books = mergeBookLists(existing.books, incoming.books);
  return {
    // `...existing` first so fields an importer never sets — groups
    // (groups.ts) and the user-given library name — survive a later
    // import instead of silently vanishing. `...incoming` after it so
    // "newest wins" still holds for anything an importer DOES set
    // (source, schema_version, ...).
    ...existing,
    ...incoming,
    books,
    book_count: books.length
  };
}
