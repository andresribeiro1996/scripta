import type { DatabaseSync, StatementSync } from "node:sqlite";
import { planTitleFolds, type KeyedWork, type TitleWork } from "../../domain/duplicateWorks.js";
import { WorkMergeError } from "../../domain/errors.js";
import type { WorkMerges } from "../../domain/ports.js";
import type { MergeSource } from "../../domain/types.js";

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
  FROM (
    SELECT DISTINCT title_key, work_id, title FROM books
    WHERE title_key IN (SELECT value FROM json_each(?)) AND title_group_blocked_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM works AS merged JOIN work_merges AS m ON m.from_work = merged.id
        WHERE merged.merged_into = books.work_id AND m.source = 'title-key' AND m.undone_at IS NULL
          AND EXISTS (SELECT 1 FROM json_each(m.moved_book_ids) WHERE value = books.id)
      )
  ) AS hits
  CROSS JOIN works ON works.id = hits.work_id
  WHERE works.ol_work_key IS NOT NULL AND works.merged_into IS NULL
`;
export const KEYED_WORKS_SQL = `
  SELECT hits.title_key AS title_key, works.id AS id, works.title AS title, works.author AS author,
    (SELECT COUNT(*) FROM books WHERE work_id = works.id) AS editions,
    (SELECT COUNT(*) FROM work_merges WHERE into_work = works.id AND source = 'ol-duplicate' AND undone_at IS NULL) AS absorbed,
    works.created_at AS created_at
  FROM (SELECT DISTINCT title_key, work_id FROM books WHERE title_key IN (SELECT value FROM json_each(?)) AND title_group_blocked_at IS NULL) AS hits
  CROSS JOIN works ON works.id = hits.work_id
  WHERE works.ol_work_key IS NOT NULL AND works.merged_into IS NULL
  ORDER BY hits.title_key, works.created_at, works.id
`;

export type MergeHelpers = {
  inTransaction<T>(write: () => T): T;
  refreshSeriesAuthor(workId: string): void;
  applyJoinedJudgment(workId: string): void;
  liveWorkId(id: string): string | null;
  insertWork(workKey: string | null, title: string, author: string, createdAt: string): string;
};

type WorkLink = { id: string; ol_work_key: string | null; merged_into: string | null };

export function createSqliteWorkMerges(db: DatabaseSync, helpers: MergeHelpers): WorkMerges & { carryGenreState(from: string, into: string): void } {
  const { inTransaction, refreshSeriesAuthor, applyJoinedJudgment, liveWorkId, insertWork } = helpers;
  const recordMergeStmt = db.prepare(`INSERT INTO work_merges (from_work, into_work, source, confidence, moved_book_ids, repointed_work_ids, merged_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const latestMergeStmt = db.prepare(`SELECT id, into_work, source, moved_book_ids, repointed_work_ids FROM work_merges WHERE from_work = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1`);
  const moveBackStmt = db.prepare(`UPDATE books SET work_id = ? WHERE work_id = ? AND (id IN (SELECT value FROM json_each(?)) OR (? IS NOT NULL AND ol_work_key = ?))`);
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
  const unmergeStmt = db.prepare(`UPDATE works SET merged_into = NULL WHERE id = ?`);
  const repointBackStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE merged_into = ? AND id IN (SELECT value FROM json_each(?))`);
  const clearCarriedSummaryStmt = db.prepare(`
    UPDATE works SET summary = NULL, summary_hash = NULL
    WHERE id = $into AND summary_hash IS NOT NULL AND summary_hash = (SELECT summary_hash FROM works WHERE id = $from)
  `);
  const markUndoneStmt = db.prepare(`UPDATE work_merges SET undone_at = ? WHERE id = ?`);
  const markMergedStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE id = ?`);
  const carryWorkSummaryStmt = db.prepare(`UPDATE works SET (summary, summary_hash) = (SELECT summary, summary_hash FROM works WHERE id = ?) WHERE id = ? AND summary IS NULL`);
  const moveWorkEditionsStmt = db.prepare(`UPDATE books SET work_id = ? WHERE work_id = ?`);
  const workEditionIdsStmt = db.prepare(`SELECT id FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
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
  const fillWorkFromEditionsStmt = db.prepare(`
    UPDATE works
    SET title = CASE WHEN title = '' THEN COALESCE((SELECT title FROM books WHERE work_id = works.id AND title <> '' ORDER BY created_at, rowid LIMIT 1), '') ELSE title END,
        author = CASE WHEN author = '' THEN COALESCE((SELECT author FROM books WHERE work_id = works.id AND author <> '' ORDER BY created_at, rowid LIMIT 1), '') ELSE author END
    WHERE id = ? AND (title = '' OR author = '')
  `);
  const activeMergesStmt = db.prepare(`SELECT id, from_work, into_work, moved_book_ids, merged_at, confidence FROM work_merges WHERE source = ? AND undone_at IS NULL ORDER BY id DESC`);
  const isSeriesNameStmt = db.prepare(`SELECT EXISTS (SELECT 1 FROM work_series WHERE name_key = ?) OR EXISTS (SELECT 1 FROM book_collections WHERE name_key = ?) AS found`);
  const genreJudgmentOwnedStmt = db.prepare(`SELECT 1 AS owned FROM genre_judgments WHERE work_id = ?`);
  const moveGenreJudgmentStmt = db.prepare(`UPDATE genre_judgments SET work_id = ? WHERE work_id = ?`);
  const dropGenreJudgmentStmt = db.prepare(`DELETE FROM genre_judgments WHERE work_id = ?`);
  const genreRejectionOwnedStmt = db.prepare(`SELECT 1 AS owned FROM genre_rejections WHERE work_id = ?`);
  const moveGenreRejectionStmt = db.prepare(`UPDATE genre_rejections SET work_id = ? WHERE work_id = ?`);
  const dropGenreRejectionStmt = db.prepare(`DELETE FROM genre_rejections WHERE work_id = ?`);
  const groupableKeysStmt = db.prepare(GROUPABLE_KEYS_SQL);
  const keylessCandidatesStmt = db.prepare(KEYLESS_CANDIDATES_SQL);
  const keyedEditionsStmt = db.prepare(KEYED_EDITIONS_SQL);
  const keyedWorksStmt = db.prepare(KEYED_WORKS_SQL);
  const workLinkStmt = db.prepare(`SELECT id, ol_work_key, merged_into FROM works WHERE id = ?`);
  const workStmt = db.prepare(`SELECT id, ol_work_key, title, author, summary, summary_hash FROM works WHERE id = ?`);
  const aliasStmt = db.prepare(`SELECT id FROM works WHERE merged_into = ?`);
  const repointMergedStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE merged_into = ?`);

  type MergeRecord = { source: MergeSource; confidence: number | null; at: string; carrySummary: boolean };

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
    const rows = keyedWorksStmt.all(JSON.stringify(keys)) as Array<{ title_key: string; id: string; title: string; author: string; editions: number; absorbed: number; created_at: string }>;
    return rows.map((row) => ({ titleKey: row.title_key, id: row.id, title: row.title, author: row.author, editions: row.editions, absorbed: row.absorbed, createdAt: row.created_at }));
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

  return {
    carryGenreState,
    groupTitleKeys,
    groupableTitleKeys,
    keyedWorksWithTitleKeys,
    undoneMergeAmong,
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
    addWorkAlias(key, intoId, at) {
      inTransaction(() => {
        const into = liveWorkId(intoId);
        if (!into) throw new WorkMergeError("No such work.");
        const { title, author } = workStmt.get(into) as { title: string; author: string };
        const alias = insertWork(key, title, author, at);
        mergeInto(alias, into, { source: "ol-duplicate", confidence: null, at, carrySummary: false });
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
    activeMerges(source) {
      return (activeMergesStmt.all(source) as Array<{ id: number; from_work: string; into_work: string; moved_book_ids: string; merged_at: string; confidence: number | null }>).map((row) => ({ id: row.id, fromWork: row.from_work, intoWork: row.into_work, movedBookIds: JSON.parse(row.moved_book_ids) as string[], mergedAt: row.merged_at, confidence: row.confidence }));
    }
  };
}
