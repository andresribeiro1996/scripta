import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMergedLibrary } from "@scripta/shared";
import type { LibraryData } from "../src/api/library";
import { deriveSeriesGroups } from "../src/lib/groups";
import { assignBookOrder } from "../src/lib/libraryOrder";
import { mergeLibraryData } from "../src/lib/merge";

function stable(data: LibraryData): LibraryData {
  return { ...data, groups: data.groups?.map((group) => ({ ...group, id: "id", createdAt: "t", updatedAt: "t" })) };
}

function stepByStep(existing: LibraryData, parsed: LibraryData): LibraryData {
  const merged = mergeLibraryData(existing, parsed);
  const ordered = { ...merged, books: assignBookOrder(merged.books) };
  return { ...ordered, groups: deriveSeriesGroups(ordered.books, ordered.groups ?? []) };
}

test("adding a book to an empty library gives the same library as merging, ordering and seeding series step by step", () => {
  const parsed: LibraryData = { books: [{ Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga" }] };
  const result = buildMergedLibrary({ books: [] }, parsed);
  assert.deepEqual(stable(result), stable(stepByStep({ books: [] }, parsed)));
  assert.equal(result.groups?.length, 1);
});

test("a re-import gives the same library as merging, ordering and seeding series step by step", () => {
  const existing: LibraryData = {
    name: "Mine",
    books: [{ Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga", ReadStatus: 0, _order: 0 }],
    groups: [{ id: "g", type: "series", name: "dune saga", bookKeys: ["ta:dune|frank herbert"], createdAt: "t", updatedAt: "t" }]
  };
  const parsed: LibraryData = {
    books: [
      { Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga", ReadStatus: 2 },
      { Title: "Dune Messiah", Attribution: "Frank Herbert", Series: " Dune  Saga " },
      { Title: "Neuromancer", Attribution: "William Gibson", Series: "Sprawl" }
    ]
  };
  const result = buildMergedLibrary(existing, parsed);
  assert.deepEqual(stable(result), stable(stepByStep(existing, parsed)));
  assert.equal(result.groups?.length, 2);
});
