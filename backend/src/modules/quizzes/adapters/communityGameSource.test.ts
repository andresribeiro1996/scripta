import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PublicBookData, QuizBook } from "@scripta/shared";

const scratchDir = mkdtempSync(join(tmpdir(), "quizzes-game-source-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");

const { applyQuizzesMigrations } = await import("./sqlite/connection.js");
const { createSqliteQuizzesRepository } = await import("./sqlite/sqliteQuizzesRepository.js");
const { createQuizzesPublicApi, createQuizzesService } = await import("../service.js");
const { createQuizGameSource } = await import("./communityGameSource.js");

const works = {
  knownWorkIds: (ids: string[]) => ids,
  resolveTitleWorks: (books: Array<{ title: string; author: string }>) => books.map(() => null),
  canonicalByKey: (ids: Map<string, string>) => new Map(ids),
  publicBooksByWork: (_ownerUserId: string, _workIds: string[]) => new Map<string, PublicBookData>()
};

const book = (workId: string): QuizBook => ({ workId, title: `Title ${workId}`, author: "A", coverUrl: `https://covers.test/${workId}.jpg`, quote: `Quote ${workId}`, blurb: `Blurb ${workId}` });
const books = Array.from({ length: 6 }, (_, i) => book(`b${i}`));

function setup() {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const service = createQuizzesService(createSqliteQuizzesRepository(db), works);
  const source = createQuizGameSource(createQuizzesPublicApi(service));
  const draft = (owner: string, name: string) => {
    const outcome = service.createQuiz(owner, name, { sourceLabel: "", questionCount: 3, allowedTypes: ["title_cover"], books });
    assert.ok(outcome.ok);
    return outcome.ok ? outcome.quiz : (undefined as never);
  };
  const publish = (owner: string, name: string) => {
    const quiz = draft(owner, name);
    assert.ok(service.publishQuiz(owner, quiz.id).ok);
    return { id: quiz.id, code: service.getQuiz(owner, quiz.id)!.voteCode! };
  };
  const play = (code: string, userId: string) => {
    const answers = service.getPlayBoard(code)!.questions.map((q) => ({ questionId: q.id, choiceIndex: 0 }));
    assert.ok(service.submitPlay(code, answers, 1000, null, { kind: "user", userId }).ok);
  };
  return { service, source, draft, publish, play };
}

test("content kind and id match the listing, and covers come through as the public API returns them", () => {
  const { source, publish } = setup();
  const quiz = publish("u1", "Covers");

  const card = source.get(quiz.id)!;

  assert.equal(card.content.kind, "quiz");
  assert.equal(card.content.id, card.id);
  assert.equal(card.content.voteCode, quiz.code);
  assert.equal(card.promoted, false);
  assert.deepEqual(card.content.covers, ["b0", "b1", "b2"].map((id) => `https://covers.test/${id}.jpg`));
});

test("getMany marks viewerVoted only when a viewer is given", () => {
  const { source, publish, play } = setup();
  const played = publish("u1", "Played");
  const unplayed = publish("u1", "Unplayed");
  play(played.code, "u9");

  assert.ok(source.getMany([played.id, unplayed.id]).every((card) => !("viewerVoted" in card.content)));
  const withViewer = source.getMany([played.id, unplayed.id], "u9");
  assert.deepEqual(withViewer.map((card) => [card.id, card.content.viewerVoted]).sort(), [[played.id, true], [unplayed.id, false]].sort());
});

test("an unpublished or unknown id is left out of getMany and undefined from get", () => {
  const { source, draft, publish } = setup();
  const live = publish("u1", "Live");
  const unpublished = draft("u1", "Draft");

  assert.equal(source.get(unpublished.id), undefined);
  assert.equal(source.get("ghost"), undefined);
  assert.deepEqual(source.getMany([live.id, unpublished.id, "ghost"]).map((card) => card.id), [live.id]);
  assert.deepEqual(source.listByOwner("u1").map((card) => card.id), [live.id]);
});

test("listByOwner is newest first", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-01-01T00:00:00Z") });
  const { source, publish } = setup();
  const first = publish("u1", "First");
  t.mock.timers.tick(1000);
  const second = publish("u1", "Second");

  assert.deepEqual(source.listByOwner("u1").map((card) => card.id), [second.id, first.id]);
});

test("shelfFacts carries empty placements and a null champion", () => {
  const { source, publish } = setup();
  const quiz = publish("u1", "Facts");

  const facts = source.shelfFacts(null, null);

  assert.equal(facts.length, 1);
  assert.equal(facts[0]!.kind, "quiz");
  assert.equal(facts[0]!.id, quiz.id);
  assert.deepEqual(facts[0]!.placements, []);
  assert.equal(facts[0]!.champion, null);
  assert.equal(facts[0]!.promoted, false);
});

test("participation rows carry the vote code and book covers", () => {
  const { source, publish, play } = setup();
  const quiz = publish("u1", "Played");
  play(quiz.code, "u9");

  const rows = source.participation("u1", "2000-01-01T00:00:00.000Z");

  assert.deepEqual(rows.map((row) => [row.id, row.voteCode, row.covers.length]), [[quiz.id, quiz.code, 3]]);
});
