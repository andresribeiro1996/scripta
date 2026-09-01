// The port: everything the library domain (service.ts) needs from
// persistence. Same shape of contract as modules/auth/domain/ports.ts —
// service.ts is written against this interface only, with no idea whether
// SQLite, Postgres, or an in-memory fake is on the other side.
//
// The per-entity operations below are the point of the normalisation
// rework: `replaceContents` is what the document-compatibility API uses,
// but `upsertBook`/`saveMuralBlockLayout` and friends let a caller touch
// one row without rewriting the account's whole library. Slice 2 puts
// HTTP routes in front of the layout one (see docs/DEPLOYMENT-PLAN.md);
// the rest are defined and tested so the storage layer isn't what blocks
// their routes landing.
//
// EVERY METHOD IS ASYNC even though the SQLite adapter answers
// synchronously. That is deliberate: a network-backed store (Postgres —
// see adapters/postgres/) cannot answer synchronously, and a port that
// promised it could would have made moving off a single machine a
// rewrite of service.ts and every caller rather than a new adapter. The
// SQLite adapter simply returns already-resolved promises.

import type { Book, BlockLayout, Group, LibraryContents, Mural } from "./types.js";

export interface LibraryRepository {
  /** Everything for one user, reassembled. `undefined` when the user has
   *  never saved a library. */
  getContents(userId: string): Promise<LibraryContents | undefined>;

  /** Wholesale replace, in a single transaction — the write path behind
   *  `PUT /library`. Bumps the version and returns the stored settings so
   *  the service doesn't have to guess them. */
  replaceContents(userId: string, contents: LibraryContents): Promise<LibraryContents>;

  /** The current version, without paying to read the whole library.
   *  `undefined` when the user has no library yet. */
  getVersion(userId: string): Promise<number | undefined>;

  // --- per-entity writes ---------------------------------------------------

  upsertBook(userId: string, book: Book): Promise<void>;
  deleteBook(userId: string, bookKey: string): Promise<void>;

  upsertGroup(userId: string, group: Group): Promise<void>;
  deleteGroup(userId: string, groupId: string): Promise<void>;

  upsertMural(userId: string, mural: Mural): Promise<void>;
  deleteMural(userId: string, muralId: string): Promise<void>;

  /** The write that `MuralEditorPage`'s drag handler should be making:
   *  one block's position, not the entire library.
   *
   *  Reports whether a row was actually updated, so the caller can tell
   *  "moved it" from "that block isn't there any more" (deleted on
   *  another device) rather than silently succeeding — and the resulting
   *  version, so the client can stay in step without a re-read. */
  saveMuralBlockLayout(
    userId: string,
    muralId: string,
    blockId: string,
    layout: BlockLayout
  ): Promise<{ updated: boolean; version: number }>;
}
