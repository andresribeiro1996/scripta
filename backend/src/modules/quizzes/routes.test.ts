// Wire-shape tests for the public play surface — what a curl really gets.
// Same env-before-import discipline as tierlists' routes.test.ts.

import assert from "node:assert/strict";
import Fastify, { type InjectOptions } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratchDir = mkdtempSync(join(tmpdir(), "quizzes-routes-test-"));
process.env.AUTH_DB_PATH = join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratchDir, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratchDir, "gallery-files");
process.env.COVERS_DB_PATH = join(scratchDir, "covers.sqlite");
process.env.COVERS_STORAGE_PATH = join(scratchDir, "covers-files");
process.env.TIERLISTS_DB_PATH = join(scratchDir, "tierlists.sqlite");
process.env.QUIZZES_DB_PATH = join(scratchDir, "quizzes.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyQuizzesMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteQuizzesRepository } = await import("./adapters/sqlite/sqliteQuizzesRepository.js");
const { createQuizzesService } = await import("./service.js");
const { buildPublicQuizRoutes } = await import("./routes.js");

type Service = ReturnType<typeof createQuizzesService>;

const book = (key: string) => ({ key, title: `Title ${key}`, author: "A", coverUrl: `https://covers.test/${key}.jpg`, quote: `Quote ${key}`, blurb: null });

/** A published 3-question quiz with its code and the owner-held answer key. */
function publishedQuiz() {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const service = createQuizzesService(createSqliteQuizzesRepository(db));
  const created = service.createQuiz("u1", "Trivia", {
    sourceLabel: "Shelf",
    questionCount: 3,
    allowedTypes: ["cover_title", "title_cover", "quote_title", "blurb_title"],
    books: Array.from({ length: 6 }, (_, i) => book(`b${i}`)),
    questions: null
  });
  const outcome = service.publishQuiz("u1", created.id, []);
  assert.ok(outcome.ok);
  const code = outcome.ok ? outcome.quiz.voteCode! : "";
  const answerKey = (service.getQuiz("u1", created.id)!.data as { questions: Array<{ id: string; answerIndex: number }> }).questions;
  return { service, code, answerKey };
}

async function call(service: Service, options: InjectOptions, signedInAs?: string) {
  const app = Fastify();
  if (signedInAs) app.decorate("authenticateAccessToken", (token: string) => token === signedInAs ? { id: signedInAs, email: `${signedInAs}@example.test`, username: signedInAs, avatarId: null } : null);
  await app.register(buildPublicQuizRoutes(service));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return { status: res.statusCode, body: res.json() as Record<string, never> };
}

test("the public board never carries the answer key", async () => {
  const { service, code } = publishedQuiz();
  const { status, body } = await call(service, { method: "GET", url: `/quizzes/voting/${code}` });
  assert.equal(status, 200);
  const board = body.board as unknown as { questions: Array<{ options: string[] } & Record<string, unknown>>; playOpen: boolean; questionCount: number };
  assert.equal(board.playOpen, true);
  assert.equal(board.questionCount, 3);
  for (const q of board.questions) {
    assert.equal("answerIndex" in q, false);
    assert.equal(q.options.length, 4);
    assert.ok(q.prompt);
  }
});

test("a closed quiz is a 403 on both the board and play", async () => {
  const { service, code } = publishedQuiz();
  const owned = service.listQuizzes("u1")[0]!;
  service.setPlayState("u1", owned.id, false);
  const board = await call(service, { method: "GET", url: `/quizzes/voting/${code}` });
  assert.equal(board.status, 403);
  // Well-shaped body: the 403 must come from play_open, not from zod.
  const play = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers: [{ questionId: "q0", choiceIndex: 0 }], durationMs: 1 } });
  assert.equal(play.status, 403);
});

test("a full submission is graded; wrong-shaped answers are a 400", async () => {
  const { service, code, answerKey } = publishedQuiz();
  const answers = answerKey.map((q) => ({ questionId: q.id, choiceIndex: q.answerIndex }));
  const good = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 12345, playerName: "Alice" } });
  assert.equal(good.status, 200);
  assert.equal((good.body as unknown as { score: number }).score, answerKey.length);
  const bad = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers: [{ questionId: "q0", choiceIndex: 0 }], durationMs: 1 } });
  assert.equal(bad.status, 400);
});

test("a second play by the same account is a 409", async () => {
  const { service, code, answerKey } = publishedQuiz();
  const answers = answerKey.map((q) => ({ questionId: q.id, choiceIndex: q.answerIndex }));
  await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 1 } }, "u9");
  const again = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 1 } }, "u9");
  assert.equal(again.status, 409);
});

test("the public leaderboard lists plays best-first and hides ids", async () => {
  const { service, code, answerKey } = publishedQuiz();
  const answers = answerKey.map((q) => ({ questionId: q.id, choiceIndex: q.answerIndex }));
  await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 9000, playerName: "Slow" } });
  await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 1000, playerName: "Fast" } });
  const { status, body } = await call(service, { method: "GET", url: `/quizzes/voting/${code}/results` });
  assert.equal(status, 200);
  const plays = (body as unknown as { plays: Array<{ playerName: string; score: number; durationMs: number }> }).plays;
  assert.deepEqual(plays.map((p) => p.playerName), ["Fast", "Slow"]);
  for (const play of plays) {
    assert.equal("playId" in play, false);
    assert.equal("voter_user_id" in play, false);
  }
});

test("an unknown code is a 404 everywhere", async () => {
  const { service } = publishedQuiz();
  assert.equal((await call(service, { method: "GET", url: "/quizzes/voting/nosuchcode" })).status, 404);
  assert.equal((await call(service, { method: "GET", url: "/quizzes/voting/nosuchcode/results" })).status, 404);
  // Well-shaped body: the 404 must come from the service, not from zod.
  const wellShaped = { answers: [{ questionId: "q0", choiceIndex: 0 }], durationMs: 1 };
  assert.equal((await call(service, { method: "POST", url: "/quizzes/voting/nosuchcode/play", body: wellShaped })).status, 404);
});
