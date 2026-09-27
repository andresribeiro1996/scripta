// Business logic for the library module. Depends only on the
// LibraryRepository port, not on SQLite — same reasoning as
// modules/auth/service.ts.

import { randomUUID } from "node:crypto";
import { buildManualBook, localDay, setReadStatus } from "@scripta/shared";
import type { BookRecommendationInput } from "@scripta/shared/community";
import { LibraryConflictError, NoLibraryDocumentError } from "./domain/errors.js";
import type { LibraryRepository } from "./domain/ports.js";
import type { LibraryDocument, LibraryDocumentRow } from "./domain/types.js";
import { toPublicLibraryData } from "./publicResolver.js";

export type BookEvent = { type: "book_added" | "book_finished"; refId: string; payload: Record<string, unknown> };

export type EmitBookEvents = (userId: string, events: BookEvent[]) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
   *  existing book by ISBN (trimmed), else by case-insensitive trimmed
   *  title+author, and updates its reading status in place — or appends a
   *  manual: book when nothing matches. `updated` distinguishes "matched
   *  and re-shelved" from "appended". */
  addBook(userId: string, input: BookRecommendationInput): { key: string; updated: boolean };
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

export function createLibraryService(repo: LibraryRepository, publicUrlFor: (token: string) => string, emitBookEvents?: EmitBookEvents): LibraryService {
  return {
    getLibrary(userId) {
      const row = repo.getDocument(userId);
      if (!row) return null;
      return toLibraryDocument(row, publicUrlFor);
    },

    saveLibrary(userId, data, expectedUpdatedAt, source) {
      const previous = source === "import" ? undefined : repo.getDocument(userId);
      const row = repo.upsertDocument(userId, JSON.stringify(data), expectedUpdatedAt);
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
      const norm = (s: string) => s.trim().toLowerCase();
      const needle = input.isbn?.trim() ? norm(input.isbn) : null;
      const match = books.find(
        (b): b is Record<string, unknown> =>
          isRecord(b) &&
          (needle
            ? norm(String(b.ISBN ?? "")) === needle
            : norm(String(b.Title ?? "")) === norm(input.title) && norm(String(b.Attribution ?? "")) === norm(input.author))
      );

      if (match) {
        const key = contentId(match);
        if (Number(match.ReadStatus ?? 0) === input.readStatus) return { key, updated: false };
        const updatedBook = setReadStatus(match, input.readStatus, input.day ?? localDay());
        const saved = repo.upsertDocument(userId, JSON.stringify({ ...doc, books: books.map((b) => (b === match ? updatedBook : b)) }), row?.updated_at);
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
      const saved = repo.upsertDocument(userId, JSON.stringify({ ...doc, books: [...books, book] }), row?.updated_at);
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
