// Book search for the Add Book flow (components/AddBookModal.tsx) and
// the mapping from a chosen result to a library book record.
//
// The mirror image of lib/bookMetadata.ts, which pins down ONE already-
// known book (exact title+author match) to show its summary/rating on
// the detail sheet. Here we need the opposite: a free-text "ISBN or
// title or author or any mix of them" lookup that returns CANDIDATES to
// pick from. Same public Open Library search API, different slice of it
// — Google Books and Hardcover stay out of this (they're cover sources
// in the backend's covers module, not general search, and one catalog is
// enough for the pick-a-result list; a miss just falls through to
// filling the form by hand).

export interface BookSearchResult {
  title: string;
  authors: string[];
  year: number | null;
  isbn: string | null;
  publisher: string | null;
  coverUrl: string | null;
}

/** True when the query is nothing but an ISBN (10 or 13, dashes/spaces
 *  allowed) — routes the search to Open Library's exact `isbn=` field
 *  instead of the fuzzy `q=` free-text search. */
export function looksLikeIsbnQuery(text: string): boolean {
  const digits = text.replace(/[\s-]/g, "");
  return /^(?:97[89]\d{10}|\d{9}[\dXx])$/.test(digits);
}

export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({
    fields: "key,title,author_name,first_publish_year,isbn,publisher,cover_i",
    limit: "12"
  });
  if (looksLikeIsbnQuery(trimmed)) params.set("isbn", trimmed.replace(/[\s-]/g, ""));
  else params.set("q", trimmed);
  const response = await fetch(`https://openlibrary.org/search.json?${params}`, {
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Search is unavailable right now — try again.");
  const data = await response.json();
  const docs = Array.isArray(data?.docs) ? (data.docs as Array<Record<string, unknown>>) : [];
  return docs.map(mapOpenLibraryDoc).filter((r): r is BookSearchResult => r !== null);
}

/** One Open Library search "doc" -> the slim shape the result list
 *  renders. Exported for scripts/test-book-search.mts. Returns null for
 *  docs with no usable title (Open Library's index has plenty). */
export function mapOpenLibraryDoc(doc: Record<string, unknown>): BookSearchResult | null {
  if (typeof doc.title !== "string" || !doc.title.trim()) return null;
  const isbns = Array.isArray(doc.isbn) ? doc.isbn : [];
  // 13-digit preferred: it's what barcode scans produce and what
  // normalizeIsbn-based book matching (lib/merge.ts) and the backend
  // cover-resolve chain handle best.
  const isbn13 = isbns.find((v): v is string => typeof v === "string" && /^97[89]\d{10}$/.test(v));
  const isbn10 = isbns.find((v): v is string => typeof v === "string" && /^\d{9}[\dXx]$/.test(v));
  const publishers = Array.isArray(doc.publisher) ? doc.publisher : [];
  return {
    title: doc.title.trim(),
    authors: Array.isArray(doc.author_name) ? doc.author_name.filter((a): a is string => typeof a === "string") : [],
    year: typeof doc.first_publish_year === "number" ? doc.first_publish_year : null,
    isbn: isbn13 ?? isbn10 ?? null,
    publisher: typeof publishers[0] === "string" ? publishers[0] : null,
    coverUrl: typeof doc.cover_i === "number" ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null
  };
}

export interface ManualBookFields {
  title: string;
  author: string;
  isbn: string;
  publisher: string | null;
  /** Same 0/1/2 semantics as every other book (see lib/goodreads.ts). */
  readStatus: number;
  rating: number | null;
  /** YYYY-MM-DD off the form's date input, or null. */
  dateRead: string | null;
}

/** Builds a book record in the same shape every importer produces
 *  (lib/goodreads.ts's is the closest sibling — no cover key, ISBN+
 *  title/author carry everything). The id is injected rather than read
 *  off crypto.randomUUID() here purely so scripts/test-book-search.mts
 *  can pin it. */
export function buildManualBook(fields: ManualBookFields, id: string): Record<string, unknown> {
  return {
    ContentID: `manual:${id}`,
    Title: fields.title,
    Attribution: fields.author,
    Series: null,
    SeriesNumber: null,
    ISBN: fields.isbn,
    Publisher: fields.publisher,
    Language: null,
    ___PercentRead: fields.readStatus === 2 ? 100 : 0,
    ReadStatus: fields.readStatus,
    // Only meaningful for a finished book — mirrors how the importers
    // leave it null for anything shelved "to-read"/"reading".
    DateLastRead: fields.readStatus === 2 ? fields.dateRead : null,
    DateCreated: new Date().toISOString().slice(0, 10),
    Rating: fields.rating,
    TimeSpentReading: null,
    WordCount: -1,
    MimeType: null,
    ImageId: null,
    highlights: [] as Array<Record<string, unknown>>
  };
}
