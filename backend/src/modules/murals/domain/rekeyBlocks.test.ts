import assert from "node:assert/strict";
import { test } from "node:test";
import { rekeyBlocks } from "./rekeyBlocks.js";

const from = new Set(["old"]);

test("rewrites every book reference a block can hold and de-duplicates", () => {
  const blocks = [
    { id: "1", type: "spotlight", bookKey: "old" },
    { id: "2", type: "shelf", title: "", bookKeys: ["old", "new", "x"] },
    { id: "3", type: "quote", bookKey: "old", highlightId: "h1" },
    { id: "4", type: "quoteCollection", title: "", quotes: [{ bookKey: "old", highlightId: "h1" }, { bookKey: "new", highlightId: "h1" }, { bookKey: "x", highlightId: "h2" }] },
    { id: "5", type: "tierlist", tiers: [{ id: "s", bookKeys: ["old"] }], pool: ["new"] },
    { id: "6", type: "text", body: "old" }
  ];
  assert.deepEqual(rekeyBlocks(blocks, from, "new"), [
    { id: "1", type: "spotlight", bookKey: "new" },
    { id: "2", type: "shelf", title: "", bookKeys: ["new", "x"] },
    { id: "3", type: "quote", bookKey: "new", highlightId: "h1" },
    { id: "4", type: "quoteCollection", title: "", quotes: [{ bookKey: "new", highlightId: "h1" }, { bookKey: "x", highlightId: "h2" }] },
    { id: "5", type: "tierlist", tiers: [{ id: "s", bookKeys: ["new"] }], pool: [] },
    { id: "6", type: "text", body: "old" }
  ]);
});

test("leaves non-array input and non-object blocks alone", () => {
  assert.equal(rekeyBlocks("nope", from, "new"), "nope");
  assert.deepEqual(rekeyBlocks([null, 3], from, "new"), [null, 3]);
});
