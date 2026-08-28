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
}
