import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureBookBlockHeights, type MuralBlock } from "./murals.js";

const reading = (y: number, h: number): MuralBlock => ({ id: "r", type: "currentlyReading", layout: { x: 0, y, w: 12, h } });
const text = (id: string, y: number, h: number): MuralBlock => ({ id, type: "text", heading: id, layout: { x: 0, y, w: 12, h } });

test("a currentlyReading block shorter than 6 rows grows to 6 and pushes the blocks below it down", () => {
  const blocks = [text("above", 0, 3), reading(3, 4), text("below", 7, 3)];
  const [above, grown, below] = ensureBookBlockHeights(blocks);
  assert.deepEqual(above.layout, { x: 0, y: 0, w: 12, h: 3 });
  assert.deepEqual(grown.layout, { x: 0, y: 3, w: 12, h: 6 });
  assert.deepEqual(below.layout, { x: 0, y: 9, w: 12, h: 3 });
});

test("a shelf keeps its 4 row minimum and a tierlist its 8", () => {
  const shelf: MuralBlock = { id: "s", type: "shelf", title: "S", bookKeys: [], layout: { x: 0, y: 0, w: 12, h: 3 } };
  const tierlist: MuralBlock = { id: "t", type: "tierlist", tierlistId: "tl", layout: { x: 0, y: 3, w: 12, h: 5 } };
  const [grownShelf, grownTierlist] = ensureBookBlockHeights([shelf, tierlist]);
  assert.equal(grownShelf.layout.h, 4);
  assert.deepEqual(grownTierlist.layout, { x: 0, y: 4, w: 12, h: 8 });
});

test("blocks already tall enough come back untouched", () => {
  const blocks = [text("above", 0, 3), reading(3, 6)];
  assert.equal(ensureBookBlockHeights(blocks), blocks);
});
