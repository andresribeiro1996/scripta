// Business logic for the library module. Depends only on the
// LibraryRepository port, not on SQLite — same reasoning as
// modules/auth/service.ts.

import { randomUUID } from "node:crypto";
import { bookKey, bookMatchKeys, buildManualBook, isCertainMatch, localDay, mergeDuplicateBooks, readerIdentity, seedCoverLookup, setReadStatus, type CoverLookupParams, type LibraryData } from "@scripta/shared";
import type { BookRecommendationInput } from "@scripta/shared/community";
import { COVER_URL_MAX_LENGTH, DISPLAY_TEXT_MAX_LENGTH, LIBRARY_MATCH_BOOK_CAP, MATCH_KEY_MAX_LENGTH } from "./domain/constants.js";
import { LibraryConflictError, NoLibraryDocumentError } from "./domain/errors.js";
import type { LibraryRepository } from "./domain/ports.js";
import type { LibraryDerived, LibraryDocument, LibraryDocumentRow, LibraryMatchKeyRow } from "./domain/types.js";
import { libraryParts, normalizeIsbn, toPublicLibraryData, toReaderGroups } from "./publicResolver.js";

export type BookEvent = { type: "book_added" | "book_finished"; refId: string; payload: Record<string, unknown> };

export type EmitBookEvents = (userId: string, events: BookEvent[]) => void;

export type EnqueueCovers = (lookups: CoverLookupParams[]) => void;

export type RekeyBooks = (userId: string, fromKeys: string[], toKey: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

export function deriveLibraryData(data: unknown): LibraryDerived {
  const parts = libraryParts(data);
  if (!parts) return { glyph: null, keys: [] };
  const books = parts.allBooks.map(textFields);
  const identity = readerIdentity(books, toReaderGroups(parts.groupRecords));
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
  return { glyph: identity.state === "settled" ? identity.identity : null, keys };
}

function bookPayload(book: Record<string, unknown>, status: number): Record<string, unknown> {
  return {
    title: String(book.Title ?? ""),
    author: String(book.Attribution ?? ""),
    isbn: book.ISBN == null ? null : String(book.ISBN),
    coverUrl: typeof book._coverUrl === "string" ? book._coverUrl : null,
    status
  };
}

function contentId(book: Record<string, unknown>): string {
  return String(book.ContentID ?? "");
}

function diffBookEvents(previous: string, data: unknown): BookEvent[] {
  const prevParsed: unknown = JSON.parse(previous);
  const prevBooks = new Map<string, Record<string, unknown>>();
  if (isRecord(prevParsed) && Array.isArray(prevParsed.books)) {
    for (const book of prevParsed.books) {
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
      events.push({ type: "book_added", refId, payload: bookPayload(book, status) });
    } else if (Number(prev.ReadStatus ?? 0) !== 2 && status === 2) {
      events.push({ type: "book_finished", refId, payload: bookPayload(book, status) });
    }
  }
  return events;
}

function toLibraryDocument(row: LibraryDocumentRow, publicUrlFor: (token: string) => string): LibraryDocument {
  return {
    data: JSON.parse(row.data),
    updatedAt: row.updated_at,
    shareToken: row.share_token,
    shareUrl: row.share_token ? publicUrlFor(row.share_token) : null
  };
}

export interface LibraryService {
  getLibrary(userId: string): LibraryDocument | null;
  saveLibrary(userId: string, data: unknown, expectedUpdatedAt?: string, source?: "import"): LibraryDocument;
  /** Same-shelf book upsert behind POST /library/books: matches an
   *  existing book with the shared certain-match rule and updates its
   *  reading status in place — or appends a manual: book when nothing
   *  matches. `updated` distinguishes "matched and re-shelved" from
   *  "appended". */
  addBook(userId: string, input: BookRecommendationInput): { key: string; updated: boolean };
  mergeBooks(userId: string, keep: string, merge: string[], expectedUpdatedAt: string): LibraryDocument;
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
   *  identical from the outside. The returned `data` is ALREADY redacted
   *  via toPublicLibraryData — see that function's own comment for the
   *  privacy boundary it enforces; this is the one place a stranger can
   *  reach a user's library data with no session at all. */
  getPublicByToken(token: string): { data: unknown } | null;
}

function coverLookupsOf(data: unknown): CoverLookupParams[] {
  const books = isRecord(data) && Array.isArray(data.books) ? data.books : [];
  return books.filter(isRecord).flatMap((book) => seedCoverLookup(book) ?? []);
}

export function createLibraryService(repo: LibraryRepository, publicUrlFor: (token: string) => string, emitBookEvents?: EmitBookEvents, enqueueCovers?: EnqueueCovers, rekeyBooks?: RekeyBooks): LibraryService {
  return {
    getLibrary(userId) {
      const row = repo.getDocument(userId);
      if (!row) return null;
      return toLibraryDocument(row, publicUrlFor);
    },

    saveLibrary(userId, data, expectedUpdatedAt, source) {
      const previous = source === "import" ? undefined : repo.getDocument(userId);
      const row = repo.upsertDocument(userId, JSON.stringify(data), deriveLibraryData(data), expectedUpdatedAt);
      if (!row) throw new LibraryConflictError();
      if (previous !== undefined && emitBookEvents) {
        try {
          const events = diffBookEvents(previous.data, data);
          if (events.length > 0) emitBookEvents(userId, events);
        } catch {
          // Activity is best-effort: a diff must never fail an otherwise
          // successful save (e.g. an unparsable previous document).
        }
      }
      if (source === "import" && enqueueCovers) enqueueCovers(coverLookupsOf(data));
      return toLibraryDocument(row, publicUrlFor);
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
        const saved = repo.upsertDocument(userId, JSON.stringify(reshelved), deriveLibraryData(reshelved), row?.updated_at);
        if (!saved) throw new LibraryConflictError();
        if (input.readStatus === 2 && emitBookEvents) {
          try {
            emitBookEvents(userId, [{ type: "book_finished", refId: key, payload: bookPayload(updatedBook, input.readStatus) }]);
          } catch {
            // Same best-effort contract as the saveLibrary diff above.
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
      const saved = repo.upsertDocument(userId, JSON.stringify(appended), deriveLibraryData(appended), row?.updated_at);
      if (!saved) throw new LibraryConflictError();
      if (emitBookEvents) {
        try {
          emitBookEvents(userId, [{ type: "book_added", refId: `manual:${id}`, payload: bookPayload(book, input.readStatus) }]);
        } catch {
          // Same best-effort contract as the saveLibrary diff above.
        }
      }
      return { key: `manual:${id}`, updated: false };
    },

    mergeBooks(userId, keep, merge, expectedUpdatedAt) {
      const row = repo.getDocument(userId);
      if (!row) throw new NoLibraryDocumentError();
      const parsed: unknown = JSON.parse(row.data);
      if (!isRecord(parsed) || !Array.isArray(parsed.books)) throw new Error("Stored library document is unreadable; refusing to rewrite it.");
      const library = parsed as LibraryData;
      const next = mergeDuplicateBooks(library, keep, merge);
      if (next === library) return toLibraryDocument(row, publicUrlFor);
      if (row.updated_at !== expectedUpdatedAt) throw new LibraryConflictError();
      const present = new Set(library.books.filter(isRecord).map(bookKey));
      const fromKeys = merge.filter((key) => key !== keep && present.has(key));
      if (fromKeys.length > 0 && rekeyBooks) rekeyBooks(userId, fromKeys, keep);
      const saved = repo.upsertDocument(userId, JSON.stringify(next), deriveLibraryData(next), row.updated_at);
      if (!saved) throw new LibraryConflictError();
      return toLibraryDocument(saved, publicUrlFor);
    },

    share(userId) {
      const existing = repo.getDocument(userId);
      if (!existing) throw new NoLibraryDocumentError();
      if (existing.share_token) return toLibraryDocument(existing, publicUrlFor);

      const row = repo.setShareToken(userId, randomUUID());
      // Can only be undefined if the row vanished between the getDocument
      // above and here — nothing in this module deletes library
      // documents, so this is unreachable in practice, but keeps the
      // return type honest rather than asserting non-null.
      if (!row) throw new NoLibraryDocumentError();
      return toLibraryDocument(row, publicUrlFor);
    },

    unshare(userId) {
      repo.setShareToken(userId, null);
    },

    getPublicByToken(token) {
      const row = repo.getByShareToken(token);
      if (!row) return null;
      // Corrupt JSON in a stored row reads as "no such share" (murals'
      // shared route treats it the same way) — this is a public,
      // unauthenticated read path, not a place to 500 with parser details.
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data);
      } catch {
        return null;
      }
      if (!isRecord(parsed)) return { data: parsed };
      return { data: toPublicLibraryData(parsed) };
    }
  };
}
