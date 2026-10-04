// The SQLite implementation of the LibraryRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// LibraryRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import { LIBRARY_ROWS_VERSION } from "../../domain/constants.js";
import type { LibraryRepository } from "../../domain/ports.js";
import type { LibraryDerived, LibraryDocumentRow, LibraryRows, LibrarySmallSave } from "../../domain/types.js";

export function createSqliteLibraryRepository(db: DatabaseSync, rowsVersion = LIBRARY_ROWS_VERSION): LibraryRepository {
  const getStmt = db.prepare(`SELECT * FROM library_documents WHERE user_id = ?`);
  // One document per user: insert on first save, replace on every save
  // after that. SQLite's upsert clause does this in one round trip.
  const upsertStmt = db.prepare(`
    INSERT INTO library_documents (user_id, data, updated_at)
    VALUES ($user_id, $data, $updated_at)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    WHERE library_documents.updated_at = $expected_updated_at
  `);
  const updateDataStmt = db.prepare(`
    UPDATE library_documents SET data = $data, updated_at = $updated_at
    WHERE user_id = $user_id AND updated_at = $expected_updated_at
  `);
  const setGlyphStmt = db.prepare(`
    UPDATE library_derived SET glyph = $glyph, source_updated_at = $updated_at
    WHERE user_id = $user_id AND source_updated_at = $expected_updated_at
  `);
  const keepDerivedStmt = db.prepare(`
    UPDATE library_derived SET source_updated_at = $updated_at
    WHERE user_id = $user_id AND source_updated_at = $expected_updated_at
  `);
  // Deliberately leaves share_token untouched on conflict — re-saving a
  // library document (a normal, frequent PUT /library) must never disturb
  // an existing share link.
  const setShareTokenStmt = db.prepare(`UPDATE library_documents SET share_token = ? WHERE user_id = ?`);
  const getShareOwnerStmt = db.prepare(`SELECT user_id, share_token FROM library_documents WHERE share_token = ?`);
  const deleteKeysStmt = db.prepare(`DELETE FROM library_match_keys WHERE user_id = ?`);
  const insertKeyStmt = db.prepare(`
    INSERT INTO library_match_keys (user_id, key, book_ref, title, author, isbn, cover)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const setDerivedStmt = db.prepare(`
    INSERT INTO library_derived (user_id, glyph, source_updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET glyph = excluded.glyph, source_updated_at = excluded.source_updated_at
  `);
  const listStaleStmt = db.prepare(`
    SELECT library_documents.user_id FROM library_documents
    LEFT JOIN library_derived ON library_derived.user_id = library_documents.user_id
    LEFT JOIN library_summary ON library_summary.user_id = library_documents.user_id
    WHERE library_derived.user_id IS NULL OR library_derived.source_updated_at != library_documents.updated_at
      OR library_summary.user_id IS NULL OR library_summary.source_updated_at != library_documents.updated_at
      OR library_summary.rows_version != ?
  `);
  const listRowHashesStmt = db.prepare(`SELECT position, row_hash FROM library_books WHERE user_id = ?`);
  const upsertBookStmt = db.prepare(`
    INSERT OR REPLACE INTO library_books (user_id, position, book_key, title, author, isbn, image_id, read_status, series_number, sort_order, cover_url, finished_year, row_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteBookStmt = db.prepare(`DELETE FROM library_books WHERE user_id = ? AND position = ?`);
  const deletePositionHighlightsStmt = db.prepare(`DELETE FROM library_highlights WHERE user_id = ? AND position = ?`);
  const insertHighlightStmt = db.prepare(`INSERT OR IGNORE INTO library_highlights (user_id, position, highlight_id, text, annotation) VALUES (?, ?, ?, ?, ?)`);
  const touchSummaryStmt = db.prepare(`
    UPDATE library_summary SET
      meta = CASE WHEN $set_meta THEN $meta ELSE meta END,
      reader_card = CASE WHEN $set_reader_card THEN $reader_card ELSE reader_card END,
      finished_count = $finished, in_progress_count = $in_progress, source_updated_at = $updated_at, rows_version = $rows_version
    WHERE user_id = $user_id AND source_updated_at = $expected_updated_at
  `);
  const upsertSummaryStmt = db.prepare(`
    INSERT INTO library_summary (user_id, meta, reader_card, shelf_theme, total_books, finished_count, in_progress_count, total_highlights, source_updated_at, rows_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET meta = excluded.meta, reader_card = excluded.reader_card, shelf_theme = excluded.shelf_theme,
      total_books = excluded.total_books, finished_count = excluded.finished_count, in_progress_count = excluded.in_progress_count,
      total_highlights = excluded.total_highlights, source_updated_at = excluded.source_updated_at,
      rows_version = excluded.rows_version
  `);

  function writeDerived(userId: string, derived: LibraryDerived, sourceUpdatedAt: string) {
    deleteKeysStmt.run(userId);
    for (const row of derived.keys) insertKeyStmt.run(userId, row.key, row.book_ref, row.title, row.author, row.isbn, row.cover);
    setDerivedStmt.run(userId, derived.glyph, sourceUpdatedAt);
  }

  function writeRows(userId: string, rows: LibraryRows, sourceUpdatedAt: string) {
    const stored = new Map((listRowHashesStmt.all(userId) as Array<{ position: number; row_hash: string }>).map((row) => [row.position, row.row_hash]));
    for (const { book, highlights } of rows.books) {
      const unchanged = stored.get(book.position) === book.row_hash;
      stored.delete(book.position);
      if (unchanged) continue;
      upsertBookStmt.run(userId, book.position, book.book_key, book.title, book.author, book.isbn, book.image_id, book.read_status, book.series_number, book.sort_order, book.cover_url, book.finished_year, book.row_hash);
      deletePositionHighlightsStmt.run(userId, book.position);
      for (const highlight of highlights) insertHighlightStmt.run(userId, book.position, highlight.highlight_id, highlight.text, highlight.annotation);
    }
    for (const position of stored.keys()) {
      deleteBookStmt.run(userId, position);
      deletePositionHighlightsStmt.run(userId, position);
    }
    const { summary } = rows;
    upsertSummaryStmt.run(userId, summary.meta, summary.reader_card, summary.shelf_theme, summary.total_books, summary.finished_count, summary.in_progress_count, summary.total_highlights, sourceUpdatedAt, rowsVersion);
  }

  function writeSmallSave(userId: string, rows: LibrarySmallSave, updatedAt: string, expectedUpdatedAt: string) {
    const result = touchSummaryStmt.run({
      $user_id: userId,
      $set_meta: rows.meta === "keep" ? 0 : 1,
      $meta: rows.meta === "keep" ? null : rows.meta,
      $set_reader_card: rows.readerCard === "keep" ? 0 : 1,
      $reader_card: rows.readerCard === "keep" ? null : rows.readerCard,
      $finished: rows.counts.finished,
      $in_progress: rows.counts.inProgress,
      $updated_at: updatedAt,
      $rows_version: rowsVersion,
      $expected_updated_at: expectedUpdatedAt
    });
    if (result.changes === 0) return;
    for (const book of rows.books) {
      upsertBookStmt.run(userId, book.position, book.book_key, book.title, book.author, book.isbn, book.image_id, book.read_status, book.series_number, book.sort_order, book.cover_url, book.finished_year, book.row_hash);
    }
  }

  function inTransaction<T>(write: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = write();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    deleteUserData(userId) {
      inTransaction(() => {
        db.prepare("DELETE FROM library_documents WHERE user_id = ?").run(userId);
        db.prepare("DELETE FROM library_derived WHERE user_id = ?").run(userId);
        deleteKeysStmt.run(userId);
        db.prepare("DELETE FROM library_books WHERE user_id = ?").run(userId);
        db.prepare("DELETE FROM library_highlights WHERE user_id = ?").run(userId);
        db.prepare("DELETE FROM library_summary WHERE user_id = ?").run(userId);
      });
    },
    getDocument(userId) {
      return getStmt.get(userId) as LibraryDocumentRow | undefined;
    },

    upsertDocument(userId, dataJson, derived, rows, expectedUpdatedAt) {
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
        writeDerived(userId, derived, updatedAt);
        writeRows(userId, rows, updatedAt);
        return getStmt.get(userId) as unknown as LibraryDocumentRow;
      });
    },

    updateDocumentData(userId, dataJson, expectedUpdatedAt, glyph, rows) {
      return inTransaction(() => {
        const updatedAt = new Date(Math.max(Date.now(), Date.parse(expectedUpdatedAt) + 1)).toISOString();
        const result = updateDataStmt.run({ $user_id: userId, $data: dataJson, $updated_at: updatedAt, $expected_updated_at: expectedUpdatedAt });
        if (result.changes === 0) return undefined;
        const derived = { $user_id: userId, $updated_at: updatedAt, $expected_updated_at: expectedUpdatedAt };
        if (glyph === "keep") keepDerivedStmt.run(derived);
        else setGlyphStmt.run({ ...derived, $glyph: glyph });
        writeSmallSave(userId, rows, updatedAt, expectedUpdatedAt);
        return updatedAt;
      });
    },

    listStaleUserIds() {
      return (listStaleStmt.all(rowsVersion) as Array<{ user_id: string }>).map((row) => row.user_id);
    },

    setDerived(userId, derived, sourceUpdatedAt) {
      inTransaction(() => writeDerived(userId, derived, sourceUpdatedAt));
    },

    setRows(userId, rows, sourceUpdatedAt) {
      inTransaction(() => writeRows(userId, rows, sourceUpdatedAt));
    },

    deleteOrphanedDerived() {
      const orphaned = `NOT EXISTS (SELECT 1 FROM library_documents WHERE library_documents.user_id = library_derived.user_id)`;
      inTransaction(() => {
        db.exec(`DELETE FROM library_match_keys WHERE user_id IN (SELECT user_id FROM library_derived WHERE ${orphaned})`);
        db.exec(`DELETE FROM library_derived WHERE ${orphaned}`);
        for (const table of ["library_books", "library_highlights", "library_summary"]) {
          db.exec(`DELETE FROM ${table} WHERE NOT EXISTS (SELECT 1 FROM library_documents WHERE library_documents.user_id = ${table}.user_id)`);
        }
      });
    },

    setShareToken(userId, token) {
      const result = setShareTokenStmt.run(token, userId);
      if (result.changes === 0) return undefined;
      return getStmt.get(userId) as LibraryDocumentRow | undefined;
    },

    getShareOwner(token) {
      return (getShareOwnerStmt.get(token) as { user_id: string } | undefined)?.user_id;
    }
  };
}
