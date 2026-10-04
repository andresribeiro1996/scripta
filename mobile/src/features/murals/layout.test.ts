/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { MuralBlock } from "@scripta/shared";
import { changeBlockLayout, layoutStepBlocked, muralCanvasHeight, muralDragCell, muralDragPosition, muralPreviewScale } from "./layout.js";

const blocks: MuralBlock[] = [
  { id: "a", type: "text", heading: "A", body: "", layout: { x: 0, y: 0, w: 4, h: 2 } },
  { id: "b", type: "text", heading: "B", body: "", layout: { x: 6, y: 4, w: 3, h: 2 } },
];

test("mural previews fill the available width so the bottom can be cropped", () => {
  assert.equal(muralPreviewScale(160, 360), 160 / 360);
  assert.equal(muralPreviewScale(160, 100), 1.6);
  assert.equal(muralPreviewScale(0, 360), 0);
  assert.equal(muralPreviewScale(160, 0), 0);
});

test("drag snapping holds the last row through small reversals and still follows deliberate movement", () => {
  let row = 0;
  const positions = [0, 0.49, 0.51, 0.64, 0.66, 0.51, 0.36, 0.34, -0.66, -0.51, -0.34, 4.7];
  assert.deepEqual(positions.map((position) => (row = muralDragCell(position, row))), [0, 0, 0, 0, 1, 1, 1, 0, -1, -1, -0, 5]);
});

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

test("size growth rearranges neighboring blocks instead of blocking the step", () => {
  assert.equal(layoutStepBlocked(grid, "a", { w: 5 }), null);
  const resized = changeBlockLayout(grid, "a", { w: 5 });
  assert.equal(resized[0].layout.w, 5);
  assert.equal(resized[1].layout.y, 2);
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


test("every dragged block stays inside the canvas without snapping its continuous movement", () => {
  const fullWidth = { x: 0, y: 3, w: 12, h: 6 };
  for (const dx of [-1000, -40, 40, 1000]) assert.deepEqual(muralDragPosition(fullWidth, dx, 5, 30), { x: 0, y: 113 });
  const narrow = { x: 4, y: 3, w: 3, h: 2 };
  assert.deepEqual(muralDragPosition(narrow, -1000, -1000, 30), { x: 0, y: 0 });
  assert.deepEqual(muralDragPosition(narrow, 1000, 15, 30), { x: 270, y: 123 });
  assert.deepEqual(muralDragPosition(narrow, 7.25, -2.5, 30), { x: 127.25, y: 105.5 });
});


test("height can shrink and grow again after compaction moves the next blocks upward", () => {
  const original: MuralBlock[] = [
    { ...blocks[0], layout: { x: 0, y: 0, w: 12, h: 4 } },
    { ...blocks[1], layout: { x: 0, y: 4, w: 12, h: 2 } },
    { ...blocks[1], id: "c", layout: { x: 0, y: 6, w: 12, h: 2 } },
  ];
  const before = structuredClone(original);
  const shrunk = changeBlockLayout(original, "a", { h: 2 });
  assert.deepEqual(shrunk.map((block) => block.layout.y), [0, 2, 4]);
  assert.equal(layoutStepBlocked(shrunk, "a", { h: 4 }), null);
  assert.deepEqual(changeBlockLayout(shrunk, "a", { h: 4 }), original);
  assert.deepEqual(original, before);
});
