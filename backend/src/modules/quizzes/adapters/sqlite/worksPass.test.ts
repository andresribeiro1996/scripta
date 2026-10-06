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

test("the pass moves a published quiz's questions to works and leaves plays and answers intact", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE quizzes (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', vote_code TEXT, play_open INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE quiz_plays (id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL, voter_user_id TEXT, player_name TEXT, score INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE quiz_play_answers (play_id TEXT NOT NULL REFERENCES quiz_plays(id) ON DELETE CASCADE, quiz_id TEXT NOT NULL, question_id TEXT NOT NULL, choice_index INTEGER NOT NULL, correct INTEGER NOT NULL, PRIMARY KEY (play_id, question_id));
    CREATE TABLE quiz_works (quiz_id TEXT NOT NULL, key TEXT NOT NULL, work_id TEXT, PRIMARY KEY (quiz_id, key));
  `);
  const data = JSON.stringify({ questionCount: 2, allowedTypes: ["cover_title"], books: [book("k1", "One"), book("k2", "Two")], questions: [{ id: "q0", type: "cover_title", bookKey: "k1", options: ["a", "b"], answerIndex: 1 }, { id: "q1", type: "cover_title", bookKey: "k2", options: ["c", "d"], answerIndex: 0 }] });
  db.prepare("INSERT INTO quizzes (id, owner_user_id, name, data, vote_code, play_open) VALUES ('live', 'u', 'Live', ?, 'CODE1', 1)").run(data);
  db.exec(`
    INSERT INTO quiz_works VALUES ('live', 'k1', 'w1'), ('live', 'k2', 'w2');
    INSERT INTO quiz_plays (id, quiz_id, voter_user_id, player_name, score, duration_ms) VALUES ('p1', 'live', 'v', 'Ann', 1, 900);
    INSERT INTO quiz_play_answers VALUES ('p1', 'live', 'q0', 1, 1), ('p1', 'live', 'q1', 1, 0);
  `);
  migrateQuizzesToWorks(db);
  const stored = db.prepare("SELECT data, vote_code, play_open FROM quizzes").get() as { data: string; vote_code: string; play_open: number };
  const rewritten = JSON.parse(stored.data);
  assert.deepEqual(rewritten.questions.map((q: { id: string; workId: string; answerIndex: number }) => [q.id, q.workId, q.answerIndex]), [["q0", "w1", 1], ["q1", "w2", 0]]);
  assert.equal(rewritten.questions.some((q: Record<string, unknown>) => "bookKey" in q), false);
  assert.deepEqual([stored.vote_code, stored.play_open], ["CODE1", 1]);
  assert.deepEqual(db.prepare("SELECT id, quiz_id, player_name, score, duration_ms FROM quiz_plays").all().map((r) => ({ ...r })), [{ id: "p1", quiz_id: "live", player_name: "Ann", score: 1, duration_ms: 900 }]);
  assert.deepEqual(db.prepare("SELECT question_id, choice_index, correct FROM quiz_play_answers ORDER BY question_id").all().map((r) => ({ ...r })), [{ question_id: "q0", choice_index: 1, correct: 1 }, { question_id: "q1", choice_index: 1, correct: 0 }]);
});
