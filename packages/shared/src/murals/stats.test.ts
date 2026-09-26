import assert from "node:assert/strict";
import { test } from "node:test";

process.env.TZ = "America/Sao_Paulo";
const { computeStat } = await import("./stats.js");

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
