// library's cross-module public-data resolver — the ONLY way another
// module (murals, for its public GET /murals/shared/:token route) may
// reach into a user's private library data. Exported from library/
// index.ts; murals/routes.ts imports this file only through that public
// interface, never library's own internals (service.ts, adapters/,
// domain/) — same module-boundary discipline every cross-module import
// in this codebase already follows (e.g. authGuard from modules/auth/
// index.ts).
//
// A mural's blocks reference books/highlights by bookKey/highlightId and
// gallery images by id (see murals/domain/blockRefs.ts, which extracts
// exactly which ones a given mural needs) — all private data belonging
// to the mural's owner. This resolver takes those references and returns
// ONLY the matching data, redacted to a public-safe shape
// (toPublicBookData below). The full private book list is read here
// (needed in full to correctly compute `currentlyReading`/`stats`, both
// of which reflect the ENTIRE library, not just referenced books — see
// the critical-for-privacy note below) but NEVER returned by this
// function — only already-redacted rows/numbers ever leave it.
//
// Opens its OWN second connection to LIBRARY_DB_PATH (via the same
// openLibraryDb() library/plugin.ts uses) rather than reaching into the
// live LibraryRepository/LibraryService instances plugin.ts closes over.
// SQLite in WAL mode supports multiple connections to one file just
// fine, and this keeps a read-only cross-module concern decoupled from
// library's own composition root and service lifecycle — this module's
// plugin can be reworked without this file needing to change at all.

import type { DatabaseSync } from "node:sqlite";
// Cross-module dependency, same discipline as murals/routes.ts importing
// this very file only from library/index.ts: peekCachedCoverUrl is
// covers' own public surface for a synchronous, cache-only cover lookup —
// never covers' internals (service.ts, adapters/, domain/). See that
// file's own top comment for why a public, unauthenticated resolver may
// use this but not the authGuard'd, network-calling GET /covers/resolve
// path. The module registration order in backend/src/app.ts (library
// before covers) doesn't matter here — see that file's own note.
import { peekCachedCoverUrl } from "../covers/index.js";
import { openLibraryDb } from "./adapters/sqlite/connection.js";

export interface PublicBookData {
  title: string;
  author: string;
  isbn: string | null;
  imageId: string | null;
  coverUrl: string | null;
  readStatus: number | null;
}

export interface PublicHighlight {
  bookKey: string;
  highlightId: string;
  text: string;
  annotation: string | null;
}

export interface ResolvedPublicData {
  books: PublicBookData[];
  highlights: PublicHighlight[];
  currentlyReading: PublicBookData[];
  stats: Record<string, number>;
}

export interface PublicDataRequest {
  bookKeys: string[];
  highlightRefs: Array<{ bookKey: string; highlightId: string }>;
  needsCurrentlyReading: boolean;
  statsMetrics: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// --- bookKey() — copied EXACTLY from frontend/src/lib/merge.ts (whose
// own normalizeIsbn comes from frontend/src/lib/covers.ts). isbn-keyed
// when present (validated the same 10/13-digit shape, hyphens/spaces
// stripped first), else normalized lowercase-trimmed-collapsed-
// whitespace title+author. Duplicated here for the same no-shared-
// package reason blockRefs.ts's own top comment gives for the block
// union — a byte-for-byte divergence here means public books silently
// stop matching the mural's own spotlight/shelf/quote/tierlist
// references, so this must track that file exactly, not approximately.

// Exported — service.ts's own getPublicByToken (GET /library/shared/:token)
// reuses these exact two normalizers for the same peekCachedCoverUrl-backed
// auto-cover fallback below, rather than reimplementing them a second time.
export function normalizeIsbn(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[-\s]/g, "");
  return /^(?:\d{9}[\dXx]|\d{13})$/.test(cleaned) ? cleaned : "";
}

export function normalizeImageId(raw: unknown): string {
  const v = String(raw ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : "";
}

function normalizeForMatch(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function bookKey(book: Record<string, unknown>): string {
  const isbn = normalizeIsbn(book.ISBN);
  if (isbn) return `isbn:${isbn}`;
  const title = normalizeForMatch(book.Title);
  const author = normalizeForMatch(book.Attribution);
  return `ta:${title}|${author}`;
}

// --- computeStat() — copied EXACTLY from frontend/src/lib/muralStats.ts.
// ReadStatus === 2 is finished, === 1 is in-progress — the same source of
// truth CurrentlyReadingBlockView (components/murals/blocks/
// BookBlocks.tsx) uses for which books count as "currently reading",
// reused below for this resolver's own `currentlyReading` field.

function isFinished(book: Record<string, unknown>): boolean {
  return book.ReadStatus === 2;
}

function isInProgress(book: Record<string, unknown>): boolean {
  return book.ReadStatus === 1;
}

function finishedInYear(book: Record<string, unknown>, year: number): boolean {
  if (!isFinished(book)) return false;
  const raw = book.DateLastRead;
  if (typeof raw !== "string" || !raw) return false;
  const parsed = new Date(raw);
  return !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === year;
}

function highlightCount(book: Record<string, unknown>): number {
  return Array.isArray(book.highlights) ? book.highlights.length : 0;
}

/** Returns null for a metric name this backend copy doesn't recognize (a
 *  frontend StatMetric addition not yet mirrored here) — fails safe: the
 *  caller below simply omits it from the public `stats` object, rather
 *  than throwing or guessing a value. */
function computeStat(metric: string, books: Array<Record<string, unknown>>, now: Date): number | null {
  switch (metric) {
    case "totalBooks":
      return books.length;
    case "booksFinished":
      return books.filter(isFinished).length;
    case "booksFinishedThisYear":
      return books.filter((b) => finishedInYear(b, now.getFullYear())).length;
    case "booksInProgress":
      return books.filter(isInProgress).length;
    case "totalHighlights":
      return books.reduce((sum, b) => sum + highlightCount(b), 0);
    default:
      return null;
  }
}

/** The ONLY place a private book object's fields cross into the public
 *  response. Maps to exactly these six fields and nothing else — never
 *  the full private book object, never any field not listed here
 *  (rating, notes, reading progress/percentage, Kobo-internal ids,
 *  `_order`, groups membership, etc.).
 *
 *  `coverUrl` prefers `book._coverUrl` — a genuine manual gallery-cover
 *  assignment or legacy pre-cache data (see frontend/src/lib/bookCovers.ts's
 *  own comment: "auto-resolved covers no longer touch `_coverUrl` at all")
 *  — but that field is ABSENT for the common case of a book whose cover
 *  was only ever auto-resolved through the normal (authGuard'd,
 *  network-calling) GET /covers/resolve flow. Falling back to
 *  peekCachedCoverUrl (covers' cache-only, synchronous, network-free
 *  lookup) covers that common case too: if the mural owner has ever
 *  viewed this book in their own library, that resolve call already ran
 *  and cached a real cover row, keyed the same way service.ts's own
 *  resolveCover keys it (isbn first, else Kobo's own imageId) — so the
 *  cache row already exists by the time a stranger opens the public
 *  mural link, with zero new network calls made from this handler. */
function toPublicBookData(book: Record<string, unknown>): PublicBookData {
  const isbn = normalizeIsbn(book.ISBN) || null;
  const imageId = normalizeImageId(book.ImageId) || null;
  const manualCoverUrl = typeof book._coverUrl === "string" ? book._coverUrl : null;
  return {
    title: typeof book.Title === "string" && book.Title ? book.Title : "Untitled",
    author: typeof book.Attribution === "string" && book.Attribution ? book.Attribution : "Unknown author",
    isbn,
    imageId,
    coverUrl: manualCoverUrl ?? peekCachedCoverUrl({ isbn, imageId }),
    readStatus: typeof book.ReadStatus === "number" ? book.ReadStatus : null
  };
}

// Lazily opened, module-scoped — one extra connection (and its one
// prepared statement, prepared once rather than on every call, matching
// the prepared-statement-per-adapter convention every other module's
// SQLite adapter already follows, e.g.
// murals/adapters/sqlite/sqliteMuralsRepository.ts) for the lifetime of
// the process, opened on first actual use rather than at import time —
// lazy avoids paying for it in any process that imports this module
// without ever serving a public mural request.
let cached: { db: DatabaseSync; getDocumentStmt: ReturnType<DatabaseSync["prepare"]> } | null = null;
function getStatements() {
  if (!cached) {
    const db = openLibraryDb();
    cached = { db, getDocumentStmt: db.prepare(`SELECT data FROM library_documents WHERE user_id = ?`) };
  }
  return cached;
}

const EMPTY_RESULT: ResolvedPublicData = { books: [], highlights: [], currentlyReading: [], stats: {} };

export function resolvePublicLibraryData(userId: string, req: PublicDataRequest): ResolvedPublicData {
  const row = getStatements().getDocumentStmt.get(userId) as { data: string } | undefined;
  if (!row) return EMPTY_RESULT;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return EMPTY_RESULT;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.books)) return EMPTY_RESULT;

  // The full, private book list — read in full so currentlyReading/stats
  // below can be computed correctly (see this file's own top comment),
  // but this array itself is never part of the returned ResolvedPublicData.
  const allBooks = parsed.books.filter(isRecord);

  const byKey = new Map<string, Record<string, unknown>>();
  for (const book of allBooks) {
    byKey.set(bookKey(book), book);
  }

  // Resolve requested book references against the map — anything that
  // doesn't resolve (a stale bookKey from a deleted/merged-away book) is
  // silently skipped, same tolerant convention frontend/src/lib/murals.ts's
  // own resolveShelfBooks/resolveQuote already use.
  const books: PublicBookData[] = [];
  for (const key of req.bookKeys) {
    const book = byKey.get(key);
    if (book) books.push(toPublicBookData(book));
  }

  const highlights: PublicHighlight[] = [];
  for (const ref of req.highlightRefs) {
    const book = byKey.get(ref.bookKey);
    if (!book) continue;
    const bookHighlights = Array.isArray(book.highlights) ? book.highlights.filter(isRecord) : [];
    // Matches on BookmarkID exactly like resolveQuote does in
    // frontend/src/lib/murals.ts: `String(h.BookmarkID) === highlightId`.
    const highlight = bookHighlights.find((h) => String(h.BookmarkID) === ref.highlightId);
    if (!highlight) continue;
    highlights.push({
      bookKey: ref.bookKey,
      highlightId: ref.highlightId,
      text: typeof highlight.Text === "string" ? highlight.Text : "",
      annotation: typeof highlight.Annotation === "string" && highlight.Annotation ? highlight.Annotation : null
    });
  }

  // --- Critical for privacy: currentlyReading and every stats metric are
  // computed against `allBooks` — the REAL, FULL private book list — not
  // against `books` (the already-filtered, referenced-only subset above).
  // That's intentional: both block types reflect the entire library by
  // design (see muralStats.ts's own computeStat and
  // CurrentlyReadingBlockView's `books.filter(b => b.ReadStatus === 1)`),
  // so filtering to referenced books first would silently produce wrong
  // numbers. `allBooks` is only ever read here to derive a redacted
  // subset (currentlyReading, mapped through toPublicBookData same as
  // `books` above) or plain counts (stats) — it is never itself returned.
  const currentlyReading = req.needsCurrentlyReading ? allBooks.filter(isInProgress).map(toPublicBookData) : [];

  const stats: Record<string, number> = {};
  if (req.statsMetrics.length > 0) {
    const now = new Date();
    for (const metric of req.statsMetrics) {
      const value = computeStat(metric, allBooks, now);
      if (value !== null) stats[metric] = value;
    }
  }

  return { books, highlights, currentlyReading, stats };
}
