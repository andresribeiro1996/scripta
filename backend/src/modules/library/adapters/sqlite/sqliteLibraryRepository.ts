// The SQLite implementation of the LibraryRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// LibraryRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { LibraryRepository } from "../../domain/ports.js";
import type { LibraryDocumentRow } from "../../domain/types.js";

export function createSqliteLibraryRepository(db: DatabaseSync): LibraryRepository {
  const getStmt = db.prepare(`SELECT * FROM library_documents WHERE user_id = ?`);
  // One document per user: insert on first save, replace on every save
  // after that. SQLite's upsert clause does this in one round trip.
  const upsertStmt = db.prepare(`
    INSERT INTO library_documents (user_id, data, updated_at)
    VALUES ($user_id, $data, $updated_at)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `);
  // Deliberately leaves share_token untouched on conflict — re-saving a
  // library document (a normal, frequent PUT /library) must never disturb
  // an existing share link.
  const setShareTokenStmt = db.prepare(`UPDATE library_documents SET share_token = ? WHERE user_id = ?`);
  const getByShareTokenStmt = db.prepare(`SELECT * FROM library_documents WHERE share_token = ?`);

  return {
    getDocument(userId) {
      return getStmt.get(userId) as LibraryDocumentRow | undefined;
    },

    upsertDocument(userId, dataJson) {
      const updatedAt = new Date().toISOString();
      upsertStmt.run({ $user_id: userId, $data: dataJson, $updated_at: updatedAt });
      return (getStmt.get(userId) as LibraryDocumentRow | undefined)!;
    },

    setShareToken(userId, token) {
      const result = setShareTokenStmt.run(token, userId);
      if (result.changes === 0) return undefined;
      return getStmt.get(userId) as LibraryDocumentRow | undefined;
    },

    getByShareToken(token) {
      return getByShareTokenStmt.get(token) as LibraryDocumentRow | undefined;
    }
  };
}
