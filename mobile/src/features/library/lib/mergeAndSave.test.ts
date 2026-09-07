/// <reference types="node" />

// Characterization test for buildMergedLibrary's pipeline order (merge,
// then assign _order to new books, then additive series auto-seed) — see
// this file's own top comment for why each step exists.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMergedLibrary } from "./mergeAndSave.js";

test("first import (no existing library) is saved as-is, with _order assigned", () => {
  const result = buildMergedLibrary(undefined, { books: [{ Title: "Dune", Attribution: "Frank Herbert" }] });
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0]._order, 0);
});

test("merging a re-import updates a matched book in place and appends a new one", () => {
  const existing = { books: [{ Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 0, _order: 0 }] };
  const incoming = { books: [{ Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 2 }, { Title: "New Book", Attribution: "Someone" }] };
  const result = buildMergedLibrary(existing, incoming);
  assert.equal(result.books.length, 2);
  const dune = result.books.find((b) => b.Title === "Dune")!;
  assert.equal(dune.ReadStatus, 2); // newest wins
  assert.equal(dune._order, 0); // app-managed field survives the merge
  const newBook = result.books.find((b) => b.Title === "New Book")!;
  assert.equal(newBook._order, 1); // appended after the existing max
});

test("auto-seeds a series group from the merged books' Series field", () => {
  const result = buildMergedLibrary(undefined, {
    books: [{ Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga" }],
  });
  assert.equal(result.groups?.length, 1);
  assert.equal(result.groups?.[0].type, "series");
  assert.equal(result.groups?.[0].name, "Dune Saga");
});
