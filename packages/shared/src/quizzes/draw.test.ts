import assert from "node:assert/strict";
import { test } from "node:test";
import { eligibleTypes, generateQuizQuestions, hashSeed, mulberry32 } from "./draw.js";
import type { QuizBook, QuizConfig } from "./types.js";

const book = (key: string, extra: Partial<QuizBook> = {}): QuizBook => ({
  workId: key,
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
    const answerValue = q.type === "title_cover" ? `https://covers.test/${q.book.workId}.jpg` : `Title ${q.book.workId}`;
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

const potter = ["Harry Potter", "Ron Weasley", "Hermione Granger"];
const characterBooks = [
  book("p1", { characters: potter }),
  book("p2", { characters: [" harry potter ", "X", "Y"] }),
  ...["a", "b", "c", "d"].map((k) => book(k, { characters: [`${k}1`, `${k}2`, `${k}3`] }))
];

test("a book with three characters is eligible for characters_title", () => {
  assert.ok(eligibleTypes(book("x", { characters: ["a", "b", "c"] })).includes("characters_title"));
});

test("two names are not enough", () => {
  assert.ok(!eligibleTypes(book("x", { characters: ["a", "b"] })).includes("characters_title"));
});

test("characters_title never offers a book that shares a prompt name", () => {
  let potterQuestions = 0;
  for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]) {
    const questions = generateQuizQuestions(characterBooks, { questionCount: 2, allowedTypes: ["characters_title"] }, seed);
    for (const q of questions) {
      const other = q.book.workId === "p1" ? "Title p2" : q.book.workId === "p2" ? "Title p1" : null;
      if (!other) continue;
      potterQuestions++;
      assert.ok(!q.options.includes(other));
    }
  }
  assert.ok(potterQuestions > 0);
});

test("characters_title is skipped when fewer than three clean distractors remain", () => {
  const shared = ["a", "b", "c", "d"].map((k) => book(k, { characters: ["Same", `${k}2`, `${k}3`] }));
  assert.equal(generateQuizQuestions(shared, { questionCount: 4, allowedTypes: ["characters_title"] }, "s").length, 0);
});

test("a book whose characters_title draw falls short keeps its other types", () => {
  const cast = ["Frodo Baggins", "Samwise Gamgee", "Gandalf"];
  const lotr = ["fellowship", "towers", "king"].map((k) => book(k, { characters: cast }));
  const hobbit = book("hobbit", { characters: ["Bilbo Baggins", "Gandalf", "Thorin"] });
  const all: QuizConfig = {
    questionCount: 4,
    allowedTypes: ["cover_title", "title_cover", "quote_title", "blurb_title", "characters_title"]
  };
  for (let i = 0; i < 200; i++) {
    assert.equal(generateQuizQuestions([...lotr, hobbit], all, `seed${i}`).length, 4);
  }
});
