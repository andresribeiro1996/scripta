// Exercises lib/murals.ts — mural/block CRUD, the two scrub-on-delete
// helpers, and the resolve* helpers block renderers use.
// Run with:
//   npx tsx scripts/test-murals.mts

import {
  addBlock,
  clearMuralCover,
  compactBlocksVertically,
  createMural,
  createTier,
  deleteMural,
  duplicateBlock,
  removeBlock,
  renameMural,
  resolveQuote,
  resolveQuoteCollection,
  resolveShelfBooks,
  scrubBooksFromMurals,
  scrubImageFromMurals,
  setMuralCover,
  updateBlock,
  type Mural,
  type MuralBlock
} from "../src/lib/murals";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("1. createMural / renameMural / deleteMural");
{
  let murals = createMural([], "  2026 Year in Books  ");
  check("trims the name", murals[0].name === "2026 Year in Books");
  check("starts with no blocks", murals[0].blocks.length === 0);
  const id = murals[0].id;
  murals = renameMural(murals, id, "Renamed");
  check("renamed", murals[0].name === "Renamed");
  murals = renameMural(murals, id, "   ");
  check("blank rename is a no-op", murals[0].name === "Renamed");
  murals = deleteMural(murals, id);
  check("deleted", murals.length === 0);
}

console.log("\n2. addBlock — lands below existing blocks, never overlapping");
{
  let murals = createMural([], "M");
  const muralId = murals[0].id;
  const first = addBlock(murals, muralId, "text");
  murals = first.murals;
  check("first block at y=0", murals[0].blocks[0].layout.y === 0);
  const second = addBlock(murals, muralId, "stats");
  murals = second.murals;
  const [b1, b2] = murals[0].blocks;
  check("second block starts at/after the first's bottom edge", b2.layout.y >= b1.layout.y + b1.layout.h);
  check("addBlock returns the new block's id", second.blockId === b2.id);
}

console.log("\n3. updateBlock / removeBlock");
{
  let murals = createMural([], "M");
  const muralId = murals[0].id;
  const { murals: m2, blockId } = addBlock(murals, muralId, "spotlight");
  murals = m2;
  const configured: MuralBlock = { ...murals[0].blocks[0], bookKey: "ta:some book|author" } as MuralBlock;
  murals = updateBlock(murals, muralId, configured);
  check("block updated", (murals[0].blocks[0] as { bookKey: string }).bookKey === "ta:some book|author");
  murals = removeBlock(murals, muralId, blockId);
  check("block removed", murals[0].blocks.length === 0);
}

function muralWithBlocks(blocks: MuralBlock[]): Mural[] {
  return [{ id: "m1", name: "M", blocks, createdAt: "t", updatedAt: "t" }];
}

console.log("\n4. scrubBooksFromMurals — spotlight/quote pointing straight at a deleted book are removed");
{
  const murals = muralWithBlocks([
    { id: "b1", type: "spotlight", layout: { x: 0, y: 0, w: 1, h: 1 }, bookKey: "ta:deleted|a" },
    { id: "b2", type: "quote", layout: { x: 0, y: 0, w: 1, h: 1 }, bookKey: "ta:deleted|a", highlightId: "h1" },
    { id: "b3", type: "spotlight", layout: { x: 0, y: 0, w: 1, h: 1 }, bookKey: "ta:kept|b" }
  ]);
  const result = scrubBooksFromMurals(murals, ["ta:deleted|a"]);
  check("spotlight referencing the deleted book is gone", !result[0].blocks.some((b) => b.id === "b1"));
  check("quote referencing the deleted book is gone", !result[0].blocks.some((b) => b.id === "b2"));
  check("spotlight referencing an unrelated book survives", result[0].blocks.some((b) => b.id === "b3"));
}

console.log("\n5. scrubBooksFromMurals — shelf/quoteCollection filter members, only dropped if left empty");
{
  const murals = muralWithBlocks([
    { id: "shelf1", type: "shelf", layout: { x: 0, y: 0, w: 1, h: 1 }, title: "Top 5", bookKeys: ["ta:deleted|a", "ta:kept|b", "ta:kept2|c"] },
    { id: "shelf2", type: "shelf", layout: { x: 0, y: 0, w: 1, h: 1 }, title: "Only one", bookKeys: ["ta:deleted|a"] },
    {
      id: "qc1",
      type: "quoteCollection",
      layout: { x: 0, y: 0, w: 1, h: 1 },
      title: "Quotes",
      quotes: [
        { bookKey: "ta:deleted|a", highlightId: "h1" },
        { bookKey: "ta:kept|b", highlightId: "h2" }
      ]
    }
  ]);
  const result = scrubBooksFromMurals(murals, ["ta:deleted|a"]);
  const shelf1 = result[0].blocks.find((b) => b.id === "shelf1") as Extract<MuralBlock, { type: "shelf" }>;
  check("shelf1 keeps its two other members", shelf1.bookKeys.length === 2 && !shelf1.bookKeys.includes("ta:deleted|a"));
  check("shelf2 (would be empty) is removed entirely", !result[0].blocks.some((b) => b.id === "shelf2"));
  const qc1 = result[0].blocks.find((b) => b.id === "qc1") as Extract<MuralBlock, { type: "quoteCollection" }>;
  check("quoteCollection keeps its other quote", qc1.quotes.length === 1 && qc1.quotes[0].bookKey === "ta:kept|b");
}

console.log("\n6. scrubBooksFromMurals — a true no-op (same array reference) when nothing is affected");
{
  const murals = muralWithBlocks([{ id: "b1", type: "spotlight", layout: { x: 0, y: 0, w: 1, h: 1 }, bookKey: "ta:unrelated|z" }]);
  const result = scrubBooksFromMurals(murals, ["ta:not-referenced-anywhere|q"]);
  check("same murals array reference back", result === murals);
}

console.log("\n7. scrubImageFromMurals — removes only the image block(s) using the deleted image, leaves others alone");
{
  const murals = muralWithBlocks([
    { id: "img1", type: "image", layout: { x: 0, y: 0, w: 1, h: 1 }, imageId: "gallery-1" },
    { id: "img2", type: "image", layout: { x: 0, y: 0, w: 1, h: 1 }, imageId: "gallery-2" },
    { id: "txt1", type: "text", layout: { x: 0, y: 0, w: 1, h: 1 }, heading: "Hi" }
  ]);
  const result = scrubImageFromMurals(murals, "gallery-1");
  check("img1 removed", !result[0].blocks.some((b) => b.id === "img1"));
  check("img2 (different image) survives", result[0].blocks.some((b) => b.id === "img2"));
  check("text block untouched", result[0].blocks.some((b) => b.id === "txt1"));

  const noop = scrubImageFromMurals(result, "gallery-does-not-exist");
  check("no-op returns the same array reference", noop === result);
}

console.log("\n8. resolveShelfBooks / resolveQuote / resolveQuoteCollection — silently drop dangling references");
{
  const books = [
    { Title: "Kept Book", Attribution: "Author K", highlights: [{ BookmarkID: "h1", Text: "A great line" }] },
    { Title: "Other Book", Attribution: "Author O", highlights: [] }
  ];
  const shelfBlock: Extract<MuralBlock, { type: "shelf" }> = {
    id: "s1",
    type: "shelf",
    layout: { x: 0, y: 0, w: 1, h: 1 },
    title: "Shelf",
    bookKeys: ["ta:kept book|author k", "ta:does-not-exist|nobody", "ta:other book|author o"]
  };
  const resolvedShelf = resolveShelfBooks(shelfBlock, books);
  check("resolves the two real books, drops the dangling one, preserves order", resolvedShelf.length === 2 && resolvedShelf[0].Title === "Kept Book" && resolvedShelf[1].Title === "Other Book");

  const quoteBlock: Extract<MuralBlock, { type: "quote" }> = {
    id: "q1",
    type: "quote",
    layout: { x: 0, y: 0, w: 1, h: 1 },
    bookKey: "ta:kept book|author k",
    highlightId: "h1"
  };
  const resolvedQuote = resolveQuote(quoteBlock, books);
  check("resolves the book + highlight", resolvedQuote?.book.Title === "Kept Book" && (resolvedQuote?.highlight as { Text: string } | undefined)?.Text === "A great line");

  const missingHighlightBlock: Extract<MuralBlock, { type: "quote" }> = { ...quoteBlock, highlightId: "does-not-exist" };
  check("returns null when the highlight id doesn't exist on the book", resolveQuote(missingHighlightBlock, books) === null);

  const missingBookBlock: Extract<MuralBlock, { type: "quote" }> = { ...quoteBlock, bookKey: "ta:gone|nobody" };
  check("returns null when the book itself doesn't resolve", resolveQuote(missingBookBlock, books) === null);

  const qcBlock: Extract<MuralBlock, { type: "quoteCollection" }> = {
    id: "qc1",
    type: "quoteCollection",
    layout: { x: 0, y: 0, w: 1, h: 1 },
    title: "Faves",
    quotes: [
      { bookKey: "ta:kept book|author k", highlightId: "h1" },
      { bookKey: "ta:gone|nobody", highlightId: "h9" }
    ]
  };
  const resolvedQc = resolveQuoteCollection(qcBlock, books);
  check("resolves only the valid entry, drops the dangling one", resolvedQc.length === 1 && resolvedQc[0].book.Title === "Kept Book");
}

console.log("\n9. setMuralCover / clearMuralCover — direct counterparts to lib/bookCovers.ts's setBookCover/clearBookCover");
{
  let murals = createMural([], "M");
  const muralId = murals[0].id;
  check("starts with no cover", murals[0].coverImageId === undefined && murals[0].coverImageUrl === undefined);

  murals = setMuralCover(murals, muralId, "gallery-1", "https://example.com/gallery-1.webp");
  check("cover id set", murals[0].coverImageId === "gallery-1");
  check("cover url set", murals[0].coverImageUrl === "https://example.com/gallery-1.webp");

  murals = clearMuralCover(murals, muralId);
  check("clearMuralCover drops both fields, not just one", !("coverImageId" in murals[0]) && !("coverImageUrl" in murals[0]));
}

console.log("\n10. scrubImageFromMurals — also clears a mural's OWN cover, not just its image blocks");
{
  const murals: Mural[] = [
    {
      id: "m1",
      name: "Cover Test",
      blocks: [{ id: "img1", type: "image", layout: { x: 0, y: 0, w: 1, h: 1 }, imageId: "gallery-2" }],
      createdAt: "t",
      updatedAt: "t",
      coverImageId: "gallery-1",
      coverImageUrl: "https://example.com/gallery-1.webp"
    }
  ];
  const result = scrubImageFromMurals(murals, "gallery-1");
  check("the mural's cover fields are cleared", !("coverImageId" in result[0]) && !("coverImageUrl" in result[0]));
  check("an unrelated image block (different image) is untouched", result[0].blocks.some((b) => b.id === "img1"));

  // The reverse: deleting an image used by an Image BLOCK, not the cover —
  // the cover must survive untouched.
  const result2 = scrubImageFromMurals(murals, "gallery-2");
  check("deleting the image-block's image leaves the mural's own cover untouched", result2[0].coverImageId === "gallery-1");
  check("...and removes the now-dangling image block", !result2[0].blocks.some((b) => b.id === "img1"));

  const noop = scrubImageFromMurals(murals, "gallery-does-not-exist");
  check("no-op (neither the cover nor any block referenced it) returns the same array reference", noop === murals);
}

console.log("\n11. compactBlocksVertically — closes gaps by sliding blocks up, never sideways");
{
  // Two blocks stacked in one column, a gap between them (block 2 sits
  // well below block 1's bottom edge, as if something used to occupy
  // the space between).
  const stacked: MuralBlock[] = [
    { id: "top", type: "text", layout: { x: 0, y: 0, w: 4, h: 2 } },
    { id: "bottom", type: "text", layout: { x: 0, y: 6, w: 4, h: 2 } }
  ];
  const compactedStack = compactBlocksVertically(stacked);
  const bottom = compactedStack.find((b) => b.id === "bottom")!;
  check("the lower block slides up to sit right below the upper one, closing the gap", bottom.layout.y === 2);
  check("x/w/h are untouched — only y moves", bottom.layout.x === 0 && bottom.layout.w === 4 && bottom.layout.h === 2);

  // Two blocks SIDE BY SIDE at the same y — compaction must not shove one
  // into the other just because there's "room" if you ignored x.
  const sideBySide: MuralBlock[] = [
    { id: "left", type: "text", layout: { x: 0, y: 0, w: 4, h: 2 } },
    { id: "right", type: "text", layout: { x: 4, y: 0, w: 4, h: 2 } }
  ];
  const compactedSide = compactBlocksVertically(sideBySide);
  check(
    "two blocks already side by side at y=0 both stay at y=0 — no false collision across columns",
    compactedSide.every((b) => b.layout.y === 0)
  );

  // Three stacked blocks, the middle one gone — the bottom one should
  // slide up to sit right below the top one (not stop short, not
  // overshoot past it).
  const threeMinusMiddle: MuralBlock[] = [
    { id: "top", type: "text", layout: { x: 0, y: 0, w: 4, h: 2 } },
    { id: "bottom", type: "text", layout: { x: 0, y: 10, w: 4, h: 2 } }
  ];
  const result = compactBlocksVertically(threeMinusMiddle);
  check("bottom slides all the way up to right below top, not just partway", result.find((b) => b.id === "bottom")!.layout.y === 2);
}

console.log("\n12. removeBlock — closes the gap the removed block leaves behind");
{
  let murals = muralWithBlocks([
    { id: "top", type: "text", layout: { x: 0, y: 0, w: 4, h: 2 }, heading: "Top" },
    { id: "bottom", type: "text", layout: { x: 0, y: 2, w: 4, h: 2 }, heading: "Bottom" }
  ]);
  murals = removeBlock(murals, "m1", "top");
  const bottom = murals[0].blocks.find((b) => b.id === "bottom") as Extract<MuralBlock, { type: "text" }>;
  check("removing the top block slides the bottom one up to close the gap", bottom.layout.y === 0);

  check("removing a block that doesn't exist is a true no-op (same array reference)", removeBlock(murals, "m1", "does-not-exist") === murals);
}

console.log("\n13. scrubBooksFromMurals — closes gaps left by a fully-removed block, but NOT for a mere member trim");
{
  const murals = muralWithBlocks([
    { id: "spot1", type: "spotlight", layout: { x: 0, y: 0, w: 4, h: 3 }, bookKey: "ta:deleted|a" },
    { id: "shelf1", type: "shelf", layout: { x: 0, y: 3, w: 8, h: 3 }, title: "Shelf", bookKeys: ["ta:deleted|a", "ta:kept|b"] }
  ]);
  const result = scrubBooksFromMurals(murals, ["ta:deleted|a"]);
  const shelf1 = result[0].blocks.find((b) => b.id === "shelf1") as Extract<MuralBlock, { type: "shelf" }>;
  check("spotlight (fully removed) is gone", !result[0].blocks.some((b) => b.id === "spot1"));
  check("the shelf below it slides up to close the gap the spotlight left behind", shelf1.layout.y === 0);
  check("the shelf itself just lost one member, not the whole block", shelf1.bookKeys.length === 1 && shelf1.bookKeys[0] === "ta:kept|b");

  // Now the reverse: a shelf that only loses a MEMBER (stays as a block)
  // must NOT have its layout touched — nothing actually disappeared from
  // the canvas.
  const murals2 = muralWithBlocks([{ id: "shelf1", type: "shelf", layout: { x: 2, y: 5, w: 8, h: 3 }, title: "Shelf", bookKeys: ["ta:deleted|a", "ta:kept|b"] }]);
  const result2 = scrubBooksFromMurals(murals2, ["ta:deleted|a"]);
  const shelf2 = result2[0].blocks[0] as Extract<MuralBlock, { type: "shelf" }>;
  check("a shelf that merely lost a member keeps its exact original layout — no compaction triggered", shelf2.layout.x === 2 && shelf2.layout.y === 5);
}

console.log("\n14. scrubImageFromMurals — closes the gap an image block leaves behind");
{
  const murals: Mural[] = [
    {
      id: "m1",
      name: "M",
      createdAt: "t",
      updatedAt: "t",
      blocks: [
        { id: "img1", type: "image", layout: { x: 0, y: 0, w: 4, h: 3 }, imageId: "gallery-1" },
        { id: "txt1", type: "text", layout: { x: 0, y: 3, w: 4, h: 2 }, heading: "Below" }
      ]
    }
  ];
  const result = scrubImageFromMurals(murals, "gallery-1");
  const txt1 = result[0].blocks.find((b) => b.id === "txt1") as Extract<MuralBlock, { type: "text" }>;
  check("the image block is gone", !result[0].blocks.some((b) => b.id === "img1"));
  check("the text block below it slides up to close the gap", txt1.layout.y === 0);
}

console.log("\n15. addBlock — the 'empty' block type: a plain styled rectangle, no content fields at all");
{
  let murals = createMural([], "M");
  const muralId = murals[0].id;
  const { murals: m2, blockId } = addBlock(murals, muralId, "empty");
  murals = m2;
  const block = murals[0].blocks.find((b) => b.id === blockId)!;
  check("block type is 'empty'", block.type === "empty");
  check("carries only the base fields (id/layout/style) — nothing content-specific", Object.keys(block).sort().join(",") === "id,layout,type");
  check("gets a real, non-zero default footprint like every other type", block.layout.w > 0 && block.layout.h > 0);
}

console.log("\n16. duplicateBlock — same type/content/style, a fresh id, lands below everything at the ORIGINAL's own size");
{
  const murals = muralWithBlocks([
    {
      id: "spot1",
      type: "spotlight",
      layout: { x: 2, y: 0, w: 6, h: 5 }, // resized away from the type's default (w:3,h:4) — the duplicate must match THIS, not the default
      bookKey: "ta:some book|author",
      caption: "My favorite",
      style: { cardRadius: 20 } as MuralBlock["style"]
    },
    { id: "other", type: "text", layout: { x: 0, y: 5, w: 4, h: 2 }, heading: "Below" }
  ]);
  const result = duplicateBlock(murals, "m1", "spot1");
  check("a new block was added — one more than before", result[0].blocks.length === 3);

  const original = result[0].blocks.find((b) => b.id === "spot1") as Extract<MuralBlock, { type: "spotlight" }>;
  const duplicate = result[0].blocks.find((b) => b.id !== "spot1" && b.id !== "other") as Extract<MuralBlock, { type: "spotlight" }>;
  check("the original is completely untouched", original.bookKey === "ta:some book|author" && original.caption === "My favorite" && original.layout.x === 2 && original.layout.y === 0);
  check("the duplicate got a genuinely new id, not the same one", duplicate.id !== "spot1" && duplicate.id.length > 0);
  check("the duplicate copied the type/content/style exactly", duplicate.type === "spotlight" && duplicate.bookKey === "ta:some book|author" && duplicate.caption === "My favorite" && duplicate.style?.cardRadius === 20);
  check(
    "the duplicate's SIZE matches the original's actual (resized) footprint, not the type's default",
    duplicate.layout.w === 6 && duplicate.layout.h === 5
  );
  check("the duplicate lands below every existing block, not overlapping anything", duplicate.layout.y >= 7);

  check("duplicating a block id that doesn't exist is a true no-op (same array reference)", duplicateBlock(result, "m1", "does-not-exist") === result);
  check("duplicating into a mural id that doesn't exist is also a true no-op", duplicateBlock(result, "does-not-exist", "spot1") === result);
}

console.log("\n17. addBlock — the 'tierlist' block type: 5 default tiers, each empty with a unique id");
{
  let murals = createMural([], "M");
  const muralId = murals[0].id;
  const { murals: m2, blockId } = addBlock(murals, muralId, "tierlist");
  murals = m2;
  const block = murals[0].blocks.find((b) => b.id === blockId) as Extract<MuralBlock, { type: "tierlist" }>;
  check("block type is 'tierlist'", block.type === "tierlist");
  check("starts with no title", block.title === "");
  check("starts with 5 default tiers", block.tiers.length === 5);
  check("default tiers are labeled S/A/B/C/D in order", block.tiers.map((t) => t.label).join("") === "SABCD");
  check("every default tier starts empty", block.tiers.every((t) => t.bookKeys.length === 0));
  check("the evaluation pool starts empty too", block.pool.length === 0);
  check("every default tier has its own unique id", new Set(block.tiers.map((t) => t.id)).size === 5);
  const tier = createTier("Custom", "#123456");
  check("createTier builds a fresh, empty, id-bearing tier", tier.label === "Custom" && tier.color === "#123456" && tier.bookKeys.length === 0 && tier.id.length > 0);
  check("createTier ids don't collide with the block's own default tiers", !block.tiers.some((t) => t.id === tier.id));
}

console.log("\n18. scrubBooksFromMurals — tierlist: deleted books drop off their own tier or the pool, block survives while anything remains anywhere");
{
  const murals = muralWithBlocks([
    {
      id: "tl1",
      type: "tierlist",
      layout: { x: 0, y: 0, w: 10, h: 8 },
      title: "Ranked",
      tiers: [
        { id: "s", label: "S", color: "#c9482f", bookKeys: ["ta:deleted|a", "ta:kept|b"] },
        { id: "a", label: "A", color: "#d98a3d", bookKeys: ["ta:untouched|c"] }
      ],
      pool: ["ta:pooled-deleted|d", "ta:pooled-kept|e"]
    }
  ]);
  const originalBlock = murals[0].blocks.find((b) => b.id === "tl1") as Extract<MuralBlock, { type: "tierlist" }>;
  const result = scrubBooksFromMurals(murals, ["ta:deleted|a", "ta:pooled-deleted|d"]);
  const block = result[0].blocks.find((b) => b.id === "tl1") as Extract<MuralBlock, { type: "tierlist" }>;
  check("the deleted book's key is gone from its tier", !block.tiers[0].bookKeys.includes("ta:deleted|a"));
  check("a surviving book on the same tier is untouched", block.tiers[0].bookKeys.includes("ta:kept|b"));
  check("a tier with no affected books is completely untouched (same array reference)", block.tiers[1] === originalBlock.tiers[1]);
  check("the deleted book's key is gone from the pool too", !block.pool.includes("ta:pooled-deleted|d"));
  check("a surviving book in the pool is untouched", block.pool.includes("ta:pooled-kept|e"));

  // Emptying every tier AND the pool removes the block entirely — same
  // "nothing left to show" convention as a shelf/quoteCollection left
  // with zero members, extended to cover the pool as just as real a
  // reference as a tier's own bookKeys.
  const stillHasPool = scrubBooksFromMurals(murals, ["ta:deleted|a", "ta:kept|b", "ta:untouched|c"]);
  check(
    "emptying every tier but leaving books in the pool keeps the block",
    stillHasPool[0].blocks.some((b) => b.id === "tl1")
  );
  const emptied = scrubBooksFromMurals(murals, ["ta:deleted|a", "ta:kept|b", "ta:untouched|c", "ta:pooled-deleted|d", "ta:pooled-kept|e"]);
  check("once every tier AND the pool are empty, the whole block is removed", !emptied[0].blocks.some((b) => b.id === "tl1"));

  check("scrubbing a book nothing references (tier or pool) is a true no-op (same array reference)", scrubBooksFromMurals(murals, ["ta:nobody-has-this|z"]) === murals);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
