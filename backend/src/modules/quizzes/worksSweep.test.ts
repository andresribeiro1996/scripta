import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "quizzes-works-sweep-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.QUIZZES_DB_PATH = join(scratch, "quizzes.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyQuizzesMigrations } = await import("./adapters/sqlite/connection.js");
const { createQuizzesWorksStep } = await import("./worksSweep.js");
const { createSqliteQuizzesRepository } = await import("./adapters/sqlite/sqliteQuizzesRepository.js");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  return db;
}

function insertQuiz(db: DatabaseSync, id: string, owner: string, books: unknown[], voteCode: string | null = null): void {
  db.prepare("INSERT INTO quizzes (id, owner_user_id, name, data, vote_code, updated_at) VALUES (?, ?, 'q', ?, ?, 't0')").run(
    id,
    owner,
    JSON.stringify({ sourceLabel: "", questionCount: 5, allowedTypes: [], books, questions: null }),
    voteCode
  );
}

function worksOf(db: DatabaseSync, id: string): Array<{ key: string; work_id: string | null }> {
  return (db.prepare("SELECT key, work_id FROM quiz_works WHERE quiz_id = ? ORDER BY key").all(id) as Array<{ key: string; work_id: string | null }>).map((row) => ({ ...row }));
}

const resolveAll = (_owner: string, entries: Array<{ key: string }>) => new Map(entries.map((entry) => [entry.key, { workId: `w-${entry.key}`, title: null }]));

test("the quiz step resolves each book from the owner's library or its title", () => {
  const db = freshDb();
  insertQuiz(db, "q1", "u1", [
    { key: "k1", title: "Dune", author: "Frank Herbert" },
    { key: "pool-1984", title: "1984", author: "George Orwell" }
  ]);
  const calls: Array<[string, Array<[string, string | null | undefined, string | null | undefined]>]> = [];
  const step = createQuizzesWorksStep(db, (owner, entries) => {
    calls.push([owner, entries.map((entry) => [entry.key, entry.title, entry.author])]);
    return new Map(entries.map((entry) => [entry.key, { workId: `w-${entry.title}`, title: entry.title ?? null }]));
  });
  const batch = step(0, 250);
  assert.equal(batch.visited, 1);
  assert.equal(batch.resolved, 2);
  assert.deepEqual(calls, [["u1", [["k1", "Dune", "Frank Herbert"], ["pool-1984", "1984", "George Orwell"]]]]);
  assert.deepEqual(worksOf(db, "q1"), [{ key: "k1", work_id: "w-Dune" }, { key: "pool-1984", work_id: "w-1984" }]);
  assert.equal(step(0, 250).visited, 0);
});

test("rekeying a private quiz moves its works rows to the kept copy", () => {
  const db = freshDb();
  insertQuiz(db, "q1", "u1", [{ key: "k-old", title: "Dune" }, { key: "other", title: "Other" }]);
  db.prepare("INSERT INTO quiz_works (quiz_id, key, work_id) VALUES ('q1', 'k-old', 'w-old'), ('q1', 'other', 'w-other')").run();
  createSqliteQuizzesRepository(db).rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  const data = JSON.parse((db.prepare("SELECT data FROM quizzes WHERE id = 'q1'").get() as { data: string }).data);
  assert.equal(data.books[0].key, "k-keep");
  assert.deepEqual(worksOf(db, "q1"), [{ key: "k-keep", work_id: "w-keep" }, { key: "other", work_id: "w-other" }]);
});

test("a resolved work survives a null re-resolve and keys off the quiz are dropped", () => {
  const db = freshDb();
  insertQuiz(db, "q1", "u1", [{ key: "a", title: "A" }, { key: "b", title: "B" }]);
  db.prepare("INSERT INTO quiz_works (quiz_id, key, work_id) VALUES ('q1', 'a', 'w-a'), ('q1', 'b', NULL), ('q1', 'gone', 'w-gone')").run();
  const step = createQuizzesWorksStep(db, (_owner, entries) => new Map(entries.map((entry) => [entry.key, { workId: null, title: null }])));
  step(0, 250);
  assert.deepEqual(worksOf(db, "q1"), [{ key: "a", work_id: "w-a" }, { key: "b", work_id: null }]);
});

test("a quiz with no works rows stays pending after a rekey and ends with rows for all its keys", () => {
  const db = freshDb();
  insertQuiz(db, "q1", "u1", [{ key: "k-old", title: "Dune" }, { key: "k-keep", title: "Dune" }, { key: "other", title: "Other" }]);
  createSqliteQuizzesRepository(db).rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  assert.deepEqual(worksOf(db, "q1"), []);
  const step = createQuizzesWorksStep(db, resolveAll);
  assert.equal(step(0, 250).visited, 1);
  assert.deepEqual(worksOf(db, "q1"), [{ key: "k-keep", work_id: "w-k-keep" }, { key: "other", work_id: "w-other" }]);
});

test("rekeying with no resolved work keeps the work already stored for the kept copy", () => {
  const db = freshDb();
  insertQuiz(db, "q1", "u1", [{ key: "k-old", title: "Dune" }, { key: "k-keep", title: "Dune" }]);
  db.prepare("INSERT INTO quiz_works (quiz_id, key, work_id) VALUES ('q1', 'k-old', 'w-old'), ('q1', 'k-keep', 'w-keep')").run();
  createSqliteQuizzesRepository(db).rekeyBooks("u1", ["k-old"], "k-keep", null);
  assert.deepEqual(worksOf(db, "q1"), [{ key: "k-keep", work_id: "w-keep" }]);
});

test("a quiz whose stored data is not an object is visited without throwing", () => {
  const db = freshDb();
  insertQuiz(db, "q1", "u1", []);
  db.prepare("UPDATE quizzes SET data = 'null' WHERE id = 'q1'").run();
  const step = createQuizzesWorksStep(db, resolveAll);
  assert.equal(step(0, 250).visited, 1);
});
