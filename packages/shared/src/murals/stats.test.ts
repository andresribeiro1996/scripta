import assert from "node:assert/strict";
import { test } from "node:test";

process.env.TZ = "America/Sao_Paulo";
const { computeStat, libraryBreakdown } = await import("./stats.js");

const finishedThisYear = (dateLastRead: string, year: number) =>
  computeStat("booksFinishedThisYear", [{ ReadStatus: 2, DateLastRead: dateLastRead }], new Date(year, 0, 1));

test("a date-only finish on New Year's Day counts toward that year, not UTC's prior one", () => {
  assert.equal(finishedThisYear("2027-01-01", 2027), 1);
});

test("a date-only finish on New Year's Eve still counts toward its own year", () => {
  assert.equal(finishedThisYear("2026-12-31", 2026), 1);
});

test("a full ISO timestamp still resolves by its instant, as before", () => {
  assert.equal(finishedThisYear("2027-01-01T02:00:00.000Z", 2026), 1);
});

test("an invalid DateLastRead never counts", () => {
  assert.equal(finishedThisYear("not-a-date", 2027), 0);
});

const counts: Record<string, number> = { totalBooks: 10, booksFinished: 4, booksInProgress: 2, totalHighlights: 7, booksFinishedThisYear: 3 };
const count = (metric: string) => counts[metric] ?? 0;

test("libraryBreakdown splits the library and keeps the other metrics in order", () => {
  assert.deepEqual(
    libraryBreakdown(["totalHighlights", "totalBooks", "booksFinished", "booksFinishedThisYear", "booksInProgress"], count),
    { finished: 4, reading: 2, toRead: 4, total: 10, others: ["totalHighlights", "booksFinishedThisYear"] }
  );
});

test("libraryBreakdown is null unless all of total, finished and in-progress are present", () => {
  assert.equal(libraryBreakdown(["totalBooks", "booksFinished"], count), null);
  assert.equal(libraryBreakdown(["booksFinished", "booksInProgress"], count), null);
  assert.equal(libraryBreakdown(["totalBooks", "booksInProgress", "totalHighlights"], count), null);
});

test("libraryBreakdown never reports a negative To read count", () => {
  const skewed = (metric: string) => ({ totalBooks: 3, booksFinished: 2, booksInProgress: 2 })[metric] ?? 0;
  assert.equal(libraryBreakdown(["totalBooks", "booksFinished", "booksInProgress"], skewed)?.toRead, 0);
});
