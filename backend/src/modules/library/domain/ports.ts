// The port: everything the library domain (service.ts) needs from
// persistence. Same shape of contract as modules/auth/domain/ports.ts —
// service.ts is written against this interface only, with no idea
// whether SQLite, Postgres, or an in-memory fake is on the other side.

import type { LibraryDocumentRow } from "./types.js";

export interface LibraryRepository {
  getDocument(userId: string): LibraryDocumentRow | undefined;
  /** Insert-or-replace: one document per user. Returns the stored row
   *  (with its server-assigned updatedAt) so the service doesn't need to
   *  compute or guess it. */
  upsertDocument(userId: string, dataJson: string): LibraryDocumentRow;
  /** Sets (or, with `token: null`, clears) the share token on this user's
   *  existing library document. Returns undefined if this user has no
   *  library document yet — service.ts turns that into a clear "nothing
   *  to share" error rather than silently doing nothing. */
  setShareToken(userId: string, token: string | null): LibraryDocumentRow | undefined;
  /** Looks up a document by its live share token — backs the public
   *  GET /library/shared/:token route. No ownership/userId involved: the
   *  token itself is the credential, same trust model as
   *  modules/gallery's getImageById. */
  getByShareToken(token: string): LibraryDocumentRow | undefined;
}
