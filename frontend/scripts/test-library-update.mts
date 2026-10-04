import assert from "node:assert/strict";
import { test } from "node:test";
import type { LibraryData } from "../src/api/library";
import { restoreDeletedBooks } from "../src/lib/restoreDeletedBooks";

test("undo restores deleted books without replacing concurrent changes", () => {
  const snapshot: LibraryData = {
    books: [{ Title: "Deleted" }, { Title: "Kept" }],
    groups: [{ id: "group", type: "collection", name: "Before", bookKeys: ["ta:deleted|", "ta:kept|"], createdAt: "t", updatedAt: "t" }],
  };
  const current: LibraryData = {
    books: [{ Title: "Kept" }, { Title: "Remote" }],
    groups: [{ ...snapshot.groups![0]!, name: "Remote rename", bookKeys: ["ta:kept|"] }],
  };
  const restored = restoreDeletedBooks(current, snapshot, new Set(["ta:deleted|"]));

  assert.deepEqual(restored.books.map((book) => book.Title), ["Deleted", "Kept", "Remote"]);
  assert.equal(restored.groups?.[0]?.name, "Remote rename");
  assert.deepEqual(restored.groups?.[0]?.bookKeys, ["ta:deleted|", "ta:kept|"]);
  assert.notEqual(restored.groups?.[0]?.updatedAt, "t");
});

test("undo preserves duplicate book keys", () => {
  const duplicate = { Title: "Duplicate", Attribution: "Author" };
  const snapshot: LibraryData = { books: [duplicate, { ...duplicate }, { Title: "Deleted" }, { Title: "Kept" }] };
  const current: LibraryData = { books: [duplicate, { ...duplicate }, { Title: "Kept" }] };
  const restored = restoreDeletedBooks(current, snapshot, new Set(["ta:deleted|"]));

  assert.deepEqual(restored.books.map((book) => book.Title), ["Duplicate", "Duplicate", "Deleted", "Kept"]);
});
