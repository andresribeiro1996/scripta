import assert from "node:assert/strict";
import { test } from "node:test";
import { statusLabel } from "./covers.js";
import { STATUS_FILTER_OPTIONS, localDay, setReadStatus } from "./libraryView.js";

test("finishing a book records the day and full progress", () => {
  const book = { Title: "A", ReadStatus: 1, ___PercentRead: 40, DateLastRead: "2024-01-01" };
  assert.deepEqual(setReadStatus(book, 2, "2026-09-25"), { Title: "A", ReadStatus: 2, ___PercentRead: 100, DateLastRead: "2026-09-25" });
});

test("choosing the status a book already has returns the same object", () => {
  const finished = { ReadStatus: 2, DateLastRead: "2025-03-01" };
  assert.equal(setReadStatus(finished, 2, "2026-09-25"), finished);
  const unset = { Title: "B" };
  assert.equal(setReadStatus(unset, 0, "2026-09-25"), unset);
});

test("leaving Finished keeps the recorded day and progress", () => {
  assert.deepEqual(
    setReadStatus({ ReadStatus: 2, DateLastRead: "2025-03-01", ___PercentRead: 100 }, 1, "2026-09-25"),
    { ReadStatus: 1, DateLastRead: "2025-03-01", ___PercentRead: 100 }
  );
});

test("localDay formats the local calendar date", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("status 0 reads as To read", () => {
  assert.equal(statusLabel(0), "To read");
  assert.equal(statusLabel(undefined), "To read");
  assert.equal(STATUS_FILTER_OPTIONS.find((option) => option.value === "unread")?.label, "To read");
});
