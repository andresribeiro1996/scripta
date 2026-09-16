/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TierlistData } from "@scripta/shared";
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
