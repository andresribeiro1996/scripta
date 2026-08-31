// Business logic for the library module. Depends only on the
// LibraryRepository port, not on SQLite — same reasoning as
// modules/auth/service.ts.
//
// The document API below (getLibrary/saveLibrary) is a COMPATIBILITY
// LAYER over the normalised entities: the frontend still speaks the whole
// -library-document shape, so this assembles it on read and decomposes it
// on write. Slice 2 adds per-entity operations alongside it and moves the
// frontend across; slice 3 deletes this pair. See
// docs/DEPLOYMENT-PLAN.md.

import { toContents, toDocument } from "./domain/document.js";
import type { LibraryRepository } from "./domain/ports.js";
import type { LibraryDocument } from "./domain/types.js";

export interface LibraryService {
  getLibrary(userId: string): LibraryDocument | null;
  saveLibrary(userId: string, data: unknown): LibraryDocument;
}

export function createLibraryService(repo: LibraryRepository): LibraryService {
  return {
    getLibrary(userId) {
      const contents = repo.getContents(userId);
      if (!contents) return null;
      return {
        data: toDocument(contents),
        updatedAt: contents.settings.updatedAt,
        version: contents.settings.version
      };
    },

    saveLibrary(userId, data) {
      // Monotonic per account, so slice 2's optimistic-concurrency check
      // has something meaningful to compare against from day one.
      const nextVersion = (repo.getVersion(userId) ?? 0) + 1;
      const updatedAt = new Date().toISOString();
      const contents = toContents(data, nextVersion, updatedAt);
      repo.replaceContents(userId, contents);
      return { data: toDocument(contents), updatedAt, version: nextVersion };
    }
  };
}
