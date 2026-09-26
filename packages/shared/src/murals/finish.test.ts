import assert from "node:assert/strict";
import { test } from "node:test";
import { createShelfSession, favouriteOpponent, promoteFavourite, shelfAfterFinish } from "./finish.js";
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

test("running it twice is stable — and the second run is a pure no-op", () => {
  const once = shelfAfterFinish([shelf("f", "finished", ["a"], 0)], "b", 5).blocks;
  const twice = shelfAfterFinish(once, "b", 5);
  assert.equal(twice.blocks, once);
  assert.deepEqual(twice.landed, ["finished"]);
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

test("promoteFavourite is a no-op (same reference) when already at the front", () => {
  const blocks = [shelf("v", "favourites", ["b", "x"], 0)];
  assert.equal(promoteFavourite(blocks, "b"), blocks);
});

function fakeShelf(bookKeys: string[]): MuralBlock[] {
  return [shelf("f", "finished", bookKeys, 0)];
}

test("createShelfSession serializes a rating then a promote, keeping the promotion", async () => {
  let blocks: MuralBlock[] = [shelf("f", "finished", ["a"], 0), shelf("v", "favourites", ["x"], 5)];
  const session = createShelfSession({
    load: async () => ({ id: "m1", blocks, updatedAt: "t0" }),
    save: async (_id, next) => { blocks = next; return {}; },
    onChange: () => {}
  });
  await Promise.all([session.finish("b", 5), session.promote("b")]);
  assert.deepEqual(keysOf(blocks, "favourites"), ["b", "x"]);
});

test("restore after a queued rating doesn't let the rating re-add the book", async () => {
  let blocks = fakeShelf(["a"]);
  let saveCalls = 0;
  const session = createShelfSession({
    load: async () => ({ id: "m1", blocks, updatedAt: "t0" }),
    save: async (_id, next) => { saveCalls++; blocks = next; return {}; },
    onChange: () => {}
  });
  const finishing = session.finish("b", null);
  const restoring = session.restore();
  await Promise.all([finishing, restoring]);
  assert.equal(saveCalls, 0);
  assert.deepEqual(keysOf(blocks, "finished"), ["a"]);
});

test("restore before load resolves still restores (nothing saved)", async () => {
  const original = fakeShelf(["a"]);
  let resolveLoad!: (result: { id: string; blocks: MuralBlock[]; updatedAt?: string }) => void;
  const loadPromise = new Promise<{ id: string; blocks: MuralBlock[]; updatedAt?: string }>((resolve) => { resolveLoad = resolve; });
  let saveCalls = 0;
  const session = createShelfSession({
    load: () => loadPromise,
    save: async (_id, next) => { saveCalls++; return {}; },
    onChange: () => {}
  });
  const finishing = session.finish("b", null);
  const restoring = session.restore();
  resolveLoad({ id: "m1", blocks: original, updatedAt: "t0" });
  const [, restored] = await Promise.all([finishing, restoring]);
  assert.equal(saveCalls, 0);
  assert.equal(restored, true);
});

test("no save when nothing changed", async () => {
  const blocks = fakeShelf(["b", "a"]);
  let saveCalls = 0;
  const session = createShelfSession({
    load: async () => ({ id: "m1", blocks, updatedAt: "t0" }),
    save: async (_id, next) => { saveCalls++; return {}; },
    onChange: () => {}
  });
  await session.finish("b", null);
  assert.equal(saveCalls, 0);
});

test("updatedAt threads from load into saves, then from each save into the next", async () => {
  let blocks = fakeShelf(["a"]);
  const seenUpdatedAt: Array<string | undefined> = [];
  const session = createShelfSession({
    load: async () => ({ id: "m1", blocks, updatedAt: "t0" }),
    save: async (_id, next, updatedAt) => {
      seenUpdatedAt.push(updatedAt);
      blocks = next;
      return { updatedAt: `t${seenUpdatedAt.length}` };
    },
    onChange: () => {}
  });
  await session.finish("b", 4);
  await session.finish("c", 4);
  assert.deepEqual(seenUpdatedAt, ["t0", "t1"]);
});

test("a failed save surfaces to the caller", async () => {
  const blocks = fakeShelf(["a"]);
  const session = createShelfSession({
    load: async () => ({ id: "m1", blocks, updatedAt: "t0" }),
    save: async () => { throw new Error("boom"); },
    onChange: () => {}
  });
  await assert.rejects(session.finish("b", null), /boom/);
});
