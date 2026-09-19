/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { ballotBoard, blankBoard, type TierlistData } from "@scripta/shared";
import { moveBook, moveBookTo, reorderBook } from "./tierBoardData.js";

const board: TierlistData = {
  tiers: [
    { id: "top", label: "Top", color: "#000000", bookKeys: ["a", "b"] },
    { id: "mid", label: "Mid", color: "#111111", bookKeys: [] },
  ],
  pool: ["c"],
};

test("tier board moves books between sections and within a section", () => {
  const moved = moveBook(board, "b", 1);
  assert.deepEqual(moved.tiers.map((tier) => tier.bookKeys), [["a"], ["b"]]);
  assert.deepEqual(reorderBook(board, "b", -1).tiers[0]?.bookKeys, ["b", "a"]);
  assert.equal(moveBook(board, "a", -1), board);
});

test("tier board moves a book directly to any section", () => {
  const moved = moveBookTo(board, "a", "pool");
  assert.deepEqual(moved.tiers[0]?.bookKeys, ["b"]);
  assert.deepEqual(moved.pool, ["c", "a"]);
  assert.equal(moveBookTo(board, "a", "top"), board);
  assert.equal(moveBookTo(board, "z", "pool"), board);
});

// The published board is always blank — openVoting moves every ranking out
// of the tier list document and into a ballot — so a ballot is the only
// thing that can fill it back in.
const published = { tiers: board.tiers.map((tier) => ({ id: tier.id, label: tier.label, color: tier.color })), pool: ["a", "b", "c"] };

test("a blank board leaves every book unranked", () => {
  const blank = blankBoard(published);
  assert.deepEqual(blank.tiers.map((tier) => tier.bookKeys), [[], []]);
  assert.deepEqual(blank.pool, ["a", "b", "c"]);
});

test("a ballot fills the published board and empties what it ranked from the pool", () => {
  const filled = ballotBoard(published, [{ bookKey: "b", tierId: "mid" }, { bookKey: "a", tierId: "top" }]);
  assert.deepEqual(filled.tiers.map((tier) => tier.bookKeys), [["a"], ["b"]]);
  assert.deepEqual(filled.pool, ["c"]);
});

test("a ballot placing a book in a tier that no longer exists drops the placement, never the book", () => {
  const filled = ballotBoard(published, [{ bookKey: "a", tierId: "gone" }]);
  assert.deepEqual(filled.tiers.map((tier) => tier.bookKeys), [[], []]);
  assert.deepEqual(filled.pool, ["a", "b", "c"]);
});
