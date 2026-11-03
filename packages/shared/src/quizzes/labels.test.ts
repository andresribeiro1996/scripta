import assert from "node:assert/strict";
import { test } from "node:test";
import { answerExpands, isLoneViewer, leaderboardPosition, missesFirst, playDurationLabel, playerLabel, quizClueHeading, quizOptionLabel, quizQuestionLabel, resultCovers, scoreRowPrompt, scoreRows } from "./labels.js";
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

test("a nameless guest's name already says guest", () => {
  assert.deepEqual(playerLabel({ playerName: null, anonymous: true }, "en"), { name: "Guest", guest: false });
  assert.deepEqual(playerLabel({ playerName: "Rui", anonymous: true }, "en"), { name: "Rui", guest: true });
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

test("score rows carry the prompt for text clues only, and the work when known", () => {
  const questions: PublicQuizQuestion[] = [
    { id: "q0", type: "quote_title", prompt: "Call me Ishmael", options: ["Moby-Dick", "Emma"] },
    { id: "q1", type: "cover_title", prompt: "/c/x.jpg", options: ["Dune", "Emma"] },
    { id: "q2", type: "title_cover", prompt: "Dune", options: ["/c/a.jpg", "/c/b.jpg"] }
  ];
  const answers = {
    q0: { choiceIndex: 1, answerIndex: 0, workId: "w0" },
    q1: { choiceIndex: 0, answerIndex: 0, workId: null },
    q2: { choiceIndex: 0, answerIndex: 0, workId: "w2" }
  };
  const rows = scoreRows(questions, { q1: true, q2: true }, answers);
  assert.equal(rows[0]!.prompt, "Call me Ishmael");
  assert.equal(rows[0]!.workId, "w0");
  assert.equal("prompt" in rows[1]!, false);
  assert.equal("workId" in rows[1]!, false);
  assert.equal("prompt" in rows[2]!, false);
});

test("misses come first and keep their numbers and relative order", () => {
  const row = (number: number, correct: boolean) => ({ id: `q${number}`, number, correct });
  assert.deepEqual(missesFirst([row(1, true), row(2, false), row(3, true), row(4, false)]).map((r) => r.number), [2, 4, 1, 3]);
});

test("a row expands only when something sits behind it", () => {
  const text = { kind: "text" as const, value: "Dune" };
  const cover = { kind: "cover" as const, value: "/c/a.jpg" };
  assert.equal(answerExpands({ id: "a", number: 1, correct: true, answer: text }), false);
  assert.equal(answerExpands({ id: "b", number: 1, correct: false, answer: text, pick: text }), false);
  assert.equal(answerExpands({ id: "c", number: 1, correct: true, answer: text, workId: "w" }), true);
  assert.equal(answerExpands({ id: "d", number: 1, correct: false, answer: cover, pick: cover }), true);
  assert.equal(answerExpands({ id: "e", number: 1, correct: false }), true);
});

test("position needs the viewer on a board with someone else", () => {
  assert.equal(leaderboardPosition([{ isYou: false }, { isYou: false }]), null);
  assert.equal(leaderboardPosition([{ isYou: true }]), null);
  assert.deepEqual(leaderboardPosition([{ isYou: false }, { isYou: true }, { isYou: false }]), { rank: 2, total: 3 });
});

test("durations keep the decimal under a minute and read as a clock from there", () => {
  assert.equal(playDurationLabel(16800, "en"), "16.8s");
  assert.equal(playDurationLabel(16800, "pt-PT"), "16,8 s");
  assert.equal(playDurationLabel(59_949, "en"), "59.9s");
  assert.equal(playDurationLabel(59_960, "en"), "1:00");
  assert.equal(playDurationLabel(143_200, "en"), "2:23");
  assert.equal(playDurationLabel(119_600, "en"), "2:00");
});

test("a prompt is curly-quoted for quotes and blurbs only", () => {
  const row = { id: "a", number: 1, correct: true, prompt: "A line" };
  assert.equal(scoreRowPrompt(row, "quote_title"), "“A line”");
  assert.equal(scoreRowPrompt(row, "blurb_title"), "“A line”");
  assert.equal(scoreRowPrompt(row, "characters_title"), "A line");
  assert.equal(scoreRowPrompt({ id: "b", number: 2, correct: true }, "quote_title"), null);
});

test("a lone viewer is exactly one play, and it is theirs", () => {
  assert.equal(isLoneViewer([{ isYou: true }]), true);
  assert.equal(isLoneViewer([{ isYou: false }]), false);
  assert.equal(isLoneViewer([{ isYou: true }, { isYou: false }]), false);
  assert.equal(isLoneViewer([]), false);
});
