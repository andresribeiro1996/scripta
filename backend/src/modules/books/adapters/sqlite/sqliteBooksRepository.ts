import { randomUUID } from "node:crypto";
import { cleanSummary } from "@scripta/shared";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { MIN_PREFIX_LENGTH, normalizeWorkKey, WORK_SCAN_LIMIT, workTitleKey } from "../../domain/normalize.js";
import type { BooksRepository, IdPage, MergeableDetails, PageCursor } from "../../domain/ports.js";
import { GENRE_SAVE_LINE } from "../../domain/constants.js";
import { planTitleFolds, type KeyedWork, type TitleWork } from "../../domain/duplicateWorks.js";
import { WorkMergeError } from "../../domain/errors.js";
import { wantsRetitle } from "../../domain/lossy.js";
import { SERIES_SOURCE_RANK, seriesNameKey, type SeriesEntry, type SeriesSource } from "../../domain/series.js";
import { summaryHashOf, type SynopsisKind } from "../../domain/synopsis.js";
import { isOriginalTitle, originalKey, originalTitleIn, originalWholeKey } from "../../domain/translation.js";
import type { BookRow, CoverImageRow, DataSource, GenreEvidence, LossyBook, MergeSource, SummarySource, WorkPageRows, WorkView } from "../../domain/types.js";

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

export const ORIGINAL_CLAIMS_SQL = `
  SELECT work_id, title, author, language, original_title FROM books WHERE original_key = ?
`;

export const ORIGINAL_KEYS_OF_WHOLE_SQL = `
  SELECT DISTINCT original_key FROM books WHERE original_whole_key = ? AND original_key IS NOT NULL
`;

export const UNCHECKED_DETAILS_SQL = `
  SELECT id FROM books WHERE details_status IS NULL AND created_by IS NOT 'bnp'
  ORDER BY details_checked_at IS NOT NULL, created_by IS NOT NULL, details_checked_at, created_at, rowid LIMIT ?
`;
export const HELD_BNP_DETAILS_SQL = `
  SELECT id FROM books
  WHERE work_id IN (SELECT value FROM json_each(?)) AND created_by = 'bnp' AND details_status IS NULL
  ORDER BY details_checked_at IS NOT NULL, details_checked_at, created_at, rowid LIMIT ?
`;
export const WORK_LOOKUP_SQL = `
  SELECT id FROM books
  WHERE ol_work_key IS NULL AND isbn IS NOT NULL AND details_status IS NOT NULL
    AND (created_by IS NULL OR created_by <> 'publisher')
    AND (work_checked_at IS NOT NULL) IN (0, 1) AND (created_by IS NOT NULL) IN (0, 1)
    AND coalesce(work_checked_at, '') < ?
  ORDER BY work_checked_at IS NOT NULL, created_by IS NOT NULL, coalesce(work_checked_at, ''), created_at, rowid
  LIMIT ?
`;
export const GROUPABLE_KEYS_SQL = `
  SELECT title_key FROM books
  WHERE title_key > ?
  GROUP BY title_key
  HAVING COUNT(DISTINCT work_id) > 1
  ORDER BY title_key
  LIMIT ?
`;
const GROUPABLE_CANDIDATES_CTE = `candidates AS (
    SELECT works.id AS work_id, MIN(books.title_key) AS title_key, works.created_at AS created_at
    FROM (SELECT DISTINCT work_id FROM books WHERE title_key IN (SELECT value FROM json_each(?))) AS hits
    CROSS JOIN works ON works.id = hits.work_id
    CROSS JOIN books ON books.work_id = works.id
    WHERE works.ol_work_key IS NULL AND works.merged_into IS NULL
    GROUP BY works.id
    HAVING COUNT(books.title_key) = COUNT(*)
      AND COUNT(DISTINCT books.title_key) = 1
      AND MIN(books.title_key) <> ''
      AND COUNT(books.title_group_blocked_at) = 0
  )`;
export const KEYLESS_CANDIDATES_SQL = `
  WITH ${GROUPABLE_CANDIDATES_CTE}
  SELECT candidates.title_key AS title_key, candidates.work_id AS id, works.title AS title, candidates.created_at AS created_at
  FROM candidates JOIN works ON works.id = candidates.work_id
  ORDER BY candidates.title_key, candidates.created_at, candidates.work_id
`;
export const KEYED_EDITIONS_SQL = `
  SELECT hits.title_key AS title_key, works.id AS id, hits.title AS title, works.created_at AS created_at
  FROM (SELECT DISTINCT title_key, work_id, title FROM books WHERE title_key IN (SELECT value FROM json_each(?)) AND title_group_blocked_at IS NULL) AS hits
  CROSS JOIN works ON works.id = hits.work_id
  WHERE works.ol_work_key IS NOT NULL AND works.merged_into IS NULL
`;
export const KEYED_WORKS_SQL = `
  SELECT hits.title_key AS title_key, works.id AS id, works.title AS title, works.author AS author,
    (SELECT COUNT(*) FROM books WHERE work_id = works.id) AS editions, works.created_at AS created_at
  FROM (SELECT DISTINCT title_key, work_id FROM books WHERE title_key IN (SELECT value FROM json_each(?)) AND title_group_blocked_at IS NULL) AS hits
  CROSS JOIN works ON works.id = hits.work_id
  WHERE works.ol_work_key IS NOT NULL AND works.merged_into IS NULL
  ORDER BY hits.title_key, works.created_at, works.id
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

type SeriesCandidate = SeriesEntry & { nameKey: string; source: SeriesSource; rank: number; createdAt: string };

export function createSqliteBooksRepository(db: DatabaseSync): BooksRepository {
  const byKeyStmt = db.prepare(`SELECT books.* FROM book_keys JOIN books ON books.id = book_keys.book_id WHERE book_keys.key = ?`);
  const byKeysStmt = db.prepare(`SELECT book_keys.key AS key, books.* FROM book_keys JOIN books ON books.id = book_keys.book_id WHERE book_keys.key IN (SELECT value FROM json_each(?))`);
  const byIdStmt = db.prepare(`SELECT * FROM books WHERE id = ?`);
  const insertBookStmt = db.prepare(`
    INSERT INTO books (id, title, author, year, publisher, isbn, ol_cover_id, ol_work_key, work_id, genres, data_sources, created_by, title_key, retitle_wanted_at, created_at)
    VALUES ($id, $title, $author, $year, $publisher, $isbn, $ol_cover_id, $ol_work_key, $work_id, $genres, $data_sources, $created_by, $title_key, $retitle_wanted_at, $created_at)
  `);
  const insertKeyIfMissingStmt = db.prepare(`INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)`);
  const fillIdentityStmt = db.prepare(`UPDATE books SET title = ?, author = ?, title_key = ? WHERE id = ? AND (title = '' OR author = '')`);
  const workByKeyStmt = db.prepare(`SELECT COALESCE(merged_into, id) AS id FROM works WHERE ol_work_key = ?`);
  const insertWorkStmt = db.prepare(`INSERT INTO works (id, ol_work_key, title, author, created_at) VALUES (?, ?, ?, ?, ?)`);
  const fillWorkIdentityStmt = db.prepare(`
    UPDATE works
    SET title = CASE WHEN works.title = '' THEN books.title ELSE works.title END,
        author = CASE WHEN works.author = '' THEN books.author ELSE works.author END
    FROM books
    WHERE books.id = ? AND works.id = books.work_id AND (works.title = '' OR works.author = '')
    RETURNING works.id AS id
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
  const setWorkSummaryStmt = db.prepare(`UPDATE works SET summary = ?, summary_hash = ? WHERE id = ? AND summary IS NULL`);
  const carryWorkSummaryStmt = db.prepare(`UPDATE works SET (summary, summary_hash) = (SELECT summary, summary_hash FROM works WHERE id = ?) WHERE id = ? AND summary IS NULL`);
  const workSummaryStmt = db.prepare(`
    SELECT target.summary AS summary, target.ol_work_key AS olWorkKey, target.summary_hash AS summaryHash
    FROM books JOIN works AS own ON own.id = books.work_id JOIN works AS target ON target.id = COALESCE(own.merged_into, own.id)
    WHERE books.id = ?
  `);
  const markMergedStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE id = ?`);
  const repointMergedStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE merged_into = ?`);
  const workEditionIdsStmt = db.prepare(`SELECT id FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
  const recordMergeStmt = db.prepare(`INSERT INTO work_merges (from_work, into_work, source, confidence, moved_book_ids, repointed_work_ids, merged_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const latestMergeStmt = db.prepare(`SELECT id, into_work, source, moved_book_ids, repointed_work_ids FROM work_merges WHERE from_work = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1`);
  const moveBackStmt = db.prepare(`UPDATE books SET work_id = ? WHERE work_id = ? AND (id IN (SELECT value FROM json_each(?)) OR (? IS NOT NULL AND ol_work_key = ?))`);
  const unmergeStmt = db.prepare(`UPDATE works SET merged_into = NULL WHERE id = ?`);
  const repointBackStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE merged_into = ? AND id IN (SELECT value FROM json_each(?))`);
  const markUndoneStmt = db.prepare(`UPDATE work_merges SET undone_at = ? WHERE id = ?`);
  const clearCarriedSummaryStmt = db.prepare(`
    UPDATE works SET summary = NULL, summary_hash = NULL
    WHERE id = $into AND summary_hash IS NOT NULL AND summary_hash = (SELECT summary_hash FROM works WHERE id = $from)
  `);
  const moveGroupedBackStmt = db.prepare(`
    UPDATE books SET work_id = $from
    WHERE work_id = $into AND ol_work_key IS NULL AND title_key IN (SELECT title_key FROM books WHERE work_id = $from AND title_key <> '')
  `);
  const repointGroupedBackStmt = db.prepare(`
    UPDATE works SET merged_into = $from
    WHERE merged_into = $into AND id IN (
      SELECT m.from_work FROM work_merges m
      WHERE m.into_work = $into AND m.source = 'title-key' AND m.undone_at IS NULL
        AND EXISTS (SELECT 1 FROM json_each(m.moved_book_ids) j JOIN books b ON b.id = j.value WHERE b.work_id = $from)
    )
  `);
  const workMatchJudgmentsStmt = db.prepare(`SELECT work_id, model, into_work_id, confidence, asked_at FROM work_match_judgments WHERE work_id IN (SELECT value FROM json_each(?))`);
  const saveWorkMatchJudgmentStmt = db.prepare(`INSERT OR REPLACE INTO work_match_judgments (work_id, model, into_work_id, confidence, asked_at) VALUES (?, ?, ?, ?, ?)`);
  const reopenCodeNoMatchStmt = db.prepare(`DELETE FROM work_match_judgments WHERE model = 'code' AND into_work_id IS NULL AND work_id = (SELECT work_id FROM books WHERE id = ?)`);
  const portugueseWorkFilter = `
    w.merged_into IS NULL
    AND EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.id)
    AND NOT EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.id AND (b.language IS NULL OR (b.language <> 'pt' AND b.language NOT LIKE 'pt-%')))
    AND NOT EXISTS (SELECT 1 FROM work_match_judgments j WHERE j.work_id = w.id AND NOT ($recheck IS NOT NULL AND j.into_work_id IS NULL AND j.model <> 'manual' AND j.asked_at < $recheck))
    AND NOT EXISTS (SELECT 1 FROM jev_rejections r WHERE r.task = 'works' AND r.subject = w.id AND r.attempts >= $rejections)
  `;
  const allPortugueseNeedingMatchStmt = db.prepare(`SELECT w.id FROM works w WHERE ${portugueseWorkFilter} ORDER BY w.created_at, w.rowid LIMIT $limit`);
  const somePortugueseNeedingMatchStmt = db.prepare(`SELECT w.id FROM (SELECT DISTINCT value FROM json_each($ids)) AS ids CROSS JOIN works w ON w.id = ids.value WHERE ${portugueseWorkFilter} ORDER BY w.created_at, w.rowid LIMIT $limit`);
  const translationEditionsStmt = db.prepare(`SELECT title, author, publisher, summary, original_title FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
  const originalTitleClaimsStmt = db.prepare(`SELECT work_id, title, author, language, original_title, summary FROM books WHERE (original_title IS NOT NULL AND original_title <> '') OR summary LIKE '%tulo original%'`);
  const activeMergesStmt = db.prepare(`SELECT id, from_work, into_work, moved_book_ids, merged_at FROM work_merges WHERE source = ? AND undone_at IS NULL ORDER BY id DESC`);
  const editionsOfStmt = db.prepare(`SELECT id, work_id, title, author, language, isbn, original_title, summary FROM books WHERE work_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, rowid`);
  const titleCandidatesStmt = db.prepare(`SELECT DISTINCT COALESCE(w.merged_into, w.id) AS id, b.title FROM books b JOIN works w ON w.id = b.work_id WHERE b.title_key GLOB ?`);
  const authorCandidatesStmt = db.prepare(`
    SELECT COALESCE(w.merged_into, w.id) AS id, COUNT(*) AS editions
    FROM books b JOIN works w ON w.id = b.work_id
    WHERE substr(b.title_key, instr(b.title_key, '|') + 1) GLOB ?
    GROUP BY COALESCE(w.merged_into, w.id)
    HAVING SUM(CASE WHEN b.language IS NULL OR (b.language <> 'pt' AND b.language NOT LIKE 'pt-%') THEN 1 ELSE 0 END) > 0
    ORDER BY editions DESC, id
  `);
  const matchCandidatesStmt = db.prepare(`
    SELECT w.id, w.title, w.author, MIN(b.year) AS year, COUNT(b.id) AS editions, json_group_array(DISTINCT COALESCE(b.language, '')) AS languages
    FROM works w JOIN books b ON b.work_id = w.id
    WHERE w.id IN (SELECT value FROM json_each(?))
    GROUP BY w.id
  `);
  const translationReviewRowsStmt = db.prepare(`
    SELECT j.work_id AS work_id, j.into_work_id AS into_id, j.model AS model, j.confidence AS confidence, NULL AS merged_at,
      CASE WHEN j.model = 'code' OR j.confidence >= $merge THEN 'blocked' ELSE 'possible' END AS grp
    FROM work_match_judgments j JOIN works w ON w.id = j.work_id
    WHERE w.merged_into IS NULL AND j.into_work_id IS NOT NULL AND j.model <> 'manual' AND (j.model = 'code' OR j.confidence >= $review)
    UNION ALL
    SELECT m.from_work, m.into_work, m.source, m.confidence, m.merged_at, 'merged'
    FROM work_merges m JOIN works w ON w.id = m.from_work
    WHERE m.source IN ('code', 'jev', 'manual') AND m.undone_at IS NULL AND w.merged_into = m.into_work
  `);
  const translationReviewWorksStmt = db.prepare(`
    SELECT w.id, w.title, w.author,
      (SELECT b.cover_image_id FROM books b WHERE b.work_id = w.id AND b.cover_image_id IS NOT NULL ORDER BY b.created_at, b.rowid LIMIT 1) AS cover_image_id,
      (SELECT b.original_title FROM books b WHERE b.work_id = w.id AND b.original_title IS NOT NULL ORDER BY b.created_at, b.rowid LIMIT 1) AS original_title,
      (SELECT b.summary FROM books b WHERE b.work_id = w.id AND trim(coalesce(b.summary, '')) <> '' ORDER BY b.created_at, b.rowid LIMIT 1) AS summary
    FROM works w WHERE w.id IN (SELECT value FROM json_each(?))
  `);
  const portugueseWithEvidenceStmt = db.prepare(`
    SELECT w.id FROM works w
    WHERE ${portugueseWorkFilter}
      AND (w.author <> '' OR EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.id AND (b.original_title IS NOT NULL OR b.author <> '' OR b.summary LIKE '%tulo original%')))
    ORDER BY w.created_at, w.rowid
  `);
  const genreJudgmentOwnedStmt = db.prepare(`SELECT 1 AS owned FROM genre_judgments WHERE work_id = ?`);
  const moveGenreJudgmentStmt = db.prepare(`UPDATE genre_judgments SET work_id = ? WHERE work_id = ?`);
  const dropGenreJudgmentStmt = db.prepare(`DELETE FROM genre_judgments WHERE work_id = ?`);
  const genreRejectionOwnedStmt = db.prepare(`SELECT 1 AS owned FROM genre_rejections WHERE work_id = ?`);
  const moveGenreRejectionStmt = db.prepare(`UPDATE genre_rejections SET work_id = ? WHERE work_id = ?`);
  const dropGenreRejectionStmt = db.prepare(`DELETE FROM genre_rejections WHERE work_id = ?`);
  const blockTitleGroupStmt = db.prepare(`UPDATE books SET title_group_blocked_at = ? WHERE id = ?`);
  const editionCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM books WHERE work_id = ?`);
  const workStmt = db.prepare(`SELECT id, ol_work_key, title, author, summary, summary_hash FROM works WHERE id = ?`);
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
  const genreBacklogStmt = db.prepare(`
    SELECT w.id FROM works w
    WHERE w.merged_into IS NULL
      AND NOT EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.id AND b.genres <> '[]')
      AND NOT EXISTS (SELECT 1 FROM genre_judgments j WHERE j.work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM genre_rejections r WHERE r.work_id = w.id AND r.attempts >= ?)
      AND (length(trim(coalesce(w.summary, ''))) >= ? OR EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.id AND length(trim(coalesce(b.summary, ''))) >= ?))
    ORDER BY w.created_at, w.rowid
    LIMIT ?
  `);
  const jevJudgedStmt = db.prepare(`SELECT work_id FROM genre_judgments WHERE model <> 'manual'`);
  const countEmptyGenreEditionsStmt = db.prepare(`SELECT COUNT(*) AS n FROM books WHERE work_id = ? AND genres = '[]'`);
  const pageEditionsStmt = db.prepare(`SELECT books.id, books.title, books.language, books.year, books.isbn, books.summary, books.summary_hash, books.cover_image_id, ci.color AS cover_color, books.genres, books.rating, books.rating_count, books.pages, books.genres_source, books.genres_confidence FROM books LEFT JOIN cover_images ci ON ci.id = books.cover_image_id WHERE books.work_id = ? ORDER BY books.created_at, books.rowid`);
  const workEditionsStmt = db.prepare(`SELECT id, isbn, title, author, ol_work_key FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
  const groupableKeysStmt = db.prepare(GROUPABLE_KEYS_SQL);
  const keylessCandidatesStmt = db.prepare(KEYLESS_CANDIDATES_SQL);
  const keyedEditionsStmt = db.prepare(KEYED_EDITIONS_SQL);
  const keyedWorksStmt = db.prepare(KEYED_WORKS_SQL);
  const isSeriesNameStmt = db.prepare(`SELECT EXISTS (SELECT 1 FROM work_series WHERE name_key = ?) OR EXISTS (SELECT 1 FROM book_collections WHERE name_key = ?) AS found`);
  const undoneMergeAmongStmt = db.prepare(`
    WITH side(id) AS (
      SELECT value FROM json_each($ids)
      UNION SELECT id FROM works WHERE merged_into IN (SELECT value FROM json_each($ids))
    )
    SELECT 1 AS found FROM work_merges m
    JOIN works f ON f.id = m.from_work
    JOIN works i ON i.id = m.into_work
    WHERE m.undone_at IS NOT NULL AND m.from_work IN side AND m.into_work IN side
      AND COALESCE(f.merged_into, f.id) <> COALESCE(i.merged_into, i.id)
    LIMIT 1
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
  const setCoverIfStmt = db.prepare(`
    UPDATE books SET cover_image_id = $image, cover_status = $status, cover_checked_at = $checked
    WHERE id = $id AND cover_image_id IS $expected
      AND NOT EXISTS (
        SELECT 1 FROM cover_images AS candidate JOIN cover_rejections AS rejection ON rejection.source_url = candidate.source_url
        WHERE candidate.id = $image AND rejection.book_id = $id
      )
  `);
  const addRejectionStmt = db.prepare(`INSERT OR IGNORE INTO cover_rejections (book_id, source_url, created_at) VALUES (?, ?, ?)`);
  const rejectionsStmt = db.prepare(`SELECT source_url FROM cover_rejections WHERE book_id = ?`);
  const workCoversStmt = db.prepare(`SELECT work_id, cover_image_id FROM books WHERE work_id IN (SELECT value FROM json_each(?)) AND cover_image_id IS NOT NULL ORDER BY created_at, rowid`);
  const takesSummary = `$summary IS NOT NULL AND (summary IS NULL OR summary = '' OR $summary_source = 'publisher')`;
  const mergeDetailsStmt = db.prepare(`
    UPDATE books
    SET summary_source = CASE WHEN ${takesSummary} THEN $summary_source ELSE summary_source END,
        summary = CASE WHEN ${takesSummary} THEN $summary ELSE summary END,
        summary_hash = CASE WHEN ${takesSummary} THEN $summary_hash ELSE summary_hash END,
        original_title = CASE WHEN ${takesSummary} THEN COALESCE(original_title, $original_title) ELSE original_title END,
        original_key = CASE WHEN ${takesSummary} AND original_title IS NULL THEN $original_key ELSE original_key END,
        original_whole_key = CASE WHEN ${takesSummary} AND original_title IS NULL THEN $original_whole_key ELSE original_whole_key END,
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
  const saveJudgmentStmt = db.prepare(`
    INSERT INTO genre_judgments (work_id, model, genre, confidence, asked_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(work_id) DO UPDATE SET model = excluded.model, genre = excluded.genre, confidence = excluded.confidence, asked_at = excluded.asked_at
    WHERE genre_judgments.model <> 'manual' OR excluded.model = 'manual'
  `);
  const judgmentsStmt = db.prepare(`SELECT work_id, model, genre, confidence FROM genre_judgments WHERE work_id IN (SELECT value FROM json_each(?))`);
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
  const synopsisJudgmentsStmt = db.prepare(`SELECT text_hash, model, usable, kind, asked_at FROM synopsis_judgments WHERE text_hash IN (SELECT value FROM json_each(?))`);
  const saveSynopsisJudgmentStmt = db.prepare(`INSERT OR REPLACE INTO synopsis_judgments (text_hash, model, usable, kind, asked_at) VALUES (?, ?, ?, ?, ?)`);
  const jevRejectionsStmt = db.prepare(`SELECT subject, status, reason, attempts, last_at FROM jev_rejections WHERE task = ? AND subject IN (SELECT value FROM json_each(?))`);
  const recordJevRejectionStmt = db.prepare(`
    INSERT INTO jev_rejections (task, subject, status, reason, attempts, last_at) VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT (task, subject) DO UPDATE SET status = excluded.status, reason = excluded.reason, attempts = attempts + 1, last_at = excluded.last_at
  `);
  const clearJevRejectionStmt = db.prepare(`DELETE FROM jev_rejections WHERE task = ? AND subject = ?`);
  const synopsesNeedingJudgmentStmt = db.prepare(`
    SELECT hash FROM (
      SELECT summary_hash AS hash FROM books WHERE work_id IN (SELECT value FROM json_each(?)) AND summary_hash IS NOT NULL AND summary IS NOT NULL
      UNION
      SELECT summary_hash FROM works WHERE id IN (SELECT value FROM json_each(?)) AND summary_hash IS NOT NULL AND summary IS NOT NULL
    ) AS t
    WHERE NOT EXISTS (SELECT 1 FROM synopsis_judgments j WHERE j.text_hash = t.hash)
      AND NOT EXISTS (SELECT 1 FROM jev_rejections r WHERE r.task = 'synopses' AND r.subject = t.hash AND r.attempts >= ?)
    LIMIT ?
  `);
  const worksNeedingSynopsisJudgmentStmt = db.prepare(`
    SELECT w.value AS id FROM json_each(?) AS w
    WHERE EXISTS (
        SELECT 1 FROM books b WHERE b.work_id = w.value AND b.summary_hash IS NOT NULL AND b.summary IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM synopsis_judgments j WHERE j.text_hash = b.summary_hash)
          AND NOT EXISTS (SELECT 1 FROM jev_rejections r WHERE r.task = 'synopses' AND r.subject = b.summary_hash AND r.attempts >= ?)
      )
      OR EXISTS (
        SELECT 1 FROM works x WHERE x.id = w.value AND x.summary_hash IS NOT NULL AND x.summary IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM synopsis_judgments j WHERE j.text_hash = x.summary_hash)
          AND NOT EXISTS (SELECT 1 FROM jev_rejections r WHERE r.task = 'synopses' AND r.subject = x.summary_hash AND r.attempts >= ?)
      )
    LIMIT ?
  `);
  const synopsisBookCarrierStmt = db.prepare(`SELECT summary AS text, title, author FROM books WHERE summary_hash = ? AND summary IS NOT NULL ORDER BY created_at, rowid LIMIT 1`);
  const synopsisWorkCarrierStmt = db.prepare(`SELECT summary AS text, title, author FROM works WHERE summary_hash = ? AND summary IS NOT NULL ORDER BY created_at, rowid LIMIT 1`);
  const synopsisBacklogStmt = db.prepare(`
    SELECT t.hash AS hash, COALESCE(w.merged_into, w.id) AS work_id, t.source AS source, t.created_at AS created_at
    FROM (
      SELECT summary_hash AS hash, work_id, summary_source AS source, created_at, rowid AS ord FROM books WHERE summary_hash IS NOT NULL AND summary IS NOT NULL
      UNION ALL
      SELECT summary_hash, id, 'openlibrary', created_at, rowid FROM works WHERE summary_hash IS NOT NULL AND summary IS NOT NULL
    ) AS t
    LEFT JOIN works w ON w.id = t.work_id
    WHERE NOT EXISTS (SELECT 1 FROM synopsis_judgments j WHERE j.text_hash = t.hash)
      AND NOT EXISTS (SELECT 1 FROM jev_rejections r WHERE r.task = 'synopses' AND r.subject = t.hash AND r.attempts >= ?)
    ORDER BY t.created_at, t.ord
  `);
  const flaggedSynopsesStmt = db.prepare(`SELECT text_hash, model, usable, kind FROM synopsis_judgments WHERE model = 'rule' OR (model <> 'manual' AND usable < ?)`);
  const synopsisCarriersStmt = db.prepare(`
    SELECT b.summary_hash AS hash, COALESCE(w.merged_into, w.id) AS work_id, b.title AS title, b.author AS author, b.cover_image_id AS cover_image_id, b.summary_source AS source, b.summary AS text, 1 AS is_edition, b.created_at AS created_at, b.rowid AS ord
    FROM books b LEFT JOIN works w ON w.id = b.work_id
    WHERE b.summary_hash IN (SELECT value FROM json_each(?)) AND b.summary IS NOT NULL
    UNION ALL
    SELECT w.summary_hash, COALESCE(w.merged_into, w.id), w.title, w.author, NULL, 'openlibrary', w.summary, 0, w.created_at, w.rowid
    FROM works w
    WHERE w.summary_hash IN (SELECT value FROM json_each(?)) AND w.summary IS NOT NULL
    ORDER BY created_at, ord
  `);
  const synopsisTextsStmt = db.prepare(`
    SELECT summary_hash AS hash, COALESCE(summary_source, 'unknown') AS source, title, author, summary AS text, created_at, rowid AS ord FROM books WHERE summary_hash IS NOT NULL AND summary IS NOT NULL
    UNION ALL
    SELECT summary_hash, 'openlibrary', title, author, summary, created_at, rowid FROM works WHERE summary_hash IS NOT NULL AND summary IS NOT NULL
    ORDER BY created_at, ord
  `);
  const fillOriginalTitleStmt = db.prepare(`UPDATE books SET original_title = ?, original_key = ?, original_whole_key = ? WHERE id = ? AND original_title IS NULL`);
  const originalClaimsOfStmt = db.prepare(ORIGINAL_CLAIMS_SQL);
  const originalKeysOfStmt = db.prepare(ORIGINAL_KEYS_OF_WHOLE_SQL);
  const originalArrivalsStmt = db.prepare(`SELECT title_key FROM original_arrivals LIMIT ?`);
  const dropOriginalArrivalStmt = db.prepare(`DELETE FROM original_arrivals WHERE title_key = ?`);
  const labelledSummariesStmt = db.prepare(`SELECT id, summary FROM books WHERE original_title IS NULL AND summary LIKE '%tulo original%'`);
  const labelledWorkSummariesStmt = db.prepare(`SELECT id, summary FROM books WHERE work_id = ? AND original_title IS NULL AND summary LIKE '%tulo original%'`);
  const detailsMissingStmt = db.prepare(`UPDATE books SET details_status = 'missing', details_checked_at = ? WHERE id = ?`);
  const detailsAttemptedStmt = db.prepare(`UPDATE books SET details_checked_at = ? WHERE id = ?`);
  const searchStmt = db.prepare(`
    SELECT books.* FROM (
      SELECT rowid AS fts_row, bm25(books_fts) AS score FROM books_fts
      WHERE books_fts MATCH ? ORDER BY score, fts_row LIMIT ?
    ) AS hits
    JOIN books_fts ON books_fts.rowid = hits.fts_row
    JOIN books ON books.id = books_fts.book_id
    ORDER BY hits.score, hits.fts_row
  `);

  const uncheckedStmt = db.prepare(UNCHECKED_COVERS_SQL);
  const uncheckedDetailsStmt = db.prepare(UNCHECKED_DETAILS_SQL);
  const heldBnpDetailsStmt = db.prepare(HELD_BNP_DETAILS_SQL);
  const fillSubjectGenresStmt = db.prepare(`UPDATE books SET genres = ?, genres_source = NULL, genres_confidence = NULL WHERE id = ? AND (genres = '[]' OR genres_source = 'jev')`);
  const confirmWithSourceStmt = db.prepare(`UPDATE books SET data_sources = json_insert(data_sources, '$[#]', ?) WHERE id = ? AND NOT ${CONFIRMED_SQL}`);
  const harvestCursorStmt = db.prepare(`SELECT through FROM harvest_cursors WHERE feed = ?`);
  const setHarvestCursorStmt = db.prepare(`INSERT INTO harvest_cursors (feed, through) VALUES (?, ?) ON CONFLICT (feed) DO UPDATE SET through = excluded.through`);
  const setUpgradeWantedStmt = db.prepare(`UPDATE books SET cover_upgrade_wanted_at = ? WHERE id = ?`);
  const setAppleCheckedStmt = db.prepare(`UPDATE books SET apple_checked_at = ? WHERE id = ?`);
  const setWorkKeyStmt = db.prepare(`UPDATE books SET ol_work_key = ? WHERE id = ? AND ol_work_key IS NULL`);
  const setLanguageStmt = db.prepare(`UPDATE books SET language = ? WHERE id = ? AND language IS NULL`);
  const blankTitledStmt = db.prepare(`SELECT id, publisher_url FROM books WHERE title = '' AND publisher_url IS NOT NULL`);
  const setPublisherUrlStmt = db.prepare(`UPDATE books SET publisher_url = ? WHERE id = ? AND publisher_url IS NULL`);
  const upgradeWantedStmt = db.prepare(UPGRADE_WANTED_SQL);
  const retitleWantedStmt = db.prepare(`
    SELECT books.id, books.title, books.author, books.isbn, books.work_id, works.title AS work_title, works.author AS work_author
    FROM books LEFT JOIN works ON works.id = books.work_id
    WHERE books.retitle_wanted_at IS NOT NULL
    ORDER BY books.retitle_wanted_at, books.rowid LIMIT ?
  `);
  const clearRetitleWantedStmt = db.prepare(`UPDATE books SET retitle_wanted_at = NULL WHERE id = ?`);
  const workAuthorStmt = db.prepare(`SELECT author FROM works WHERE id = ?`);
  const insertWorkSeriesStmt = db.prepare(`
    INSERT INTO work_series (work_id, name, name_key, position, source, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (work_id, name_key, source) DO NOTHING
  `);
  const fillWorkSeriesPositionStmt = db.prepare(`UPDATE work_series SET position = ? WHERE work_id = ? AND name_key = ? AND source = ? AND position IS NULL`);
  const indexSeriesStmt = db.prepare(`
    INSERT INTO series_fts (work_id, name, author)
    SELECT $work_id, $name, $author WHERE (SELECT COUNT(*) FROM work_series WHERE work_id = $work_id AND name_key = $name_key) = 1
  `);
  const hasWorkSeriesStmt = db.prepare(`SELECT 1 FROM work_series WHERE work_id = ? LIMIT 1`);
  const refreshSeriesAuthorStmt = db.prepare(`UPDATE series_fts SET author = ? WHERE work_id = ?`);
  const insertCollectionStmt = db.prepare(`
    INSERT INTO book_collections (book_id, name, name_key, position, source, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (book_id, name_key, source) DO NOTHING
  `);
  const fillCollectionPositionStmt = db.prepare(`UPDATE book_collections SET position = ? WHERE book_id = ? AND name_key = ? AND source = ? AND position IS NULL`);
  const indexCollectionStmt = db.prepare(`
    INSERT INTO collections_fts (book_id, name)
    SELECT $book_id, $name WHERE (SELECT COUNT(*) FROM book_collections WHERE book_id = $book_id AND name_key = $name_key) = 1
  `);
  const workSeriesStmt = db.prepare(`SELECT work_id, name, name_key, position, source, created_at FROM work_series WHERE work_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`);
  const editionCollectionsStmt = db.prepare(`
    SELECT books.work_id AS work_id, book_collections.name AS name, book_collections.name_key AS name_key, book_collections.position AS position, book_collections.created_at AS created_at
    FROM books JOIN book_collections ON book_collections.book_id = books.id
    WHERE books.work_id IN (SELECT value FROM json_each(?)) AND book_collections.source = 'ol-edition'
    ORDER BY book_collections.rowid
  `);
  const collectionsOfStmt = db.prepare(`SELECT book_id, name, position FROM book_collections WHERE book_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, rowid`);
  const searchSeriesStmt = db.prepare(`SELECT work_id FROM series_fts WHERE series_fts MATCH ? ORDER BY bm25(series_fts), rowid LIMIT ?`);
  const searchCollectionsStmt = db.prepare(`
    SELECT hits.book_id AS book_id, hits.name AS name, (
      SELECT book_collections.position FROM book_collections
      WHERE book_collections.book_id = hits.book_id AND book_collections.name = hits.name
      ORDER BY book_collections.position IS NULL, book_collections.created_at, book_collections.rowid LIMIT 1
    ) AS position
    FROM (
      SELECT collections_fts.book_id AS book_id, collections_fts.name AS name, bm25(collections_fts) AS score, collections_fts.rowid AS fts_row
      FROM collections_fts JOIN books_search ON books_search.book_id = collections_fts.book_id
      WHERE collections_fts MATCH ?
      ORDER BY score, fts_row LIMIT ?
    ) AS hits
    ORDER BY hits.score, hits.fts_row
  `);

  function mergeDetails(bookId: string, details: MergeableDetails, summarySource: SummarySource | null) {
    const summary = details.summary ? cleanSummary(details.summary) : null;
    const originalTitle = details.summary ? originalTitleIn(details.summary) : null;
    mergeDetailsStmt.run({
      $id: bookId,
      $summary: summary,
      $summary_source: summarySource,
      $summary_hash: summaryHashOf(summary),
      $original_title: originalTitle,
      $original_key: originalTitle === null ? null : originalKey(originalTitle),
      $original_whole_key: originalTitle === null ? null : originalWholeKey(originalTitle),
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

  function applyJoinedJudgment(workId: string) {
    undoJudgmentForWorkStmt.run(workId, GENRE_SAVE_LINE);
    applyJudgmentForWorkStmt.run(workId, GENRE_SAVE_LINE);
  }

  function canonicalWorkIds(ids: string[]): Map<string, string> {
    const rows = canonicalWorksStmt.all(JSON.stringify(ids)) as Array<{ id: string; canonical: string }>;
    return new Map(rows.map((row) => [row.id, row.canonical]));
  }

  function aliasesOf(workIds: string[]): string[] {
    return (aliasesOfStmt.all(JSON.stringify(workIds)) as Array<{ id: string }>).map((row) => row.id);
  }

  type MergeRecord = { source: MergeSource; confidence: number | null; at: string; carrySummary: boolean };

  function refreshSeriesAuthor(workId: string) {
    const work = workAuthorStmt.get(workId) as { author: string } | undefined;
    if (work?.author && hasWorkSeriesStmt.get(workId)) refreshSeriesAuthorStmt.run(work.author, workId);
  }

  function fillWorkIdentity(bookId: string) {
    for (const work of fillWorkIdentityStmt.all(bookId) as Array<{ id: string }>) refreshSeriesAuthor(work.id);
  }

  function carryGenreState(from: string, into: string) {
    if (genreJudgmentOwnedStmt.get(into)) dropGenreJudgmentStmt.run(from);
    else moveGenreJudgmentStmt.run(into, from);
    if (genreRejectionOwnedStmt.get(into)) dropGenreRejectionStmt.run(from);
    else moveGenreRejectionStmt.run(into, from);
  }

  function mergeInto(from: string, into: string, record: MergeRecord) {
    const moved = (workEditionIdsStmt.all(from) as Array<{ id: string }>).map((row) => row.id);
    const repointed = (aliasStmt.all(from) as Array<{ id: string }>).map((row) => row.id);
    moveWorkEditionsStmt.run(into, from);
    if (record.carrySummary) carryWorkSummaryStmt.run(from, into);
    fillWorkFromEditionsStmt.run(into);
    refreshSeriesAuthor(into);
    markMergedStmt.run(into, from);
    repointMergedStmt.run(into, from);
    carryGenreState(from, into);
    applyJoinedJudgment(into);
    recordMergeStmt.run(from, into, record.source, record.confidence, JSON.stringify(moved), JSON.stringify(repointed), record.at);
  }

  function groupableTitleKeys(after: string, limit: number): string[] {
    return (groupableKeysStmt.all(after, limit) as Array<{ title_key: string }>).map((row) => row.title_key);
  }

  function keyedWorksWithTitleKeys(keys: string[]): KeyedWork[] {
    const rows = keyedWorksStmt.all(JSON.stringify(keys)) as Array<{ title_key: string; id: string; title: string; author: string; editions: number; created_at: string }>;
    return rows.map((row) => ({ titleKey: row.title_key, id: row.id, title: row.title, author: row.author, editions: row.editions, createdAt: row.created_at }));
  }

  function titleWorks(stmt: StatementSync, keys: string[], keyed: boolean): TitleWork[] {
    const rows = stmt.all(JSON.stringify(keys)) as Array<{ title_key: string; id: string; title: string; created_at: string }>;
    return rows.map((row) => ({ titleKey: row.title_key, workId: row.id, title: row.title, keyed, createdAt: row.created_at }));
  }

  function undoneMergeAmong(workIds: string[]): boolean {
    return undoneMergeAmongStmt.get({ $ids: JSON.stringify(workIds) }) !== undefined;
  }

  function groupTitleKeys(keys: string[], limit: number, at = new Date().toISOString(), skip?: (from: string, into: string) => boolean): number {
    return inTransaction(() => {
      const pairs = planTitleFolds([...titleWorks(keyedEditionsStmt, keys, true), ...titleWorks(keylessCandidatesStmt, keys, false)]);
      let merged = 0;
      for (const pair of pairs) {
        if (merged === limit) break;
        if (undoneMergeAmong([pair.source, pair.target]) || skip?.(pair.source, pair.target)) continue;
        mergeInto(pair.source, pair.target, { source: "title-key", confidence: null, at, carrySummary: true });
        merged++;
      }
      return merged;
    });
  }

  type UnassignedBook = { id: string; ol_work_key: string | null; title: string; author: string; created_at: string };

  function giveWork(row: UnassignedBook): string {
    const held = row.ol_work_key ? (workByKeyStmt.get(row.ol_work_key) as { id: string } | undefined) : undefined;
    const workId = held?.id ?? insertWork(row.ol_work_key, row.title, row.author, row.created_at);
    moveBookStmt.run(workId, row.id);
    if (held) {
      fillWorkIdentity(row.id);
      applyJoinedJudgment(workId);
    }
    return workId;
  }

  return {
    transaction: inTransaction,

    canonicalWorkIds,
    groupTitleKeys,
    groupableTitleKeys,
    keyedWorksWithTitleKeys,
    aliasesOf,
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
    genreBacklogWorks(limit, minSynopsis, rejectionLimit) {
      return (genreBacklogStmt.all(rejectionLimit, minSynopsis, minSynopsis, limit) as Array<{ id: string }>).map((row) => row.id);
    },
    jevJudgedWorkIds() {
      return (jevJudgedStmt.all() as Array<{ work_id: string }>).map((row) => row.work_id);
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
          $retitle_wanted_at: wantsRetitle(input) ? createdAt : null,
          $created_at: createdAt
        });
        for (const key of keys) insertKeyIfMissingStmt.run(key, id);
        if (held) {
          fillWorkIdentity(id);
          applyJoinedJudgment(workId);
        }
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
        fillWorkIdentity(id);
        reopenCodeNoMatchStmt.run(id);
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
      return setCoverIfStmt.run({ $image: cover.imageId, $status: cover.status, $checked: cover.checkedAt, $id: bookId, $expected: expectedImageId }).changes > 0;
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

    listHeldBnpDetailIds(workIds, limit) {
      if (workIds.length === 0) return [];
      return (heldBnpDetailsStmt.all(JSON.stringify(workIds), limit) as Array<{ id: string }>).map((row) => row.id);
    },

    fillSubjectGenres(bookId, genres) {
      if (genres.length === 0) return;
      fillSubjectGenresStmt.run(JSON.stringify(genres), bookId);
    },

    confirmWithSource(bookId, source) {
      inTransaction(() => {
        if (confirmWithSourceStmt.run(source, bookId).changes > 0) makeSearchableIfConfirmed(bookId);
      });
    },

    getHarvestCursor(feed) {
      return (harvestCursorStmt.get(feed) as { through: string } | undefined)?.through ?? null;
    },

    setHarvestCursor(feed, through) {
      setHarvestCursorStmt.run(feed, through);
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
        if (book.work_id && mergeEmptyWorkStmt.run(target, book.work_id).changes === 1) {
          repointMergedStmt.run(target, book.work_id);
          carryGenreState(book.work_id, target);
        }
        if (held) applyJoinedJudgment(target);
        fillWorkIdentity(id);
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

    mergeWorks(fromId, intoId, at = new Date().toISOString()) {
      return inTransaction(() => {
        const from = workLinkStmt.get(fromId) as WorkLink | undefined;
        if (!from) throw new WorkMergeError("No such work.");
        if (from.merged_into) throw new WorkMergeError("That work was already merged.");
        if (from.ol_work_key) throw new WorkMergeError("A work with an Open Library key is never merged into another.");
        const into = liveWorkId(intoId);
        if (!into) throw new WorkMergeError("No such work.");
        if (into === from.id) throw new WorkMergeError("Those editions already share a work.");
        mergeInto(from.id, into, { source: "admin", confidence: null, at, carrySummary: true });
        return into;
      });
    },

    mergeDuplicateWork(fromId, intoId, at) {
      return inTransaction(() => {
        const from = workLinkStmt.get(fromId) as WorkLink | undefined;
        const into = workLinkStmt.get(intoId) as WorkLink | undefined;
        if (!from || !into) throw new WorkMergeError("No such work.");
        if (from.merged_into || into.merged_into) throw new WorkMergeError("That work was already merged.");
        if (!from.ol_work_key || !into.ol_work_key) throw new WorkMergeError("Only works with an Open Library key merge as duplicates.");
        if (from.id === into.id) throw new WorkMergeError("A work can't merge into itself.");
        mergeInto(from.id, into.id, { source: "ol-duplicate", confidence: null, at, carrySummary: true });
        return into.id;
      });
    },

    mergeTranslation(fromId, intoId, source, confidence, at) {
      return inTransaction(() => {
        const from = workLinkStmt.get(fromId) as WorkLink | undefined;
        if (!from || from.merged_into) throw new WorkMergeError("That work is gone or was already merged.");
        const into = liveWorkId(intoId);
        if (!into || into === from.id) throw new WorkMergeError("That work can't be merged there.");
        mergeInto(from.id, into, { source, confidence, at, carrySummary: false });
        return into;
      });
    },
    undoMerge(fromId, at) {
      return inTransaction(() => {
        const merge = latestMergeStmt.get(fromId) as { id: number; into_work: string; source: MergeSource; moved_book_ids: string; repointed_work_ids: string } | undefined;
        const from = workLinkStmt.get(fromId) as WorkLink | undefined;
        if (!merge || !from || from.merged_into !== merge.into_work) throw new WorkMergeError("That merge can no longer be undone.");
        const grouped = merge.source !== "ol-duplicate" && merge.source !== "title-key";
        const moved = Number(moveBackStmt.run(from.id, merge.into_work, merge.moved_book_ids, from.ol_work_key, from.ol_work_key).changes);
        const editions = moved + (grouped ? Number(moveGroupedBackStmt.run({ $from: from.id, $into: merge.into_work }).changes) : 0);
        unmergeStmt.run(from.id);
        repointBackStmt.run(from.id, merge.into_work, merge.repointed_work_ids);
        if (grouped) repointGroupedBackStmt.run({ $from: from.id, $into: merge.into_work });
        if (merge.source === "title-key") clearCarriedSummaryStmt.run({ $from: from.id, $into: merge.into_work });
        markUndoneStmt.run(at, merge.id);
        return { into: merge.into_work, editions };
      });
    },
    isSeriesName(nameKey) {
      return (isSeriesNameStmt.get(nameKey, nameKey) as { found: number }).found === 1;
    },
    undoneMergeAmong,
    workMatchJudgments(workIds) {
      const rows = workMatchJudgmentsStmt.all(JSON.stringify(workIds)) as Array<{ work_id: string; model: string; into_work_id: string | null; confidence: number | null; asked_at: string }>;
      return new Map(rows.map((row) => [row.work_id, { model: row.model, intoWorkId: row.into_work_id, confidence: row.confidence, askedAt: row.asked_at }]));
    },
    saveWorkMatchJudgment(workId, judgment) {
      saveWorkMatchJudgmentStmt.run(workId, judgment.model, judgment.intoWorkId, judgment.confidence, judgment.askedAt);
    },
    portugueseWorksNeedingMatch(workIds, limit, rejectionLimit, recheckBefore) {
      const params = { $recheck: recheckBefore, $rejections: rejectionLimit, $limit: limit };
      const rows = workIds === null ? allPortugueseNeedingMatchStmt.all(params) : somePortugueseNeedingMatchStmt.all({ ...params, $ids: JSON.stringify(workIds) });
      return (rows as Array<{ id: string }>).map((row) => row.id);
    },
    translationEvidence(workId) {
      const work = workLinkStmt.get(workId) as WorkLink | undefined;
      if (!work) return undefined;
      const author = (workStmt.get(workId) as { author: string } | undefined)?.author ?? "";
      const editions = (translationEditionsStmt.all(workId) as Array<{ title: string; author: string; publisher: string | null; summary: string | null; original_title: string | null }>).map((row) => ({ title: row.title, author: row.author, publisher: row.publisher, summary: row.summary, originalTitle: row.original_title }));
      return { workId, workAuthor: author, editions };
    },
    originalTitleClaims() {
      const rows = originalTitleClaimsStmt.all() as Array<{ work_id: string | null; title: string; author: string; language: string | null; original_title: string | null; summary: string | null }>;
      return rows.flatMap((row) => {
        const originalTitle = row.original_title || originalTitleIn(row.summary);
        return originalTitle ? [{ workId: row.work_id, title: row.title, author: row.author, language: row.language, originalTitle }] : [];
      });
    },
    originalClaimsOf(key) {
      return (originalClaimsOfStmt.all(key) as Array<{ work_id: string | null; title: string; author: string; language: string | null; original_title: string }>).map((row) => ({ workId: row.work_id, title: row.title, author: row.author, language: row.language, originalTitle: row.original_title }));
    },
    originalKeysOf(wholeKey) {
      return (originalKeysOfStmt.all(wholeKey) as Array<{ original_key: string }>).map((row) => row.original_key);
    },
    originalArrivals(limit) {
      return (originalArrivalsStmt.all(limit) as Array<{ title_key: string }>).map((row) => row.title_key);
    },
    dropOriginalArrival(titleKey) {
      dropOriginalArrivalStmt.run(titleKey);
    },
    activeMerges(source) {
      return (activeMergesStmt.all(source) as Array<{ id: number; from_work: string; into_work: string; moved_book_ids: string; merged_at: string }>).map((row) => ({ id: row.id, fromWork: row.from_work, intoWork: row.into_work, movedBookIds: JSON.parse(row.moved_book_ids) as string[], mergedAt: row.merged_at }));
    },
    editionsOf(workIds) {
      return (editionsOfStmt.all(JSON.stringify(workIds)) as Array<{ id: string; work_id: string; title: string; author: string; language: string | null; isbn: string | null; original_title: string | null; summary: string | null }>).map((row) => ({ id: row.id, workId: row.work_id, title: row.title, author: row.author, language: row.language, isbn: row.isbn, originalTitle: row.original_title || originalTitleIn(row.summary) }));
    },
    titleCandidates(pattern) {
      return titleCandidatesStmt.all(pattern) as Array<{ id: string; title: string }>;
    },
    authorCandidates(pattern) {
      return (authorCandidatesStmt.all(pattern) as Array<{ id: string }>).map((row) => row.id);
    },
    matchCandidates(workIds) {
      return (matchCandidatesStmt.all(JSON.stringify(workIds)) as Array<{ id: string; title: string; author: string; year: number | null; editions: number; languages: string }>).map((row) => ({ id: row.id, title: row.title, author: row.author, year: row.year, editions: row.editions, languages: (JSON.parse(row.languages) as string[]).filter(Boolean) }));
    },
    translationReviewRows(mergeAt, reviewAt) {
      return (translationReviewRowsStmt.all({ $merge: mergeAt, $review: reviewAt }) as Array<{ work_id: string; into_id: string; model: string; confidence: number | null; merged_at: string | null; grp: "possible" | "blocked" | "merged" }>).map((row) => ({ workId: row.work_id, intoWorkId: row.into_id, model: row.model, confidence: row.confidence, mergedAt: row.merged_at, group: row.grp }));
    },
    translationReviewWorks(workIds) {
      const rows = translationReviewWorksStmt.all(JSON.stringify(workIds)) as Array<{ id: string; title: string; author: string; cover_image_id: string | null; original_title: string | null; summary: string | null }>;
      return new Map(rows.map((row) => [row.id, { title: row.title, author: row.author, coverImageId: row.cover_image_id, originalTitle: row.original_title, synopsis: row.summary }]));
    },
    portugueseWorksWithEvidence() {
      return (portugueseWithEvidenceStmt.all({ $recheck: null, $rejections: Number.MAX_SAFE_INTEGER }) as Array<{ id: string }>).map((row) => row.id);
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
    synopsisJudgments(hashes) {
      const rows = synopsisJudgmentsStmt.all(JSON.stringify(hashes)) as Array<{ text_hash: string; model: string; usable: number; kind: SynopsisKind; asked_at: string }>;
      return new Map(rows.map((row) => [row.text_hash, { model: row.model, usable: row.usable, kind: row.kind, askedAt: row.asked_at }]));
    },
    saveSynopsisJudgment(hash, judgment) {
      saveSynopsisJudgmentStmt.run(hash, judgment.model, judgment.usable, judgment.kind, judgment.askedAt);
    },
    jevRejections(task, subjects) {
      const rows = jevRejectionsStmt.all(task, JSON.stringify(subjects)) as Array<{ subject: string; status: number | null; reason: string; attempts: number; last_at: string }>;
      return new Map(rows.map((row) => [row.subject, { status: row.status, reason: row.reason, attempts: row.attempts, lastAt: row.last_at }]));
    },
    recordJevRejection(rejection) {
      recordJevRejectionStmt.run(rejection.task, rejection.subject, rejection.status, rejection.reason, rejection.at);
    },
    clearJevRejection(task, subject) {
      clearJevRejectionStmt.run(task, subject);
    },
    synopsesNeedingJudgment(workIds, limit, rejectionLimit) {
      const ids = JSON.stringify(workIds);
      return (synopsesNeedingJudgmentStmt.all(ids, ids, rejectionLimit, limit) as Array<{ hash: string }>).map((row) => row.hash);
    },
    worksNeedingSynopsisJudgment(workIds, limit, rejectionLimit) {
      return (worksNeedingSynopsisJudgmentStmt.all(JSON.stringify(workIds), rejectionLimit, rejectionLimit, limit) as Array<{ id: string }>).map((row) => row.id);
    },
    synopsisText(hash) {
      const row = (synopsisBookCarrierStmt.get(hash) ?? synopsisWorkCarrierStmt.get(hash)) as { text: string; title: string; author: string } | undefined;
      return row ? { text: row.text, title: row.title, author: row.author } : undefined;
    },
    synopsisBacklog(rejectionLimit) {
      return (synopsisBacklogStmt.all(rejectionLimit) as Array<{ hash: string; work_id: string | null; source: string | null; created_at: string }>).map((row) => ({ hash: row.hash, workId: row.work_id, source: row.source, createdAt: row.created_at }));
    },
    flaggedSynopses(reviewBelow) {
      return (flaggedSynopsesStmt.all(reviewBelow) as Array<{ text_hash: string; model: string; usable: number; kind: SynopsisKind }>).map((row) => ({ hash: row.text_hash, model: row.model, usable: row.usable, kind: row.kind }));
    },
    synopsisCarriers(hashes) {
      const ids = JSON.stringify(hashes);
      return (synopsisCarriersStmt.all(ids, ids) as Array<{ hash: string; work_id: string | null; title: string; author: string; cover_image_id: string | null; source: string | null; text: string; is_edition: number }>).map((row) => ({
        hash: row.hash,
        workId: row.work_id,
        title: row.title,
        author: row.author,
        coverImageId: row.cover_image_id,
        source: row.source,
        text: row.text,
        isEdition: row.is_edition === 1
      }));
    },
    synopsisTexts() {
      const seen = new Map<string, { hash: string; source: string; title: string; author: string; text: string }>();
      for (const row of synopsisTextsStmt.all() as Array<{ hash: string; source: string; title: string; author: string; text: string }>) {
        if (!seen.has(row.hash)) seen.set(row.hash, { hash: row.hash, source: row.source, title: row.title, author: row.author, text: row.text });
      }
      return [...seen.values()];
    },
    fillOriginalTitle(bookId, title) {
      if (isOriginalTitle(title)) fillOriginalTitleStmt.run(title, originalKey(title), originalWholeKey(title), bookId);
    },
    fillOriginalTitlesFromSummaries(workId) {
      return inTransaction(() => {
        const rows = (workId === undefined ? labelledSummariesStmt.all() : labelledWorkSummariesStmt.all(workId)) as Array<{ id: string; summary: string }>;
        let filled = 0;
        for (const row of rows) {
          const title = originalTitleIn(row.summary);
          if (title && fillOriginalTitleStmt.run(title, originalKey(title), originalWholeKey(title), row.id).changes > 0) filled += 1;
        }
        return filled;
      });
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
      const work = workStmt.get(canonical) as { id: string; title: string; author: string; summary: string | null; summary_hash: string | null } | undefined;
      if (!work) return undefined;
      const aliases = (aliasStmt.all(canonical) as Array<{ id: string }>).map((row) => row.id);
      return {
        work: { id: work.id, title: work.title, author: work.author, summary: work.summary, summary_hash: work.summary_hash },
        aliasIds: [canonical, ...aliases],
        editions: pageEditionsStmt.all(canonical) as WorkPageRows["editions"]
      };
    },

    groupKeylessWorks(limit, at = new Date().toISOString(), skip) {
      return inTransaction(() => {
        let merged = 0;
        let after = "";
        while (merged < limit) {
          const keys = groupableTitleKeys(after, limit);
          if (keys.length === 0) break;
          merged += groupTitleKeys(keys, limit - merged, at, skip);
          after = keys[keys.length - 1]!;
        }
        return merged;
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
      const cleaned = cleanSummary(summary);
      inTransaction(() => {
        const book = byIdStmt.get(bookId) as unknown as (UnassignedBook & { work_id: string | null }) | undefined;
        if (!book) throw new Error(`Unknown book ${bookId}`);
        const workId = liveWorkId(book.work_id ?? giveWork(book));
        if (workId && cleaned !== null) setWorkSummaryStmt.run(cleaned, summaryHashOf(cleaned), workId);
      });
    },

    getWorkSummary: (bookId) => workSummaryStmt.get(bookId) as { summary: string | null; olWorkKey: string | null; summaryHash: string | null } | undefined,

    setLanguage(id, tag) {
      if (tag) setLanguageStmt.run(tag, id);
    },

    setPublisherUrl(id, url) {
      setPublisherUrlStmt.run(url, id);
    },

    listUpgradeWantedIds(after, limit) {
      return idPage(upgradeWantedStmt, after, limit);
    },

    listRetitleWanted(limit) {
      return retitleWantedStmt.all(limit) as unknown as LossyBook[];
    },

    clearRetitleWanted(id) {
      clearRetitleWantedStmt.run(id);
    },

    addWorkSeries(workId, entries, source, at) {
      return inTransaction(() => {
        const work = workAuthorStmt.get(workId) as { author: string } | undefined;
        if (!work) throw new Error(`Unknown work ${workId}`);
        let added = 0;
        for (const entry of entries) {
          const nameKey = seriesNameKey(entry.name);
          if (!nameKey) continue;
          const name = entry.name.trim();
          if (insertWorkSeriesStmt.run(workId, name, nameKey, entry.position, source, at).changes > 0) {
            indexSeriesStmt.run({ $work_id: workId, $name: name, $author: work.author, $name_key: nameKey });
            added += 1;
          } else if (entry.position !== null) {
            fillWorkSeriesPositionStmt.run(entry.position, workId, nameKey, source);
          }
        }
        return added;
      });
    },

    addBookCollection(bookId, entry, source, at) {
      const nameKey = seriesNameKey(entry.name);
      if (!nameKey) return false;
      const name = entry.name.trim();
      return inTransaction(() => {
        if (insertCollectionStmt.run(bookId, name, nameKey, entry.position, source, at).changes === 0) {
          if (entry.position !== null) fillCollectionPositionStmt.run(entry.position, bookId, nameKey, source);
          return false;
        }
        indexCollectionStmt.run({ $book_id: bookId, $name: name, $name_key: nameKey });
        return true;
      });
    },

    bestSeriesOf(workIds) {
      const best = new Map<string, SeriesEntry>();
      if (workIds.length === 0) return best;
      const rootOf = new Map(workIds.map((id) => [id, id]));
      for (const [alias, canonical] of canonicalWorkIds(aliasesOf(workIds))) rootOf.set(alias, canonical);
      const members = JSON.stringify([...rootOf.keys()]);
      const stored = workSeriesStmt.all(members) as Array<{ work_id: string; name: string; name_key: string; position: string | null; source: SeriesSource; created_at: string }>;
      if (stored.length === 0) return best;
      const candidates = new Map<string, SeriesCandidate[]>();
      for (const row of stored) {
        const root = rootOf.get(row.work_id)!;
        const candidate = { name: row.name, position: row.position, nameKey: row.name_key, source: row.source, rank: SERIES_SOURCE_RANK[row.source], createdAt: row.created_at };
        const list = candidates.get(root) ?? [];
        list.push(candidate);
        candidates.set(root, list);
      }
      for (const row of editionCollectionsStmt.all(members) as Array<{ work_id: string; name: string; name_key: string; position: string | null; created_at: string }>) {
        const named = candidates.get(rootOf.get(row.work_id)!);
        if (named?.some((candidate) => candidate.nameKey === row.name_key && (candidate.source === "wikidata" || candidate.source === "ol-subject"))) {
          named.push({ name: row.name, position: row.position, nameKey: row.name_key, source: "ol-edition", rank: SERIES_SOURCE_RANK["ol-edition"], createdAt: row.created_at });
        }
      }
      for (const [root, list] of candidates) {
        list.sort((left, right) => left.rank - right.rank || (left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0));
        const top = list[0]!;
        best.set(root, { name: top.name, position: list.find((candidate) => candidate.nameKey === top.nameKey && candidate.position !== null)?.position ?? null });
      }
      return best;
    },

    collectionsOf(bookIds) {
      const earliest = new Map<string, SeriesEntry>();
      for (const row of collectionsOfStmt.all(JSON.stringify(bookIds)) as Array<{ book_id: string; name: string; position: string | null }>) {
        if (!earliest.has(row.book_id)) earliest.set(row.book_id, { name: row.name, position: row.position });
      }
      return earliest;
    },

    searchSeriesWorks(tokens, limit) {
      if (tokens.length === 0) return [];
      const hits = (searchSeriesStmt.all(matchExpression(tokens), WORK_SCAN_LIMIT) as Array<{ work_id: string }>).map((row) => row.work_id);
      const canonical = canonicalWorkIds([...new Set(hits)]);
      return [...new Set(hits.map((id) => canonical.get(id) ?? id))].slice(0, limit);
    },

    searchCollectionBooks(tokens, limit) {
      if (tokens.length === 0) return [];
      const best = new Map<string, { bookId: string; name: string; position: string | null }>();
      for (const row of searchCollectionsStmt.all(matchExpression(tokens), limit) as Array<{ book_id: string; name: string; position: string | null }>) {
        if (!best.has(row.book_id)) best.set(row.book_id, { bookId: row.book_id, name: row.name, position: row.position });
      }
      return [...best.values()];
    }
  };
}
