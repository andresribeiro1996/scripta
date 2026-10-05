import type { DatabaseSync } from "node:sqlite";
import { resolveEntryWorks, type SweepBatch, type WorkEntry, type WorkRef, type WorksSweepStep } from "../library/index.js";
import { openQuizzesDb } from "./adapters/sqlite/connection.js";

type Resolve = (ownerUserId: string, entries: WorkEntry[]) => Map<string, WorkRef>;

function entriesOf(data: string): WorkEntry[] {
  const parsed: unknown = JSON.parse(data);
  const booksValue = parsed && typeof parsed === "object" ? (parsed as { books?: unknown }).books : undefined;
  const books = Array.isArray(booksValue) ? booksValue : [];
  return books.flatMap((book) => {
    if (!book || typeof book !== "object") return [];
    const { key, title, author } = book as { key?: unknown; title?: unknown; author?: unknown };
    return typeof key === "string" && key !== "" ? [{ key, title: typeof title === "string" ? title : null, author: typeof author === "string" ? author : null }] : [];
  });
}

export function createQuizzesWorksStep(db: DatabaseSync, resolve: Resolve): WorksSweepStep {
  const pendingStmt = db.prepare(`
    SELECT rowid, id, owner_user_id, data FROM quizzes
    WHERE rowid > ? AND (
      NOT EXISTS (SELECT 1 FROM quiz_works w WHERE w.quiz_id = quizzes.id)
      OR EXISTS (SELECT 1 FROM quiz_works w WHERE w.quiz_id = quizzes.id AND w.work_id IS NULL)
    )
    ORDER BY rowid LIMIT ?
  `);
  const deleteStaleWorks = db.prepare(`DELETE FROM quiz_works WHERE quiz_id = ? AND key NOT IN (SELECT value FROM json_each(?))`);
  const setWork = db.prepare(`
    INSERT INTO quiz_works (quiz_id, key, work_id) VALUES (?, ?, ?)
    ON CONFLICT(quiz_id, key) DO UPDATE SET work_id = excluded.work_id
  `);
  const keepWork = db.prepare(`INSERT OR IGNORE INTO quiz_works (quiz_id, key, work_id) VALUES (?, ?, NULL)`);
  return (afterRowid, limit): SweepBatch => {
    const quizzes = pendingStmt.all(afterRowid, limit) as Array<{ rowid: number; id: string; owner_user_id: string; data: string }>;
    let resolved = 0;
    for (const quiz of quizzes) {
      const works = resolve(quiz.owner_user_id, entriesOf(quiz.data));
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteStaleWorks.run(quiz.id, JSON.stringify([...works.keys()]));
        for (const [key, ref] of works) {
          if (!ref.workId) {
            keepWork.run(quiz.id, key);
            continue;
          }
          setWork.run(quiz.id, key, ref.workId);
          resolved++;
        }
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }
    return { lastRowid: quizzes.at(-1)?.rowid ?? afterRowid, visited: quizzes.length, resolved };
  };
}

let quizzesStep: WorksSweepStep | null = null;

export function sweepQuizzesWorks(afterRowid: number, limit: number): SweepBatch {
  quizzesStep ??= createQuizzesWorksStep(openQuizzesDb(), resolveEntryWorks);
  return quizzesStep(afterRowid, limit);
}
