import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { BooksRepository } from "../../domain/ports.js";
import type { BookRow, CoverImageRow } from "../../domain/types.js";

export function createSqliteBooksRepository(db: DatabaseSync): BooksRepository {
  const byKeyStmt = db.prepare(`SELECT books.* FROM book_keys JOIN books ON books.id = book_keys.book_id WHERE book_keys.key = ?`);
  const byIdStmt = db.prepare(`SELECT * FROM books WHERE id = ?`);
  const insertBookStmt = db.prepare(`
    INSERT INTO books (id, title, author, year, publisher, isbn, ol_cover_id, genres, created_at)
    VALUES ($id, $title, $author, $year, $publisher, $isbn, $ol_cover_id, $genres, $created_at)
  `);
  const insertKeyStmt = db.prepare(`INSERT INTO book_keys (key, book_id) VALUES (?, ?)`);
  const fillIdentityStmt = db.prepare(`UPDATE books SET title = ?, author = ? WHERE id = ? AND title = ''`);
  const makeSearchableStmt = db.prepare(`
    INSERT INTO books_fts (book_id, title, author)
    SELECT id, title, author FROM books WHERE id = ? AND title != '' AND NOT EXISTS (SELECT 1 FROM books_fts WHERE book_id = ?)
  `);
  const imageStmt = db.prepare(`SELECT * FROM cover_images WHERE id = ?`);
  const insertImageStmt = db.prepare(`
    INSERT INTO cover_images (id, book_id, source, source_url, width, height, byte_size, created_at)
    VALUES ($id, $book_id, $source, $source_url, $width, $height, $byte_size, $created_at)
  `);
  const setCoverStmt = db.prepare(`UPDATE books SET cover_image_id = ?, cover_status = ?, cover_checked_at = ? WHERE id = ?`);
  const addRejectionStmt = db.prepare(`INSERT OR IGNORE INTO cover_rejections (book_id, source_url, created_at) VALUES (?, ?, ?)`);
  const rejectionsStmt = db.prepare(`SELECT source_url FROM cover_rejections WHERE book_id = ?`);
  const saveDetailsStmt = db.prepare(`
    UPDATE books
    SET summary = ?, rating = ?, rating_count = ?, genres = ?, source_url = ?, details_status = 'found', details_checked_at = ?
    WHERE id = ?
  `);
  const detailsMissingStmt = db.prepare(`UPDATE books SET details_status = 'missing', details_checked_at = ? WHERE id = ?`);
  const searchStmt = db.prepare(`
    SELECT books.* FROM books_fts JOIN books ON books.id = books_fts.book_id
    WHERE books_fts MATCH ? ORDER BY bm25(books_fts) LIMIT ?
  `);

  return {
    findBookByKey: (key) => byKeyStmt.get(key) as BookRow | undefined,

    getBook: (id) => byIdStmt.get(id) as BookRow | undefined,

    createBook(input, key, createdAt) {
      const existing = byKeyStmt.get(key) as BookRow | undefined;
      if (existing) return existing;
      const id = randomUUID();
      db.exec("BEGIN");
      try {
        insertBookStmt.run({
          $id: id,
          $title: input.title,
          $author: input.author,
          $year: input.year ?? null,
          $publisher: input.publisher ?? null,
          $isbn: input.isbn,
          $ol_cover_id: input.olCoverId ?? null,
          $genres: JSON.stringify(input.genres ?? []),
          $created_at: createdAt
        });
        insertKeyStmt.run(key, id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return byIdStmt.get(id) as unknown as BookRow;
    },

    fillIdentity(id, title, author) {
      fillIdentityStmt.run(title, author, id);
    },

    makeSearchable(id) {
      makeSearchableStmt.run(id, id);
    },

    getImage: (id) => imageStmt.get(id) as CoverImageRow | undefined,

    insertImage(row) {
      insertImageStmt.run({
        $id: row.id,
        $book_id: row.book_id,
        $source: row.source,
        $source_url: row.source_url,
        $width: row.width,
        $height: row.height,
        $byte_size: row.byte_size,
        $created_at: row.created_at
      });
    },

    setCover(bookId, cover) {
      setCoverStmt.run(cover.imageId, cover.status, cover.checkedAt, bookId);
    },

    addRejection(bookId, sourceUrl, createdAt) {
      addRejectionStmt.run(bookId, sourceUrl, createdAt);
    },

    listRejectedUrls(bookId) {
      return new Set((rejectionsStmt.all(bookId) as Array<{ source_url: string }>).map((row) => row.source_url));
    },

    saveDetails(bookId, details, checkedAt) {
      saveDetailsStmt.run(details.summary, details.rating, details.ratingCount, JSON.stringify(details.genres), details.sourceUrl, checkedAt, bookId);
    },

    markDetailsMissing(bookId, checkedAt) {
      detailsMissingStmt.run(checkedAt, bookId);
    },

    searchBooks(tokens, limit) {
      if (tokens.length === 0) return [];
      return searchStmt.all(tokens.map((token) => `"${token}"`).join(" "), limit) as unknown as BookRow[];
    }
  };
}
