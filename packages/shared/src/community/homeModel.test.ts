import assert from "node:assert/strict";
import { test } from "node:test";
import { readingNow, shouldMarkFeedSeen } from "./homeModel.js";

test("the feed counts as seen only when focused, a row is on screen, the data is loaded and idle, and it wasn't sent yet", () => {
  const ready = { focused: true, rowVisible: true, loaded: true, failed: false, fetching: false, sent: false };
  assert.equal(shouldMarkFeedSeen(ready), true);
  assert.equal(shouldMarkFeedSeen({ ...ready, focused: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, rowVisible: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, loaded: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, failed: true }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, fetching: true }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, sent: true }), false);
});

test("readingNow orders reading books by last read, newest first", () => {
  const books = [
    { Title: "Old", ReadStatus: 1, DateLastRead: "2026-01-02" },
    { Title: "Done", ReadStatus: 2, DateLastRead: "2026-11-10" },
    { Title: "New", ReadStatus: 1, DateLastRead: "2026-11-01T09:00:00Z" }
  ];
  assert.deepEqual(readingNow(books).map((book) => book.Title), ["New", "Old"]);
});
test("readingNow sorts undated or unparseable dates last and keeps library order on ties", () => {
  assert.deepEqual(readingNow([{ Title: "A", ReadStatus: 1 }, { Title: "B", ReadStatus: 1, DateLastRead: "garbage" }]).map((book) => book.Title), ["A", "B"]);
  assert.deepEqual(readingNow([{ Title: "A", ReadStatus: 1 }, { Title: "B", ReadStatus: 1, DateLastRead: "2020-01-01" }]).map((book) => book.Title), ["B", "A"]);
});
test("readingNow returns every reading book", () => {
  const books = Array.from({ length: 7 }, (_, i) => ({ Title: `B${i}`, ReadStatus: 1, DateLastRead: `2026-11-0${i + 1}` }));
  assert.equal(readingNow(books).length, 7);
  assert.deepEqual(readingNow(undefined), []);
});
