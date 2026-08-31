// Business logic for the library module. Depends only on the
// LibraryRepository port, not on SQLite — same reasoning as
// modules/auth/service.ts.
//
// The document API (getLibrary/saveLibrary) is a COMPATIBILITY LAYER over
// the normalised entities: most of the frontend still speaks the
// whole-library-document shape, so this assembles it on read and
// decomposes it on write. saveMuralBlockLayout is the first per-entity
// operation to have a route in front of it — it is the hot path, fired on
// every drag. See docs/DEPLOYMENT-PLAN.md.

import { toContents, toDocument } from "./domain/document.js";
import { LibraryEntityNotFoundError, LibraryVersionConflictError } from "./domain/errors.js";
import type { BlockLayout } from "./domain/types.js";
import type { LibraryRepository } from "./domain/ports.js";
import type { LibraryDocument } from "./domain/types.js";

export interface LibraryService {
  getLibrary(userId: string): LibraryDocument | null;
  /** `expectedVersion` is the optimistic-concurrency precondition: the
   *  version the caller believes it is editing. Omit it to force the
   *  write through unconditionally (the pre-versioning behaviour, kept
   *  for the first save and for callers that genuinely mean "replace
   *  whatever is there"). */
  saveLibrary(userId: string, data: unknown, expectedVersion?: number): LibraryDocument;
  saveMuralBlockLayout(
    userId: string,
    muralId: string,
    blockId: string,
    layout: BlockLayout,
    expectedVersion?: number
  ): { version: number };
}

export function createLibraryService(repo: LibraryRepository): LibraryService {
  /** Throws if the caller is writing against a version that has since
   *  moved on. `undefined` on either side means "no precondition
   *  available" — an omitted expectation, or a user with no library yet —
   *  and is allowed through. */
  function assertVersion(userId: string, expectedVersion: number | undefined): number {
    const current = repo.getVersion(userId);
    if (expectedVersion !== undefined && current !== undefined && expectedVersion !== current) {
      throw new LibraryVersionConflictError(expectedVersion, current);
    }
    return current ?? 0;
  }

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

    saveLibrary(userId, data, expectedVersion) {
      const current = assertVersion(userId, expectedVersion);
      const nextVersion = current + 1;
      const updatedAt = new Date().toISOString();
      const contents = toContents(data, nextVersion, updatedAt);
      repo.replaceContents(userId, contents);
      return { data: toDocument(contents), updatedAt, version: nextVersion };
    },

    saveMuralBlockLayout(userId, muralId, blockId, layout, expectedVersion) {
      assertVersion(userId, expectedVersion);
      const { updated, version } = repo.saveMuralBlockLayout(userId, muralId, blockId, layout);
      if (!updated) throw new LibraryEntityNotFoundError("That block");
      return { version };
    }
  };
}
