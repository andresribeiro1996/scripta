import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMergedLibrary } from "./addPipeline.js";
import { bookKey } from "./merge.js";
import type { LibraryData } from "./types.js";

test("a re-import updates a matched book in place and appends a new one after the highest _order", () => {
  const existing: LibraryData = { books: [{ Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 0, _order: 4 }] };
  const incoming: LibraryData = {
    books: [
      { Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 2 },
      { Title: "New Book", Attribution: "Someone" }
    ]
  };
  const result = buildMergedLibrary(existing, incoming);
  assert.equal(result.books.length, 2);
  assert.equal(result.book_count, 2);
  assert.equal(result.books[0]!.ReadStatus, 2);
  assert.equal(result.books[0]!._order, 4);
  assert.equal(result.books[1]!.Title, "New Book");
  assert.equal(result.books[1]!._order, 5);
});

test("series are seeded from the merged books and the saved library's own fields survive", () => {
  const dune = { Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga", _order: 0 };
  const messiah = { Title: "Dune Messiah", Attribution: "Frank Herbert", Series: "  dune   saga " };
  const existing: LibraryData = {
    name: "My shelf",
    books: [dune],
    groups: [{ id: "g", type: "series", name: "Dune Saga", bookKeys: [bookKey(dune)], createdAt: "t", updatedAt: "t" }]
  };
  const incoming: LibraryData = { books: [messiah, { Title: "Neuromancer", Attribution: "William Gibson", Series: "Sprawl" }] };
  const result = buildMergedLibrary(existing, incoming);
  assert.equal(result.name, "My shelf");
  assert.equal(result.groups!.length, 2);
  assert.equal(result.groups![0]!.id, "g");
  assert.deepEqual(result.groups![0]!.bookKeys, [bookKey(dune), bookKey(messiah)]);
  assert.equal(result.groups![1]!.name, "Sprawl");
  assert.deepEqual(result.groups![1]!.bookKeys, [bookKey({ Title: "Neuromancer", Attribution: "William Gibson" })]);
});
