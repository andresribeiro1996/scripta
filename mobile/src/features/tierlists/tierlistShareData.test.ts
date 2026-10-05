/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { blankBoard, type TierlistData } from "@scripta/shared";
import { shareableCommunityResults, tierlistShareRows } from "./tierlistShareData.js";

const privateBoard: TierlistData = {
  tiers: [{ id: "top", label: "Top", color: "#000000", workIds: ["a", "b"] }, { id: "next", label: "Next", color: "#111111", workIds: [] }],
  pool: ["c"],
};

test("private snapshots preserve every ranked and unranked book without publishing", () => {
  const snapshot = tierlistShareRows(privateBoard);
  assert.deepEqual(snapshot.tiers.map((tier) => tier.workIds), [["a", "b"], []]);
  assert.deepEqual(snapshot.extra, ["c"]);
  assert.equal(privateBoard.tiers[0]?.workIds.length, 2);
});

test("community snapshots use the selected aggregation and keep books with no votes", () => {
  const published = blankBoard({ tiers: privateBoard.tiers, pool: ["a", "b", "c"] });
  const histogram = [{ workId: "a", tierId: "top", votes: 2 }, { workId: "a", tierId: "next", votes: 1 }, { workId: "b", tierId: "next", votes: 3 }];
  const snapshot = tierlistShareRows(published, histogram, "plurality");
  assert.deepEqual(snapshot.tiers.map((tier) => tier.workIds), [["a"], ["b"]]);
  assert.deepEqual(snapshot.extra, ["c"]);
  assert.equal(shareableCommunityResults(null, 3), false);
  assert.equal(shareableCommunityResults(histogram, 3), true);
});
