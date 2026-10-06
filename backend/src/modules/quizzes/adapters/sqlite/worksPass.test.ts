import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrateQuizzesToWorks, rewriteQuiz } from "./worksPass.js";

const works = new Map([["k1", "w1"], ["k2", "w2"], ["k3", "w1"]]);
const book = (key: string, title: string) => ({ key, title, author: "A", coverUrl: null, quote: null, blurb: null });

test("rewriteQuiz moves books and questions to works, first book per work, orphans dropped", () => {
  const data = JSON.stringify({ sourceLabel: "Shelf", questionCount: 4, allowedTypes: ["cover_title"], books: [book("k1", "One"), book("k2", "Two"), book("k3", "One again"), book("k-orphan", "Gone")], questions: [{ id: "q0", type: "cover_title", bookKey: "k2", options: ["a"], answerIndex: 0 }, { id: "q1", type: "cover_title", bookKey: "k-orphan", options: ["b"], answerIndex: 0 }] });
  const rewritten = JSON.parse(rewriteQuiz(data, works));
  assert.deepEqual(rewritten.books.map((b: { workId: string; title: string }) => [b.workId, b.title]), [["w1", "One"], ["w2", "Two"]]);
  assert.equal("key" in rewritten.books[0], false);
  assert.deepEqual(rewritten.questions.map((q: { workId: string | null }) => q.workId), ["w2", null]);
  assert.equal(rewritten.sourceLabel, "Shelf");
});

test("the pass rewrites stored quizzes and rebuilds quiz_works, once", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE quizzes (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', vote_code TEXT, play_open INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE quiz_works (quiz_id TEXT NOT NULL, key TEXT NOT NULL, work_id TEXT, PRIMARY KEY (quiz_id, key));
  `);
  db.prepare("INSERT INTO quizzes (id, owner_user_id, name, data) VALUES ('q', 'u', 'Q', ?)").run(JSON.stringify({ books: [book("k1", "One"), book("k2", "Two")], questions: null }));
  db.exec("INSERT INTO quiz_works VALUES ('q', 'k1', 'w1'), ('q', 'k2', 'w2')");
  migrateQuizzesToWorks(db);
  migrateQuizzesToWorks(db);
  assert.deepEqual(JSON.parse((db.prepare("SELECT data FROM quizzes").get() as { data: string }).data).books.map((b: { workId: string }) => b.workId), ["w1", "w2"]);
  assert.deepEqual(db.prepare("SELECT quiz_id, work_id FROM quiz_works ORDER BY work_id").all().map((r) => ({ ...r })), [{ quiz_id: "q", work_id: "w1" }, { quiz_id: "q", work_id: "w2" }]);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
});

test("invalid quiz data makes the pass throw and leaves quiz_works untouched", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE quizzes (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', vote_code TEXT, play_open INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE quiz_works (quiz_id TEXT NOT NULL, key TEXT NOT NULL, work_id TEXT, PRIMARY KEY (quiz_id, key));
  `);
  db.exec("INSERT INTO quizzes (id, owner_user_id, name, data) VALUES ('q', 'u', 'Q', '{not json')");
  db.exec("INSERT INTO quiz_works VALUES ('q', 'k1', 'w1')");
  assert.throws(() => migrateQuizzesToWorks(db), SyntaxError);
  assert.equal((db.prepare("PRAGMA table_info(quiz_works)").all() as Array<{ name: string }>).some((c) => c.name === "key"), true);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 0);
});
