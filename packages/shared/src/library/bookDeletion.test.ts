import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteBooks, restoreDeletedBooks } from "./bookDeletion.js";
import type { Group } from "./groups.js";
import type { LibraryData } from "./types.js";

const STAMP = "2020-01-01T00:00:00.000Z";

function book(key: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { _key: key, Title: key, ...extra };
}

function group(id: string, bookKeys: string[]): Group {
  return { id, type: "collection", name: id, bookKeys, createdAt: STAMP, updatedAt: STAMP };
}

function frozenLibrary(data: LibraryData): LibraryData {
  for (const b of data.books) Object.freeze(b);
  Object.freeze(data.books);
  for (const g of data.groups ?? []) {
    Object.freeze(g.bookKeys);
    Object.freeze(g);
  }
  if (data.groups) Object.freeze(data.groups);
  return Object.freeze(data);
}

function keysOf(data: LibraryData): string[] {
  return data.books.map((b) => b._key as string);
}

test("deleteBooks drops the books with the given keys, scrubs them from every group and sets book_count", () => {
  const data = frozenLibrary({
    books: [book("a"), book("b"), book("c")],
    book_count: 99,
    groups: [group("g1", ["a", "b"]), group("g2", ["c"])]
  });
  const result = deleteBooks(data, new Set(["b"]));
  assert.deepEqual(keysOf(result), ["a", "c"]);
  assert.equal(result.book_count, 2);
  assert.deepEqual(result.groups!.map((g) => g.bookKeys), [["a"], ["c"]]);
  assert.equal(result.groups![1], data.groups![1]);
  assert.notEqual(result.groups![0]!.updatedAt, STAMP);
});

test("deleteBooks with no keys returns the same library", () => {
  const data = frozenLibrary({ books: [book("a")] });
  assert.equal(deleteBooks(data, new Set()), data);
});

test("deleteBooks removes every copy of a duplicated book", () => {
  const data = frozenLibrary({ books: [book("a"), book("b"), book("a", { Title: "again" })] });
  assert.deepEqual(keysOf(deleteBooks(data, new Set(["a"]))), ["b"]);
});

test("restoreDeletedBooks puts deleted books back at their old positions", () => {
  const snapshot = frozenLibrary({ books: [book("a"), book("b"), book("c"), book("d")] });
  const current = deleteBooks(snapshot, new Set(["b", "d"]));
  const result = restoreDeletedBooks(current, snapshot, new Set(["b", "d"]));
  assert.deepEqual(keysOf(result), ["a", "b", "c", "d"]);
  assert.equal(result.book_count, 4);
});

test("restoreDeletedBooks restores both copies of a duplicated book in place", () => {
  const snapshot = frozenLibrary({ books: [book("a"), book("x"), book("b"), book("x", { Title: "second" })] });
  const current = deleteBooks(snapshot, new Set(["x"]));
  const result = restoreDeletedBooks(current, snapshot, new Set(["x"]));
  assert.deepEqual(result.books, snapshot.books);
});

test("restoreDeletedBooks keeps a book added after the delete and places restored books around it", () => {
  const snapshot = frozenLibrary({ books: [book("a"), book("b"), book("c")] });
  const deleted = deleteBooks(snapshot, new Set(["b"]));
  const current = frozenLibrary({ ...deleted, books: [...deleted.books, book("new")] });
  const result = restoreDeletedBooks(current, snapshot, new Set(["b"]));
  assert.deepEqual(keysOf(result), ["a", "b", "c", "new"]);
});

test("restoreDeletedBooks puts books back into their groups in order and bumps only the groups it changed", () => {
  const snapshot = frozenLibrary({
    books: [book("a"), book("b"), book("c")],
    groups: [group("g1", ["a", "b", "c"]), group("g2", ["a"])]
  });
  const current = deleteBooks(snapshot, new Set(["b"]));
  const result = restoreDeletedBooks(current, snapshot, new Set(["b"]));
  assert.deepEqual(result.groups![0]!.bookKeys, ["a", "b", "c"]);
  assert.notEqual(result.groups![0], current.groups![0]);
  assert.equal(result.groups![1], current.groups![1]);
});

test("restoreDeletedBooks does not recreate a group deleted after the delete", () => {
  const snapshot = frozenLibrary({ books: [book("a"), book("b")], groups: [group("g1", ["a", "b"])] });
  const deleted = deleteBooks(snapshot, new Set(["b"]));
  const current = frozenLibrary({ ...deleted, groups: [] });
  const result = restoreDeletedBooks(current, snapshot, new Set(["b"]));
  assert.deepEqual(result.groups, []);
});

test("deleteBooks then restoreDeletedBooks gives back the original books and group keys", () => {
  const snapshot = frozenLibrary({
    books: [book("a"), book("b"), book("c"), book("d")],
    groups: [group("g1", ["d", "a", "c"]), group("g2", ["b", "c"])]
  });
  const keys = new Set(["a", "c"]);
  const result = restoreDeletedBooks(deleteBooks(snapshot, keys), snapshot, keys);
  assert.deepEqual(result.books, snapshot.books);
  assert.deepEqual(result.groups!.map((g) => g.bookKeys), snapshot.groups!.map((g) => g.bookKeys));
});

test("neither function mutates its inputs", () => {
  const snapshot = frozenLibrary({
    books: [book("a"), book("b")],
    groups: [group("g1", ["a", "b"])]
  });
  const deleted = deleteBooks(snapshot, new Set(["a"]));
  frozenLibrary(deleted);
  assert.doesNotThrow(() => restoreDeletedBooks(deleted, snapshot, new Set(["a"])));
  assert.deepEqual(keysOf(snapshot), ["a", "b"]);
  assert.deepEqual(snapshot.groups![0]!.bookKeys, ["a", "b"]);
});
