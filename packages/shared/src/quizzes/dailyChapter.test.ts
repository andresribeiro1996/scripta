import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyChapterCoverage, dailyChapterShare, dailyChapterStats, dailyChapterSubmission, readDailyChapterDraft, type DailyChapterBook, type DailyChapterQuestion, type DailyChapterResult } from "./dailyChapter.js";

const book: DailyChapterBook = { id: "book-1", title: "A Book", author: "A Writer", language: "en", themeIds: ["retold-myths"] };
const question: DailyChapterQuestion = { id: "q1", bookId: book.id, type: "quote_title", prompt: "A passage", options: ["A Book", "Two", "Three", "Four"], answerIndex: 0, explanation: "An explanation", sourceUrl: "https://example.org/book", sourceEdition: "First edition", rights: { basis: "public-domain", evidence: "Reviewed evidence" }, approvedAt: "2030-01-01", approvedBy: "editor" };
const result = (id: string, date: string, score = 5): DailyChapterResult => ({ editionId: id, date, title: "Old myths, new voices", themeId: "retold-myths", score, completedAt: date + "T12:00:00Z", answers: [{ questionId: "q1", prompt: "Secret passage", choiceIndex: 0, answerIndex: 0, options: ["A Book", "Two", "Three", "Four"], explanation: "Secret explanation", sourceUrl: "https://example.org/book", book }] });

test("quote coverage counts books once, excludes clues and drafts, and separates unused stock", () => {
  const second = { ...book, id: "book-2" };
  const coverage = dailyChapterCoverage([book, second], [question, { ...question, id: "q2" }, { ...question, id: "q3", bookId: second.id, type: "blurb_title" }, { ...question, id: "q4", bookId: second.id, approvedAt: null }], ["q1"]);
  assert.equal(coverage.targetBooks, 2);
  assert.equal(coverage.coveredBooks, 1);
  assert.equal(coverage.approvedQuotes, 2);
  assert.equal(coverage.availableQuotes, 1);
  assert.equal(coverage.readyQuestions, 2);
  assert.equal(coverage.themes.find((theme) => theme.themeId === "retold-myths")?.coveredBooks, 1);
});

test("theme attendance starts at the first daily participation and missed appearances break perfect streaks", () => {
  const releases = ["01", "03", "05", "07"].map((day) => ({ id: "e" + day, date: "2030-01-" + day, themeId: "retold-myths" }));
  const history = dailyChapterStats([result("e03", "2030-01-03"), result("e07", "2030-01-07")], releases, "2030-01-07");
  assert.equal(history.startedOn, "2030-01-03");
  assert.equal(history.streak, 1);
  assert.deepEqual(history.themes[0], { themeId: "retold-myths", eligible: 3, completed: 2, correct: 10, answered: 10, perfect: 2, perfectStreak: 1 });
});

test("an unplayed edition today does not break a streak before the day closes", () => {
  const releases = ["01", "02", "03"].map((day) => ({ id: "e" + day, date: "2030-01-" + day, themeId: "retold-myths" }));
  const history = dailyChapterStats([result("e01", "2030-01-01"), result("e02", "2030-01-02")], releases, "2030-01-03");
  assert.equal(history.streak, 2);
  assert.equal(history.themes[0]?.perfectStreak, 2);
  assert.equal(dailyChapterStats([], releases, "2030-01-03").themes.length, 0);
});

test("draft recovery validates stored choices and submissions require every question", () => {
  const questions = [{ id: "q1", type: "quote_title" as const, prompt: "Quote", options: question.options }];
  assert.deepEqual(readDailyChapterDraft('{"q1":0,"foreign":3}', questions), { q1: 0 });
  assert.deepEqual(readDailyChapterDraft('{"q1":4}', questions), {});
  assert.deepEqual(readDailyChapterDraft('{broken', questions), {});
  assert.deepEqual(readDailyChapterDraft('null', questions), {});
  assert.equal(dailyChapterSubmission(questions, {}), null);
  assert.deepEqual(dailyChapterSubmission(questions, { q1: 0 }), [{ questionId: "q1", choiceIndex: 0 }]);
});

test("shared results contain scores and marks without quotations, books, or answer keys", () => {
  const text = dailyChapterShare(result("e01", "2030-01-01"), "https://example.org/daily");
  assert.match(text, /5\/5/);
  for (const secret of ["Secret passage", "Secret explanation", "A Book", "answerIndex"]) assert.equal(text.includes(secret), false);
  assert.ok(text.endsWith("https://example.org/daily"));
});
