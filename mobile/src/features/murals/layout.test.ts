/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { MuralBlock } from "@scripta/shared";
import { changeBlockLayout, layoutStepBlocked, muralCanvasHeight } from "./layout.js";

const blocks: MuralBlock[] = [
  { id: "a", type: "text", heading: "A", body: "", layout: { x: 0, y: 0, w: 4, h: 2 } },
  { id: "b", type: "text", heading: "B", body: "", layout: { x: 6, y: 4, w: 3, h: 2 } },
];

test("mural layout changes preserve authored whitespace and reject collisions", () => {
  const moved = changeBlockLayout(blocks, "b", { x: 8, y: 8 });
  assert.deepEqual(moved[1]?.layout, { x: 8, y: 8, w: 3, h: 2 });
  assert.deepEqual(moved[0]?.layout, blocks[0]?.layout);
  assert.equal(changeBlockLayout(blocks, "b", { x: 2, y: 1 }), blocks);
});

test("large murals retain their full scrollable height", () => {
  const large = Array.from({ length: 100 }, (_, index): MuralBlock => ({
    id: String(index),
    type: "text",
    heading: String(index),
    body: "",
    layout: { x: 0, y: index * 3, w: 4, h: 2 },
  }));
  assert.equal(muralCanvasHeight(large, 36), 10_764);
});

const grid: MuralBlock[] = [
  { id: "a", type: "text", heading: "A", body: "", layout: { x: 0, y: 0, w: 4, h: 2 } },
  { id: "b", type: "text", heading: "B", body: "", layout: { x: 4, y: 0, w: 3, h: 2 } },
  { id: "c", type: "text", heading: "C", body: "", layout: { x: 9, y: 4, w: 3, h: 1 } },
];

test("a step into another block is blocked by that block", () => {
  assert.equal(layoutStepBlocked(grid, "a", { w: 5 }), "overlap");
});

test("a step past the right edge is blocked by the edge", () => {
  assert.equal(layoutStepBlocked(grid, "c", { w: 4 }), "edge");
});

test("shrinking below one cell is the minimum", () => {
  assert.equal(layoutStepBlocked(grid, "c", { h: 0 }), "minimum");
  assert.equal(layoutStepBlocked(grid, "c", { w: 0 }), "minimum");
});

test("free steps are allowed, and growing taller never meets an edge", () => {
  assert.equal(layoutStepBlocked(grid, "a", { h: 3 }), null);
  assert.equal(layoutStepBlocked(grid, "c", { h: 40 }), null);
});

test("the helper agrees with changeBlockLayout", () => {
  const patches = [{ w: 5 }, { w: 3 }, { h: 3 }, { h: 0 }, { x: 11 }, { w: 4 }];
  for (const id of ["a", "b", "c"]) {
    for (const patch of patches) {
      assert.equal(layoutStepBlocked(grid, id, patch) === null, changeBlockLayout(grid, id, patch) !== grid, `${id} ${JSON.stringify(patch)}`);
    }
  }
});
