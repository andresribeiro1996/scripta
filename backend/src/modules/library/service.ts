// Business logic for the library module. Depends only on the
// LibraryRepository port, not on SQLite — same reasoning as
// modules/auth/service.ts.

import { randomUUID } from "node:crypto";
// Cross-module dependency, same discipline as modules/murals/routes.ts
// importing resolvePublicLibraryData only from library/index.ts:
// peekCachedCoverUrl is covers' own public surface for a synchronous,
// cache-only cover lookup — never covers' internals. See
// publicResolver.ts's own top comment (which already uses this for
// mural sharing) for why a public, unauthenticated resolver may use this
// but not the authGuard'd, network-calling GET /covers/resolve path.
import { peekCachedCoverUrl } from "../covers/index.js";
import { NoLibraryDocumentError } from "./domain/errors.js";
import type { LibraryRepository } from "./domain/ports.js";
import type { LibraryDocument, LibraryDocumentRow } from "./domain/types.js";
import { normalizeImageId, normalizeIsbn } from "./publicResolver.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The ONLY fields of a private book object that ever reach an anonymous
 *  visitor of GET /library/shared/:token. Read from frontend/src/pages/
 *  SharedLibraryPage.tsx, components/BookCard.tsx, lib/libraryOrder.ts
 *  and lib/groups.ts to determine exactly what that page renders/needs:
 *
 *   - Title, Attribution, ReadStatus — rendered directly on the card.
 *   - ISBN, ImageId — needed by lib/merge.ts's bookKey() (isbn-keyed when
 *     present) so this book still matches its own entries in `data.groups`
 *     (series/collections reference books by bookKey, not by index) —
 *     and by CoverImage's own cover-resolution fallback.
 *   - _coverUrl — a manual gallery-cover override, or (via
 *     peekCachedCoverUrl below) an already-cached auto-resolved cover; see
 *     that function's own comment for why this doesn't need a live network
 *     call. Kept even when null/absent so CoverImage falls back to its own
 *     (401ing, for an anonymous visitor) resolve call — same intentional
 *     "no cover" outcome a book with a genuine cache miss already has.
 *   - SeriesNumber, _order — the two fields lib/libraryOrder.ts's
 *     buildUnits()/orderedGroupBooks() actually read to reproduce the same
 *     series-clustered display order the authenticated LibraryPage uses.
 *
 *  Deliberately dropped: `highlights` (a reader's private notes/quotes —
 *  Text/Annotation), ContentID, ___PercentRead, DateLastRead, `_style`/
 *  `_coverImageId` (only ever read by the Style/Cover buttons, which
 *  SharedLibraryPage never renders — it passes neither onOpenStyle nor
 *  onOpenCoverPicker), `Series` (only used by the frontend's own
 *  auto-seeding on import, never at display time), and every other raw
 *  Kobo/Goodreads field — nothing outside the list above, ever. */
function toPublicLibraryBook(book: Record<string, unknown>): Record<string, unknown> {
  const isbn = normalizeIsbn(book.ISBN) || null;
  const imageId = normalizeImageId(book.ImageId) || null;
  const manualCoverUrl = typeof book._coverUrl === "string" ? book._coverUrl : null;
  return {
    Title: typeof book.Title === "string" ? book.Title : undefined,
    Attribution: typeof book.Attribution === "string" ? book.Attribution : undefined,
    ISBN: typeof book.ISBN === "string" ? book.ISBN : undefined,
    ImageId: typeof book.ImageId === "string" ? book.ImageId : undefined,
    ReadStatus: typeof book.ReadStatus === "number" ? book.ReadStatus : undefined,
    SeriesNumber: typeof book.SeriesNumber === "number" ? book.SeriesNumber : undefined,
    _order: typeof book._order === "number" ? book._order : undefined,
    _coverUrl: manualCoverUrl ?? peekCachedCoverUrl({ isbn, imageId })
  };
}

/** Projects a full private library document down to the public-safe shape
 *  GET /library/shared/:token actually returns — see toPublicLibraryBook's
 *  own comment for the per-book field allowlist. `name`/`groups`/`style`
 *  (plus the exporter's own `source`/`schema_version`/`book_count`
 *  metadata) pass through unchanged: none of them carry private per-book
 *  content the way the raw `books` array does, and SharedLibraryPage.tsx
 *  needs `name`/`groups`/`style` verbatim to render the same grouped/
 *  styled view the authenticated LibraryPage uses. Builds a NEW object —
 *  never mutates `doc` or anything reachable from it, so this can never
 *  accidentally write a redacted/peeked value back into the private,
 *  stored document. */
function toPublicLibraryData(doc: Record<string, unknown>): Record<string, unknown> {
  const books = Array.isArray(doc.books) ? doc.books.filter(isRecord).map(toPublicLibraryBook) : [];
  return {
    source: doc.source,
    schema_version: doc.schema_version,
    book_count: doc.book_count,
    name: doc.name,
    groups: doc.groups,
    style: doc.style,
    books
  };
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
  saveLibrary(userId: string, data: unknown): LibraryDocument;
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

export function createLibraryService(repo: LibraryRepository, publicUrlFor: (token: string) => string): LibraryService {
  return {
    getLibrary(userId) {
      const row = repo.getDocument(userId);
      if (!row) return null;
      return toLibraryDocument(row, publicUrlFor);
    },

    saveLibrary(userId, data) {
      const row = repo.upsertDocument(userId, JSON.stringify(data));
      return toLibraryDocument(row, publicUrlFor);
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
      const parsed: unknown = JSON.parse(row.data);
      if (!isRecord(parsed)) return { data: parsed };
      return { data: toPublicLibraryData(parsed) };
    }
  };
}
