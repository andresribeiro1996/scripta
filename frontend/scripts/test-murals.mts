// Exercises lib/murals.ts — mural/block CRUD, the image scrub-on-delete
// helper, and the resolve* helpers block renderers use.
// Run with:
//   npx tsx scripts/test-murals.mts

import {
  addBlock,
  clearMuralCover,
  createBlockCandidate,
  createDuplicateCandidate,
  createTier,
  duplicateBlock,
  ensureBookBlockHeights,
  findAvailableLayout,
  isValidBlockLayout,
  profileOnlyMural,
  removeBlock,
  resolveQuote,
  resolveQuoteCollection,
  resolveShelfBooks,
  screenPointToGrid,
  scrubImageFromMurals,
  setMuralCover,
  updateBlock,
  type Mural,
  type MuralBlock
} from "../src/lib/murals";

let muralSeq = 0;

/** Stands in for the createMural lib/murals.ts used to export.
 *
 *  It, renameMural and deleteMural were removed when a mural stopped
 *  being a field on the library blob and became its own backend row:
 *  creating, renaming and deleting one is now a request, and lives in
 *  hooks/useMurals.ts against modules/murals. Their tests went with
 *  them — this file covers the pure block/scrub/resolve logic that
 *  stayed — but the rest of the suite still needs a mural to operate
 *  on, which is all this builds. */
function makeMural(name = "M"): Mural[] {
  const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
  return [
    {
      id: `m${++muralSeq}`,
      name,
      theme: "light",
      blocks: [],
      createdAt: now,
      updatedAt: now,
      shareToken: null,
      shareUrl: null,
      folderId: null
    }
  ];
}

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

function muralWithBlocks(blocks: MuralBlock[]): Mural[] {
  return [{ id: "m1", name: "Mural", theme: "light", blocks, createdAt: "t", updatedAt: "t", shareToken: null, shareUrl: null, folderId: null }];
}

console.log("\n1. Layout validation and placement");
{
  const blocks: MuralBlock[] = [
    { id: "a", type: "text", layout: { x: 0, y: 0, w: 4, h: 2 }, heading: "A" },
    { id: "b", type: "text", layout: { x: 6, y: 3, w: 4, h: 2 }, heading: "B" }
  ];
  check("accepts free space", isValidBlockLayout({ x: 4, y: 0, w: 3, h: 2 }, blocks));
  check("rejects overlap", !isValidBlockLayout({ x: 3, y: 0, w: 3, h: 2 }, blocks));
  check("rejects the right edge", !isValidBlockLayout({ x: 10, y: 0, w: 3, h: 2 }, blocks));
  check("ignores the edited block", isValidBlockLayout({ x: 0, y: 0, w: 4, h: 2 }, blocks, "a"));
  const available = findAvailableLayout(blocks, 2, 2);
  check("finds the first top-row gap", available.x === 4 && available.y === 0);
}

console.log("\n2. Screen coordinates map to the rendered grid");
{
  check("top-left padding maps to 0,0", JSON.stringify(screenPointToGrid(10, 10)) === JSON.stringify({ x: 0, y: 0 }));
  check("one full column step maps to column 1", screenPointToGrid(109.17, 10).x === 1);
  check("one row step maps to row 1", screenPointToGrid(10, 48).y === 1);
  check("coordinates clamp at the left edge", screenPointToGrid(-100, 10).x === 0);
}

console.log("\n2b. Multi-book blocks have enough height for full covers");
{
  const blocks: MuralBlock[] = [
    { id: "shelf", type: "shelf", layout: { x: 0, y: 0, w: 6, h: 3 }, title: "Shelf", bookKeys: [] },
    { id: "reading", type: "currentlyReading", layout: { x: 6, y: 0, w: 4, h: 3 } },
    { id: "below", type: "text", layout: { x: 0, y: 3, w: 4, h: 2 }, heading: "Below" }
  ];
  const upgraded = ensureBookBlockHeights(blocks);
  check("short shelves reach 4 rows and short currently-reading blocks reach 6", upgraded[0].layout.h === 4 && upgraded[1].layout.h === 6);
  check("blocks below move once without overlap", upgraded[2].layout.y === 6);
  check("height upgrade is idempotent", ensureBookBlockHeights(upgraded) === upgraded);
}

console.log("\n3. addBlock — first free slot, never overlapping");
{
  let murals = makeMural();
  const muralId = murals[0].id;
  const first = addBlock(murals, muralId, "text");
  murals = first.murals;
  check("first block at the origin", JSON.stringify(murals[0].blocks[0].layout) === JSON.stringify({ x: 0, y: 0, w: 4, h: 2 }));
  const second = addBlock(murals, muralId, "stats");
  murals = second.murals;
  const [b1, b2] = murals[0].blocks;
  check("second block takes the free slot beside the first, not below it", JSON.stringify(b2.layout) === JSON.stringify({ x: 4, y: 0, w: 6, h: 2 }));
  check("second block does not overlap the first", isValidBlockLayout(b2.layout, [b1]));
  check("addBlock returns the new block's id", second.blockId === b2.id);

  const withGap = muralWithBlocks([
    { id: "a", type: "text", layout: { x: 4, y: 0, w: 8, h: 2 }, heading: "A" },
    { id: "b", type: "text", layout: { x: 0, y: 2, w: 12, h: 2 }, heading: "B" }
  ]);
  const inGap = addBlock(withGap, "m1", "text");
  const gapBlock = inGap.murals[0].blocks.find((b) => b.id === inGap.blockId)!;
  check("a gap at the top-left takes the new block", JSON.stringify(gapBlock.layout) === JSON.stringify({ x: 0, y: 0, w: 4, h: 2 }));

  const full = muralWithBlocks([
    { id: "a", type: "text", layout: { x: 0, y: 0, w: 12, h: 2 }, heading: "A" },
    { id: "b", type: "text", layout: { x: 0, y: 2, w: 6, h: 2 }, heading: "B" },
    { id: "c", type: "text", layout: { x: 6, y: 2, w: 6, h: 2 }, heading: "C" }
  ]);
  const appended = addBlock(full, "m1", "stats");
  const appendedBlock = appended.murals[0].blocks.find((b) => b.id === appended.blockId)!;
  check("with no fitting gap the block goes at x=0 below the last row", JSON.stringify(appendedBlock.layout) === JSON.stringify({ x: 0, y: 4, w: 6, h: 2 }));
}

console.log("\n4. updateBlock / removeBlock");
{
  let murals = makeMural();
  const muralId = murals[0].id;
  const { murals: m2, blockId } = addBlock(murals, muralId, "spotlight");
  murals = m2;
  const configured: MuralBlock = { ...murals[0].blocks[0], bookKey: "ta:some book|author" } as MuralBlock;
  murals = updateBlock(murals, muralId, configured);
  check("block updated", (murals[0].blocks[0] as { bookKey: string }).bookKey === "ta:some book|author");
  murals = removeBlock(murals, muralId, blockId);
  check("block removed", murals[0].blocks.length === 0);
}

console.log("\n5. Placement candidates — mobile placement mode's pure helpers");
{
  let murals = muralWithBlocks([]);
  const added = addBlock(murals, "m1", "text");
  murals = added.murals;
  const changed = { ...murals[0].blocks[0], layout: { x: 3, y: 4, w: 5, h: 3 } } as MuralBlock;
  const candidate = createBlockCandidate("stats", murals[0].blocks);
  check("new candidate is valid and not persisted", isValidBlockLayout(candidate.layout, murals[0].blocks) && murals[0].blocks.length === 1);
  const duplicate = createDuplicateCandidate(changed, murals[0].blocks);
  check("duplicate has fresh identity and matching dimensions", duplicate.id !== changed.id && duplicate.layout.w === 5 && duplicate.layout.h === 3);
}

console.log("\n6. addBlock — the 'empty' block type: a plain styled rectangle, no content fields at all");
{
  let murals = makeMural();
  const muralId = murals[0].id;
  const { murals: m2, blockId } = addBlock(murals, muralId, "empty");
  murals = m2;
  const block = murals[0].blocks.find((b) => b.id === blockId)!;
  check("block type is 'empty'", block.type === "empty");
  check("carries only the base fields (id/layout/style) — nothing content-specific", Object.keys(block).sort().join(",") === "id,layout,type");
  check("gets a real, non-zero default footprint like every other type", block.layout.w > 0 && block.layout.h > 0);
}

console.log("\n7. duplicateBlock — same type/content/style, a fresh id, first free slot at the ORIGINAL's own size");
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
  check("the duplicate is placed in the first free slot, not overlapping anything", JSON.stringify(duplicate.layout) === JSON.stringify({ x: 4, y: 5, w: 6, h: 5 }) && isValidBlockLayout(duplicate.layout, [original, result[0].blocks.find((b) => b.id === "other")!]));

  const gapMural = muralWithBlocks([
    { id: "orig", type: "text", layout: { x: 4, y: 0, w: 4, h: 2 }, heading: "Orig" },
    { id: "right", type: "text", layout: { x: 8, y: 0, w: 4, h: 2 }, heading: "Right" },
    { id: "bottom", type: "text", layout: { x: 0, y: 2, w: 12, h: 2 }, heading: "Bottom" }
  ]);
  const gapCopy = duplicateBlock(gapMural, "m1", "orig")[0].blocks.find((b) => !["orig", "right", "bottom"].includes(b.id))!;
  check("a gap at the top-left takes the duplicate", JSON.stringify(gapCopy.layout) === JSON.stringify({ x: 0, y: 0, w: 4, h: 2 }));

  check("duplicating a block id that doesn't exist is a true no-op (same array reference)", duplicateBlock(result, "m1", "does-not-exist") === result);
  check("duplicating into a mural id that doesn't exist is also a true no-op", duplicateBlock(result, "does-not-exist", "spot1") === result);
}

console.log("\n8. addBlock — the 'tierlist' block type: a reference, not an inline ladder");
{
  // A mural's tier-list block USED to carry its own tiers and pool
  // inline, and this section tested those five default rows. A tier
  // list is its own resource now (api/tierlists.ts, backed by
  // modules/tierlists) and the block holds only the id of one — the
  // same list can appear in several murals, and editing it in Arena
  // updates all of them. What's worth pinning down is that a new block
  // starts UNLINKED rather than inventing a tier list of its own.
  let murals = makeMural();
  const muralId = murals[0].id;
  const { murals: m2, blockId } = addBlock(murals, muralId, "tierlist");
  murals = m2;
  const block = murals[0].blocks.find((b) => b.id === blockId) as Extract<MuralBlock, { type: "tierlist" }>;
  check("block type is 'tierlist'", block.type === "tierlist");
  check("starts unlinked, so the config panel asks which list to show", block.tierlistId === "");
  check("carries no tiers of its own", !("tiers" in block));
  check("lands at the tierlist default footprint", block.layout.w === 10 && block.layout.h === 8);

  // createTier stayed in lib/murals.ts even though the tiers moved:
  // TierListEditorPage.tsx's "New tier" button is its one caller.
  const tier = createTier("Custom", "#123456");
  check("createTier builds a fresh, empty, id-bearing tier", tier.label === "Custom" && tier.color === "#123456" && tier.workIds.length === 0 && tier.id.length > 0);
  check("createTier ids are unique per call", createTier("A", "#000").id !== createTier("A", "#000").id);
}

console.log("\n12. removeBlock — whitespace is authored content, survivors keep their exact coordinates");
{
  // Compaction (compactBlocksVertically) used to close the gap a removed
  // block left behind. It's gone by design: a mural is an authored wall,
  // and deliberate gaps/alignment must survive deletion. See the mobile
  // mural editor plan for the decision.
  let murals = muralWithBlocks([
    { id: "top", type: "text", layout: { x: 0, y: 0, w: 4, h: 2 }, heading: "Top" },
    { id: "bottom", type: "text", layout: { x: 0, y: 2, w: 4, h: 2 }, heading: "Bottom" }
  ]);
  const bottom = murals[0].blocks[1];
  murals = removeBlock(murals, "m1", "top");
  check("removing the top block leaves the bottom one at its authored y", murals[0].blocks[0] === bottom && murals[0].blocks[0].layout.y === 2);

  check("removing a block that doesn't exist is a true no-op (same array reference)", removeBlock(murals, "m1", "does-not-exist") === murals);
}

console.log("\n14. scrubImageFromMurals — removes only the image block(s) using the deleted image, leaves others alone");
{
  const murals = muralWithBlocks([
    { id: "img1", type: "image", layout: { x: 0, y: 0, w: 1, h: 1 }, imageId: "gallery-1" },
    { id: "img2", type: "image", layout: { x: 0, y: 0, w: 1, h: 1 }, imageId: "gallery-2" },
    { id: "txt1", type: "text", layout: { x: 0, y: 3, w: 4, h: 2 }, heading: "Below" }
  ]);
  const result = scrubImageFromMurals(murals, "gallery-1");
  check("img1 removed", !result[0].blocks.some((b) => b.id === "img1"));
  check("img2 (different image) survives", result[0].blocks.some((b) => b.id === "img2"));
  check("text block untouched, at its authored position", result[0].blocks.some((b) => b.id === "txt1" && b.layout.y === 3));

  const noop = scrubImageFromMurals(result, "gallery-does-not-exist");
  check("no-op returns the same array reference", noop === result);
}

console.log("\n15. resolveShelfBooks / resolveQuote / resolveQuoteCollection — silently drop dangling references");
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

console.log("\n16. setMuralCover / clearMuralCover — direct counterparts to lib/bookCovers.ts's setBookCover/clearBookCover");
{
  let murals = makeMural();
  const muralId = murals[0].id;
  check("starts with no cover", murals[0].coverImageId === undefined && murals[0].coverImageUrl === undefined);

  murals = setMuralCover(murals, muralId, "gallery-1", "https://example.com/gallery-1.webp");
  check("cover id set", murals[0].coverImageId === "gallery-1");
  check("cover url set", murals[0].coverImageUrl === "https://example.com/gallery-1.webp");

  murals = clearMuralCover(murals, muralId);
  check("clearMuralCover drops both fields, not just one", !("coverImageId" in murals[0]) && !("coverImageUrl" in murals[0]));
}

console.log("\n17. scrubImageFromMurals — also clears a mural's OWN cover, not just its image blocks");
{
  const murals: Mural[] = [
    {
      id: "m1",
      name: "Cover Test",
      theme: "light",
      blocks: [{ id: "img1", type: "image", layout: { x: 0, y: 0, w: 1, h: 1 }, imageId: "gallery-2" }],
      createdAt: "t",
      updatedAt: "t",
      shareToken: null,
      shareUrl: null,
      folderId: null,
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

{
  const mural = profileOnlyMural("dark");
  check("profileOnlyMural holds one profile block", mural.blocks.length === 1 && mural.blocks[0]?.type === "profile");
  check("profileOnlyMural takes the theme it is given", mural.theme === "dark");
  check("spanning the full grid, three rows tall", JSON.stringify(mural.blocks[0]?.layout) === JSON.stringify({ x: 0, y: 0, w: 12, h: 3 }));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
