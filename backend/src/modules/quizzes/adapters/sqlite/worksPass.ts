import type { DatabaseSync } from "node:sqlite";

const hasColumn = (db: DatabaseSync, table: string, column: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function rewriteQuiz(dataJson: string, workByKey: Map<string, string>): string {
  const doc: unknown = JSON.parse(dataJson);
  if (!isRecord(doc)) return dataJson;
  const seen = new Set<string>();
  const books = (Array.isArray(doc.books) ? doc.books : []).filter(isRecord).flatMap(({ key, ...book }) => {
    const workId = typeof key === "string" ? workByKey.get(key) : undefined;
    if (!workId || seen.has(workId)) return [];
    seen.add(workId);
    return [{ workId, ...book }];
  });
  const questions = Array.isArray(doc.questions)
    ? doc.questions.filter(isRecord).map(({ bookKey, ...question }) => ({ id: question.id, type: question.type, workId: (typeof bookKey === "string" ? workByKey.get(bookKey) : undefined) ?? null, options: question.options, answerIndex: question.answerIndex }))
    : doc.questions;
  return JSON.stringify({ ...doc, books, questions });
}

export function migrateQuizzesToWorks(db: DatabaseSync): void {
  if (!hasColumn(db, "quiz_works", "key")) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasColumn(db, "quiz_works", "key")) {
      const workByQuiz = new Map<string, Map<string, string>>();
      for (const row of db.prepare("SELECT quiz_id, key, work_id FROM quiz_works WHERE work_id IS NOT NULL").all() as Array<{ quiz_id: string; key: string; work_id: string }>) {
        if (!workByQuiz.has(row.quiz_id)) workByQuiz.set(row.quiz_id, new Map());
        workByQuiz.get(row.quiz_id)!.set(row.key, row.work_id);
      }
      const update = db.prepare("UPDATE quizzes SET data = ? WHERE id = ?");
      for (const row of db.prepare("SELECT id, data FROM quizzes").all() as Array<{ id: string; data: string }>) {
        update.run(rewriteQuiz(row.data, workByQuiz.get(row.id) ?? new Map()), row.id);
      }
      db.exec(`
        CREATE TABLE quiz_works_new (quiz_id TEXT NOT NULL, work_id TEXT NOT NULL, PRIMARY KEY (quiz_id, work_id));
        INSERT OR IGNORE INTO quiz_works_new (quiz_id, work_id) SELECT quiz_id, work_id FROM quiz_works WHERE work_id IS NOT NULL;
        DROP TABLE quiz_works;
        ALTER TABLE quiz_works_new RENAME TO quiz_works;
        PRAGMA user_version = 1;
      `);
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
