import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { normalizeWorkKey, workTitleKey } from "../../domain/normalize.js";
import type { BooksRepository, MergeableDetails } from "../../domain/ports.js";
import { WorkMergeError } from "../../domain/errors.js";
import type { BookRow, CoverImageRow, DataSource, SummarySource, WorkPageRows, WorkView } from "../../domain/types.js";

export function createSqliteBooksRepository(db: DatabaseSync): BooksRepository {
  const byKeyStmt = db.prepare(`SELECT books.* FROM book_keys JOIN books ON books.id = book_keys.book_id WHERE book_keys.key = ?`);
  const byKeysStmt = db.prepare(`SELECT book_keys.key AS key, books.* FROM book_keys JOIN books ON books.id = book_keys.book_id WHERE book_keys.key IN (SELECT value FROM json_each(?))`);
  const byIdStmt = db.prepare(`SELECT * FROM books WHERE id = ?`);
  const insertBookStmt = db.prepare(`
    INSERT INTO books (id, title, author, year, publisher, isbn, ol_cover_id, ol_work_key, work_id, genres, data_sources, created_by, title_key, created_at)
    VALUES ($id, $title, $author, $year, $publisher, $isbn, $ol_cover_id, $ol_work_key, $work_id, $genres, $data_sources, $created_by, $title_key, $created_at)
  `);
  const insertKeyIfMissingStmt = db.prepare(`INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)`);
  const fillIdentityStmt = db.prepare(`UPDATE books SET title = ?, author = ?, title_key = ? WHERE id = ? AND title = ''`);
  const workByKeyStmt = db.prepare(`SELECT id FROM works WHERE ol_work_key = ?`);
  const insertWorkStmt = db.prepare(`INSERT INTO works (id, ol_work_key, title, author, created_at) VALUES (?, ?, ?, ?, ?)`);
  const fillWorkIdentityStmt = db.prepare(`
    UPDATE works
    SET title = CASE WHEN works.title = '' THEN books.title ELSE works.title END,
        author = CASE WHEN works.author = '' THEN books.author ELSE works.author END
    FROM books
    WHERE books.id = ? AND works.id = books.work_id AND (works.title = '' OR works.author = '')
  `);
  const keyOwnWorkStmt = db.prepare(`
    UPDATE works SET ol_work_key = ?
    WHERE id = ? AND ol_work_key IS NULL AND NOT EXISTS (SELECT 1 FROM books WHERE work_id = works.id AND id != ?)
  `);
  const missingTitleKeyStmt = db.prepare(`SELECT id, title, author FROM books WHERE title_key IS NULL AND title <> '' LIMIT ?`);
  const setTitleKeyStmt = db.prepare(`UPDATE books SET title_key = ? WHERE id = ?`);
  const unassignedStmt = db.prepare(`SELECT id, ol_work_key, title, author, created_at FROM books WHERE work_id IS NULL LIMIT ?`);
  const canonicalWorksStmt = db.prepare(`SELECT id, COALESCE(merged_into, id) AS canonical FROM works WHERE id IN (SELECT value FROM json_each(?))`);
  const moveBookStmt = db.prepare(`UPDATE books SET work_id = ? WHERE id = ?`);
  const mergeEmptyWorkStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM books WHERE work_id = works.id)`);
  const workLinkStmt = db.prepare(`SELECT id, ol_work_key, merged_into FROM works WHERE id = ?`);
  const moveWorkEditionsStmt = db.prepare(`UPDATE books SET work_id = ? WHERE work_id = ?`);
  const fillWorkFromEditionsStmt = db.prepare(`
    UPDATE works
    SET title = CASE WHEN title = '' THEN COALESCE((SELECT title FROM books WHERE work_id = works.id AND title <> '' ORDER BY created_at, rowid LIMIT 1), '') ELSE title END,
        author = CASE WHEN author = '' THEN COALESCE((SELECT author FROM books WHERE work_id = works.id AND author <> '' ORDER BY created_at, rowid LIMIT 1), '') ELSE author END
    WHERE id = ? AND (title = '' OR author = '')
  `);
  const markMergedStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE id = ?`);
  const repointMergedStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE merged_into = ?`);
  const blockTitleGroupStmt = db.prepare(`UPDATE books SET title_group_blocked_at = ? WHERE id = ?`);
  const editionCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM books WHERE work_id = ?`);
  const workStmt = db.prepare(`SELECT id, ol_work_key, title, author FROM works WHERE id = ?`);
  const aliasStmt = db.prepare(`SELECT id FROM works WHERE merged_into = ?`);
  const pageEditionsStmt = db.prepare(`SELECT id, title, language, year, isbn, summary, cover_image_id FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
  const workEditionsStmt = db.prepare(`SELECT id, isbn, title, author, ol_work_key FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
  const groupablePairsStmt = db.prepare(`
    WITH candidates AS (
      SELECT works.id AS work_id, MIN(books.title_key) AS title_key, works.created_at AS created_at
      FROM works JOIN books ON books.work_id = works.id
      WHERE works.ol_work_key IS NULL AND works.merged_into IS NULL
      GROUP BY works.id
      HAVING COUNT(books.title_key) = COUNT(*)
        AND COUNT(DISTINCT books.title_key) = 1
        AND MIN(books.title_key) <> ''
        AND COUNT(books.title_group_blocked_at) = 0
    ),
    keyed AS (
      SELECT books.title_key AS title_key, MIN(works.id) AS target, COUNT(DISTINCT works.id) AS works
      FROM books JOIN works ON works.id = books.work_id
      WHERE works.ol_work_key IS NOT NULL AND works.merged_into IS NULL
        AND books.title_group_blocked_at IS NULL
        AND books.title_key IN (SELECT title_key FROM candidates)
      GROUP BY books.title_key
    ),
    oldest AS (
      SELECT title_key, work_id AS target
      FROM (SELECT title_key, work_id, ROW_NUMBER() OVER (PARTITION BY title_key ORDER BY created_at, work_id) AS rank FROM candidates)
      WHERE rank = 1
    )
    SELECT candidates.work_id AS source, COALESCE(keyed.target, oldest.target) AS target
    FROM candidates
    JOIN oldest ON oldest.title_key = candidates.title_key
    LEFT JOIN keyed ON keyed.title_key = candidates.title_key
    WHERE keyed.works = 1 OR (keyed.title_key IS NULL AND candidates.work_id <> oldest.target)
    ORDER BY candidates.created_at, candidates.work_id
    LIMIT ?
  `);
  const workLookupStmt = db.prepare(`
    SELECT id FROM books
    WHERE ol_work_key IS NULL AND isbn IS NOT NULL AND details_status IS NOT NULL
      AND (created_by IS NULL OR created_by <> 'publisher')
      AND (work_checked_at IS NULL OR work_checked_at < ?)
    ORDER BY work_checked_at IS NOT NULL, created_by IS NOT NULL, work_checked_at, created_at, rowid
    LIMIT ?
  `);
  const workCheckedStmt = db.prepare(`UPDATE books SET work_checked_at = ? WHERE id = ?`);
  const replaceLanguageStmt = db.prepare(`UPDATE books SET language = ? WHERE id = ?`);
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
  const setCoverIfStmt = db.prepare(`UPDATE books SET cover_image_id = ?, cover_status = ?, cover_checked_at = ? WHERE id = ? AND cover_image_id IS ?`);
  const addRejectionStmt = db.prepare(`INSERT OR IGNORE INTO cover_rejections (book_id, source_url, created_at) VALUES (?, ?, ?)`);
  const rejectionsStmt = db.prepare(`SELECT source_url FROM cover_rejections WHERE book_id = ?`);
  const takesSummary = `$summary IS NOT NULL AND (summary IS NULL OR summary = '' OR $summary_source = 'publisher')`;
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
  const detailsAttemptedStmt = db.prepare(`UPDATE books SET details_checked_at = ? WHERE id = ?`);
  const searchStmt = db.prepare(`
    SELECT books.* FROM books_fts JOIN books ON books.id = books_fts.book_id
    WHERE books_fts MATCH ? ORDER BY bm25(books_fts) LIMIT ?
  `);

  const uncheckedStmt = db.prepare(`
    SELECT id FROM books WHERE cover_checked_at IS NULL AND (cover_status IS NULL OR cover_status = 'low_res') ORDER BY created_at, rowid
  `);
  const uncheckedDetailsStmt = db.prepare(`
    SELECT id FROM books WHERE details_status IS NULL ORDER BY details_checked_at IS NOT NULL, created_by IS NOT NULL, details_checked_at, created_at, rowid LIMIT ?
  `);
  const setUpgradeWantedStmt = db.prepare(`UPDATE books SET cover_upgrade_wanted_at = ? WHERE id = ?`);
  const setAppleCheckedStmt = db.prepare(`UPDATE books SET apple_checked_at = ? WHERE id = ?`);
  const setWorkKeyStmt = db.prepare(`UPDATE books SET ol_work_key = ? WHERE id = ? AND ol_work_key IS NULL`);
  const setLanguageStmt = db.prepare(`UPDATE books SET language = ? WHERE id = ? AND language IS NULL`);
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

  function inTransaction<T>(write: () => T): T {
    if (db.isTransaction) return write();
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

  function insertWork(workKey: string | null, title: string, author: string, createdAt: string): string {
    const id = randomUUID();
    insertWorkStmt.run(id, workKey, title, author, createdAt);
    return id;
  }

  type WorkLink = { id: string; ol_work_key: string | null; merged_into: string | null };

  function liveWorkId(id: string): string | null {
    const work = workLinkStmt.get(id) as WorkLink | undefined;
    if (!work) return null;
    if (!work.merged_into) return work.id;
    const target = workLinkStmt.get(work.merged_into) as WorkLink | undefined;
    if (!target || target.merged_into) throw new Error(`Work ${id} does not resolve in one hop.`);
    return target.id;
  }

  function mergeInto(from: string, into: string) {
    moveWorkEditionsStmt.run(into, from);
    fillWorkFromEditionsStmt.run(into);
    markMergedStmt.run(into, from);
    repointMergedStmt.run(into, from);
  }

  type UnassignedBook = { id: string; ol_work_key: string | null; title: string; author: string; created_at: string };

  function giveWork(row: UnassignedBook): string {
    const held = row.ol_work_key ? (workByKeyStmt.get(row.ol_work_key) as { id: string } | undefined) : undefined;
    const workId = held?.id ?? insertWork(row.ol_work_key, row.title, row.author, row.created_at);
    moveBookStmt.run(workId, row.id);
    if (held) fillWorkIdentityStmt.run(row.id);
    return workId;
  }

  return {
    transaction: inTransaction,

    canonicalWorkIds(ids) {
      const rows = canonicalWorksStmt.all(JSON.stringify(ids)) as Array<{ id: string; canonical: string }>;
      return new Map(rows.map((row) => [row.id, row.canonical]));
    },

    findBookByKey: (key) => byKeyStmt.get(key) as BookRow | undefined,

    findBooksByKeys(keys) {
      const rows = byKeysStmt.all(JSON.stringify(keys)) as unknown as Array<BookRow & { key: string }>;
      return new Map(rows.map(({ key, ...book }) => [key, book as BookRow]));
    },

    getBook: (id) => byIdStmt.get(id) as BookRow | undefined,

    createBook(input, keys, createdAt) {
      return inTransaction(() => {
        const existing = keys.map((key) => byKeyStmt.get(key) as BookRow | undefined).find(Boolean);
        if (existing) return existing;
        const workKey = normalizeWorkKey(input.workKey);
        const held = workKey ? (workByKeyStmt.get(workKey) as { id: string } | undefined) : undefined;
        const workId = held?.id ?? insertWork(workKey, input.title, input.author, createdAt);
        const id = randomUUID();
        insertBookStmt.run({
          $id: id,
          $title: input.title,
          $author: input.author,
          $year: input.year ?? null,
          $publisher: input.publisher ?? null,
          $isbn: input.isbn,
          $ol_cover_id: input.olCoverId ?? null,
          $ol_work_key: workKey,
          $work_id: workId,
          $genres: JSON.stringify(input.genres ?? []),
          $data_sources: JSON.stringify(input.sources ?? []),
          $created_by: input.createdBy ?? null,
          $title_key: input.title ? workTitleKey(input.title, input.author) : null,
          $created_at: createdAt
        });
        for (const key of keys) insertKeyIfMissingStmt.run(key, id);
        if (held) fillWorkIdentityStmt.run(id);
        return byIdStmt.get(id) as unknown as BookRow;
      });
    },

    addKey(key, bookId) {
      insertKeyIfMissingStmt.run(key, bookId);
    },

    fillIdentity(id, title, author) {
      inTransaction(() => {
        fillIdentityStmt.run(title, author, title ? workTitleKey(title, author) : null, id);
        fillWorkIdentityStmt.run(id);
      });
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

    setCoverIf(bookId, expectedImageId, cover) {
      return setCoverIfStmt.run(cover.imageId, cover.status, cover.checkedAt, bookId, expectedImageId).changes > 0;
    },

    addRejection(bookId, sourceUrl, createdAt) {
      addRejectionStmt.run(bookId, sourceUrl, createdAt);
    },

    listRejectedUrls(bookId) {
      return new Set((rejectionsStmt.all(bookId) as Array<{ source_url: string }>).map((row) => row.source_url));
    },

    saveDetails(bookId, details, sources, summarySource, checkedAt) {
      inTransaction(() => {
        mergeDetails(bookId, details, summarySource);
        const stored = JSON.parse((byIdStmt.get(bookId) as BookRow | undefined)?.data_sources ?? "[]") as DataSource[];
        saveDetailsStmt.run(details.rating, details.ratingCount, JSON.stringify(details.genres), JSON.stringify([...new Set([...stored, ...sources])]), details.sourceUrl, checkedAt, bookId);
      });
    },

    mergeDetails,

    markDetailsMissing(bookId, checkedAt) {
      detailsMissingStmt.run(checkedAt, bookId);
    },

    markDetailsAttempted(bookId, checkedAt) {
      detailsAttemptedStmt.run(checkedAt, bookId);
    },

    searchBooks(tokens, limit) {
      if (tokens.length === 0) return [];
      return searchStmt.all(tokens.map((token) => `"${token}"`).join(" "), limit) as unknown as BookRow[];
    },

    listUncheckedCoverIds() {
      return (uncheckedStmt.all() as Array<{ id: string }>).map((row) => row.id);
    },

    listUncheckedDetailIds(limit) {
      return (uncheckedDetailsStmt.all(limit) as Array<{ id: string }>).map((row) => row.id);
    },

    setUpgradeWanted(bookId, at) {
      setUpgradeWantedStmt.run(at, bookId);
    },

    setAppleChecked(bookId, at) {
      setAppleCheckedStmt.run(at, bookId);
    },

    setWorkKey(id, key) {
      const workKey = normalizeWorkKey(key);
      if (!workKey) return;
      inTransaction(() => {
        if (setWorkKeyStmt.run(workKey, id).changes === 0) return;
        const book = byIdStmt.get(id) as unknown as BookRow;
        const held = workByKeyStmt.get(workKey) as { id: string } | undefined;
        if (!held && book.work_id && keyOwnWorkStmt.run(workKey, book.work_id, id).changes === 1) return;
        const target = held?.id ?? insertWork(workKey, book.title, book.author, book.created_at);
        moveBookStmt.run(target, id);
        if (book.work_id && mergeEmptyWorkStmt.run(target, book.work_id).changes === 1) repointMergedStmt.run(target, book.work_id);
        fillWorkIdentityStmt.run(id);
      });
    },

    assignMissingWorks(limit) {
      return inTransaction(() => {
        const rows = unassignedStmt.all(limit) as unknown as UnassignedBook[];
        for (const row of rows) giveWork(row);
        return rows.length;
      });
    },

    fillTitleKeys(limit) {
      return inTransaction(() => {
        const rows = missingTitleKeyStmt.all(limit) as Array<{ id: string; title: string; author: string }>;
        for (const row of rows) setTitleKeyStmt.run(workTitleKey(row.title, row.author), row.id);
        return rows.length;
      });
    },

    mergeWorks(fromId, intoId) {
      return inTransaction(() => {
        const from = workLinkStmt.get(fromId) as WorkLink | undefined;
        if (!from) throw new WorkMergeError("No such work.");
        if (from.merged_into) throw new WorkMergeError("That work was already merged.");
        if (from.ol_work_key) throw new WorkMergeError("A work with an Open Library key is never merged into another.");
        const into = liveWorkId(intoId);
        if (!into) throw new WorkMergeError("No such work.");
        if (into === from.id) throw new WorkMergeError("Those editions already share a work.");
        mergeInto(from.id, into);
        return into;
      });
    },

    detachEdition(bookId, at) {
      return inTransaction(() => {
        const book = byIdStmt.get(bookId) as BookRow | undefined;
        if (!book) throw new WorkMergeError("No such edition.");
        if (book.ol_work_key) throw new WorkMergeError("An edition with an Open Library key stays in that work.");
        if (!book.work_id) throw new WorkMergeError("That edition has no work yet.");
        blockTitleGroupStmt.run(at, bookId);
        if ((editionCountStmt.get(book.work_id) as { n: number }).n === 1) return book.work_id;
        const own = insertWork(null, book.title, book.author, at);
        moveBookStmt.run(own, bookId);
        return own;
      });
    },

    resolveWorkId: (id) => liveWorkId(id),

    getWorkView(id) {
      const work = workStmt.get(id) as { id: string; ol_work_key: string | null; title: string; author: string } | undefined;
      if (!work) return undefined;
      const editions = workEditionsStmt.all(id) as Array<{ id: string; isbn: string | null; title: string; author: string; ol_work_key: string | null }>;
      return {
        id: work.id,
        olWorkKey: work.ol_work_key,
        title: work.title,
        author: work.author,
        editions: editions.map((edition) => ({ id: edition.id, isbn: edition.isbn, title: edition.title, author: edition.author, olWorkKey: edition.ol_work_key }))
      } satisfies WorkView;
    },

    workPageRows(id) {
      const canonical = liveWorkId(id);
      if (canonical === null) return undefined;
      const work = workStmt.get(canonical) as { id: string; title: string; author: string } | undefined;
      if (!work) return undefined;
      const aliases = (aliasStmt.all(canonical) as Array<{ id: string }>).map((row) => row.id);
      return {
        work: { id: work.id, title: work.title, author: work.author },
        aliasIds: [canonical, ...aliases],
        editions: pageEditionsStmt.all(canonical) as WorkPageRows["editions"]
      };
    },

    groupKeylessWorks(limit) {
      return inTransaction(() => {
        const pairs = groupablePairsStmt.all(limit) as Array<{ source: string; target: string }>;
        for (const pair of pairs) mergeInto(pair.source, pair.target);
        return pairs.length;
      });
    },

    listWorkLookupIds(limit, recheckBefore) {
      return (workLookupStmt.all(recheckBefore, limit) as Array<{ id: string }>).map((row) => row.id);
    },

    markWorkChecked(id, at) {
      workCheckedStmt.run(at, id);
    },

    replaceLanguage(id, tag) {
      replaceLanguageStmt.run(tag, id);
    },

    assignWork(bookId) {
      return inTransaction(() => {
        const book = byIdStmt.get(bookId) as unknown as (UnassignedBook & { work_id: string | null }) | undefined;
        if (!book) throw new Error(`Unknown book ${bookId}`);
        return book.work_id ?? giveWork(book);
      });
    },

    setLanguage(id, tag) {
      if (tag) setLanguageStmt.run(tag, id);
    },

    setPublisherUrl(id, url) {
      setPublisherUrlStmt.run(url, id);
    },

    listUpgradeWantedIds() {
      return (upgradeWantedStmt.all() as Array<{ id: string }>).map((row) => row.id);
    }
  };
}
