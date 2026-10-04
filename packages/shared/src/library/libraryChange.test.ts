import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMergedLibrary } from "./addPipeline.js";
import type { Group } from "./groups.js";
import { applyLibraryChange } from "./libraryChange.js";
import { bookKey } from "./merge.js";
import type { LibraryData } from "./types.js";

const STAMP = "2020-01-01T00:00:00.000Z";

const dune = { Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 0 };
const emma = { Title: "Emma", Attribution: "Jane Austen", ReadStatus: 1, ___PercentRead: 40 };
const duneKey = bookKey(dune);
const emmaKey = bookKey(emma);

function group(partial: Partial<Group> & Pick<Group, "id">): Group {
  return { type: "collection", name: partial.id, bookKeys: [], createdAt: STAMP, updatedAt: STAMP, ...partial };
}

function library(): LibraryData {
  const data = { books: [dune, emma], groups: [group({ id: "shelf", bookKeys: [emmaKey] }), group({ id: "empty" })] };
  for (const book of data.books) Object.freeze(book);
  for (const g of data.groups) {
    Object.freeze(g.bookKeys);
    Object.freeze(g);
  }
  Object.freeze(data.books);
  Object.freeze(data.groups);
  return Object.freeze(data);
}

test("ticking a book puts its key in the group and stamps only that group", () => {
  const data = library();
  const result = applyLibraryChange(data, { kind: "membership", groupId: "empty", bookKey: duneKey, member: true });
  assert.ok("data" in result && result.changed);
  assert.deepEqual(result.data.groups![1]!.bookKeys, [duneKey]);
  assert.notEqual(result.data.groups![1]!.updatedAt, STAMP);
  assert.equal(result.data.groups![0], data.groups![0]);
  assert.equal(result.data.books, data.books);
});

test("unticking takes the key out of the group", () => {
  const data = library();
  const result = applyLibraryChange(data, { kind: "membership", groupId: "shelf", bookKey: emmaKey, member: false });
  assert.ok("data" in result && result.changed);
  assert.deepEqual(result.data.groups![0]!.bookKeys, []);
});

test("a membership change that alters nothing returns the same data", () => {
  const data = library();
  for (const change of [
    { kind: "membership", groupId: "shelf", bookKey: emmaKey, member: true },
    { kind: "membership", groupId: "empty", bookKey: emmaKey, member: false }
  ] as const) {
    const result = applyLibraryChange(data, change);
    assert.ok("data" in result);
    assert.equal(result.data, data);
    assert.equal(result.changed, false);
  }
});

test("an unknown group is no-group, before the book is looked up", () => {
  const data = library();
  assert.deepEqual(applyLibraryChange(data, { kind: "membership", groupId: "gone", bookKey: duneKey, member: true }), { error: "no-group" });
  assert.deepEqual(applyLibraryChange(data, { kind: "membership", groupId: "gone", bookKey: duneKey, member: false }), { error: "no-group" });
  assert.deepEqual(applyLibraryChange(data, { kind: "membership", groupId: "gone", bookKey: "ta:nobody|", member: true }), { error: "no-group" });
  assert.deepEqual(applyLibraryChange({ books: [dune] }, { kind: "membership", groupId: "shelf", bookKey: duneKey, member: true }), { error: "no-group" });
});

test("putting a key with no book in a group is no-book, but a dangling key can be taken out", () => {
  const data = { ...library(), groups: [group({ id: "shelf", bookKeys: ["ta:removed|"] })] };
  assert.deepEqual(applyLibraryChange(data, { kind: "membership", groupId: "shelf", bookKey: "ta:nobody|", member: true }), { error: "no-book" });
  const cleaned = applyLibraryChange(data, { kind: "membership", groupId: "shelf", bookKey: "ta:removed|", member: false });
  assert.ok("data" in cleaned && cleaned.changed);
  assert.deepEqual(cleaned.data.groups![0]!.bookKeys, []);
});

test("a status change finishes the book on the given day and leaves the others alone", () => {
  const data = library();
  const result = applyLibraryChange(data, { kind: "book", bookKey: emmaKey, readStatus: 2, day: "2026-10-02" });
  assert.ok("data" in result && result.changed);
  assert.deepEqual(result.data.books[1], { ...emma, ReadStatus: 2, DateLastRead: "2026-10-02", ___PercentRead: 100 });
  assert.equal(result.data.books[0], dune);
  assert.equal(result.data.groups, data.groups);
});

test("a rating change sets the rating, and a status and rating in one change apply together", () => {
  const data = library();
  const rated = applyLibraryChange(data, { kind: "book", bookKey: duneKey, rating: 4 });
  assert.ok("data" in rated && rated.changed);
  assert.deepEqual(rated.data.books[0], { ...dune, Rating: 4 });
  const both = applyLibraryChange(data, { kind: "book", bookKey: duneKey, readStatus: 2, day: "2026-10-02", rating: 5 });
  assert.ok("data" in both && both.changed);
  assert.deepEqual(both.data.books[0], { ...dune, ReadStatus: 2, DateLastRead: "2026-10-02", ___PercentRead: 100, Rating: 5 });
});

test("a book change reaches every book with the key", () => {
  const twin = { ...dune, ContentID: "twin" };
  const data = { books: [dune, emma, twin] };
  const result = applyLibraryChange(data, { kind: "book", bookKey: duneKey, readStatus: 1 });
  assert.ok("data" in result && result.changed);
  assert.deepEqual(result.data.books.map((book) => book.ReadStatus), [1, 1, 1]);
  assert.equal(result.data.books[1], emma);
});

test("a book change that alters no matched book returns the same data", () => {
  const data = library();
  for (const change of [
    { kind: "book", bookKey: emmaKey, readStatus: 1, day: "2026-10-02" },
    { kind: "book", bookKey: emmaKey, rating: undefined },
    { kind: "book", bookKey: emmaKey }
  ] as const) {
    const result = applyLibraryChange(data, change);
    assert.ok("data" in result);
    assert.equal(result.data, data);
    assert.equal(result.changed, false);
  }
  const rated = { books: [{ ...dune, Rating: 3 }] };
  const same = applyLibraryChange(rated, { kind: "book", bookKey: duneKey, rating: 3 });
  assert.ok("data" in same);
  assert.equal(same.data, rated);
});

test("a book change for a key no book has is no-book", () => {
  assert.deepEqual(applyLibraryChange(library(), { kind: "book", bookKey: "ta:nobody|", readStatus: 1 }), { error: "no-book" });
});

test("an add runs the add pipeline and always counts as changed", () => {
  const data = library();
  const book = { Title: "Neuromancer", Attribution: "William Gibson", Series: "Sprawl", ReadStatus: 0 };
  const result = applyLibraryChange(data, { kind: "add", book });
  assert.ok("data" in result && result.changed);
  const expected = buildMergedLibrary(data, { books: [book] });
  assert.equal(result.data.books.length, 3);
  assert.deepEqual(result.data.books, expected.books);
  assert.equal(result.data.books[2]!._order, 2);
  const series = result.data.groups!.find((g) => g.type === "series");
  assert.deepEqual([series?.name, series?.bookKeys], ["Sprawl", [bookKey(book)]]);
  assert.equal(result.data.groups!.length, 3);
});

test("re-adding a book the library already has still counts as changed", () => {
  const data = library();
  const result = applyLibraryChange(data, { kind: "add", book: { ...dune } });
  assert.ok("data" in result && result.changed);
  assert.equal(result.data.books.length, 2);
});

test("an add to a library with no books or groups starts from nothing", () => {
  const result = applyLibraryChange({ books: [] }, { kind: "add", book: { Title: "Emma", Attribution: "Jane Austen" } });
  assert.ok("data" in result && result.changed);
  assert.equal(result.data.books.length, 1);
  assert.equal(result.data.book_count, 1);
});

test("a group lookup passes malformed groups through unchanged, never matches them, and never throws", () => {
  const malformed: unknown[] = [
    null,
    "group",
    { id: "shelf", type: "collection", bookKeys: [] },
    { id: "shelf", type: "collection", name: "Bad keys", bookKeys: "ta:dune|frank herbert" },
    { id: "shelf", type: "collection", name: "No keys" }
  ];
  const only = { books: [dune, emma], groups: malformed as Group[] };
  assert.deepEqual(applyLibraryChange(only, { kind: "membership", groupId: "shelf", bookKey: duneKey, member: true }), { error: "no-group" });
  assert.deepEqual(applyLibraryChange(only, { kind: "membership", groupId: "shelf", bookKey: duneKey, member: false }), { error: "no-group" });

  const valid = group({ id: "shelf", bookKeys: [emmaKey] });
  const mixed = { books: [dune, emma], groups: [...malformed as Group[], valid] };
  const ticked = applyLibraryChange(mixed, { kind: "membership", groupId: "shelf", bookKey: duneKey, member: true });
  assert.ok("data" in ticked && ticked.changed);
  malformed.forEach((entry, i) => assert.equal(ticked.data.groups![i], entry));
  assert.deepEqual(ticked.data.groups!.at(-1)!.bookKeys, [emmaKey, duneKey]);

  const added = applyLibraryChange(mixed, { kind: "add", book: { Title: "Neuromancer", Attribution: "William Gibson", Series: "Sprawl" } });
  assert.ok("data" in added);
  malformed.forEach((entry, i) => assert.equal(added.data.groups![i], entry));
  assert.equal(added.data.groups!.length, malformed.length + 2);
});

test("a non-record entry in books is passed through untouched by every kind of change, and never throws", () => {
  const junk: unknown[] = [null, 7, "book"];
  const data = { books: [...junk as Array<Record<string, unknown>>, dune, emma], groups: [group({ id: "shelf" })] };

  const ticked = applyLibraryChange(data, { kind: "membership", groupId: "shelf", bookKey: duneKey, member: true });
  assert.ok("data" in ticked && ticked.changed);
  assert.equal(ticked.data.books, data.books);
  assert.deepEqual(applyLibraryChange(data, { kind: "membership", groupId: "shelf", bookKey: "ta:nobody|", member: true }), { error: "no-book" });

  const finished = applyLibraryChange(data, { kind: "book", bookKey: duneKey, readStatus: 2, day: "2026-10-02" });
  assert.ok("data" in finished && finished.changed);
  junk.forEach((entry, i) => assert.equal(finished.data.books[i], entry));
  assert.deepEqual(finished.data.books[3], { ...dune, ReadStatus: 2, DateLastRead: "2026-10-02", ___PercentRead: 100 });
  assert.deepEqual(applyLibraryChange(data, { kind: "book", bookKey: "ta:nobody|", rating: 3 }), { error: "no-book" });

  const added = applyLibraryChange(data, { kind: "add", book: { Title: "Neuromancer", Attribution: "William Gibson" } });
  assert.ok("data" in added);
  assert.deepEqual(added.data.books.filter((book) => typeof book !== "object" || book === null), junk);
  assert.equal(added.data.books.filter((book) => typeof book === "object" && book !== null).length, 3);
  assert.equal(added.data.book_count, 6);
});

test("a groups that is not an array is passed through untouched, and a membership change finds no group", () => {
  for (const groups of ["shelf", 7, { id: "shelf" }, null]) {
    const data = { books: [dune, emma], groups } as unknown as LibraryData;
    assert.deepEqual(applyLibraryChange(data, { kind: "membership", groupId: "shelf", bookKey: duneKey, member: true }), { error: "no-group" });

    const rated = applyLibraryChange(data, { kind: "book", bookKey: duneKey, rating: 4 });
    assert.ok("data" in rated && rated.changed);
    assert.equal(rated.data.groups, groups);

    const added = applyLibraryChange(data, { kind: "add", book: { Title: "Neuromancer", Attribution: "William Gibson", Series: "Sprawl" } });
    assert.ok("data" in added);
    assert.equal(added.data.groups, groups);
    assert.equal(added.data.books.length, 3);
  }
});
