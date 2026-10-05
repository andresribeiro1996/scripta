// The port: everything the library domain (service.ts) needs from
// persistence. Same shape of contract as modules/auth/domain/ports.ts —
// service.ts is written against this interface only, with no idea
// whether SQLite, Postgres, or an in-memory fake is on the other side.

import type { LibraryDerived, LibraryDocumentRow, LibraryRows, LibrarySmallSave } from "./types.js";

export interface LibraryRepository {
  deleteUserData(userId: string): void;
  getDocument(userId: string): LibraryDocumentRow | undefined;
  /** Insert-or-replace: one document per user. Returns the stored row
   *  (with its server-assigned updatedAt) so the service doesn't need to
   *  compute or guess it. */
  upsertDocument(userId: string, dataJson: string, derived: LibraryDerived, rows: LibraryRows, expectedUpdatedAt?: string): LibraryDocumentRow | undefined;
  updateDocumentData(userId: string, dataJson: string, expectedUpdatedAt: string, glyph: LibraryDerived["glyph"] | "keep", rows: LibrarySmallSave): string | undefined;
  listStaleUserIds(): string[];
  rowHashes(userId: string): Map<number, string>;
  setDerived(userId: string, derived: LibraryDerived, sourceUpdatedAt: string): void;
  setRows(userId: string, rows: LibraryRows, sourceUpdatedAt: string): void;
  deleteOrphanedDerived(): void;
  /** Sets (or, with `token: null`, clears) the share token on this user's
   *  existing library document. Returns undefined if this user has no
   *  library document yet — service.ts turns that into a clear "nothing
   *  to share" error rather than silently doing nothing. */
  setShareToken(userId: string, token: string | null): LibraryDocumentRow | undefined;
  /** The owner of the live share token — backs the public
   *  GET /library/shared/:token route without reading the document. The
   *  token itself is the credential, same trust model as
   *  modules/gallery's unguessable image ids. */
  getShareOwner(token: string): string | undefined;
}
