// Business logic for the library module. Depends only on the
// LibraryRepository port, not on SQLite — same reasoning as
// modules/auth/service.ts.

import { randomUUID } from "node:crypto";
import { NoLibraryDocumentError } from "./domain/errors.js";
import type { LibraryRepository } from "./domain/ports.js";
import type { LibraryDocument, LibraryDocumentRow } from "./domain/types.js";

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
   *  identical from the outside. */
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
      return { data: JSON.parse(row.data) };
    }
  };
}
