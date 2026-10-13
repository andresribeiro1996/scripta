import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardCards } from "@scripta/shared";
import { homeSections, shouldMarkFeedSeen } from "./homeModel.js";

const book = (key: string, ReadStatus: number, highlights: unknown[] = []) => ({ _key: key, Title: key, Attribution: "Author", ReadStatus, highlights });
const sectionsFor = (books: Array<Record<string, unknown>>) => homeSections(buildDashboardCards(books, "2026-10-12", "u1:0"));

test("an empty library shows no section", () => {
  assert.deepEqual(sectionsFor([]), { readingKeys: [], nextKeys: null, highlight: null });
});

test("every reading book becomes a card, in shelf order", () => {
  assert.deepEqual(sectionsFor([book("a", 1)]).readingKeys, ["a"]);
  assert.deepEqual(sectionsFor([book("a", 1), book("b", 0), book("c", 1), book("d", 2), book("e", 1)]).readingKeys, ["a", "c", "e"]);
});

test("What's next shows only when nothing is reading and two or more books are to read", () => {
  assert.deepEqual(sectionsFor([book("a", 0), book("b", 0), book("c", 2)]).nextKeys, ["a", "b"]);
  assert.equal(sectionsFor([book("a", 0)]).nextKeys, null);
  assert.equal(sectionsFor([book("a", 1), book("b", 0), book("c", 0)]).nextKeys, null);
  assert.equal(sectionsFor([book("a", 2), book("b", 2)]).nextKeys, null);
});

test("a highlight shows when a book has one", () => {
  const highlighted = book("a", 2, [{ Type: "highlight", Text: "Call me Ishmael.", BookmarkID: "h1" }]);
  assert.equal(sectionsFor([highlighted]).highlight?.highlightId, "h1");
  assert.equal(sectionsFor([book("b", 2)]).highlight, null);
});

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
