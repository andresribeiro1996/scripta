// Exercises service.ts against a hand-written in-memory QuizzesRepository
// fake — no real SQLite, same seam as tierlists' service.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizBook } from "@scripta/shared";
import type { QuizzesRepository } from "./domain/ports.js";
import type { AnswerRow, PlayRow, QuizRow } from "./domain/types.js";
import { createQuizzesService } from "./service.js";

function createInMemoryRepo(): QuizzesRepository {
  const quizzes = new Map<string, QuizRow>();
  const plays = new Map<string, PlayRow>();
  const answers = new Map<string, AnswerRow[]>();
  return {
    rekeyBooks() {},
    listByUser: (userId) => [...quizzes.values()].filter((q) => q.owner_user_id === userId),
    getOwned: (id, userId) => {
      const q = quizzes.get(id);
      return q && q.owner_user_id === userId ? q : undefined;
    },
    getById: (id) => quizzes.get(id),
    insert: (row) => quizzes.set(row.id, { ...row }),
    update: (id, userId, patch) => {
      const existing = quizzes.get(id);
      if (!existing || existing.owner_user_id !== userId) return undefined;
      const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
      quizzes.set(id, merged);
      return merged;
    },
    delete: (id, userId) => {
      const existing = quizzes.get(id);
      if (!existing || existing.owner_user_id !== userId) return false;
      quizzes.delete(id);
      return true;
    },
    deleteUserData: () => {},
    getByVoteCode: (code) => [...quizzes.values()].find((q) => q.vote_code === code),
    publish: (id, userId, data, code) => {
      const row = quizzes.get(id);
      if (!row || row.owner_user_id !== userId || row.vote_code) return undefined;
      const published = { ...row, data, vote_code: code, play_open: 1 };
      quizzes.set(id, published);
      return published;
    },
    setPlayOpen: (id, userId, open) => {
      const existing = quizzes.get(id);
      if (!existing || existing.owner_user_id !== userId) return undefined;
      const merged = { ...existing, play_open: open };
      quizzes.set(id, merged);
      return merged;
    },
    getPlayById: (quizId, playId) => {
      const p = plays.get(playId);
      return p && p.quiz_id === quizId ? p : undefined;
    },
    getPlayByVoter: (quizId, voter) => [...plays.values()].find((p) => p.quiz_id === quizId && p.voter_user_id === voter),
    savePlay: (play, rows) => {
      plays.set(play.id, { ...play });
      answers.set(play.id, [...rows]);
    },
    getAnswers: (playId) => answers.get(playId) ?? [],
    listPlays: (quizId) =>
      [...plays.values()]
        .filter((p) => p.quiz_id === quizId)
        .sort((a, b) => b.score - a.score || a.duration_ms - b.duration_ms),
    playCount: (quizId) => [...plays.values()].filter((p) => p.quiz_id === quizId).length,
    questionStats: (quizId) => {
      const byQuestion = new Map<string, { answerCount: number; correctCount: number; picks: Map<number, number> }>();
      for (const rows of answers.values()) {
        if (rows[0]?.quiz_id !== quizId) continue;
        for (const row of rows) {
          let stat = byQuestion.get(row.question_id);
          if (!stat) byQuestion.set(row.question_id, (stat = { answerCount: 0, correctCount: 0, picks: new Map() }));
          stat.answerCount += 1;
          stat.correctCount += row.correct;
          stat.picks.set(row.choice_index, (stat.picks.get(row.choice_index) ?? 0) + 1);
        }
      }
      return [...byQuestion.entries()].map(([questionId, s]) => ({
        questionId,
        answerCount: s.answerCount,
        correctCount: s.correctCount,
        picks: [...s.picks.entries()].map(([choiceIndex, count]) => ({ choiceIndex, count }))
      }));
    }
  };
}

const book = (key: string, extra: Partial<QuizBook> = {}): QuizBook => ({
  key,
  title: `Title ${key}`,
  author: "A",
  coverUrl: `https://covers.test/${key}.jpg`,
  quote: `Quote ${key}`,
  blurb: `Blurb ${key}`,
  ...extra
});

function makeService() {
  const repo = createInMemoryRepo();
  const service = createQuizzesService(repo);
  const created = service.createQuiz("u1", "My quiz", {
    sourceLabel: "Shelf",
    questionCount: 3,
    allowedTypes: ["cover_title", "title_cover", "quote_title", "blurb_title"],
    books: [book("b0", { coverUrl: null }), ...Array.from({ length: 5 }, (_, i) => book(`b${i + 1}`))],
    questions: null
  });
  return { repo, service, quizId: created.id };
}

test("publish generates the full seeded set, mints a code, and opens play", () => {
  const { service, quizId } = makeService();
  const outcome = service.publishQuiz("u1", quizId, []);
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.ok(outcome.quiz.voteCode);
  const data = outcome.quiz.data as { questions: Array<{ id: string; options: string[]; answerIndex: number }>; books: unknown[] };
  assert.equal(data.questions.length, 3);
  assert.equal(data.books.length, 6);
  assert.equal(outcome.quiz.playOpen, true);
});

test("publish resolves covers for shelf books that lack one", () => {
  const { service, quizId } = makeService();
  const outcome = service.publishQuiz("u1", quizId, [{ bookKey: "b0", coverUrl: "https://resolved.test/b0.jpg" }]);
  assert.ok(outcome.ok);
  const data = outcome.ok ? (outcome.quiz.data as { books: Array<{ key: string; coverUrl: string | null }> }) : null;
  assert.equal(data!.books.find((b) => b.key === "b0")!.coverUrl, "https://resolved.test/b0.jpg");
});

test("publish refuses another user's quiz and a second publish", () => {
  const { service, quizId } = makeService();
  const byOther = service.publishQuiz("u2", quizId, []);
  assert.equal(byOther.ok, false);
  if (!byOther.ok) assert.equal(byOther.reason, "not-found");
  assert.ok(service.publishQuiz("u1", quizId, []).ok);
  const again = service.publishQuiz("u1", quizId, []);
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.reason, "already-published");
});

test("publish rejects too few books", () => {
  const { service } = makeService();
  const few = service.createQuiz("u1", "Few", {
    sourceLabel: "",
    questionCount: 10,
    allowedTypes: ["cover_title"],
    books: Array.from({ length: 3 }, (_, i) => book(`f${i}`)),
    questions: null
  });
  const outcome = service.publishQuiz("u1", few.id, []);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.reason, "invalid");
    assert.match(outcome.error, /at least 4 books/i);
  }
});

test("getPlayBoard strips the answer key and carries the prompt", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId, []);
  assert.ok(published.ok);
  const board = service.getPlayBoard(published.ok ? published.quiz.voteCode! : "");
  assert.ok(board);
  assert.equal(board!.questions.length, 3);
  for (const q of board!.questions) {
    assert.equal("answerIndex" in q, false);
    assert.ok(q.prompt.length > 0);
    assert.equal(q.options.length, 4);
  }
});

test("submitPlay grades server-side and locks one play per player", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId, []);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const board = service.getPlayBoard(code)!;
  const key = (service.getQuiz("u1", quizId)!.data as { questions: Array<{ id: string; answerIndex: number }> }).questions;
  const answers = board.questions.map((q) => ({ questionId: q.id, choiceIndex: key.find((k) => k.id === q.id)!.answerIndex }));
  const first = service.submitPlay(code, answers, 20000, "Alice", { kind: "user", userId: "u9" });
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.score, board.questions.length);
  const second = service.submitPlay(code, answers, 20000, "Alice", { kind: "user", userId: "u9" });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, "already-played");
});

test("submitPlay rejects wrong-shaped answers and closed quizzes", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId, []);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const short = service.submitPlay(code, [{ questionId: "q0", choiceIndex: 0 }], 1, null, { kind: "anonymous", playId: null });
  assert.equal(short.ok, false);
  if (!short.ok) assert.equal(short.reason, "invalid");
  const unknownQuestion = service.submitPlay(code, [{ questionId: "zz", choiceIndex: 0 }, { questionId: "q0", choiceIndex: 0 }, { questionId: "q1", choiceIndex: 0 }], 1, null, { kind: "anonymous", playId: null });
  assert.equal(unknownQuestion.ok, false);
  if (!unknownQuestion.ok) assert.equal(unknownQuestion.reason, "invalid");
  service.setPlayState("u1", quizId, false);
  const closed = service.submitPlay(code, [{ questionId: "q0", choiceIndex: 0 }, { questionId: "q1", choiceIndex: 0 }, { questionId: "q2", choiceIndex: 0 }], 1, null, { kind: "anonymous", playId: null });
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.reason, "closed");
});

test("anonymous players recover their play by the id handle", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId, []);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const board = service.getPlayBoard(code)!;
  const answers = board.questions.map((q) => ({ questionId: q.id, choiceIndex: 0 }));
  const play = service.submitPlay(code, answers, 1000, null, { kind: "anonymous", playId: null });
  assert.ok(play.ok);
  const recovered = service.getPlay(code, { kind: "anonymous", playId: play.ok ? play.playId : null });
  assert.equal(recovered.ok, true);
  assert.equal(service.getPlay(code, { kind: "anonymous", playId: "nope" }).ok, false);
});

test("results order plays score-then-speed and include per-question stats", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId, []);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const board = service.getPlayBoard(code)!;
  const answers = board.questions.map((q) => ({ questionId: q.id, choiceIndex: 0 }));
  service.submitPlay(code, answers, 9000, "Slow", { kind: "anonymous", playId: null });
  service.submitPlay(code, answers, 1000, "Fast", { kind: "anonymous", playId: null });
  const results = service.getResults("u1", quizId);
  assert.ok(results);
  assert.deepEqual(results!.plays.map((p) => p.playerName), ["Fast", "Slow"]);
  assert.ok(results!.stats.length > 0);
  assert.equal(results!.questionCount, 3);
});
