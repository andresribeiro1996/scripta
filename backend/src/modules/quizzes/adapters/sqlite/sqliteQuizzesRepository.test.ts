import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDir = mkdtempSync(join(tmpdir(), "quizzes-repo-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");

const { applyQuizzesMigrations } = await import("./connection.js");
import { createSqliteQuizzesRepository } from "./sqliteQuizzesRepository.js";

function makeRepo() {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  return createSqliteQuizzesRepository(db);
}

type QuizRow = Parameters<ReturnType<typeof makeRepo>["insert"]>[0];

const quizRow = (overrides: Partial<QuizRow> = {}): QuizRow => ({
  id: "quiz-1",
  owner_user_id: "u1",
  name: "Quiz",
  data: "{}",
  vote_code: null,
  play_open: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides
});

const playRow = (id: string, quizId: string, voter: string | null, score = 0, durationMs = 0) => ({
  id,
  quiz_id: quizId,
  voter_user_id: voter,
  player_name: null,
  score,
  duration_ms: durationMs,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z"
});

test("quiz rows round-trip through insert/getOwned/getById", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  assert.equal(repo.getOwned("quiz-1", "u1")?.name, "Quiz");
  assert.equal(repo.getOwned("quiz-1", "u2"), undefined);
  assert.equal(repo.getById("quiz-1")?.id, "quiz-1");
  assert.equal(repo.getByVoteCode("nope"), undefined);
});

test("update merges the patch and refuses published quizzes", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  const updated = repo.update("quiz-1", "u1", { name: "Renamed", data: '{"a":1}' });
  assert.equal(updated?.name, "Renamed");
  assert.equal(JSON.parse(updated!.data).a, 1);
  repo.publish("quiz-1", "u1", "{}", "code42");
  assert.equal(repo.update("quiz-1", "u1", { name: "Nope" }), undefined);
});

test("insert and update keep quiz_works in step with the books' work ids; delete clears it", () => {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const repo = createSqliteQuizzesRepository(db);
  const rows = (quizId: string) => (db.prepare("SELECT work_id FROM quiz_works WHERE quiz_id = ? ORDER BY work_id").all(quizId) as Array<{ work_id: string }>).map((row) => row.work_id);
  const doc = (...ids: string[]) => JSON.stringify({ books: ids.map((workId) => ({ workId, title: workId })), questions: null });

  repo.insert(quizRow({ data: doc("w0", "w9") }));
  assert.deepEqual(rows("quiz-1"), ["w0", "w9"]);

  repo.update("quiz-1", "u1", { data: doc("w1") });
  assert.deepEqual(rows("quiz-1"), ["w1"]);

  repo.update("quiz-1", "u1", { name: "Renamed" });
  assert.deepEqual(rows("quiz-1"), ["w1"]);

  repo.insert(quizRow({ id: "quiz-2", owner_user_id: "u2", data: doc("w2") }));
  assert.equal(repo.delete("quiz-1", "u1"), true);
  assert.deepEqual(rows("quiz-1"), []);
  assert.deepEqual(rows("quiz-2"), ["w2"]);

  repo.deleteUserData("u2");
  assert.deepEqual(rows("quiz-2"), []);
});

test("publish stamps code + play_open once, and vote codes are unique", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  const published = repo.publish("quiz-1", "u1", '{"questions":[]}', "code42");
  assert.equal(published?.play_open, 1);
  assert.equal(repo.publish("quiz-1", "u1", "{}", "again"), undefined);
  repo.insert(quizRow({ id: "quiz-other" }));
  assert.throws(() => repo.insert(quizRow({ id: "quiz-3", vote_code: "code42" })));
});

test("savePlay stores answers; one play per voter is enforced by the index", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  const answers = [
    { play_id: "p1", quiz_id: "quiz-1", question_id: "q0", choice_index: 2, correct: 1 },
    { play_id: "p1", quiz_id: "quiz-1", question_id: "q1", choice_index: 0, correct: 0 }
  ];
  repo.savePlay(playRow("p1", "quiz-1", "u9", 1, 5000), answers);
  assert.equal(repo.getPlayByVoter("quiz-1", "u9")?.score, 1);
  assert.equal(repo.getAnswers("p1").length, 2);
  assert.equal(repo.playCount("quiz-1"), 1);
  assert.throws(() => repo.savePlay(playRow("p2", "quiz-1", "u9"), []));
});

test("listPlays orders by score DESC then duration ASC; stats aggregate", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  const answer = (playId: string, q: string, choice: number, correct: number) => ({ play_id: playId, quiz_id: "quiz-1", question_id: q, choice_index: choice, correct });
  repo.savePlay(playRow("p1", "quiz-1", "u9", 1, 9000), [answer("p1", "q0", 0, 1), answer("p1", "q1", 1, 0)]);
  repo.savePlay(playRow("p2", "quiz-1", "u8", 2, 8000), [answer("p2", "q0", 0, 1), answer("p2", "q1", 2, 1)]);
  repo.savePlay(playRow("p3", "quiz-1", "u7", 2, 3000), [answer("p3", "q0", 2, 0), answer("p3", "q1", 2, 1)]);
  repo.savePlay(playRow("p4", "quiz-1", null, 2, 1000), [answer("p4", "q0", 0, 1), answer("p4", "q1", 0, 0)]);
  const plays = repo.listPlays("quiz-1").map((p) => p.id);
  assert.deepEqual(plays, ["p4", "p3", "p2", "p1"]);
  const stats = repo.questionStats("quiz-1");
  const q0 = stats.find((s) => s.questionId === "q0")!;
  assert.equal(q0.answerCount, 4);
  assert.equal(q0.correctCount, 3);
  assert.deepEqual(q0.picks, [{ choiceIndex: 0, count: 3 }, { choiceIndex: 2, count: 1 }]);
});

test("delete removes the quiz, its plays and their answers", () => {
  const repo = makeRepo();
  repo.insert(quizRow());
  repo.savePlay(playRow("p1", "quiz-1", "u9"), [{ play_id: "p1", quiz_id: "quiz-1", question_id: "q0", choice_index: 0, correct: 1 }]);
  assert.equal(repo.delete("quiz-1", "u1"), true);
  assert.equal(repo.getById("quiz-1"), undefined);
  assert.equal(repo.getAnswers("p1").length, 0);
  assert.equal(repo.delete("quiz-1", "u1"), false);
});

test("deleteUserData erases the account's quizzes and unlinks their plays elsewhere", () => {
  const repo = makeRepo();
  repo.insert(quizRow({ id: "mine", owner_user_id: "u1" }));
  repo.insert(quizRow({ id: "theirs", owner_user_id: "u2" }));
  const answer = (playId: string, quizId: string, q: string) => ({ play_id: playId, quiz_id: quizId, question_id: q, choice_index: 0, correct: 1 });
  repo.savePlay(playRow("own", "mine", "u1"), [answer("own", "mine", "q0")]);
  repo.savePlay(playRow("guest", "theirs", "u1"), [answer("guest", "theirs", "q0")]);
  repo.savePlay(playRow("other", "theirs", "u9"), [answer("other", "theirs", "q0")]);

  repo.deleteUserData("u1");

  assert.equal(repo.getById("mine"), undefined);
  assert.equal(repo.getById("theirs")?.owner_user_id, "u2");
  assert.equal(repo.getAnswers("own").length, 0);
  // The play on someone else's quiz stays (the leaderboard keeps its row),
  // unlinked from the deleted account.
  assert.deepEqual(repo.getPlayByVoter("theirs", "u1"), undefined);
  assert.equal(repo.getPlayById("theirs", "guest")?.player_name, null);
  assert.equal(repo.getPlayByVoter("theirs", "u9")?.id, "other");
});

test("participation counts other people's plays on the owner's quizzes", () => {
  const repo = makeRepo();
  repo.insert(quizRow({ id: "quiz-1", name: "Mine" }));
  repo.insert(quizRow({ id: "quiz-2", name: "Theirs", owner_user_id: "u9" }));
  const play = (id: string, quizId: string, voter: string | null, createdAt: string) => ({ ...playRow(id, quizId, voter), created_at: createdAt });
  repo.savePlay(play("own", "quiz-1", "u1", "2026-01-01T00:00:00Z"), []);
  repo.savePlay(play("p2", "quiz-1", "u2", "2026-01-02T00:00:00Z"), []);
  repo.savePlay(play("p3", "quiz-1", null, "2026-01-03T00:00:00Z"), []);
  repo.savePlay(play("p4", "quiz-1", "u3", "2026-01-04T00:00:00Z"), []);
  repo.savePlay(play("p5", "quiz-2", "u2", "2026-01-05T00:00:00Z"), []);

  assert.deepEqual(repo.listParticipation("u1", "2026-01-01T00:00:00Z").map((r) => ({ ...r })), [
    { id: "quiz-1", name: "Mine", participants: 3, latest_at: "2026-01-04T00:00:00Z" }
  ]);
  assert.deepEqual(repo.listRecentPlayers("quiz-1", "u1", 10).map((r) => ({ ...r })), [
    { user_id: "u3", at: "2026-01-04T00:00:00Z" },
    { user_id: "u2", at: "2026-01-02T00:00:00Z" }
  ]);
  assert.deepEqual(repo.listRecentPlayers("quiz-1", "u1", 1).map((r) => r.user_id), ["u3"]);
});

test("participation lists only the quizzes played since the marker, and their counts still cover every play", () => {
  const repo = makeRepo();
  repo.insert(quizRow({ id: "quiet", name: "Quiet" }));
  repo.insert(quizRow({ id: "busy", name: "Busy" }));
  const play = (id: string, quizId: string, voter: string | null, createdAt: string) => ({ ...playRow(id, quizId, voter), created_at: createdAt });
  repo.savePlay(play("q1", "quiet", "u2", "2026-01-02T00:00:00.000Z"), []);
  repo.savePlay(play("b1", "busy", "u2", "2026-01-02T00:00:00.000Z"), []);
  repo.savePlay(play("b2", "busy", "u3", "2026-02-10T00:00:00.000Z"), []);
  const listed = (since: string) => repo.listParticipation("u1", since).map((r) => [r.id, r.participants, r.latest_at]).sort();

  assert.deepEqual(listed("2026-01-01T00:00:00.000Z"), [["busy", 2, "2026-02-10T00:00:00.000Z"], ["quiet", 1, "2026-01-02T00:00:00.000Z"]]);
  assert.deepEqual(listed("2026-02-01T00:00:00.000Z"), [["busy", 2, "2026-02-10T00:00:00.000Z"]]);
  assert.deepEqual(listed("2026-02-10T00:00:00.000Z"), [["busy", 2, "2026-02-10T00:00:00.000Z"]]);
  assert.deepEqual(listed("2026-02-10T00:00:00.001Z"), []);
});

test("an E1-shaped quiz database is migrated on open", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE quizzes (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', vote_code TEXT, play_open INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE quiz_plays (id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL, voter_user_id TEXT, player_name TEXT, score INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE quiz_play_answers (play_id TEXT NOT NULL REFERENCES quiz_plays(id) ON DELETE CASCADE, quiz_id TEXT NOT NULL, question_id TEXT NOT NULL, choice_index INTEGER NOT NULL, correct INTEGER NOT NULL, PRIMARY KEY (play_id, question_id));
    CREATE TABLE quiz_works (quiz_id TEXT NOT NULL, key TEXT NOT NULL, work_id TEXT, PRIMARY KEY (quiz_id, key));
    CREATE INDEX idx_quiz_works_work ON quiz_works(work_id);
  `);
  const book = (key: string) => ({ key, title: `Title ${key}`, author: "A", coverUrl: `https://covers.test/${key}.jpg`, quote: null, blurb: null });
  const data = JSON.stringify({ sourceLabel: "", questionCount: 1, allowedTypes: ["cover_title"], books: ["k0", "k1", "k2", "k3"].map(book), questions: [{ id: "q0", type: "cover_title", bookKey: "k1", options: ["a", "b", "c", "d"], answerIndex: 2 }] });
  db.prepare("INSERT INTO quizzes (id, owner_user_id, name, data, vote_code, play_open) VALUES ('live', 'u1', 'Live', ?, 'CODE1', 1)").run(data);
  db.exec(`
    INSERT INTO quiz_works VALUES ('live', 'k0', 'w0'), ('live', 'k1', 'w1'), ('live', 'k2', 'w2'), ('live', 'k3', 'w3');
    INSERT INTO quiz_plays (id, quiz_id, voter_user_id, score) VALUES ('p1', 'live', 'u9', 1);
    INSERT INTO quiz_play_answers VALUES ('p1', 'live', 'q0', 2, 1);
  `);

  applyQuizzesMigrations(db);
  applyQuizzesMigrations(db);

  const repo = createSqliteQuizzesRepository(db);
  const stored = JSON.parse(repo.getById("live")!.data) as { books: Array<{ workId: string }>; questions: Array<{ workId: string; bookKey?: string }> };
  assert.deepEqual(stored.books.map((b) => b.workId), ["w0", "w1", "w2", "w3"]);
  assert.deepEqual(stored.questions.map((q) => q.workId), ["w1"]);
  assert.equal("bookKey" in stored.questions[0]!, false);
  assert.equal(repo.getByVoteCode("CODE1")?.play_open, 1);
  assert.equal(repo.getPlayByVoter("live", "u9")?.score, 1);
  assert.deepEqual(repo.getAnswers("p1").map((a) => [a.question_id, a.choice_index, a.correct]), [["q0", 2, 1]]);
  assert.deepEqual(db.prepare("SELECT work_id FROM quiz_works WHERE quiz_id = 'live' ORDER BY work_id").all().map((r) => r.work_id), ["w0", "w1", "w2", "w3"]);
  const columns = (db.prepare("PRAGMA table_info(quiz_works)").all() as Array<{ name: string }>).map((c) => c.name);
  assert.equal(columns.includes("key"), false);
  const indexes = (db.prepare("PRAGMA index_list(quiz_works)").all() as Array<{ name: string }>).map((i) => i.name);
  assert.equal(indexes.includes("idx_quiz_works_work"), true);
});

test("a trigger that rolls the transaction back surfaces its own error and keeps every row", () => {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const repo = createSqliteQuizzesRepository(db);
  repo.insert(quizRow());
  repo.savePlay(playRow("p1", "quiz-1", "u9"), []);
  db.exec("CREATE TRIGGER boom BEFORE DELETE ON quizzes BEGIN SELECT RAISE(ROLLBACK, 'trigger boom'); END");
  assert.throws(() => repo.deleteUserData("u1"), /trigger boom/);
  assert.equal(repo.playCount("quiz-1"), 1);
  assert.equal(db.isTransaction, false);
});

test("published quizzes about any of the given works, newest first; drafts never", async () => {
  const { createQuizzesService, createQuizzesPublicApi } = await import("../../service.js");
  const repo = makeRepo();
  const books = (...workIds: string[]) => JSON.stringify({ books: workIds.map((workId) => ({ workId })) });
  repo.insert(quizRow({ id: "old", name: "Old", data: books("w-old", "w-x"), vote_code: "code-old", created_at: "2026-01-01T00:00:00Z" }));
  repo.insert(quizRow({ id: "both", name: "Both", owner_user_id: "u2", data: books("w-old", "w-new"), vote_code: "code-both", created_at: "2026-02-01T00:00:00Z" }));
  repo.insert(quizRow({ id: "other", name: "Other", data: books("w-other"), vote_code: "code-other", created_at: "2026-03-01T00:00:00Z" }));
  repo.insert(quizRow({ id: "draft", name: "Draft", data: books("w-old", "w-new"), created_at: "2026-04-01T00:00:00Z" }));

  assert.deepEqual(repo.listPublishedByWorks(["w-new", "w-old"], 20).map((r) => r.id), ["both", "old"]);
  assert.deepEqual(repo.listPublishedByWorks(["w-new", "w-old"], 1).map((r) => r.id), ["both"]);
  assert.equal(repo.listPublishedByWorks([], 20).length, 0);

  const api = createQuizzesPublicApi(createQuizzesService(repo));
  assert.deepEqual(api.publishedByWorks(["w-new", "w-old"], 20), [
    { id: "both", name: "Both", path: "/play/code-both", ownerUserId: "u2" },
    { id: "old", name: "Old", path: "/play/code-old", ownerUserId: "u1" }
  ]);
});

function seedPublished() {
  const repo = makeRepo();
  repo.insert(quizRow({ id: "habits", name: "Hábitos Atómicos", vote_code: "c1", created_at: "2026-01-01T00:00:00.000Z" }));
  repo.insert(quizRow({ id: "fantasy", name: "Fantasy ranked", owner_user_id: "u2", vote_code: "c2", created_at: "2026-02-01T00:00:00.000Z" }));
  repo.insert(quizRow({ id: "habits-2", name: "Atomic Habits: Hábitos", vote_code: "c3", created_at: "2026-03-01T00:00:00.000Z" }));
  repo.insert(quizRow({ id: "draft", name: "Hábitos privados", created_at: "2026-04-01T00:00:00.000Z" }));
  return repo;
}

test("getPublicById and listPublicByUser see published quizzes only, newest first", () => {
  const repo = seedPublished();
  assert.equal(repo.getPublicById("habits")?.vote_code, "c1");
  assert.equal(repo.getPublicById("draft"), undefined);
  assert.equal(repo.getPublicById("ghost"), undefined);
  assert.deepEqual(repo.listPublicByUser("u1").map((r) => r.id), ["habits-2", "habits"]);
  assert.deepEqual(repo.listPublicByUser("u2").map((r) => r.id), ["fantasy"]);
  assert.deepEqual(repo.listPublicByUser("u3"), []);
});

test("listPublicByIds returns the published quizzes among the ids and nothing else", () => {
  const repo = seedPublished();
  assert.deepEqual(repo.listPublicByIds(["habits", "draft", "ghost", "fantasy"]).map((r) => r.id).sort(), ["fantasy", "habits"]);
  assert.deepEqual(repo.listPublicByIds([]), []);
});

test("discoverWindow matches published names accent-insensitively, newest first, up to the limit", () => {
  const repo = seedPublished();
  const ids = (needle: string, limit = 10) => repo.discoverWindow(needle, limit).map((r) => r.id);
  assert.deepEqual(ids("habitos"), ["habits-2", "habits"]);
  assert.deepEqual(ids("habitos", 1), ["habits-2"]);
  assert.deepEqual(ids("habitos atom"), ["habits"]);
  assert.deepEqual(ids("fantasy"), ["fantasy"]);
  assert.deepEqual(ids("nothing like it"), []);
  assert.deepEqual(ids(""), ["habits-2", "fantasy", "habits"]);
  assert.deepEqual(ids("", 2), ["habits-2", "fantasy"]);
  assert.deepEqual(repo.discoverWindow("fantasy", 10).map((r) => ({ ...r })), [{ id: "fantasy", created_at: "2026-02-01T00:00:00.000Z", owner_user_id: "u2" }]);
});

test("playCountsFor counts plays per requested quiz and omits quizzes without plays", () => {
  const repo = seedPublished();
  repo.savePlay(playRow("p1", "habits", "u9"), []);
  repo.savePlay(playRow("p2", "habits", null), []);
  repo.savePlay(playRow("p3", "fantasy", "u9"), []);
  assert.deepEqual([...repo.playCountsFor(["habits", "fantasy", "habits-2"])].sort(), [["fantasy", 1], ["habits", 2]]);
  assert.equal(repo.playCountsFor([]).size, 0);
});

test("votedAmong returns the published quizzes the viewer has played, owner plays included", () => {
  const repo = seedPublished();
  repo.savePlay(playRow("p1", "habits", "u9"), []);
  repo.savePlay(playRow("p2", "fantasy", "u2"), []);
  repo.savePlay(playRow("p3", "habits-2", null), []);
  assert.deepEqual(repo.votedAmong("u9", ["habits", "fantasy", "habits-2", "ghost"]), ["habits"]);
  assert.deepEqual(repo.votedAmong("u2", ["habits", "fantasy"]), ["fantasy"]);
  assert.deepEqual(repo.votedAmong("u9", []), []);
});
