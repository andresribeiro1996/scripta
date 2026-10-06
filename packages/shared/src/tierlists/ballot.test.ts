import assert from "node:assert/strict";
import { test } from "node:test";
import { ballotBoard, blankBoard } from "./ballot.js";
import { aggregate, toPlacements } from "./results.js";

const board = { tiers: [{ id: "s", label: "S", color: "#000000" }, { id: "a", label: "A", color: "#111111" }], pool: ["w1", "w2", "w3"] };

test("a ballot rebuilds the board by work and round-trips to placements", () => {
  assert.deepEqual(blankBoard(board).tiers.map((tier) => tier.workIds), [[], []]);
  const filled = ballotBoard(board, [{ workId: "w2", tierId: "s" }, { workId: "w9", tierId: "gone" }]);
  assert.deepEqual(filled.tiers.map((tier) => tier.workIds), [["w2"], []]);
  assert.deepEqual(filled.pool, ["w1", "w3"]);
  assert.deepEqual(toPlacements(filled), [{ workId: "w2", tierId: "s" }]);
});

test("results aggregate per work", () => {
  const results = aggregate([{ workId: "w1", tierId: "a", votes: 2 }, { workId: "w2", tierId: "s", votes: 1 }], ["s", "a"], ["w1", "w2", "w3"], "plurality");
  assert.deepEqual(results.map((result) => [result.workId, result.tierId]), [["w1", "a"], ["w2", "s"], ["w3", null]]);
});
