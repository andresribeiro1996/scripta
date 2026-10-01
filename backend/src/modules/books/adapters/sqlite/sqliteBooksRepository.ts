import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { normalizeWorkKey } from "../../domain/normalize.js";
import type { BooksRepository, MergeableDetails } from "../../domain/ports.js";
import type { BookRow, CoverImageRow, SummarySource } from "../../domain/types.js";

export function createSqliteBooksRepository(db: DatabaseSync): BooksRepository {
  const byKeyStmt = db.prepare(`SELECT books.* FROM book_keys JOIN books ON books.id = book_keys.book_id WHERE book_keys.key = ?`);
  const byIdStmt = db.prepare(`SELECT * FROM books WHERE id = ?`);
  const insertBookStmt = db.prepare(`
    INSERT INTO books (id, title, author, year, publisher, isbn, ol_cover_id, ol_work_key, genres, data_sources, created_by, created_at)
    VALUES ($id, $title, $author, $year, $publisher, $isbn, $ol_cover_id, $ol_work_key, $genres, $data_sources, $created_by, $created_at)
  `);
  const insertKeyIfMissingStmt = db.prepare(`INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)`);
  const fillIdentityStmt = db.prepare(`UPDATE books SET title = ?, author = ? WHERE id = ? AND title = ''`);
  const makeSearchableStmt = db.prepare(`
    INSERT INTO books_fts (book_id, title, author)
    SELECT id, title, author FROM books WHERE id = ? AND title != '' AND NOT EXISTS (SELECT 1 FROM books_fts WHERE book_id = ?)
  `);
  const imageStmt = db.prepare(`SELECT * FROM cover_images WHERE id = ?`);
  const insertImageStmt = db.prepare(`
    INSERT INTO cover_images (id, book_id, source, source_url, origin, width, height, byte_size, created_at)
    VALUES ($id, $book_id, $source, $source_url, $origin, $width, $height, $byte_size, $created_at)
  `);
  const setCoverStmt = db.prepare(`UPDATE books SET cover_image_id = ?, cover_status = ?, cover_checked_at = ? WHERE id = ?`);
  const addRejectionStmt = db.prepare(`INSERT OR IGNORE INTO cover_rejections (book_id, source_url, created_at) VALUES (?, ?, ?)`);
  const rejectionsStmt = db.prepare(`SELECT source_url FROM cover_rejections WHERE book_id = ?`);
  const takesSummary = `$summary IS NOT NULL AND (summary IS NULL OR summary = '' OR ($summary_source = 'publisher' AND summary_source IS NOT 'publisher'))`;
  const mergeDetailsStmt = db.prepare(`
    UPDATE books
    SET summary_source = CASE WHEN ${takesSummary} THEN $summary_source ELSE summary_source END,
        summary = CASE WHEN ${takesSummary} THEN $summary ELSE summary END,
        pages = COALESCE(pages, $pages),
        year = COALESCE(year, $year),
        publisher = COALESCE(publisher, $publisher),
        translator = COALESCE(translator, $translator)
    WHERE id = $id
  `);
  const saveDetailsStmt = db.prepare(`
    UPDATE books
    SET rating = ?, rating_count = ?, genres = CASE WHEN genres = '[]' THEN ? ELSE genres END, data_sources = ?, source_url = ?, details_status = 'found', details_checked_at = ?
    WHERE id = ?
  `);
  const detailsMissingStmt = db.prepare(`UPDATE books SET details_status = 'missing', details_checked_at = ? WHERE id = ?`);
  const searchStmt = db.prepare(`
    SELECT books.* FROM books_fts JOIN books ON books.id = books_fts.book_id
    WHERE books_fts MATCH ? ORDER BY bm25(books_fts) LIMIT ?
  `);

  const uncheckedStmt = db.prepare(`
    SELECT id FROM books WHERE cover_image_id IS NULL AND cover_status IS NULL ORDER BY created_at, rowid
  `);
  const setUpgradeWantedStmt = db.prepare(`UPDATE books SET cover_upgrade_wanted_at = ? WHERE id = ?`);
  const setWorkKeyStmt = db.prepare(`UPDATE books SET ol_work_key = ? WHERE id = ? AND ol_work_key IS NULL`);
  const setPublisherUrlStmt = db.prepare(`UPDATE books SET publisher_url = ? WHERE id = ? AND publisher_url IS NULL`);
  const upgradeWantedStmt = db.prepare(`SELECT id FROM books WHERE cover_upgrade_wanted_at IS NOT NULL ORDER BY cover_upgrade_wanted_at, rowid`);

  function mergeDetails(bookId: string, details: MergeableDetails, summarySource: SummarySource | null) {
    mergeDetailsStmt.run({
      $id: bookId,
      $summary: details.summary,
      $summary_source: summarySource,
      $pages: details.pages,
      $year: details.year,
      $publisher: details.publisher,
      $translator: details.translator
    });
  }

  return {
    findBookByKey: (key) => byKeyStmt.get(key) as BookRow | undefined,

    getBook: (id) => byIdStmt.get(id) as BookRow | undefined,

    createBook(input, keys, createdAt) {
      const existing = keys.map((key) => byKeyStmt.get(key) as BookRow | undefined).find(Boolean);
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
          $ol_work_key: normalizeWorkKey(input.workKey),
          $genres: JSON.stringify(input.genres ?? []),
          $data_sources: JSON.stringify(input.sources ?? []),
          $created_by: input.createdBy ?? null,
          $created_at: createdAt
        });
        for (const key of keys) insertKeyIfMissingStmt.run(key, id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return byIdStmt.get(id) as unknown as BookRow;
    },

    addKey(key, bookId) {
      insertKeyIfMissingStmt.run(key, bookId);
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
        $origin: row.origin ?? null,
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

    saveDetails(bookId, details, sources, summarySource, checkedAt) {
      db.exec("BEGIN");
      try {
        mergeDetails(bookId, details, summarySource);
        saveDetailsStmt.run(details.rating, details.ratingCount, JSON.stringify(details.genres), JSON.stringify(sources), details.sourceUrl, checkedAt, bookId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    mergeDetails,

    markDetailsMissing(bookId, checkedAt) {
      detailsMissingStmt.run(checkedAt, bookId);
    },

    searchBooks(tokens, limit) {
      if (tokens.length === 0) return [];
      return searchStmt.all(tokens.map((token) => `"${token}"`).join(" "), limit) as unknown as BookRow[];
    },

    listUncheckedCoverIds() {
      return (uncheckedStmt.all() as Array<{ id: string }>).map((row) => row.id);
    },

    setUpgradeWanted(bookId, at) {
      setUpgradeWantedStmt.run(at, bookId);
    },

    setWorkKey(id, key) {
      const workKey = normalizeWorkKey(key);
      if (workKey) setWorkKeyStmt.run(workKey, id);
    },

    setPublisherUrl(id, url) {
      setPublisherUrlStmt.run(url, id);
    },

    listUpgradeWantedIds() {
      return (upgradeWantedStmt.all() as Array<{ id: string }>).map((row) => row.id);
    }
  };
}
