// The SQLite implementation of the LibraryRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// LibraryRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { LibraryRepository } from "../../domain/ports.js";
import type { LibraryDerived, LibraryDocumentRow } from "../../domain/types.js";

export function createSqliteLibraryRepository(db: DatabaseSync): LibraryRepository {
  const getStmt = db.prepare(`SELECT * FROM library_documents WHERE user_id = ?`);
  // One document per user: insert on first save, replace on every save
  // after that. SQLite's upsert clause does this in one round trip.
  const upsertStmt = db.prepare(`
    INSERT INTO library_documents (user_id, data, updated_at)
    VALUES ($user_id, $data, $updated_at)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    WHERE library_documents.updated_at = $expected_updated_at
  `);
  // Deliberately leaves share_token untouched on conflict — re-saving a
  // library document (a normal, frequent PUT /library) must never disturb
  // an existing share link.
  const setShareTokenStmt = db.prepare(`UPDATE library_documents SET share_token = ? WHERE user_id = ?`);
  const getByShareTokenStmt = db.prepare(`SELECT * FROM library_documents WHERE share_token = ?`);
  const deleteKeysStmt = db.prepare(`DELETE FROM library_match_keys WHERE user_id = ?`);
  const insertKeyStmt = db.prepare(`
    INSERT INTO library_match_keys (user_id, key, book_ref, title, author, isbn, cover)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const setGlyphStmt = db.prepare(`
    INSERT INTO library_derived (user_id, glyph) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET glyph = excluded.glyph
  `);
  const listUnderivedStmt = db.prepare(`
    SELECT user_id FROM library_documents
    WHERE NOT EXISTS (SELECT 1 FROM library_derived WHERE library_derived.user_id = library_documents.user_id)
  `);

  function writeDerived(userId: string, derived: LibraryDerived) {
    deleteKeysStmt.run(userId);
    for (const row of derived.keys) insertKeyStmt.run(userId, row.key, row.book_ref, row.title, row.author, row.isbn, row.cover);
    setGlyphStmt.run(userId, derived.glyph);
  }

  function inTransaction<T>(write: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = write();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    deleteUserData(userId) {
      inTransaction(() => {
        db.prepare("DELETE FROM library_documents WHERE user_id = ?").run(userId);
        db.prepare("DELETE FROM library_derived WHERE user_id = ?").run(userId);
        deleteKeysStmt.run(userId);
      });
    },
    getDocument(userId) {
      return getStmt.get(userId) as LibraryDocumentRow | undefined;
    },

    upsertDocument(userId, dataJson, derived, expectedUpdatedAt) {
      return inTransaction(() => {
        const current = getStmt.get(userId) as LibraryDocumentRow | undefined;
        const updatedAt = new Date(Math.max(Date.now(), current ? Date.parse(current.updated_at) + 1 : 0)).toISOString();
        const result = upsertStmt.run({
          $user_id: userId,
          $data: dataJson,
          $updated_at: updatedAt,
          $expected_updated_at: expectedUpdatedAt ?? null
        });
        if (result.changes === 0) return undefined;
        writeDerived(userId, derived);
        return getStmt.get(userId) as unknown as LibraryDocumentRow;
      });
    },

    listUnderivedUserIds() {
      return (listUnderivedStmt.all() as Array<{ user_id: string }>).map((row) => row.user_id);
    },

    setDerived(userId, derived) {
      inTransaction(() => writeDerived(userId, derived));
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
