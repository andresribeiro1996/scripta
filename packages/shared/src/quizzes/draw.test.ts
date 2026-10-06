import assert from "node:assert/strict";
import { test } from "node:test";
import { eligibleTypes, generateQuizQuestions, hashSeed, mulberry32 } from "./draw.js";
import type { QuizBook, QuizConfig } from "./types.js";

const book = (key: string, extra: Partial<QuizBook> = {}): QuizBook => ({
  key,
  title: `Title ${key}`,
  author: "A",
  coverUrl: `https://covers.test/${key}.jpg`,
  quote: null,
  blurb: null,
  ...extra
});

const config: QuizConfig = {
  questionCount: 5,
  allowedTypes: ["cover_title", "title_cover", "quote_title", "blurb_title"]
};
const books = Array.from({ length: 10 }, (_, i) => book(`b${i}`));

test("same seed produces the identical set, ids included", () => {
  assert.deepEqual(generateQuizQuestions(books, config, "code123"), generateQuizQuestions(books, config, "code123"));
});

test("a different seed produces a different set", () => {
  assert.notDeepEqual(generateQuizQuestions(books, config, "aaa"), generateQuizQuestions(books, config, "bbb"));
});

test("every question has 4 distinct options whose answer slot holds the answer value", () => {
  for (const q of generateQuizQuestions(books, config, "seed")) {
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    const answerValue = q.type === "title_cover" ? `https://covers.test/${q.book.key}.jpg` : `Title ${q.book.key}`;
    assert.equal(q.options[q.answerIndex], answerValue);
  }
});

test("title_cover options are all cover URLs", () => {
  const questions = generateQuizQuestions(books, config, "seed");
  assert.ok(questions.some((q) => q.type === "title_cover"));
  for (const q of questions) {
    if (q.type !== "title_cover") continue;
    for (const option of q.options) assert.ok(option.startsWith("https://covers.test/"));
  }
});

test("allowedTypes narrow the draw", () => {
  const onlyQuote = generateQuizQuestions(books, { questionCount: 10, allowedTypes: ["quote_title"] }, "s");
  assert.equal(onlyQuote.length, 0);
});

test("stops short when too few books can supply a question", () => {
  assert.equal(generateQuizQuestions(books.slice(0, 3), config, "s").length, 0);
});

test("eligibility follows the data each type needs", () => {
  assert.deepEqual(eligibleTypes(book("x", { coverUrl: null })), []);
  assert.deepEqual(eligibleTypes(book("x")), ["cover_title", "title_cover"]);
  assert.deepEqual(eligibleTypes(book("x", { quote: "q", blurb: "b" })), ["cover_title", "title_cover", "quote_title", "blurb_title"]);
});

test("mulberry32 is deterministic and hashSeed is stable", () => {
  const a = mulberry32(hashSeed("abc"));
  const b = mulberry32(hashSeed("abc"));
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("options stay distinct when several books share a title", () => {
  const dupes = [book("a"), book("b"), book("b2", { title: "Title b" }), book("b3", { title: "Title b" }), book("c"), book("d")];
  const questions = generateQuizQuestions(dupes, { questionCount: 6, allowedTypes: ["cover_title", "title_cover"] }, "s");
  for (const q of questions) {
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4, `options should be distinct: ${q.options.join(", ")}`);
  }
});

test("a pool whose titles cannot fill 4 distinct options draws nothing rather than duplicating", () => {
  const dupes = [book("a"), book("b"), book("b2", { title: "Title b" }), book("b3", { title: "Title b" })];
  assert.equal(generateQuizQuestions(dupes, { questionCount: 4, allowedTypes: ["cover_title"] }, "s").length, 0);
});

test("a distractor is any other book object, so two books sharing a title still draw", () => {
  const books = [book("a"), book("b"), book("c"), book("d"), book("e")];
  const questions = generateQuizQuestions(books, { questionCount: 5, allowedTypes: ["title_cover"] }, "seed");
  for (const question of questions) assert.ok(books.includes(question.book));
});
