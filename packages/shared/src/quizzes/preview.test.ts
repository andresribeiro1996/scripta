import assert from "node:assert/strict";
import { test } from "node:test";
import { quizPreview } from "./preview.js";
import { QUIZ_QUESTION_TYPES, type QuizBook, type QuizQuestion, type QuizQuestionType } from "./types.js";

const book: QuizBook = { workId: "work", title: "Dune", author: "Frank Herbert", coverUrl: "https://covers.test/dune.jpg", quote: "A beginning is the time for taking the most delicate care.", blurb: "A desert planet.", characters: ["Paul", "Jessica", "Duncan", "Gurney"] };
const question = (type: QuizQuestionType, workId: string | null = "work"): QuizQuestion => ({ id: "q0", type, workId, options: ["Dune", "Other"], answerIndex: 0 });

test("quiz previews match the actual question without options or an answer key", () => {
  const prompts = [book.coverUrl, book.title, book.quote, book.blurb, "Paul · Jessica · Duncan"];
  QUIZ_QUESTION_TYPES.forEach((type, index) => {
    assert.deepEqual(quizPreview({ books: [book], questions: [question(type)] }), { type, prompt: prompts[index] });
  });
});

test("previews skip missing question sources and never substitute an unrelated pool cover", () => {
  assert.equal(quizPreview({ books: [book], questions: null }), undefined);
  assert.equal(quizPreview({ books: [book], questions: [question("cover_title", null)] }), undefined);
  assert.equal(quizPreview({ books: [{ ...book, quote: null }], questions: [question("quote_title")] }), undefined);
  assert.deepEqual(quizPreview({ books: [book], questions: [question("cover_title", "gone"), question("quote_title")] }), { type: "quote_title", prompt: book.quote });
});

test("preview text is bounded without truncating cover URLs", () => {
  assert.equal(quizPreview({ books: [{ ...book, quote: "x".repeat(500) }], questions: [question("quote_title")] })?.prompt.length, 180);
  const coverUrl = `https://covers.test/${"x".repeat(250)}.jpg`;
  assert.equal(quizPreview({ books: [{ ...book, coverUrl }], questions: [question("cover_title")] })?.prompt, coverUrl);
});

test("characters preview is the first three names", () => {
  const characters = ["A", "B", "C", "D"];
  assert.equal(quizPreview({ books: [{ ...book, characters }], questions: [question("characters_title")] })?.prompt, "A · B · C");
});
