// The port: everything the library domain (service.ts) needs from
// persistence. Same shape of contract as modules/auth/domain/ports.ts —
// service.ts is written against this interface only, with no idea whether
// SQLite, Postgres, or an in-memory fake is on the other side.
//
// The per-entity operations below are the point of the normalisation
// rework: `replaceContents` is what the document-compatibility API uses,
// but `upsertBook`/`saveMuralBlockLayout` and friends let a caller touch
// one row without rewriting the account's whole library. Slice 2 puts
// HTTP routes in front of them (see docs/DEPLOYMENT-PLAN.md); they are
// defined and tested now so the storage layer isn't the thing blocking
// that.

import type { Book, BlockLayout, Group, LibraryContents, Mural } from "./types.js";

export interface LibraryRepository {
  /** Everything for one user, reassembled. `undefined` when the user has
   *  never saved a library. */
  getContents(userId: string): LibraryContents | undefined;

  /** Wholesale replace, in a single transaction — the write path behind
   *  `PUT /library`. Bumps the version and returns the stored settings so
   *  the service doesn't have to guess them. */
  replaceContents(userId: string, contents: LibraryContents): LibraryContents;

  /** The current version, without paying to read the whole library.
   *  `undefined` when the user has no library yet. */
  getVersion(userId: string): number | undefined;

  // --- per-entity writes ---------------------------------------------------

  upsertBook(userId: string, book: Book): void;
  deleteBook(userId: string, bookKey: string): void;

  upsertGroup(userId: string, group: Group): void;
  deleteGroup(userId: string, groupId: string): void;

  upsertMural(userId: string, mural: Mural): void;
  deleteMural(userId: string, muralId: string): void;

  /** The write that `MuralEditorPage`'s drag handler should be making:
   *  one block's position, not the entire library. */
  saveMuralBlockLayout(userId: string, muralId: string, blockId: string, layout: BlockLayout): void;
}
