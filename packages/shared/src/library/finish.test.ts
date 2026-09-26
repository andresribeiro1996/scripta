import assert from "node:assert/strict";
import { test } from "node:test";

process.env.TZ = "America/Sao_Paulo";
const { FINISH_FEELINGS, addReaderNote, formatFinishDay, readSnapshot, restoreReadState, setRating } = await import("./finish.js");

test("the five feelings map to ratings 1 through 5", () => {
  assert.deepEqual(FINISH_FEELINGS.map(({ rating, label }) => [rating, label]), [
    [1, "Not for me"], [2, "Fine"], [3, "Good"], [4, "Loved it"], [5, "All-time"]
  ]);
});

test("setRating sets Rating and returns the same object when unchanged", () => {
  const book = { Title: "A", Rating: 3 };
  assert.deepEqual(setRating(book, 5), { Title: "A", Rating: 5 });
  assert.equal(setRating(book, 3), book);
});

test("addReaderNote appends a review-shaped highlight", () => {
  const book = { Title: "A", ContentID: "c1", highlights: [{ BookmarkID: "h1", Type: "highlight", Text: "x" }] };
  const next = addReaderNote(book, "Stayed with me.", "2026-09-26", "n1");
  assert.equal((next.highlights as unknown[]).length, 2);
  assert.deepEqual((next.highlights as unknown[])[1], {
    BookmarkID: "note:n1", VolumeID: "c1", Text: "Stayed with me.", Annotation: "", Type: "review",
    DateCreated: "2026-09-26", DateModified: null, ChapterProgress: null
  });
  assert.deepEqual((addReaderNote({ Title: "B" }, "Hm.", "2026-09-26", "n2").highlights as Array<Record<string, unknown>>)[0]!.VolumeID, null);
});

test("restoreReadState puts back exactly the snapshot, removing fields that were absent", () => {
  const before = readSnapshot({ Title: "A", ReadStatus: 1, ___PercentRead: 40 });
  const finished = { Title: "A", ReadStatus: 2, DateLastRead: "2026-09-26", ___PercentRead: 100 };
  assert.deepEqual(restoreReadState(finished, before), { Title: "A", ReadStatus: 1, ___PercentRead: 40 });
});

test("formatFinishDay reads a date-only day in local time", () => {
  assert.equal(formatFinishDay("2027-01-01", "en-US"), "January 1, 2027");
});
