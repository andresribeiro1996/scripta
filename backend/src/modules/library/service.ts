// Business logic for the library module. Depends only on the
// LibraryRepository port, not on SQLite — same reasoning as
// modules/auth/service.ts.

import { createHash, randomUUID } from "node:crypto";
import { applyLibraryChange, bookKey, bookMatchKeys, buildManualBook, calculateShelfTheme, isCertainMatch, isFinishedBook, isGroup, localDay, mergeDuplicateBooks, normalizeIsbn, publicReaderCardOf, readerIdentity, seedCoverLookup, setReadStatus, type CoverLookupParams, type IdentityKey, type LibraryChange, type LibraryChangeAnswer, type LibraryData } from "@scripta/shared";
import type { BookRecommendationInput } from "@scripta/shared/community";
import { BOOK_EVENTS_PER_SAVE, COVER_URL_MAX_LENGTH, DISPLAY_TEXT_MAX_LENGTH, LIBRARY_MATCH_BOOK_CAP, LIBRARY_PUT_HEADROOM_BYTES, LIBRARY_ROWS_VERSION, MATCH_KEY_MAX_LENGTH } from "./domain/constants.js";
import { LibraryChangeNotFoundError, LibraryConflictError, LibraryTooLargeError, NoLibraryDocumentError } from "./domain/errors.js";
import type { LibraryRepository } from "./domain/ports.js";
import type { LibraryBookRow, LibraryBookRows, LibraryDerived, LibraryDocument, LibraryDocumentRow, LibraryDocumentText, LibraryHighlightRow, LibraryMatchKeyRow, LibraryRows, LibrarySmallSave } from "./domain/types.js";
import { canonicalWorks as canonicalCatalogWorks, resolveWorks as resolveCatalogWorks } from "../books/index.js";
import { canonicalWorkIds, WorkResolutionError } from "./works.js";
import { libraryParts, resolvePublicLibrary, toReaderGroups } from "./publicResolver.js";

export type BookEvent = { type: "book_added" | "book_finished"; refId: string; payload: Record<string, unknown> };

export type EmitBookEvents = (userId: string, events: BookEvent[]) => void;

export type EnqueueCovers = (lookups: CoverLookupParams[]) => void;

export type RekeyBooks = (userId: string, fromKeys: string[], toKey: string) => void;

export type LogError = (error: unknown, message: string) => void;

export type ResolveWorks = (lookups: Array<{ isbn: string | null; title: string | null; author: string | null }>) => Array<string | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function withoutClientTags<T>(book: T): T {
  if (!isRecord(book) || Array.isArray(book)) return book;
  const { _key, _workId, ...rest } = book;
  return rest as T;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function textFields(book: Record<string, unknown>): Record<string, unknown> {
  return {
    ReadStatus: book.ReadStatus,
    Title: text(book.Title),
    Attribution: text(book.Attribution),
    ISBN: text(book.ISBN),
    ContentID: text(book.ContentID),
    _genres: book._genres,
    _coverUrl: text(book._coverUrl),
    highlights: Array.isArray(book.highlights) ? book.highlights.filter(isRecord).map((mark) => ({ Type: mark.Type, Text: text(mark.Text), Annotation: text(mark.Annotation) })) : undefined
  };
}

function settledGlyph(books: Record<string, unknown>[], groupRecords: Record<string, unknown>[]): IdentityKey | null {
  const identity = readerIdentity(books, toReaderGroups(groupRecords));
  return identity.state === "settled" ? identity.identity : null;
}

export function deriveGlyph(data: unknown): IdentityKey | null {
  const parts = libraryParts(data);
  return parts ? settledGlyph(parts.allBooks.map(textFields), parts.groupRecords) : null;
}

export function deriveLibraryData(data: unknown): LibraryDerived {
  const parts = libraryParts(data);
  if (!parts) return { glyph: null, keys: [] };
  const books = parts.allBooks.map(textFields);
  const emitted = new Set<string>();
  const keys: LibraryMatchKeyRow[] = [];
  books.slice(0, LIBRARY_MATCH_BOOK_CAP).forEach((book, bookRef) => {
    for (const key of bookMatchKeys(book)) {
      if (key.length > MATCH_KEY_MAX_LENGTH || emitted.has(key)) continue;
      emitted.add(key);
      keys.push({
        key,
        book_ref: bookRef,
        title: String(book.Title ?? "").slice(0, DISPLAY_TEXT_MAX_LENGTH),
        author: String(book.Attribution ?? "").slice(0, DISPLAY_TEXT_MAX_LENGTH),
        isbn: normalizeIsbn(book.ISBN) || null,
        cover: typeof book._coverUrl === "string" && book._coverUrl.length <= COVER_URL_MAX_LENGTH && /^https?:\/\//.test(book._coverUrl) ? book._coverUrl : null
      });
    }
  });
  return { glyph: settledGlyph(books, parts.groupRecords), keys };
}

export type ReportSkippedRow = (error: TypeError, what: string) => void;

function number(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function finishedYear(book: Record<string, unknown>): number | null {
  if (!isFinishedBook(book)) return null;
  const raw = book.DateLastRead;
  if (typeof raw !== "string" || !raw) return null;
  const year = new Date(raw).getFullYear();
  return Number.isNaN(year) ? null : year;
}

export function bookRowHash(book: Record<string, unknown>, rowsVersion = LIBRARY_ROWS_VERSION): string {
  return createHash("sha256").update(`${rowsVersion}:${JSON.stringify(book)}`).digest("hex");
}

export function bookRow(book: Record<string, unknown>, position: number, report: ReportSkippedRow, rowsVersion = LIBRARY_ROWS_VERSION): LibraryBookRows {
  const highlights: LibraryHighlightRow[] = [];
  const marks = Array.isArray(book.highlights) ? book.highlights : [];
  const key = bookKey(book);
  marks.forEach((mark, index) => {
    if (!isRecord(mark)) return;
    let id: string;
    try {
      id = String(mark.BookmarkID);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      report(error, `no row for highlight ${index} of book ${position}`);
      return;
    }
    highlights.push({ highlight_id: id, text: text(mark.Text) ?? null, annotation: text(mark.Annotation) ?? null });
  });
  return {
    book: {
      position,
      book_key: key,
      title: text(book.Title) ?? null,
      author: text(book.Attribution) ?? null,
      isbn: text(book.ISBN) ?? null,
      image_id: text(book.ImageId) ?? null,
      read_status: number(book.ReadStatus),
      series_number: number(book.SeriesNumber),
      sort_order: number(book._order),
      cover_url: text(book._coverUrl) ?? null,
      finished_year: finishedYear(book),
      work_id: null,
      row_hash: bookRowHash(book, rowsVersion)
    },
    highlights
  };
}

export function libraryMeta(data: Record<string, unknown>): string {
  return JSON.stringify({ source: data.source, schema_version: data.schema_version, book_count: data.book_count, name: data.name, groups: data.groups, style: data.style });
}

export function readerCardOf(parts: { allBooks: Record<string, unknown>[]; groupRecords: Record<string, unknown>[] }, report: ReportSkippedRow): string | null {
  try {
    return JSON.stringify(publicReaderCardOf(parts.allBooks, toReaderGroups(parts.groupRecords)));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    report(error, "no reader card");
    return null;
  }
}

export function deriveLibraryRows(data: unknown, report: ReportSkippedRow, rowsVersion = LIBRARY_ROWS_VERSION): LibraryRows {
  const parts = libraryParts(data);
  if (!parts) return { books: [], summary: { meta: null, reader_card: null, shelf_theme: null, total_books: 0, finished_count: 0, in_progress_count: 0, total_highlights: 0 } };
  const doc = data as Record<string, unknown>;
  const books: LibraryBookRows[] = [];
  (doc.books as unknown[]).forEach((book, position) => {
    if (!isRecord(book)) return;
    try {
      books.push(bookRow(book, position, report, rowsVersion));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      report(error, `no row for book ${position}`);
    }
  });
  const readerCard = readerCardOf(parts, report);
  return {
    books,
    summary: {
      meta: libraryMeta(doc),
      reader_card: readerCard,
      shelf_theme: JSON.stringify(calculateShelfTheme(parts.allBooks)),
      total_books: parts.allBooks.length,
      finished_count: parts.allBooks.filter(isFinishedBook).length,
      in_progress_count: parts.allBooks.filter((book) => book.ReadStatus === 1).length,
      total_highlights: parts.allBooks.reduce((sum, book) => sum + (Array.isArray(book.highlights) ? book.highlights.length : 0), 0)
    }
  };
}

function bookPayload(book: Record<string, unknown>, status: number, workId: string | null): Record<string, unknown> {
  return {
    title: String(book.Title ?? ""),
    author: String(book.Attribution ?? ""),
    isbn: book.ISBN == null ? null : String(book.ISBN),
    coverUrl: typeof book._coverUrl === "string" ? book._coverUrl : null,
    status,
    workId
  };
}

function contentId(book: Record<string, unknown>): string {
  return String(book.ContentID ?? "");
}

function diffBookEvents(previous: unknown, data: unknown, workOf: (book: Record<string, unknown>) => string | null): BookEvent[] {
  const prevBooks = new Map<string, Record<string, unknown>>();
  if (isRecord(previous) && Array.isArray(previous.books)) {
    for (const book of previous.books) {
      if (!isRecord(book)) continue;
      const key = contentId(book);
      if (key) prevBooks.set(key, book);
    }
  }
  const nextBooks = isRecord(data) && Array.isArray(data.books) ? data.books : [];
  const events: BookEvent[] = [];
  for (const book of nextBooks) {
    if (!isRecord(book)) continue;
    const refId = contentId(book);
    if (!refId) continue;
    const status = Number(book.ReadStatus ?? 0);
    const prev = prevBooks.get(refId);
    if (!prev) {
      events.push({ type: "book_added", refId, payload: bookPayload(book, status, workOf(book)) });
    } else if (Number(prev.ReadStatus ?? 0) !== 2 && status === 2) {
      events.push({ type: "book_finished", refId, payload: bookPayload(book, status, workOf(book)) });
    }
  }
  return events;
}

function parseStoredLibrary(row: LibraryDocumentRow): LibraryData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch (error) {
    throw new Error("Stored library document is unreadable; refusing to rewrite it.", { cause: error });
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.books)) throw new Error("Stored library document is unreadable; refusing to rewrite it.");
  return { ...parsed, books: parsed.books.map(withoutClientTags) } as LibraryData;
}

function flippedBooks(before: LibraryData, after: LibraryData): Array<Record<string, unknown>> {
  return after.books.filter((book, i) => book !== before.books[i] && isFinishedBook(book) !== isFinishedBook(before.books[i]!));
}

function seriesGroupChanged(before: LibraryData, after: LibraryData): boolean {
  return (after.groups ?? []).some((group, i) => group !== before.groups?.[i] && isGroup(group) && group.type === "series");
}

function toLibraryDocument(row: LibraryDocumentRow, publicUrlFor: (token: string) => string, works: Record<string, string>): LibraryDocument {
  return {
    data: JSON.parse(row.data),
    updatedAt: row.updated_at,
    shareToken: row.share_token,
    shareUrl: row.share_token ? publicUrlFor(row.share_token) : null,
    works
  };
}

function toLibraryDocumentText(row: LibraryDocumentRow, publicUrlFor: (token: string) => string, works: Record<string, string>): LibraryDocumentText {
  return {
    data: row.data,
    updatedAt: row.updated_at,
    shareToken: row.share_token,
    shareUrl: row.share_token ? publicUrlFor(row.share_token) : null,
    works
  };
}

export type CanonicalWorks = (ids: string[]) => Map<string, string>;

export interface LibraryService {
  getLibrary(userId: string): LibraryDocument | null;
  getLibraryText(userId: string): LibraryDocumentText | null;
  saveLibrary(userId: string, data: unknown, expectedUpdatedAt?: string, source?: "import"): LibraryDocumentText;
  /** Same-shelf book upsert behind POST /library/books: matches an
   *  existing book with the shared certain-match rule and updates its
   *  reading status in place — or appends a manual: book when nothing
   *  matches. `updated` distinguishes "matched and re-shelved" from
   *  "appended". */
  addBook(userId: string, input: BookRecommendationInput): { key: string; updated: boolean };
  mergeBooks(userId: string, keep: string, merge: string[], expectedUpdatedAt: string): LibraryDocumentText;
  applyChange(userId: string, change: LibraryChange): LibraryChangeAnswer;
  /** Idempotent: a document that's already shared keeps its existing
   *  token rather than minting a new one, so a re-opened share modal (or
   *  a retried request) never invalidates a link someone already has.
   *  Throws NoLibraryDocumentError if this user has no library document
   *  yet — there's nothing to share. */
  share(userId: string): LibraryDocument;
  unshare(userId: string): void;
  /** Backs the public GET /library/shared/:token route. Returns null for
   *  an unknown OR no-longer-shared token — routes.ts turns that into a
   *  404 either way, so an unshared link and a never-valid one look
   *  identical from the outside. The returned `data` is ALREADY redacted:
   *  it is built from the public columns of the library rows only; this is
   *  the one place a stranger can reach a user's library data with no
   *  session at all. */
  getPublicByToken(token: string): { data: unknown } | null;
}

function coverLookupsOf(data: unknown): CoverLookupParams[] {
  const books = isRecord(data) && Array.isArray(data.books) ? data.books : [];
  return books.filter(isRecord).flatMap((book) => seedCoverLookup(book) ?? []);
}

export function createLibraryService(repo: LibraryRepository, publicUrlFor: (token: string) => string, maxDocumentBytes: number, emitBookEvents?: EmitBookEvents, enqueueCovers?: EnqueueCovers, rekeyBooks?: RekeyBooks, logError?: LogError, resolveWorks: ResolveWorks = resolveCatalogWorks, canonicalWorks: CanonicalWorks = canonicalCatalogWorks): LibraryService {
  const logSkipped = logError ?? ((error: unknown, message: string) => console.error(message, error));

  function rowsOf(userId: string, data: unknown): LibraryRows {
    return deriveLibraryRows(data, (error, what) => logSkipped(error, `library rows of ${userId}: ${what}`));
  }

  function withWorks(userId: string, books: LibraryBookRow[]): void {
    const stored = repo.rowHashes(userId);
    const pending = books.filter((book) => stored.get(book.position) !== book.row_hash);
    if (pending.length === 0) return;
    try {
      const ids = resolveWorks(pending.map((book) => ({ isbn: book.isbn, title: book.title, author: book.author })));
      pending.forEach((book, index) => { book.work_id = ids[index] ?? null; });
    } catch (error) {
      logSkipped(error, `work resolve failed for ${userId} (${pending.length} books)`);
    }
  }

  function rowsWithWorks(userId: string, data: unknown): LibraryRows {
    const rows = rowsOf(userId, data);
    withWorks(userId, rows.books.map(({ book }) => book));
    return rows;
  }

  function worksOf(userId: string): Record<string, string> {
    const rows = repo.workIds(userId);
    let canonical = new Map<string, string>();
    try {
      canonical = canonicalWorkIds(rows.map((row) => row.work_id), canonicalWorks);
    } catch (error) {
      if (!(error instanceof WorkResolutionError)) throw error;
      logSkipped(error, `work canonical lookup failed for ${userId}`);
    }
    const works: Record<string, string> = {};
    for (const row of rows) works[row.book_key] ??= canonical.get(row.work_id) ?? row.work_id;
    return works;
  }

  function workOfUser(userId: string): (book: Record<string, unknown>) => string | null {
    const works = worksOf(userId);
    return (book) => works[bookKey(book)] ?? null;
  }

  function smallSave(userId: string, previous: LibraryData, next: LibraryData, change: LibraryChange, recomputeCard: boolean): LibrarySmallSave {
    const report: ReportSkippedRow = (error, what) => logSkipped(error, `library rows of ${userId}: ${what}`);
    const books: LibraryBookRow[] = [];
    const counts = { finished: 0, inProgress: 0 };
    next.books.forEach((book, position) => {
      if (!isRecord(book)) return;
      if (isFinishedBook(book)) counts.finished++;
      if (book.ReadStatus === 1) counts.inProgress++;
      if (change.kind === "book" && book !== previous.books[position]) books.push(bookRow(book, position, report).book);
    });
    return {
      books,
      counts,
      meta: change.kind === "membership" ? libraryMeta(next as Record<string, unknown>) : "keep",
      readerCard: recomputeCard ? readerCardOf(libraryParts(next)!, report) : "keep"
    };
  }

  function serializeWithinLimit(document: unknown): string {
    const json = JSON.stringify(document);
    if (Buffer.byteLength(json) > maxDocumentBytes - LIBRARY_PUT_HEADROOM_BYTES) throw new LibraryTooLargeError();
    return json;
  }

  return {
    getLibrary(userId) {
      const row = repo.getDocument(userId);
      if (!row) return null;
      return toLibraryDocument(row, publicUrlFor, worksOf(userId));
    },

    getLibraryText(userId) {
      const row = repo.getDocument(userId);
      if (!row) return null;
      return toLibraryDocumentText(row, publicUrlFor, worksOf(userId));
    },

    saveLibrary(userId, input, expectedUpdatedAt, source) {
      const data = isRecord(input) && Array.isArray(input.books) ? { ...input, books: input.books.map(withoutClientTags) } : input;
      const previous = source === "import" ? undefined : repo.getDocument(userId);
      const row = repo.upsertDocument(userId, JSON.stringify(data), deriveLibraryData(data), rowsWithWorks(userId, data), expectedUpdatedAt);
      if (!row) throw new LibraryConflictError();
      const works = worksOf(userId);
      if (previous !== undefined && emitBookEvents) {
        try {
          const events = diffBookEvents(JSON.parse(previous.data), data, (book) => works[bookKey(book)] ?? null).slice(0, BOOK_EVENTS_PER_SAVE);
          if (events.length > 0) emitBookEvents(userId, events);
        } catch (error) {
          logError?.(error, "book events failed after a library save");
        }
      }
      if (source === "import" && enqueueCovers) enqueueCovers(coverLookupsOf(data));
      return toLibraryDocumentText(row, publicUrlFor, works);
    },

    addBook(userId, input) {
      const row = repo.getDocument(userId);
      let doc: Record<string, unknown>;
      if (row) {
        try {
          const parsed: unknown = JSON.parse(row.data);
          if (isRecord(parsed)) doc = parsed;
          else throw new Error();
        } catch {
          throw new Error("Stored library document is unreadable; refusing to rewrite it.");
        }
      } else {
        doc = { books: [] };
      }
      const books = Array.isArray(doc.books) ? doc.books : [];
      const incoming = { Title: input.title, Attribution: input.author, ISBN: input.isbn ?? "" };
      const match = books.find((b): b is Record<string, unknown> => isRecord(b) && isCertainMatch(b, incoming));

      if (match) {
        const key = contentId(match);
        if (Number(match.ReadStatus ?? 0) === input.readStatus) return { key, updated: false };
        const updatedBook = setReadStatus(match, input.readStatus, input.day ?? localDay());
        const reshelved = { ...doc, books: books.map((b) => (b === match ? updatedBook : b)) };
        const saved = repo.upsertDocument(userId, serializeWithinLimit(reshelved), deriveLibraryData(reshelved), rowsWithWorks(userId, reshelved), row?.updated_at);
        if (!saved) throw new LibraryConflictError();
        if (input.readStatus === 2 && emitBookEvents) {
          try {
            emitBookEvents(userId, [{ type: "book_finished", refId: key, payload: bookPayload(updatedBook, input.readStatus, workOfUser(userId)(updatedBook)) }]);
          } catch (error) {
            logError?.(error, "book events failed after a library save");
          }
        }
        return { key, updated: true };
      }

      const id = randomUUID();
      const built = buildManualBook(
        {
          title: input.title,
          author: input.author,
          isbn: input.isbn ?? "",
          publisher: null,
          readStatus: input.readStatus,
          rating: null,
          dateRead: input.readStatus === 2 ? (input.day ?? localDay()) : null
        },
        id
      );
      const book = input.coverUrl ? { ...built, _coverUrl: input.coverUrl } : built;
      const appended = { ...doc, books: [...books, book] };
      const saved = repo.upsertDocument(userId, serializeWithinLimit(appended), deriveLibraryData(appended), rowsWithWorks(userId, appended), row?.updated_at);
      if (!saved) throw new LibraryConflictError();
      if (emitBookEvents) {
        try {
          emitBookEvents(userId, [{ type: "book_added", refId: `manual:${id}`, payload: bookPayload(book, input.readStatus, workOfUser(userId)(book)) }]);
        } catch (error) {
          logError?.(error, "book events failed after a library save");
        }
      }
      return { key: `manual:${id}`, updated: false };
    },

    mergeBooks(userId, keep, merge, expectedUpdatedAt) {
      const row = repo.getDocument(userId);
      if (!row) throw new NoLibraryDocumentError();
      const library = parseStoredLibrary(row);
      const next = mergeDuplicateBooks(library, keep, merge);
      if (next === library) return toLibraryDocumentText(row, publicUrlFor, worksOf(userId));
      if (row.updated_at !== expectedUpdatedAt) throw new LibraryConflictError();
      const json = serializeWithinLimit(next);
      const present = new Set(library.books.filter(isRecord).map(bookKey));
      const fromKeys = merge.filter((key) => key !== keep && present.has(key));
      if (fromKeys.length > 0 && rekeyBooks) rekeyBooks(userId, fromKeys, keep);
      const saved = repo.upsertDocument(userId, json, deriveLibraryData(next), rowsWithWorks(userId, next), row.updated_at);
      if (!saved) throw new LibraryConflictError();
      return toLibraryDocumentText(saved, publicUrlFor, worksOf(userId));
    },

    applyChange(userId, input) {
      const change = input.kind === "add" ? { ...input, book: withoutClientTags(input.book) } : input;
      const row = repo.getDocument(userId);
      if (!row && change.kind !== "add") throw new NoLibraryDocumentError();
      const previous: LibraryData = row ? parseStoredLibrary(row) : { books: [] };
      const result = applyLibraryChange(previous, change);
      if ("error" in result) throw new LibraryChangeNotFoundError(result.error);
      if (row && !result.changed) return { updatedAt: row.updated_at, baseUpdatedAt: row.updated_at };
      const json = serializeWithinLimit(result.data);
      const flipped = change.kind === "book" ? flippedBooks(previous, result.data) : [];
      const glyph = flipped.length > 0 || (change.kind === "membership" && seriesGroupChanged(previous, result.data)) ? deriveGlyph(result.data) : "keep";
      const small = row && change.kind !== "add" ? smallSave(userId, previous, result.data, change, glyph !== "keep") : undefined;
      if (small) withWorks(userId, small.books);
      const updatedAt =
        small
          ? repo.updateDocumentData(userId, json, row!.updated_at, glyph, small)
          : repo.upsertDocument(userId, json, deriveLibraryData(result.data), rowsWithWorks(userId, result.data), row?.updated_at)?.updated_at;
      if (!updatedAt) throw new LibraryConflictError();
      if (emitBookEvents && (change.kind === "add" || flipped.some(isFinishedBook))) {
        try {
          const events = diffBookEvents(previous, result.data, workOfUser(userId)).slice(0, BOOK_EVENTS_PER_SAVE);
          if (events.length > 0) emitBookEvents(userId, events);
        } catch (error) {
          logError?.(error, "book events failed after a library save");
        }
      }
      return { updatedAt, baseUpdatedAt: row?.updated_at ?? null };
    },

    share(userId) {
      const existing = repo.getDocument(userId);
      if (!existing) throw new NoLibraryDocumentError();
      if (existing.share_token) return toLibraryDocument(existing, publicUrlFor, worksOf(userId));

      const row = repo.setShareToken(userId, randomUUID());
      // Can only be undefined if the row vanished between the getDocument
      // above and here — nothing in this module deletes library
      // documents, so this is unreachable in practice, but keeps the
      // return type honest rather than asserting non-null.
      if (!row) throw new NoLibraryDocumentError();
      return toLibraryDocument(row, publicUrlFor, worksOf(userId));
    },

    unshare(userId) {
      repo.setShareToken(userId, null);
    },

    getPublicByToken(token) {
      const owner = repo.getShareOwner(token);
      if (!owner) return null;
      const data = resolvePublicLibrary(owner);
      return data ? { data } : null;
    }
  };
}
