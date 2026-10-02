/// <reference types="node" />

// Characterization test for buildMergedLibrary's pipeline order (merge,
// then assign _order to new books, then additive series auto-seed).

import assert from "node:assert/strict";
import { test } from "node:test";
import { assignBookOrder, deriveSeriesGroups, mergeLibraryData, type LibraryData } from "@scripta/shared";
import { buildMergedLibrary } from "./mergeAndSave.js";

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
  const result = buildMergedLibrary({ books: [] }, {
    books: [{ Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga" }],
  });
  assert.equal(result.groups?.length, 1);
  assert.equal(result.groups?.[0].type, "series");
  assert.equal(result.groups?.[0].name, "Dune Saga");
});

function stable(data: LibraryData): LibraryData {
  return { ...data, groups: data.groups?.map((group) => ({ ...group, id: "id", createdAt: "t", updatedAt: "t" })) };
}

test("gives the same library as merging, ordering and seeding series step by step", () => {
  const existing: LibraryData = {
    name: "Mine",
    books: [{ Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga", ReadStatus: 0, _order: 0 }],
    groups: [{ id: "g", type: "series", name: "dune saga", bookKeys: ["ta:dune|frank herbert"], createdAt: "t", updatedAt: "t" }],
  };
  const incoming: LibraryData = {
    books: [
      { Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga", ReadStatus: 2 },
      { Title: "Dune Messiah", Attribution: "Frank Herbert", Series: " Dune  Saga " },
      { Title: "Neuromancer", Attribution: "William Gibson", Series: "Sprawl" },
    ],
  };
  const merged = mergeLibraryData(existing, incoming);
  const ordered = { ...merged, books: assignBookOrder(merged.books) };
  const before = { ...ordered, groups: deriveSeriesGroups(ordered.books, ordered.groups ?? []) };
  const result = buildMergedLibrary(existing, incoming);
  assert.deepEqual(stable(result), stable(before));
  assert.equal(result.groups?.length, 2);
});
