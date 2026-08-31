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

import { toBookEntity, toContents, toDocument, toGroupEntity, toMuralEntity } from "./domain/document.js";
import { LibraryEntityNotFoundError, LibraryVersionConflictError } from "./domain/errors.js";
import type { BlockLayout, BookRecord, LibraryDocument } from "./domain/types.js";
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

  // --- per-entity writes -------------------------------------------------
  //
  // Each of these replaces a whole-document PUT for an operation that only
  // ever touches ONE entity: renaming a group, restyling a book, editing a
  // mural's blocks. The document endpoint stays for genuinely cross-cutting
  // work — an import that merges everything, or deleting books that must
  // also be scrubbed out of every group and mural in the same write.
  saveBook(userId: string, book: BookRecord, expectedVersion?: number): Promise<{ version: number; bookKey: string }>;
  deleteBook(userId: string, bookKey: string, expectedVersion?: number): Promise<{ version: number }>;
  saveGroup(userId: string, group: unknown, expectedVersion?: number): Promise<{ version: number }>;
  deleteGroup(userId: string, groupId: string, expectedVersion?: number): Promise<{ version: number }>;
  saveMural(userId: string, mural: unknown, expectedVersion?: number): Promise<{ version: number }>;
  deleteMural(userId: string, muralId: string, expectedVersion?: number): Promise<{ version: number }>;
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
    },

    async saveBook(userId, book, expectedVersion) {
      const current = await assertVersion(userId, expectedVersion);
      // The key is derived server-side rather than taken from the caller:
      // it is what groups and mural blocks reference, so letting a client
      // supply one that disagrees with the book's own fields would orphan
      // those references. Same function the document path uses.
      const entity = toBookEntity(book);
      await repo.upsertBook(userId, entity);
      return { version: current + 1, bookKey: entity.bookKey };
    },

    async deleteBook(userId, bookKey, expectedVersion) {
      const current = await assertVersion(userId, expectedVersion);
      await repo.deleteBook(userId, bookKey);
      return { version: current + 1 };
    },

    async saveGroup(userId, group, expectedVersion) {
      const current = await assertVersion(userId, expectedVersion);
      await repo.upsertGroup(userId, toGroupEntity(group));
      return { version: current + 1 };
    },

    async deleteGroup(userId, groupId, expectedVersion) {
      const current = await assertVersion(userId, expectedVersion);
      await repo.deleteGroup(userId, groupId);
      return { version: current + 1 };
    },

    async saveMural(userId, mural, expectedVersion) {
      const current = await assertVersion(userId, expectedVersion);
      await repo.upsertMural(userId, toMuralEntity(mural));
      return { version: current + 1 };
    },

    async deleteMural(userId, muralId, expectedVersion) {
      const current = await assertVersion(userId, expectedVersion);
      await repo.deleteMural(userId, muralId);
      return { version: current + 1 };
    }
  };
}
