// Business logic for the library module. Depends only on the
// LibraryRepository port, not on any particular database — same reasoning
// as modules/auth/service.ts, and the reason a Postgres adapter is a new
// file rather than a rewrite of this one.
//
// The document API (getLibrary/saveLibrary) is a COMPATIBILITY LAYER over
// the normalised entities: most of the frontend still speaks the
// whole-library-document shape, so this assembles it on read and
// decomposes it on write. saveMuralBlockLayout is the first per-entity
// operation to have a route in front of it — it is the hot path, fired on
// every drag. See docs/DEPLOYMENT-PLAN.md.

import { toContents, toDocument } from "./domain/document.js";
import { LibraryEntityNotFoundError, LibraryVersionConflictError } from "./domain/errors.js";
import type { BlockLayout, LibraryDocument } from "./domain/types.js";
import type { LibraryRepository } from "./domain/ports.js";

export interface LibraryService {
  getLibrary(userId: string): Promise<LibraryDocument | null>;
  /** `expectedVersion` is the optimistic-concurrency precondition: the
   *  version the caller believes it is editing. Omit it to force the
   *  write through unconditionally (the pre-versioning behaviour, kept
   *  for the first save and for callers that genuinely mean "replace
   *  whatever is there"). */
  saveLibrary(userId: string, data: unknown, expectedVersion?: number): Promise<LibraryDocument>;
  saveMuralBlockLayout(
    userId: string,
    muralId: string,
    blockId: string,
    layout: BlockLayout,
    expectedVersion?: number
  ): Promise<{ version: number }>;
}

export function createLibraryService(repo: LibraryRepository): LibraryService {
  /** Throws if the caller is writing against a version that has since
   *  moved on. `undefined` on either side means "no precondition
   *  available" — an omitted expectation, or a user with no library yet —
   *  and is allowed through. */
  async function assertVersion(userId: string, expectedVersion: number | undefined): Promise<number> {
    const current = await repo.getVersion(userId);
    if (expectedVersion !== undefined && current !== undefined && expectedVersion !== current) {
      throw new LibraryVersionConflictError(expectedVersion, current);
    }
    return current ?? 0;
  }

  return {
    async getLibrary(userId) {
      const contents = await repo.getContents(userId);
      if (!contents) return null;
      return {
        data: toDocument(contents),
        updatedAt: contents.settings.updatedAt,
        version: contents.settings.version
      };
    },

    async saveLibrary(userId, data, expectedVersion) {
      const current = await assertVersion(userId, expectedVersion);
      const nextVersion = current + 1;
      const updatedAt = new Date().toISOString();
      const contents = toContents(data, nextVersion, updatedAt);
      await repo.replaceContents(userId, contents);
      return { data: toDocument(contents), updatedAt, version: nextVersion };
    },

    async saveMuralBlockLayout(userId, muralId, blockId, layout, expectedVersion) {
      await assertVersion(userId, expectedVersion);
      const { updated, version } = await repo.saveMuralBlockLayout(userId, muralId, blockId, layout);
      if (!updated) throw new LibraryEntityNotFoundError("That block");
      return { version };
    }
  };
}
