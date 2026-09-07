/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { MuralBlock } from "@scripta/shared";
import { changeBlockLayout, muralCanvasHeight } from "./layout.js";

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
