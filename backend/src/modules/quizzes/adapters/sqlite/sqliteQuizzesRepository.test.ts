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
