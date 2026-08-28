// Business logic for the library module. Depends only on the
// LibraryRepository port, not on SQLite — same reasoning as
// modules/auth/service.ts.

import type { LibraryRepository } from "./domain/ports.js";
import type { LibraryDocument } from "./domain/types.js";

export interface LibraryService {
  getLibrary(userId: string): LibraryDocument | null;
  saveLibrary(userId: string, data: unknown): LibraryDocument;
}

export function createLibraryService(repo: LibraryRepository): LibraryService {
  return {
    getLibrary(userId) {
      const row = repo.getDocument(userId);
      if (!row) return null;
      return { data: JSON.parse(row.data), updatedAt: row.updated_at };
    },

    saveLibrary(userId, data) {
      const row = repo.upsertDocument(userId, JSON.stringify(data));
      return { data, updatedAt: row.updated_at };
    }
  };
}
