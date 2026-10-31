import assert from "node:assert/strict";
import { test } from "node:test";
import { createTier, tierlistBookCount } from "./tierlist.js";

test("a tier list counts the books in its tiers as well as its pool", () => {
  const s = { ...createTier("S", "#c9482f"), workIds: ["a", "b"] };
  const a = { ...createTier("A", "#d98a3d"), workIds: ["c"] };
  assert.equal(tierlistBookCount({ tiers: [s, a], pool: ["d"] }), 4);
  assert.equal(tierlistBookCount({ tiers: [s, a], pool: [] }), 3);
  assert.equal(tierlistBookCount({ tiers: [], pool: ["x", "y"] }), 2);
});
