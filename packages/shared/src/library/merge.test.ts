import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey, mergeBookLists } from "./merge.js";

test("a Goodreads row with an ISBN merges into the ISBN-less Kobo copy and keeps the Kobo key", () => {
  const kobo = { ContentID: "k1", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1, highlights: [{ BookmarkID: "h1" }] };
  const goodreads = { ContentID: "goodreads:9", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 };
  const merged = mergeBookLists([kobo], [goodreads]);
  assert.equal(merged.length, 1);
  assert.equal(bookKey(merged[0]!), bookKey(kobo));
  assert.equal("ISBN" in merged[0]!, false);
  assert.equal(merged[0]!.ReadStatus, 2);
  assert.deepEqual(merged[0]!.highlights, [{ BookmarkID: "h1" }]);
});

test("ISBN-10 and ISBN-13 of the same book pair", () => {
  const merged = mergeBookLists([{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "0441013597" }], [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.ISBN, "0441013597");
});

test("likely matches and different ISBNs are appended, not merged", () => {
  const existing = [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" }];
  const merged = mergeBookLists(existing, [
    { Title: "Dune (Dune Chronicles #1)", Attribution: "Frank Herbert" },
    { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780593099322" }
  ]);
  assert.equal(merged.length, 3);
});

test("certain duplicates inside one import collapse into the first", () => {
  const merged = mergeBookLists([], [
    { ContentID: "a", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 0 },
    { ContentID: "b", Title: "DUNE", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.Title, "Dune");
  assert.equal(merged[0]!.ReadStatus, 2);
});

test("each existing book pairs at most once", () => {
  const merged = mergeBookLists([{ Title: "Dune", Attribution: "Frank Herbert" }], [
    { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" },
    { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780593099322" }
  ]);
  assert.equal(merged.length, 2);
});
