import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { MIN_PREFIX_LENGTH, normalizeWorkKey, workTitleKey } from "../../domain/normalize.js";
import type { BooksRepository, IdPage, MergeableDetails, PageCursor } from "../../domain/ports.js";
import { WorkMergeError } from "../../domain/errors.js";
import type { BookRow, CoverImageRow, DataSource, GenreEvidence, SummarySource, WorkPageRows, WorkView } from "../../domain/types.js";

export const UNCHECKED_COVERS_SQL = `
  SELECT id, created_at AS at, rowid AS row FROM books
  WHERE cover_checked_at IS NULL AND (cover_status IS NULL OR cover_status = 'low_res') AND (created_at, rowid) > (?, ?)
  ORDER BY created_at, rowid LIMIT ?
`;
export const UPGRADE_WANTED_SQL = `
  SELECT id, cover_upgrade_wanted_at AS at, rowid AS row FROM books
  WHERE cover_upgrade_wanted_at IS NOT NULL AND (cover_upgrade_wanted_at, rowid) > (?, ?)
  ORDER BY cover_upgrade_wanted_at, rowid LIMIT ?
`;

export const UNCHECKED_DETAILS_SQL = `
  SELECT id FROM books WHERE details_status IS NULL
  ORDER BY details_checked_at IS NOT NULL, created_by IS NOT NULL, details_checked_at, created_at, rowid LIMIT ?
`;
export const WORK_LOOKUP_SQL = `
  SELECT id FROM books
  WHERE ol_work_key IS NULL AND isbn IS NOT NULL AND details_status IS NOT NULL
    AND (created_by IS NULL OR created_by <> 'publisher')
    AND (work_checked_at IS NULL OR work_checked_at < ?)
  ORDER BY work_checked_at IS NOT NULL, created_by IS NOT NULL, work_checked_at, created_at, rowid
  LIMIT ?
`;
export const CONFIRMED_SQL = "(created_by IS NOT NULL OR data_sources <> '[]')";

function idPage(stmt: StatementSync, after: PageCursor | null, limit: number): IdPage {
  const rows = stmt.all(after?.at ?? "", after?.row ?? 0, limit) as Array<{ id: string; at: string; row: number }>;
  const last = rows[rows.length - 1];
  return { ids: rows.map((row) => row.id), next: rows.length === limit && last ? { at: last.at, row: last.row } : null };
}

function matchExpression(tokens: string[]): string {
  return tokens.map((token, index) => (index === tokens.length - 1 && token.length >= MIN_PREFIX_LENGTH ? `"${token}"*` : `"${token}"`)).join(" ");
}

export function createSqliteBooksRepository(db: DatabaseSync): BooksRepository {
  const byKeyStmt = db.prepare(`SELECT books.* FROM book_keys JOIN books ON books.id = book_keys.book_id WHERE book_keys.key = ?`);
  const byKeysStmt = db.prepare(`SELECT book_keys.key AS key, books.* FROM book_keys JOIN books ON books.id = book_keys.book_id WHERE book_keys.key IN (SELECT value FROM json_each(?))`);
  const byIdStmt = db.prepare(`SELECT * FROM books WHERE id = ?`);
  const insertBookStmt = db.prepare(`
    INSERT INTO books (id, title, author, year, publisher, isbn, ol_cover_id, ol_work_key, work_id, genres, data_sources, created_by, title_key, created_at)
    VALUES ($id, $title, $author, $year, $publisher, $isbn, $ol_cover_id, $ol_work_key, $work_id, $genres, $data_sources, $created_by, $title_key, $created_at)
  `);
  const insertKeyIfMissingStmt = db.prepare(`INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)`);
  const fillIdentityStmt = db.prepare(`UPDATE books SET title = ?, author = ?, title_key = ? WHERE id = ? AND (title = '' OR author = '')`);
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
  const aliasesOfStmt = db.prepare(`SELECT id FROM works WHERE merged_into IN (SELECT value FROM json_each(?))`);
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
  const setWorkSummaryStmt = db.prepare(`UPDATE works SET summary = ? WHERE id = ? AND summary IS NULL`);
  const carryWorkSummaryStmt = db.prepare(`UPDATE works SET summary = (SELECT summary FROM works WHERE id = ?) WHERE id = ? AND summary IS NULL`);
  const workSummaryStmt = db.prepare(`
    SELECT target.summary AS summary, target.ol_work_key AS olWorkKey
    FROM books JOIN works AS own ON own.id = books.work_id JOIN works AS target ON target.id = COALESCE(own.merged_into, own.id)
    WHERE books.id = ?
  `);
  const markMergedStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE id = ?`);
  const repointMergedStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE merged_into = ?`);
  const blockTitleGroupStmt = db.prepare(`UPDATE books SET title_group_blocked_at = ? WHERE id = ?`);
  const editionCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM books WHERE work_id = ?`);
  const workStmt = db.prepare(`SELECT id, ol_work_key, title, author, summary FROM works WHERE id = ?`);
  const evidenceEditionsStmt = db.prepare(`SELECT title, language, isbn, publisher, year, summary FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
  const setManualGenresStmt = db.prepare(`
    UPDATE books SET genres = $genres, genres_source = 'manual', genres_confidence = NULL
    WHERE work_id = $work_id
      AND (genres = '[]' OR genres_source IN ('jev', 'manual'))
      AND NOT (genres = $genres AND genres_source = 'manual')
  `);
  const aliasStmt = db.prepare(`SELECT id FROM works WHERE merged_into = ?`);
  const editionGenresStmt = db.prepare(`SELECT work_id, genres, genres_source, genres_confidence FROM books WHERE work_id IN (SELECT value FROM json_each(?)) AND genres <> '[]' ORDER BY created_at, rowid`);
  const workIdsByKeysStmt = db.prepare(`SELECT ol_work_key AS key, COALESCE(merged_into, id) AS id FROM works WHERE ol_work_key IN (SELECT value FROM json_each(?))`);
  const publisherUrlsStmt = db.prepare(`SELECT work_id, publisher_url FROM books WHERE publisher_url IS NOT NULL ORDER BY created_at, rowid`);
  const fillSourceGenresStmt = db.prepare(`UPDATE books SET genres = ?, genres_source = NULL, genres_confidence = NULL WHERE work_id = ? AND genres = '[]'`);
  const countEmptyGenreEditionsStmt = db.prepare(`SELECT COUNT(*) AS n FROM books WHERE work_id = ? AND genres = '[]'`);
  const pageEditionsStmt = db.prepare(`SELECT books.id, books.title, books.language, books.year, books.isbn, books.summary, books.cover_image_id, ci.color AS cover_color, books.genres, books.rating, books.rating_count, books.pages, books.genres_source, books.genres_confidence FROM books LEFT JOIN cover_images ci ON ci.id = books.cover_image_id WHERE books.work_id = ? ORDER BY books.created_at, books.rowid`);
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
  const workLookupStmt = db.prepare(WORK_LOOKUP_SQL);
  const workCheckedStmt = db.prepare(`UPDATE books SET work_checked_at = ? WHERE id = ?`);
  const replaceLanguageStmt = db.prepare(`UPDATE books SET language = ? WHERE id = ?`);
  const makeSearchableStmt = db.prepare(`
    INSERT INTO books_fts (book_id, title, author)
    SELECT id, title, author FROM books
    WHERE id = ? AND title <> '' AND NOT EXISTS (SELECT 1 FROM books_search WHERE book_id = books.id)
  `);
  const refreshSearchStmt = db.prepare(`UPDATE books_fts SET title = ?, author = ? WHERE book_id = ?`);
  const markSearchableStmt = db.prepare(`INSERT OR IGNORE INTO books_search (book_id) VALUES (?)`);
  const searchableStmt = db.prepare(`SELECT 1 FROM books_search WHERE book_id = ?`);
  const confirmedStmt = db.prepare(`SELECT 1 FROM books WHERE id = ? AND ${CONFIRMED_SQL}`);
  const imageStmt = db.prepare(`SELECT * FROM cover_images WHERE id = ?`);
  const insertImageStmt = db.prepare(`
    INSERT INTO cover_images (id, book_id, source, source_url, origin, width, height, byte_size, color, created_at)
    VALUES ($id, $book_id, $source, $source_url, $origin, $width, $height, $byte_size, $color, $created_at)
  `);
  const pendingColorStmt = db.prepare(`SELECT id FROM cover_images WHERE color IS NULL LIMIT ?`);
  const setImageColorStmt = db.prepare(`UPDATE cover_images SET color = ? WHERE id = ?`);
  const setCoverStmt = db.prepare(`UPDATE books SET cover_image_id = ?, cover_status = ?, cover_checked_at = ? WHERE id = ?`);
  const setCoverIfStmt = db.prepare(`UPDATE books SET cover_image_id = ?, cover_status = ?, cover_checked_at = ? WHERE id = ? AND cover_image_id IS ?`);
  const addRejectionStmt = db.prepare(`INSERT OR IGNORE INTO cover_rejections (book_id, source_url, created_at) VALUES (?, ?, ?)`);
  const rejectionsStmt = db.prepare(`SELECT source_url FROM cover_rejections WHERE book_id = ?`);
  const workCoversStmt = db.prepare(`SELECT work_id, cover_image_id FROM books WHERE work_id IN (SELECT value FROM json_each(?)) AND cover_image_id IS NOT NULL ORDER BY created_at, rowid`);
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
    SET rating = $rating, rating_count = $rating_count,
        genres = CASE WHEN genres = '[]' OR (genres_source = 'jev' AND $genres <> '[]') THEN $genres ELSE genres END,
        genres_source = CASE WHEN genres_source = 'jev' AND $genres <> '[]' THEN NULL ELSE genres_source END,
        genres_confidence = CASE WHEN genres_source = 'jev' AND $genres <> '[]' THEN NULL ELSE genres_confidence END,
        data_sources = $data_sources, source_url = $source_url, details_status = 'found', details_checked_at = $checked_at
    WHERE id = $id
  `);
  const needingJudgmentStmt = db.prepare(`
    SELECT w.value AS id FROM json_each(?) AS w
    WHERE NOT EXISTS (SELECT 1 FROM genre_judgments j WHERE j.work_id = w.value)
      AND NOT EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.value AND b.genres <> '[]' AND b.genres_source IS NOT 'jev')
      AND EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.value AND b.details_status IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM genre_rejections r WHERE r.work_id = w.value AND r.attempts >= ?)
    LIMIT ?
  `);
  const saveJudgmentStmt = db.prepare(`INSERT OR REPLACE INTO genre_judgments (work_id, model, genre, confidence, asked_at) VALUES (?, ?, ?, ?, ?)`);
  const judgmentsStmt = db.prepare(`SELECT work_id, model, genre, confidence FROM genre_judgments WHERE work_id IN (SELECT value FROM json_each(?))`);
  const applyJudgmentsStmt = db.prepare(`
    UPDATE books SET genres = json_array(j.genre), genres_source = 'jev', genres_confidence = j.confidence
    FROM genre_judgments AS j
    WHERE books.work_id = j.work_id AND j.genre IS NOT NULL AND j.confidence >= ?
      AND (books.genres = '[]' OR books.genres_source = 'jev')
      AND NOT (books.genres = json_array(j.genre) AND books.genres_source = 'jev' AND books.genres_confidence IS j.confidence)
  `);
  const undoJudgmentsStmt = db.prepare(`
    UPDATE books SET genres = '[]', genres_source = NULL, genres_confidence = NULL
    WHERE genres_source = 'jev' AND work_id IN (SELECT work_id FROM genre_judgments WHERE genre IS NULL OR confidence < ?)
  `);
  const applyJudgmentForWorkStmt = db.prepare(`
    UPDATE books SET genres = json_array(j.genre), genres_source = 'jev', genres_confidence = j.confidence
    FROM genre_judgments AS j
    WHERE books.work_id = ? AND j.work_id = books.work_id AND j.genre IS NOT NULL AND j.confidence >= ?
      AND (books.genres = '[]' OR books.genres_source = 'jev')
      AND NOT (books.genres = json_array(j.genre) AND books.genres_source = 'jev' AND books.genres_confidence IS j.confidence)
  `);
  const undoJudgmentForWorkStmt = db.prepare(`
    UPDATE books SET genres = '[]', genres_source = NULL, genres_confidence = NULL
    WHERE work_id = ? AND genres_source = 'jev'
      AND EXISTS (SELECT 1 FROM genre_judgments j WHERE j.work_id = books.work_id AND (j.genre IS NULL OR j.confidence < ?))
  `);
  const deleteJudgmentStmt = db.prepare(`DELETE FROM genre_judgments WHERE work_id = ? AND model <> 'manual'`);
  const recordGenreRejectionStmt = db.prepare(`
    INSERT INTO genre_rejections (work_id, status, reason, attempts, last_at) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (work_id) DO UPDATE SET status = excluded.status, reason = excluded.reason, attempts = attempts + 1, last_at = excluded.last_at
  `);
  const clearGenreRejectionStmt = db.prepare(`DELETE FROM genre_rejections WHERE work_id = ?`);
  const genreRejectionsStmt = db.prepare(`SELECT work_id, status, reason, attempts, last_at FROM genre_rejections WHERE work_id IN (SELECT value FROM json_each(?))`);
  const spendTypesafeStmt = db.prepare(`
    INSERT INTO typesafe_usage (day, source, requests) VALUES (?, ?, 1)
    ON CONFLICT (day, source) DO UPDATE SET requests = requests + 1 WHERE requests < ?
  `);
  const typesafeUsageStmt = db.prepare(`SELECT requests FROM typesafe_usage WHERE day = ? AND source = ?`);
  const detailsMissingStmt = db.prepare(`UPDATE books SET details_status = 'missing', details_checked_at = ? WHERE id = ?`);
  const detailsAttemptedStmt = db.prepare(`UPDATE books SET details_checked_at = ? WHERE id = ?`);
  const searchStmt = db.prepare(`
    SELECT books.* FROM books_fts JOIN books ON books.id = books_fts.book_id
    WHERE books_fts MATCH ? ORDER BY bm25(books_fts) LIMIT ?
  `);

  const uncheckedStmt = db.prepare(UNCHECKED_COVERS_SQL);
  const uncheckedDetailsStmt = db.prepare(UNCHECKED_DETAILS_SQL);
  const setUpgradeWantedStmt = db.prepare(`UPDATE books SET cover_upgrade_wanted_at = ? WHERE id = ?`);
  const setAppleCheckedStmt = db.prepare(`UPDATE books SET apple_checked_at = ? WHERE id = ?`);
  const setWorkKeyStmt = db.prepare(`UPDATE books SET ol_work_key = ? WHERE id = ? AND ol_work_key IS NULL`);
  const setLanguageStmt = db.prepare(`UPDATE books SET language = ? WHERE id = ? AND language IS NULL`);
  const blankTitledStmt = db.prepare(`SELECT id, publisher_url FROM books WHERE title = '' AND publisher_url IS NOT NULL`);
  const setPublisherUrlStmt = db.prepare(`UPDATE books SET publisher_url = ? WHERE id = ? AND publisher_url IS NULL`);
  const upgradeWantedStmt = db.prepare(UPGRADE_WANTED_SQL);

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

  function makeSearchable(id: string) {
    inTransaction(() => {
      if (makeSearchableStmt.run(id).changes > 0) markSearchableStmt.run(id);
    });
  }

  function makeSearchableIfConfirmed(id: string) {
    if (confirmedStmt.get(id)) makeSearchable(id);
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
    carryWorkSummaryStmt.run(from, into);
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
    aliasesOf(workIds) {
      return (aliasesOfStmt.all(JSON.stringify(workIds)) as Array<{ id: string }>).map((row) => row.id);
    },
    editionGenres(workIds) {
      return editionGenresStmt.all(JSON.stringify(workIds)) as unknown as ReturnType<BooksRepository["editionGenres"]>;
    },
    workIdsByWorkKeys(keys) {
      const rows = workIdsByKeysStmt.all(JSON.stringify(keys)) as Array<{ key: string; id: string }>;
      return new Map(rows.map((row) => [row.key, row.id]));
    },
    listPublisherUrls() {
      const rows = publisherUrlsStmt.all() as Array<{ work_id: string | null; publisher_url: string }>;
      return rows.map((row) => ({ work_id: row.work_id, publisher_url: row.publisher_url }));
    },
    fillSourceGenres(workId, genres) {
      return Number(fillSourceGenresStmt.run(JSON.stringify(genres), workId).changes);
    },
    countEmptyGenreEditions(workId) {
      return Number((countEmptyGenreEditionsStmt.get(workId) as { n: number }).n);
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
        makeSearchableIfConfirmed(id);
        return byIdStmt.get(id) as unknown as BookRow;
      });
    },

    addKey(key, bookId) {
      insertKeyIfMissingStmt.run(key, bookId);
    },

    fillIdentity(id, title, author) {
      inTransaction(() => {
        const row = byIdStmt.get(id) as BookRow | undefined;
        if (!row || (row.title !== "" && row.author !== "")) return;
        const nextTitle = row.title || title;
        const nextAuthor = row.author || author;
        if (nextTitle === row.title && nextAuthor === row.author) return;
        fillIdentityStmt.run(nextTitle, nextAuthor, nextTitle ? workTitleKey(nextTitle, nextAuthor) : null, id);
        fillWorkIdentityStmt.run(id);
        if (searchableStmt.get(id)) refreshSearchStmt.run(nextTitle, nextAuthor, id);
        else makeSearchableIfConfirmed(id);
      });
    },

    makeSearchable,

    listBlankTitled() {
      return blankTitledStmt.all() as Array<{ id: string; publisher_url: string }>;
    },
    isSearchable: (id) => searchableStmt.get(id) !== undefined,

    getImage: (id) => imageStmt.get(id) as CoverImageRow | undefined,

    listPendingColorImageIds: (limit) => (pendingColorStmt.all(limit) as Array<{ id: string }>).map((row) => row.id),

    setImageColor(id, color) {
      setImageColorStmt.run(color, id);
    },

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
        $color: row.color,
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
        saveDetailsStmt.run({ $rating: details.rating, $rating_count: details.ratingCount, $genres: JSON.stringify(details.genres), $data_sources: JSON.stringify([...new Set([...stored, ...sources])]), $source_url: details.sourceUrl, $checked_at: checkedAt, $id: bookId });
        makeSearchableIfConfirmed(bookId);
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
      return searchStmt.all(matchExpression(tokens), limit) as unknown as BookRow[];
    },

    listUncheckedCoverIds(after, limit) {
      return idPage(uncheckedStmt, after, limit);
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

    worksNeedingGenreJudgment(workIds, limit, rejectionLimit) {
      return (needingJudgmentStmt.all(JSON.stringify(workIds), rejectionLimit, limit) as Array<{ id: string }>).map((row) => row.id);
    },
    saveGenreJudgment(judgment) {
      saveJudgmentStmt.run(judgment.workId, judgment.model, judgment.genre, judgment.confidence, judgment.askedAt);
    },
    genreJudgments(workIds) {
      const rows = judgmentsStmt.all(JSON.stringify(workIds)) as Array<{ work_id: string; model: string; genre: string | null; confidence: number }>;
      return new Map(rows.map((row) => [row.work_id, { model: row.model, genre: row.genre, confidence: row.confidence }]));
    },
    applyGenreJudgments(saveLine) {
      inTransaction(() => {
        undoJudgmentsStmt.run(saveLine);
        applyJudgmentsStmt.run(saveLine);
      });
    },
    applyGenreJudgment(workId, saveLine) {
      inTransaction(() => {
        undoJudgmentForWorkStmt.run(workId, saveLine);
        applyJudgmentForWorkStmt.run(workId, saveLine);
      });
    },
    deleteGenreJudgment(workId) {
      deleteJudgmentStmt.run(workId);
    },
    recordGenreRejection(rejection) {
      recordGenreRejectionStmt.run(rejection.workId, rejection.status, rejection.reason, rejection.at);
    },
    clearGenreRejection(workId) {
      clearGenreRejectionStmt.run(workId);
    },
    genreRejections(workIds) {
      const rows = genreRejectionsStmt.all(JSON.stringify(workIds)) as Array<{ work_id: string; status: number | null; reason: string; attempts: number; last_at: string }>;
      return new Map(rows.map((row) => [row.work_id, { status: row.status, reason: row.reason, attempts: row.attempts, lastAt: row.last_at }]));
    },
    workCoverImageIds(workIds) {
      const covers = new Map<string, string>();
      for (const row of workCoversStmt.all(JSON.stringify(workIds)) as Array<{ work_id: string; cover_image_id: string }>) {
        if (!covers.has(row.work_id)) covers.set(row.work_id, row.cover_image_id);
      }
      return covers;
    },
    spendTypesafe(day, source, limit) {
      return Number(spendTypesafeStmt.run(day, source, limit).changes) > 0;
    },
    typesafeUsage(day, source) {
      return (typesafeUsageStmt.get(day, source) as { requests: number } | undefined)?.requests ?? 0;
    },

    genreEvidence(workId) {
      const work = workStmt.get(workId) as { id: string; title: string; author: string; summary: string | null } | undefined;
      if (!work) return undefined;
      return { work: { id: work.id, title: work.title, author: work.author, summary: work.summary }, editions: evidenceEditionsStmt.all(workId) as GenreEvidence["editions"] };
    },

    setManualGenres(workId, genres) {
      return Number(setManualGenresStmt.run({ $genres: JSON.stringify(genres), $work_id: workId }).changes);
    },

    workPageRows(id) {
      const canonical = liveWorkId(id);
      if (canonical === null) return undefined;
      const work = workStmt.get(canonical) as { id: string; title: string; author: string; summary: string | null } | undefined;
      if (!work) return undefined;
      const aliases = (aliasStmt.all(canonical) as Array<{ id: string }>).map((row) => row.id);
      return {
        work: { id: work.id, title: work.title, author: work.author, summary: work.summary },
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

    setWorkSummary(bookId, summary) {
      inTransaction(() => {
        const book = byIdStmt.get(bookId) as unknown as (UnassignedBook & { work_id: string | null }) | undefined;
        if (!book) throw new Error(`Unknown book ${bookId}`);
        const workId = liveWorkId(book.work_id ?? giveWork(book));
        if (workId) setWorkSummaryStmt.run(summary, workId);
      });
    },

    getWorkSummary: (bookId) => workSummaryStmt.get(bookId) as { summary: string | null; olWorkKey: string | null } | undefined,

    setLanguage(id, tag) {
      if (tag) setLanguageStmt.run(tag, id);
    },

    setPublisherUrl(id, url) {
      setPublisherUrlStmt.run(url, id);
    },

    listUpgradeWantedIds(after, limit) {
      return idPage(upgradeWantedStmt, after, limit);
    }
  };
}
