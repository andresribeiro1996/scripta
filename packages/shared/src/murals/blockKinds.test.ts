import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "../library/merge.js";
import { BLOCK_TYPES, blockLabel, createBlockCandidate, ensureBookBlockHeights, isConfigurable, muralBlockTitle, type BlockType, type MuralBlock } from "./murals.js";

const make = (type: BlockType, extra: Record<string, unknown> = {}) => ({ ...createBlockCandidate(type, []), ...extra }) as MuralBlock;

test("every block type has a label and a default block of its own type", () => {
  assert.equal(BLOCK_TYPES.length, 12);
  for (const type of BLOCK_TYPES) {
    assert.ok(blockLabel(type));
    assert.equal(createBlockCandidate(type, []).type, type);
  }
});

test("only currentlyReading, empty and readerCard have nothing to configure", () => {
  assert.deepEqual(BLOCK_TYPES.filter((type) => !isConfigurable(type)), ["currentlyReading", "empty", "readerCard"]);
});

test("a new currentlyReading block already meets its minimum height", () => {
  const blocks = [createBlockCandidate("currentlyReading", [])];
  assert.equal(blocks[0].layout.h, 6);
  assert.equal(ensureBookBlockHeights(blocks), blocks);
});

test("muralBlockTitle names a block by its content and falls back to its label", () => {
  const books = [{ Title: "Dune", Attribution: "Frank Herbert" }];
  assert.equal(muralBlockTitle(make("text"), books), "Note");
  assert.equal(muralBlockTitle(make("shelf"), books), "Shelf");
  assert.equal(muralBlockTitle(make("shelf", { title: "Top 5" }), books), "Top 5");
  assert.equal(muralBlockTitle(make("spotlight", { bookKey: bookKey(books[0]) }), books), "Dune");
  assert.equal(muralBlockTitle(make("tierlist"), books, "Best of"), "Best of");
  assert.equal(muralBlockTitle(make("stats"), books), "Stats");
});
