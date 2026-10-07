import assert from "node:assert/strict";
import { test } from "node:test";
import { compactMuralBlocks, createDuplicateCandidate, duplicateBlock, ensureBookBlockHeights, layoutsOverlap, moveMuralBlock, muralDragScrollSpeed, muralThemeId, toggleMuralBlockExpansion, withMuralBlockLayout, type MuralBlock } from "./murals.js";

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

test("muralThemeId passes a valid theme through and falls back to light otherwise", () => {
  assert.equal(muralThemeId("dark"), "dark");
  for (const bad of [undefined, null, "", "system", "nope"]) assert.equal(muralThemeId(bad), "light");
});

test("dropping above a block pushes every collision in the chain and compacts empty rows", () => {
  const blocks = [text("first", 0, 2), text("second", 2, 3), text("gap", 12, 2), text("moving", 16, 2)];
  blocks.push({ ...text("side", 2, 3), layout: { x: 8, y: 2, w: 4, h: 3 } });
  blocks[0].layout.w = 6;
  blocks[1].layout.w = 6;
  const before = structuredClone(blocks);
  const moved = moveMuralBlock(blocks, "moving", { x: 0, y: 0, w: 6, h: 4 });
  assert.deepEqual(moved.map((block) => block.layout.y), [4, 6, 9, 0, 0]);
  for (let i = 0; i < moved.length; i++) {
    for (let j = i + 1; j < moved.length; j++) assert.equal(layoutsOverlap(moved[i].layout, moved[j].layout), false);
  }
  assert.deepEqual(blocks, before);
  assert.deepEqual(moved.map((block) => block.id), blocks.map((block) => block.id));
});

test("a move crossing columns cascades through wide blocks without changing content, size or array order", () => {
  const blocks = [text("moving", 0, 2), text("wide", 5, 3), { ...text("side", 8, 2), layout: { x: 8, y: 8, w: 4, h: 2 } }];
  const moved = moveMuralBlock(blocks, "moving", { x: 0, y: 5, w: 4, h: 2 });
  assert.deepEqual(moved.map((block) => block.layout.y), [0, 2, 5]);
  assert.deepEqual(moved.map((block) => block.id), blocks.map((block) => block.id));
  assert.equal(moved[1].layout.w, 12);
  assert.equal(moved[1].layout.h, 3);
  assert.deepEqual(moveMuralBlock(blocks, "moving", { x: 8, y: 20, w: 4, h: 2 })[1].layout, { ...blocks[1].layout, y: 0 });
});

test("invalid and unchanged mural drops are no-ops", () => {
  const blocks = [text("moving", 0, 2)];
  for (const patch of [{ x: -1 }, { x: 1 }, { y: -1 }, { y: NaN }, { y: Infinity }, { y: 0.5 }, { h: 0 }]) {
    assert.equal(moveMuralBlock(blocks, "moving", { ...blocks[0].layout, ...patch }), blocks);
  }
  assert.equal(moveMuralBlock(blocks, "missing", blocks[0].layout), blocks);
  assert.equal(moveMuralBlock(blocks, "moving", blocks[0].layout), blocks);
});

test("placing a new block at its draft position also rearranges collisions", () => {
  const blocks = [text("first", 0, 2), text("second", 2, 2), text("new", 0, 3)];
  const placed = moveMuralBlock(blocks, "new", blocks[2].layout);
  assert.deepEqual(placed.map((block) => block.layout.y), [3, 5, 0]);
  assert.deepEqual(blocks.map((block) => block.layout.y), [0, 2, 0]);
});

test("downward dragging reorders on entering the next row, regardless of block height", () => {
  const blocks = [text("moving", 0, 2), text("tall", 2, 8), text("last", 10, 2)];
  const before = structuredClone(blocks);
  assert.equal(moveMuralBlock(blocks, "moving", blocks[0].layout), blocks);
  const moved = moveMuralBlock(blocks, "moving", { x: 0, y: 1, w: 12, h: 2 });
  assert.deepEqual(moved.map((block) => block.layout.y), [8, 0, 10]);
  assert.deepEqual(moved.map((block) => block.layout.h), [2, 8, 2]);
  assert.deepEqual(blocks, before);
  const tallMoving = [text("moving", 0, 8), text("next", 8, 8), text("last", 16, 2)];
  assert.deepEqual(moveMuralBlock(tallMoving, "moving", { x: 0, y: 1, w: 12, h: 8 }).map((block) => block.layout.y), [8, 0, 16]);
  for (let i = 0; i < moved.length; i++) {
    for (let j = i + 1; j < moved.length; j++) assert.equal(layoutsOverlap(moved[i].layout, moved[j].layout), false);
  }
});

test("matching blocks swap left and right at half overlap without moving other rows", () => {
  const blocks = [
    { ...text("left", 0, 4), layout: { x: 0, y: 0, w: 6, h: 4 }, expandedFrom: { w: 2, x: 1 } },
    { ...text("right", 0, 4), layout: { x: 6, y: 0, w: 6, h: 4 } },
    text("below", 4, 2),
  ];
  const before = structuredClone(blocks);
  assert.equal(moveMuralBlock(blocks, "left", { x: 2, y: 0, w: 6, h: 4 }), blocks);
  assert.equal(moveMuralBlock(blocks, "right", { x: 4, y: 0, w: 6, h: 4 }), blocks);
  for (const id of ["left", "right"]) {
    const swapped = moveMuralBlock(blocks, id, { x: 3, y: 0, w: 6, h: 4 });
    assert.deepEqual(swapped.map((block) => block.layout), [{ x: 6, y: 0, w: 6, h: 4 }, { x: 0, y: 0, w: 6, h: 4 }, blocks[2].layout]);
    assert.equal(swapped[2], blocks[2]);
    assert.deepEqual(swapped[0].expandedFrom, { w: 2, x: 7 });
    assert.deepEqual(moveMuralBlock(swapped, id, { x: 3, y: 0, w: 6, h: 4 }), blocks);
  }
  assert.deepEqual(blocks, before);
});

test("horizontal swaps preserve intervening blocks and size changes still rearrange collisions", () => {
  const blocks = [0, 4, 8].map((x, index) => ({ ...text(String(index), 0, 4), layout: { x, y: 0, w: 4, h: 4 } }));
  const swapped = moveMuralBlock(blocks, "0", { x: 8, y: 0, w: 4, h: 4 });
  assert.deepEqual(swapped.map((block) => block.layout.x), [8, 4, 0]);
  assert.equal(swapped[1], blocks[1]);
  const resized = moveMuralBlock(blocks, "0", { x: 1, y: 0, w: 5, h: 4 });
  assert.deepEqual(resized.map((block) => block.layout.y), [0, 4, 0]);
  const different = [{ ...blocks[0], layout: { ...blocks[0].layout, w: 3 } }, blocks[1]];
  assert.deepEqual(moveMuralBlock(different, "0", { x: 3, y: 0, w: 3, h: 4 }).map((block) => block.layout), [{ x: 5, y: 0, w: 3, h: 4 }, { x: 0, y: 0, w: 4, h: 4 }]);
});

test("unequal blocks swap in either direction with slight vertical drift and preserve their sizes", () => {
  for (const [w, h] of [[8, 4], [4, 6], [10, 2], [2, 6], [4, 1]]) {
    const blocks = [
      { ...text("left", 0, h), layout: { x: 0, y: 0, w, h } },
      { ...text("right", 0, 4), layout: { x: w, y: 0, w: 12 - w, h: 4 } },
      text("below", Math.max(h, 4), 2),
    ];
    const before = structuredClone(blocks);
    const expected = [{ x: 12 - w, y: 0, w, h }, { x: 0, y: 0, w: 12 - w, h: 4 }, blocks[2].layout];
    for (const id of ["left", "right"]) {
      const block = blocks.find((item) => item.id === id)!;
      const moved = moveMuralBlock(blocks, id, { ...block.layout, x: id === "left" ? 12 - w : 0, y: 1 });
      assert.deepEqual(moved.map((item) => item.layout), expected);
      assert.equal(moved[2], blocks[2]);
    }
    assert.deepEqual(blocks, before);
  }
});

test("unequal swaps keep intervening blocks in the row when the row fits", () => {
  const blocks = [
    { ...text("left", 0, 4), layout: { x: 0, y: 0, w: 2, h: 4 } },
    { ...text("middle", 0, 4), layout: { x: 2, y: 0, w: 4, h: 4 } },
    { ...text("right", 0, 4), layout: { x: 6, y: 0, w: 6, h: 4 } },
  ];
  for (const id of ["left", "right"]) {
    const block = blocks.find((item) => item.id === id)!;
    const moved = moveMuralBlock(blocks, id, { ...block.layout, x: id === "left" ? 10 : 0 });
    assert.deepEqual(moved.map((block) => block.layout.x), [10, 6, 0]);
    assert.deepEqual(moved.map((block) => block.layout.y), [0, 0, 0]);
    assert.deepEqual(moveMuralBlock(moved, id, block.layout), blocks);
  }
});

test("horizontal swaps that cannot fit vertically fall back to collision rearrangement", () => {
  const blocks = [
    { ...text("left", 0, 2), layout: { x: 0, y: 0, w: 6, h: 2 } },
    { ...text("right", 0, 6), layout: { x: 6, y: 0, w: 6, h: 6 } },
    { ...text("below", 2, 4), layout: { x: 0, y: 2, w: 6, h: 4 } },
  ];
  const moved = moveMuralBlock(blocks, "left", { x: 6, y: 0, w: 6, h: 2 });
  assert.deepEqual(moved.map((block) => block.layout.y), [0, 2, 0]);
  for (let i = 0; i < moved.length; i++) {
    for (let j = i + 1; j < moved.length; j++) assert.equal(layoutsOverlap(moved[i].layout, moved[j].layout), false);
  }
});

test("reordering crosses multiple blocks while upward dragging and resizing retain their behavior", () => {
  const blocks = [text("moving", 0, 2), text("first", 2, 2), text("second", 4, 2), text("last", 6, 2)];
  assert.deepEqual(moveMuralBlock(blocks, "moving", { x: 0, y: 1, w: 12, h: 2 }).map((block) => block.layout.y), [2, 0, 4, 6]);
  assert.deepEqual(moveMuralBlock(blocks, "moving", { x: 0, y: 3, w: 12, h: 2 }).map((block) => block.layout.y), [4, 0, 2, 6]);
  assert.deepEqual(moveMuralBlock(blocks, "first", { x: 0, y: 1, w: 12, h: 2 }).map((block) => block.layout.y), [2, 0, 4, 6]);
  assert.deepEqual(moveMuralBlock(blocks, "moving", { x: 0, y: 1, w: 12, h: 3 }).map((block) => block.layout.y), [0, 3, 5, 7]);
});

test("edge scrolling accelerates in both directions and stays still in the center", () => {
  assert.equal(muralDragScrollSpeed(300, 100, 500), 0);
  assert.equal(muralDragScrollSpeed(100, 100, 500), -420);
  assert.equal(muralDragScrollSpeed(500, 100, 500), 420);
  assert.equal(muralDragScrollSpeed(132, 100, 500), -105);
  assert.equal(muralDragScrollSpeed(468, 100, 500), 105);
  assert.equal(muralDragScrollSpeed(700, 100, 500), 420);
  assert.equal(muralDragScrollSpeed(300, 100, 100), 0);
});

test("expansion fills both directions and restores the original position and size after reload", () => {
  const blocks: MuralBlock[] = [
    { ...text("a", 2, 2), layout: { x: 2, y: 2, w: 2, h: 2 } },
    { ...text("right", 3, 2), layout: { x: 8, y: 3, w: 2, h: 2 } },
    { ...text("below", 9, 2), layout: { x: 3, y: 9, w: 2, h: 2 } },
    { ...text("outside", 0, 2), layout: { x: 4, y: 0, w: 2, h: 2 } },
  ];
  const before = structuredClone(blocks);
  const wide = toggleMuralBlockExpansion(blocks, "a", "w", 20);
  assert.deepEqual(wide[0].layout, { x: 0, y: 2, w: 8, h: 2 });
  assert.deepEqual(wide[0].expandedFrom, { w: 2, x: 2 });
  const tall = toggleMuralBlockExpansion(wide, "a", "h", 20);
  assert.equal(tall[0].layout.h, 7);
  assert.deepEqual(tall[0].expandedFrom, { w: 2, x: 2, h: 2, y: 2 });
  const narrow = toggleMuralBlockExpansion(JSON.parse(JSON.stringify(tall)), "a", "w", 20);
  assert.deepEqual(narrow[0].expandedFrom, { h: 2, y: 2 });
  assert.equal(narrow[0].layout.h, 7);
  assert.deepEqual(toggleMuralBlockExpansion(narrow, "a", "h", 20), blocks);
  assert.deepEqual(blocks, before);
  assert.equal(wide[1], blocks[1]);
});

test("expansion respects mural width and both viewport edges without shrinking offscreen blocks", () => {
  const blocks = [{ ...text("a", 3, 2), layout: { x: 4, y: 3, w: 2, h: 2 } }];
  assert.deepEqual(toggleMuralBlockExpansion(blocks, "a", "w", 10)[0].layout, { x: 0, y: 3, w: 12, h: 2 });
  assert.deepEqual(toggleMuralBlockExpansion(blocks, "a", "h", 10.8, 1.2)[0].layout, { x: 4, y: 2, w: 2, h: 8 });
  for (const bottom of [5, 2, NaN, Infinity]) assert.equal(toggleMuralBlockExpansion(blocks, "a", "h", bottom, 3), blocks);
  const blocked = [...blocks, { ...text("b", 3, 2), layout: { x: 6, y: 3, w: 2, h: 2 } }];
  assert.deepEqual(toggleMuralBlockExpansion(blocked, "a", "w", 10)[0].layout, { x: 0, y: 3, w: 6, h: 2 });
  const surrounded = [...blocked, { ...text("left", 3, 2), layout: { x: 0, y: 3, w: 4, h: 2 } }];
  assert.equal(toggleMuralBlockExpansion(surrounded, "a", "w", 10), surrounded);
  const below = [...blocks, { ...text("below", 5, 2), layout: { x: 4, y: 5, w: 2, h: 2 } }];
  assert.deepEqual(toggleMuralBlockExpansion(below, "a", "h", 10)[0].layout, { x: 4, y: 0, w: 2, h: 5 });
  assert.equal(toggleMuralBlockExpansion(blocks, "missing", "w", 10), blocks);
});

test("manual resizing clears only the resized axis toggle while moving keeps both toggles", () => {
  const blocks = [{ ...text("a", 0, 2), layout: { x: 0, y: 0, w: 2, h: 2 } }];
  const expanded = toggleMuralBlockExpansion(toggleMuralBlockExpansion(blocks, "a", "w", 10), "a", "h", 10);
  assert.deepEqual(withMuralBlockLayout(expanded[0], { ...expanded[0].layout, w: 6 }).expandedFrom, { h: 2, y: 0 });
  const moved = moveMuralBlock(expanded, "a", { ...expanded[0].layout, y: 12 });
  assert.deepEqual(moved[0].expandedFrom, { w: 2, x: 0, h: 2, y: 0 });
  assert.equal(toggleMuralBlockExpansion(moved, "a", "h", 10)[0].layout.h, 2);
});

test("moving an expanded block keeps its original inset and older saved toggles still restore", () => {
  const blocks = [{ ...text("a", 3, 2), layout: { x: 4, y: 3, w: 2, h: 2 } }];
  const expanded = toggleMuralBlockExpansion(blocks, "a", "h", 10);
  const moved = moveMuralBlock(expanded, "a", { ...expanded[0].layout, y: 12 });
  assert.deepEqual(toggleMuralBlockExpansion(moved, "a", "h", 20)[0].layout, { x: 4, y: 3, w: 2, h: 2 });
  const duplicate = createDuplicateCandidate(expanded[0], expanded);
  assert.deepEqual(toggleMuralBlockExpansion([duplicate], duplicate.id, "h", 20)[0].layout, { x: 0, y: 3, w: 2, h: 2 });
  const [mural] = duplicateBlock([{ id: "m", name: "M", theme: "light", blocks: expanded, createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null }], "m", "a");
  const last = mural.blocks.at(-1)!;
  assert.deepEqual(toggleMuralBlockExpansion(mural.blocks, last.id, "h", 20).at(-1)!.layout, { x: 0, y: 3, w: 2, h: 2 });
  const legacy = [{ ...blocks[0], layout: { ...blocks[0].layout, w: 8 }, expandedFrom: { w: 2 } }];
  assert.deepEqual(toggleMuralBlockExpansion(legacy, "a", "w", 10), blocks);
});


test("compaction packs columns and wide blocks without changing dimensions, content or order", () => {
  const blocks = [text("wide", 12, 2), { ...text("left", 3, 4), layout: { x: 0, y: 3, w: 6, h: 4 } }, { ...text("right", 6, 2), layout: { x: 6, y: 6, w: 6, h: 2 } }, text("last", 20, 3)];
  const before = structuredClone(blocks);
  const packed = compactMuralBlocks(blocks);
  assert.deepEqual(packed.map((block) => block.layout.y), [4, 0, 0, 6]);
  assert.deepEqual(packed.map((block) => ({ ...block, layout: { ...block.layout, y: 0 } })), before.map((block) => ({ ...block, layout: { ...block.layout, y: 0 } })));
  assert.deepEqual(blocks, before);
  assert.equal(compactMuralBlocks(packed), packed);
  assert.deepEqual(compactMuralBlocks(packed.filter((block) => block.id !== "wide")).map((block) => block.layout.y), [0, 0, 4]);
  for (let i = 0; i < packed.length; i++) {
    for (let j = i + 1; j < packed.length; j++) assert.equal(layoutsOverlap(packed[i].layout, packed[j].layout), false);
  }
});

test("compaction preserves expansion insets and rejects invalid geometry", () => {
  const blocks = [{ ...text("expanded", 8, 6), expandedFrom: { h: 2, y: 10 } }];
  const packed = compactMuralBlocks(blocks);
  assert.deepEqual(packed[0].expandedFrom, { h: 2, y: 2 });
  assert.deepEqual(toggleMuralBlockExpansion(packed, "expanded", "h", 20)[0].layout, { x: 0, y: 2, w: 12, h: 2 });
  for (const patch of [{ x: -1 }, { y: NaN }, { w: 13 }, { h: 0 }]) {
    const invalid = [{ ...blocks[0], layout: { ...blocks[0].layout, ...patch } }];
    assert.equal(compactMuralBlocks(invalid), invalid);
  }
});
