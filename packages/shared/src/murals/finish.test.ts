import assert from "node:assert/strict";
import { test } from "node:test";
import { favouriteOpponent, promoteFavourite, shelfAfterFinish } from "./finish.js";
import type { MuralBlock } from "./murals.js";

const shelf = (id: string, role: "finished" | "favourites" | undefined, bookKeys: string[], y: number): MuralBlock =>
  ({ id, type: "shelf", title: id, bookKeys, layout: { x: 0, y, w: 12, h: 5 }, ...(role ? { role } : {}) });
const text: MuralBlock = { id: "t", type: "text", heading: "Hi", layout: { x: 0, y: 0, w: 12, h: 3 } };

function keysOf(blocks: MuralBlock[], role: "finished" | "favourites") {
  const block = blocks.find((b) => b.type === "shelf" && b.role === role);
  return block?.type === "shelf" ? block.bookKeys : undefined;
}

test("a blank or hand-made shelf is never modified", () => {
  const blocks = [text, shelf("mine", undefined, ["a"], 3)];
  const result = shelfAfterFinish(blocks, "b", 5);
  assert.equal(result.blocks, blocks);
  assert.deepEqual(result.landed, []);
});

test("the finished book moves to the front of Finished, deduped", () => {
  const blocks = [text, shelf("f", "finished", ["a", "b", "c"], 3)];
  const result = shelfAfterFinish(blocks, "b", null);
  assert.deepEqual(keysOf(result.blocks, "finished"), ["b", "a", "c"]);
  assert.deepEqual(result.landed, ["finished"]);
});

test("a 4 or 5 with no Favourites shelf appends one below the lowest block", () => {
  const blocks = [text, shelf("f", "finished", ["a"], 3)];
  const result = shelfAfterFinish(blocks, "b", 4);
  assert.deepEqual(keysOf(result.blocks, "favourites"), ["b"]);
  const favourites = result.blocks.at(-1)!;
  assert.equal(favourites.layout.y, 8);
  assert.equal(favourites.layout.w, 12);
  assert.deepEqual(result.landed, ["finished", "favourites"]);
});

test("a 3 or an existing Favourites shelf adds nothing to Favourites", () => {
  assert.equal(keysOf(shelfAfterFinish([shelf("f", "finished", [], 0)], "b", 3).blocks, "favourites"), undefined);
  const withFavourites = [shelf("f", "finished", [], 0), shelf("v", "favourites", ["x"], 5)];
  const result = shelfAfterFinish(withFavourites, "b", 5);
  assert.deepEqual(keysOf(result.blocks, "favourites"), ["x"]);
  assert.deepEqual(result.landed, ["finished"]);
});

test("running it twice is stable", () => {
  const once = shelfAfterFinish([shelf("f", "finished", ["a"], 0)], "b", 5).blocks;
  const twice = shelfAfterFinish(once, "b", 5).blocks;
  assert.deepEqual(twice.map((b) => b.type === "shelf" ? b.bookKeys : []), once.map((b) => b.type === "shelf" ? b.bookKeys : []));
});

test("favouriteOpponent returns the first favourite that isn't the book", () => {
  const blocks = [shelf("v", "favourites", ["b", "x", "y"], 0)];
  assert.equal(favouriteOpponent(blocks, "b"), "x");
  assert.equal(favouriteOpponent([shelf("v", "favourites", ["b"], 0)], "b"), null);
  assert.equal(favouriteOpponent([text], "b"), null);
});

test("promoteFavourite moves or inserts the book at the front of Favourites", () => {
  assert.deepEqual(keysOf(promoteFavourite([shelf("v", "favourites", ["x", "b"], 0)], "b"), "favourites"), ["b", "x"]);
  assert.deepEqual(keysOf(promoteFavourite([shelf("v", "favourites", ["x"], 0)], "b"), "favourites"), ["b", "x"]);
});
