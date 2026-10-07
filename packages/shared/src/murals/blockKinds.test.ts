import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "../library/merge.js";
import { BLOCK_TYPES, blockBooks, blockLabel, blockReferences, createBlockCandidate, ensureBookBlockHeights, isConfigurable, muralBlockTitle, rekeyBlocks, scrubBooksFromMurals, type BlockType, type Mural, type MuralBlock } from "./murals.js";

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

test("blockReferences collects what each block type points at", () => {
  const refs = blockReferences([
    { id: "1", type: "spotlight", bookKey: "a" },
    { id: "2", type: "shelf", title: "", bookKeys: ["b", "", 3] },
    { id: "3", type: "shelf", title: "", bookKeys: ["ignored"], collectionId: "g1" },
    { id: "4", type: "quote", bookKey: "c", highlightId: "h1" },
    { id: "5", type: "quote", bookKey: "", highlightId: "", mode: "rediscover" },
    { id: "6", type: "quoteCollection", title: "", quotes: [{ bookKey: "d", highlightId: "h2" }, { bookKey: "e" }, null] },
    { id: "7", type: "image", imageId: "img" },
    { id: "8", type: "image", imageId: "" },
    { id: "9", type: "stats", metrics: ["totalBooks", 4] },
    { id: "10", type: "currentlyReading" },
    { id: "11", type: "profile", bio: "", favoriteGenres: [] },
    { id: "12", type: "readerCard" },
    { id: "13", type: "tierlist", tierlistId: "t" },
    { id: "14", type: "text" },
    { id: "15", type: "empty" }
  ]);
  assert.deepEqual([...refs.bookKeys], ["a", "b", "c", "d", "e"]);
  assert.deepEqual([...refs.collectionIds], ["g1"]);
  assert.deepEqual(refs.highlightRefs, [{ bookKey: "c", highlightId: "h1" }, { bookKey: "d", highlightId: "h2" }]);
  assert.deepEqual([...refs.imageIds], ["img"]);
  assert.deepEqual([...refs.statsMetrics], ["totalBooks"]);
  assert.equal(refs.needsCurrentlyReading, true);
  assert.equal(refs.needsShelfTheme, true);
  assert.equal(refs.needsReaderCard, true);
});

test("blockReferences skips anything it doesn't recognise and never throws", () => {
  const none = blockReferences([]);
  assert.deepEqual(blockReferences("nope"), none);
  assert.deepEqual(blockReferences(null), none);
  assert.deepEqual(blockReferences([
    null, 3, "x", [], { type: 7 }, { type: "toString" }, { type: "constructor" }, { type: "hologram", bookKey: "z" },
    { type: "spotlight", bookKey: 5 }, { type: "shelf", bookKeys: "a" }, { type: "quoteCollection", quotes: {} }, { type: "stats", metrics: "x" }
  ]), none);
});

test("a tier list block contributes no book keys, whatever extra fields it carries", () => {
  const refs = blockReferences([{ id: "1", type: "tierlist", tierlistId: "t", tiers: [{ id: "s", bookKeys: ["old"] }], pool: ["p"] }]);
  assert.equal(refs.bookKeys.size, 0);
});

const from = new Set(["old"]);

test("rekeyBlocks rewrites every book reference a block can hold and de-duplicates", () => {
  const blocks = [
    { id: "1", type: "spotlight", bookKey: "old" },
    { id: "2", type: "shelf", title: "", bookKeys: ["old", "new", "x"] },
    { id: "3", type: "quote", bookKey: "old", highlightId: "h1" },
    { id: "4", type: "quoteCollection", title: "", quotes: [{ bookKey: "old", highlightId: "h1" }, { bookKey: "new", highlightId: "h1" }, { bookKey: "x", highlightId: "h2" }] },
    { id: "5", type: "tierlist", tierlistId: "t" },
    { id: "6", type: "text", body: "old" }
  ];
  assert.deepEqual(rekeyBlocks(blocks, from, "new"), [
    { id: "1", type: "spotlight", bookKey: "new" },
    { id: "2", type: "shelf", title: "", bookKeys: ["new", "x"] },
    { id: "3", type: "quote", bookKey: "new", highlightId: "h1" },
    { id: "4", type: "quoteCollection", title: "", quotes: [{ bookKey: "new", highlightId: "h1" }, { bookKey: "x", highlightId: "h2" }] },
    { id: "5", type: "tierlist", tierlistId: "t" },
    { id: "6", type: "text", body: "old" }
  ]);
});

test("rekeyBlocks passes anything it doesn't recognise through untouched", () => {
  assert.equal(rekeyBlocks("nope", from, "new"), "nope");
  const odd = [null, 3, { type: "toString" }, { type: "hologram", bookKey: "old" }, { type: "spotlight", bookKey: 5 }, { type: "shelf", bookKeys: "old" }];
  assert.deepEqual(rekeyBlocks(odd, from, "new"), odd);
  const inlineTiers = [{ id: "1", type: "tierlist", tierlistId: "t", tiers: [{ id: "s", bookKeys: ["old"] }], pool: ["old"] }];
  assert.deepEqual(rekeyBlocks(inlineTiers, from, "new"), inlineTiers);
});

const at = { x: 0, y: 0, w: 1, h: 1 };
const muralOf = (blocks: MuralBlock[]): Mural[] => [{ id: "m1", name: "M", theme: "light", blocks, createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null }];

test("scrub removes a spotlight or quote that points at a deleted book", () => {
  const [mural] = scrubBooksFromMurals(muralOf([
    { id: "b1", type: "spotlight", layout: at, bookKey: "gone" },
    { id: "b2", type: "quote", layout: at, bookKey: "gone", highlightId: "h1" },
    { id: "b3", type: "spotlight", layout: at, bookKey: "kept" }
  ]), ["gone"]);
  assert.deepEqual(mural.blocks.map((b) => b.id), ["b3"]);
});

test("scrub trims shelf and quote collection members and drops them only once empty", () => {
  const [mural] = scrubBooksFromMurals(muralOf([
    { id: "s1", type: "shelf", layout: { x: 2, y: 5, w: 8, h: 3 }, title: "Top", bookKeys: ["gone", "a", "b"] },
    { id: "s2", type: "shelf", layout: at, title: "One", bookKeys: ["gone"] },
    { id: "q1", type: "quoteCollection", layout: at, title: "Q", quotes: [{ bookKey: "gone", highlightId: "h1" }, { bookKey: "a", highlightId: "h2" }] }
  ]), ["gone"]);
  const shelf = mural.blocks.find((b) => b.id === "s1") as Extract<MuralBlock, { type: "shelf" }>;
  const quotes = mural.blocks.find((b) => b.id === "q1") as Extract<MuralBlock, { type: "quoteCollection" }>;
  assert.deepEqual(shelf.bookKeys, ["a", "b"]);
  assert.deepEqual(shelf.layout, { x: 2, y: 5, w: 8, h: 3 });
  assert.equal(mural.blocks.some((b) => b.id === "s2"), false);
  assert.deepEqual(quotes.quotes, [{ bookKey: "a", highlightId: "h2" }]);
});

test("scrub leaves survivors at their authored coordinates", () => {
  const [mural] = scrubBooksFromMurals(muralOf([
    { id: "spot", type: "spotlight", layout: { x: 0, y: 0, w: 4, h: 3 }, bookKey: "gone" },
    { id: "shelf", type: "shelf", layout: { x: 0, y: 3, w: 8, h: 3 }, title: "S", bookKeys: ["gone", "a"] }
  ]), ["gone"]);
  assert.deepEqual(mural.blocks.map((b) => [b.id, b.layout.y]), [["shelf", 3]]);
});

test("scrub never touches a collection shelf, a rediscover quote or a tier list", () => {
  const blocks: MuralBlock[] = [
    { id: "c", type: "shelf", layout: at, title: "", bookKeys: ["gone"], collectionId: "g" },
    { id: "r", type: "quote", layout: at, bookKey: "", highlightId: "", mode: "rediscover" },
    { id: "t", type: "tierlist", layout: at, tierlistId: "list" }
  ];
  const murals = muralOf(blocks);
  assert.equal(scrubBooksFromMurals(murals, ["gone", ""]), murals);
});

test("scrub returns the same array when nothing is affected or no keys are given", () => {
  const murals = muralOf([{ id: "b", type: "spotlight", layout: at, bookKey: "kept" }]);
  assert.equal(scrubBooksFromMurals(murals, ["other"]), murals);
  assert.equal(scrubBooksFromMurals(murals, []), murals);
});

test("blockBooks returns the books each block draws, each once, in draw order", () => {
  const books = ["A", "B", "C", "D"].map((Title, i) => ({ Title, Attribution: "X", ReadStatus: i === 2 ? 1 : 0, _workId: `w${i}`, highlights: [] }));
  const key = (i: number) => bookKey(books[i]);
  assert.deepEqual(blockBooks(make("spotlight", { bookKey: key(1) }), books), [books[1]]);
  assert.deepEqual(blockBooks(make("spotlight", { bookKey: "missing" }), books), []);
  assert.deepEqual(blockBooks(make("shelf", { bookKeys: [key(3), "missing", key(0)] }), books), [books[3], books[0]]);
  assert.deepEqual(blockBooks(make("shelf", { bookKeys: [key(1), key(1)] }), books), [books[1]]);
  assert.deepEqual(blockBooks(make("quote", { bookKey: key(0), highlightId: "h" }), books), [books[0]]);
  assert.deepEqual(blockBooks(make("quoteCollection", { quotes: [{ bookKey: key(1), highlightId: "1" }, { bookKey: key(1), highlightId: "2" }, { bookKey: key(3), highlightId: "3" }] }), books), [books[1], books[3]]);
  assert.deepEqual(blockBooks(make("currentlyReading"), books), [books[2]]);
  const tiers = () => ({ tiers: [{ id: "s", label: "S", color: "red", workIds: ["w3", "missing"] }], pool: ["w0", "w3"] });
  assert.deepEqual(blockBooks(make("tierlist", { tierlistId: "t" }), books, tiers), [books[3], books[0]]);
  assert.deepEqual(blockBooks(make("tierlist", { tierlistId: "t" }), books, () => undefined), []);
  assert.deepEqual(blockBooks(make("tierlist", { tierlistId: "t" }), books), []);
  for (const type of ["image", "text", "profile", "stats", "empty", "readerCard"] as const) assert.deepEqual(blockBooks(make(type), books), []);
});
