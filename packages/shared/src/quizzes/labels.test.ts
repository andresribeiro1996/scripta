import assert from "node:assert/strict";
import { test } from "node:test";
import { playerLabel, quizClueHeading, quizOptionLabel, quizQuestionLabel, resultCovers, scoreRows } from "./labels.js";
import type { PublicQuizQuestion, QuizBook, QuizQuestion } from "./types.js";

const books: QuizBook[] = [{ workId: "w1", title: "Dune", author: "Frank Herbert", coverUrl: "/c/dune.jpg", quote: null, blurb: null }];
const question = (workId: string | null): QuizQuestion => ({ id: "q0", type: "quote_title", workId, options: ["a", "b"], answerIndex: 0 });

test("a question label names the book it is about", () => {
  assert.equal(quizQuestionLabel(question("w1"), 0, books, "en"), "Q1 · Dune");
  assert.equal(quizQuestionLabel(question("missing"), 2, books, "en"), "Q3");
  assert.equal(quizQuestionLabel(question(null), 2, books, "en"), "Q3");
});

test("a title_cover option is shown as its book's title", () => {
  assert.equal(quizOptionLabel("title_cover", "/c/dune.jpg", books, "en"), "Dune");
  assert.equal(quizOptionLabel("title_cover", "/c/other.jpg", books, "en"), "Unknown book");
  assert.equal(quizOptionLabel("quote_title", "Dune", books, "en"), "Dune");
});

test("a player without a name is a guest", () => {
  assert.deepEqual(playerLabel({ playerName: null, anonymous: true }, "en"), { name: "Guest", guest: true });
  assert.deepEqual(playerLabel({ playerName: "Reader", anonymous: false }, "en"), { name: "Reader", guest: false });
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

test("the discover clue heading follows the question type", () => {
  assert.equal(quizClueHeading("characters_title", "en"), "Which book has these characters?");
  assert.equal(quizClueHeading("title_cover", "en"), "Which cover belongs to this title?");
  assert.equal(quizClueHeading("quote_title", "en"), "Which book is this from?");
});

test("result covers are the first three distinct covers in question order", () => {
  const cover = (id: string, prompt: string, options: string[]): PublicQuizQuestion => ({ id, type: "title_cover", prompt, options });
  const questions: PublicQuizQuestion[] = [
    cover("q0", "Dune", ["/c/a.jpg", "/c/b.jpg"]),
    { id: "q1", type: "cover_title", prompt: "/c/x.jpg", options: ["Emma", "Ulysses"] },
    cover("q2", "Dune again", ["/c/c.jpg", "/c/b.jpg"]),
    cover("q3", "Emma", ["/c/d.jpg", "/c/e.jpg"]),
    cover("q4", "Ulysses", ["/c/f.jpg", "/c/g.jpg"])
  ];
  const answers = Object.fromEntries(questions.map((q) => [q.id, { choiceIndex: 0, answerIndex: 1 }]));
  const rows = scoreRows(questions, {}, answers);
  assert.deepEqual(resultCovers(questions, rows), [
    { url: "/c/b.jpg", title: "Dune again" },
    { url: "/c/x.jpg", title: "Ulysses" },
    { url: "/c/e.jpg", title: "Emma" }
  ]);
});

test("a quiz without covers has no result covers", () => {
  const questions: PublicQuizQuestion[] = [{ id: "q0", type: "quote_title", prompt: "Call me Ishmael", options: ["Moby-Dick", "Emma"] }];
  assert.deepEqual(resultCovers(questions, scoreRows(questions, {}, { q0: { choiceIndex: 0, answerIndex: 0 } })), []);
});
