import assert from "node:assert/strict";
import { test } from "node:test";
import type { Group } from "./groups.js";
import { buildMergedLibrary } from "./addPipeline.js";
import { moveUnit, orderLibraryBooks, unitMoves } from "./libraryOrder.js";

type Book = Record<string, unknown>;
const book = (key: string, order: number): Book => ({ _key: key, Title: key, _order: order });
const series = (id: string, bookKeys: string[]): Group => ({ id, type: "series", name: id, bookKeys, createdAt: "", updatedAt: "" });

const books = [book("S1", 0), book("S2", 1), book("T1", 2), book("A", 3), book("B", 4), book("C", 5)];
const groups = [series("S", ["S1", "S2"]), series("T", ["T1"])];
const keys = (list: Book[]) => orderLibraryBooks(list, groups).map((b) => b._key);

test("moveUnit moves a series past the next series", () => {
  assert.deepEqual(keys(moveUnit(books, groups, "S2", "down")), ["T1", "S1", "S2", "A", "B", "C"]);
  assert.deepEqual(keys(moveUnit(books, groups, "T1", "up")), ["T1", "S1", "S2", "A", "B", "C"]);
});

test("moveUnit moves a standalone book past the next standalone book", () => {
  assert.deepEqual(keys(moveUnit(books, groups, "B", "down")), ["S1", "S2", "T1", "A", "C", "B"]);
});

test("moveUnit returns the same books when there is no same-kind neighbour", () => {
  assert.equal(moveUnit(books, groups, "A", "up"), books);
  assert.equal(moveUnit(books, groups, "T1", "down"), books);
});

test("unitMoves reports the arrows each unit may use", () => {
  const moves = unitMoves(books, groups);
  assert.deepEqual(moves.get("S1"), { up: false, down: true, inSeries: true });
  assert.deepEqual(moves.get("S2"), { up: false, down: true, inSeries: true });
  assert.deepEqual(moves.get("T1"), { up: true, down: false, inSeries: true });
  assert.deepEqual(moves.get("A"), { up: false, down: true, inSeries: false });
  assert.deepEqual(moves.get("C"), { up: true, down: false, inSeries: false });
});

test("unitMoves disables every arrow for one series and one standalone book", () => {
  const moves = unitMoves([book("S1", 0), book("A", 1)], [series("S", ["S1"])]);
  for (const move of moves.values()) assert.equal(move.up || move.down, false);
});

test("adding a book keeps the order of books that had no _order yet", () => {
  const unordered = [{ _key: "T1", Title: "T1" }, { _key: "S1", Title: "S1" }, { _key: "A", Title: "A" }];
  const seriesGroups = [series("Zeta", ["T1"]), series("Alpha", ["S1"])];
  const before = orderLibraryBooks(unordered, seriesGroups).map((b) => b._key);
  const added = buildMergedLibrary({ books: unordered, groups: seriesGroups }, { books: [{ _key: "N", Title: "N" }] });
  assert.deepEqual(orderLibraryBooks(added.books, added.groups ?? []).map((b) => b._key), [...before, "N"]);
});
