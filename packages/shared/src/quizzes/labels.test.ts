import assert from "node:assert/strict";
import { test } from "node:test";
import { playerLabel, quizOptionLabel, quizQuestionLabel, scoreRows } from "./labels.js";
import type { PublicQuizQuestion, QuizBook, QuizQuestion } from "./types.js";

const books: QuizBook[] = [{ workId: "w1", title: "Dune", author: "Frank Herbert", coverUrl: "/c/dune.jpg", quote: null, blurb: null }];
const question = (workId: string | null): QuizQuestion => ({ id: "q0", type: "quote_title", workId, options: ["a", "b"], answerIndex: 0 });

test("a question label names the book it is about", () => {
  assert.equal(quizQuestionLabel(question("w1"), 0, books), "Q1 · Dune");
  assert.equal(quizQuestionLabel(question("missing"), 2, books), "Q3");
  assert.equal(quizQuestionLabel(question(null), 2, books), "Q3");
});

test("a title_cover option is shown as its book's title", () => {
  assert.equal(quizOptionLabel("title_cover", "/c/dune.jpg", books), "Dune");
  assert.equal(quizOptionLabel("title_cover", "/c/other.jpg", books), "Unknown book");
  assert.equal(quizOptionLabel("quote_title", "Dune", books), "Dune");
});

test("a player without a name is a guest", () => {
  assert.deepEqual(playerLabel({ playerName: null, anonymous: true }), { name: "Guest", guest: true });
  assert.deepEqual(playerLabel({ playerName: "Reader", anonymous: false }), { name: "Reader", guest: false });
});

test("score rows carry the right answer, and the pick when wrong", () => {
  const questions: PublicQuizQuestion[] = [
    { id: "q0", type: "title_cover", prompt: "Dune", options: ["/c/a.jpg", "/c/b.jpg"] },
    { id: "q1", type: "cover_title", prompt: "/c/x.jpg", options: ["Dune", "Emma"] }
  ];
  const correct = { q0: false, q1: true };
  const rows = scoreRows(questions, correct, { q0: { choiceIndex: 0, answerIndex: 1 }, q1: { choiceIndex: 0, answerIndex: 0 } });
  assert.deepEqual(rows[0], { id: "q0", number: 1, correct: false, answer: { kind: "cover", value: "/c/b.jpg", title: "Dune" }, pick: { kind: "cover", value: "/c/a.jpg" } });
  assert.deepEqual(rows[1], { id: "q1", number: 2, correct: true, answer: { kind: "text", value: "Dune" } });
  assert.deepEqual(scoreRows(questions, correct, undefined), [{ id: "q0", number: 1, correct: false }, { id: "q1", number: 2, correct: true }]);
});
