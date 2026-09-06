import {
  addBlock,
  clearMuralCover,
  createBlockCandidate,
  createDuplicateCandidate,
  findAvailableLayout,
  isValidBlockLayout,
  removeBlock,
  resolveQuote,
  resolveQuoteCollection,
  resolveShelfBooks,
  screenPointToGrid,
  scrubBooksFromMurals,
  scrubImageFromMurals,
  setMuralCover,
  updateBlock,
  type Mural,
  type MuralBlock
} from "../src/lib/murals";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

function muralWithBlocks(blocks: MuralBlock[]): Mural[] {
  return [{ id: "m1", name: "Mural", blocks, createdAt: "t", updatedAt: "t", shareToken: null, shareUrl: null, folderId: null }];
}

console.log("1. Layout validation and placement");
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

console.log("\n3. Add, update and duplicate candidates");
{
  let murals = muralWithBlocks([]);
  const added = addBlock(murals, "m1", "text");
  murals = added.murals;
  check("adds a block with the returned id", murals[0].blocks[0].id === added.blockId);
  const changed = { ...murals[0].blocks[0], layout: { x: 3, y: 4, w: 5, h: 3 } } as MuralBlock;
  murals = updateBlock(murals, "m1", changed);
  check("updates layout without replacing identity", murals[0].blocks[0].id === added.blockId && murals[0].blocks[0].layout.x === 3);
  const candidate = createBlockCandidate("stats", murals[0].blocks);
  check("new candidate is valid and not persisted", isValidBlockLayout(candidate.layout, murals[0].blocks) && murals[0].blocks.length === 1);
  const duplicate = createDuplicateCandidate(changed, murals[0].blocks);
  check("duplicate has fresh identity and matching dimensions", duplicate.id !== changed.id && duplicate.layout.w === 5 && duplicate.layout.h === 3);
}

console.log("\n4. Removal preserves intentional whitespace");
{
  const bottom: MuralBlock = { id: "bottom", type: "text", layout: { x: 0, y: 8, w: 4, h: 2 }, heading: "Bottom" };
  let murals = muralWithBlocks([
    { id: "top", type: "text", layout: { x: 0, y: 0, w: 4, h: 2 }, heading: "Top" },
    bottom
  ]);
  murals = removeBlock(murals, "m1", "top");
  check("survivor keeps exact coordinates", murals[0].blocks[0] === bottom && murals[0].blocks[0].layout.y === 8);
  check("missing block is a true no-op", removeBlock(murals, "m1", "missing") === murals);
}

console.log("\n5. Scrubbing references preserves survivor coordinates");
{
  const shelf: MuralBlock = { id: "shelf", type: "shelf", layout: { x: 2, y: 7, w: 8, h: 3 }, title: "Shelf", bookKeys: ["gone", "kept"] };
  const murals = muralWithBlocks([
    { id: "spot", type: "spotlight", layout: { x: 0, y: 0, w: 3, h: 4 }, bookKey: "gone" },
    shelf,
    { id: "image", type: "image", layout: { x: 8, y: 12, w: 4, h: 3 }, imageId: "gone-image" }
  ]);
  const booksScrubbed = scrubBooksFromMurals(murals, ["gone"]);
  const survivingShelf = booksScrubbed[0].blocks.find((block) => block.id === "shelf") as Extract<MuralBlock, { type: "shelf" }>;
  check("book-backed block disappears", !booksScrubbed[0].blocks.some((block) => block.id === "spot"));
  check("remaining shelf stays at its authored position", survivingShelf.layout.y === 7 && survivingShelf.bookKeys.join() === "kept");
  const imageScrubbed = scrubImageFromMurals(murals, "gone-image");
  check("image disappears without moving other blocks", imageScrubbed[0].blocks[0].layout.y === 0 && imageScrubbed[0].blocks[1].layout.y === 7);
}

console.log("\n6. Content resolvers tolerate missing references");
{
  const books = [{ Title: "Book", Attribution: "Author", highlights: [{ BookmarkID: "h1", Text: "Line" }] }];
  const shelf: Extract<MuralBlock, { type: "shelf" }> = { id: "s", type: "shelf", layout: { x: 0, y: 0, w: 4, h: 2 }, title: "S", bookKeys: ["ta:book|author", "missing"] };
  const quote: Extract<MuralBlock, { type: "quote" }> = { id: "q", type: "quote", layout: { x: 0, y: 0, w: 4, h: 2 }, bookKey: "ta:book|author", highlightId: "h1" };
  const collection: Extract<MuralBlock, { type: "quoteCollection" }> = { id: "c", type: "quoteCollection", layout: { x: 0, y: 0, w: 4, h: 2 }, title: "C", quotes: [{ bookKey: "ta:book|author", highlightId: "h1" }, { bookKey: "missing", highlightId: "h2" }] };
  check("shelf keeps only resolvable books", resolveShelfBooks(shelf, books).length === 1);
  check("quote resolves its highlight", resolveQuote(quote, books)?.highlight.Text === "Line");
  check("collection keeps only resolvable quotes", resolveQuoteCollection(collection, books).length === 1);
}

console.log("\n7. Mural cover helpers");
{
  let murals = muralWithBlocks([]);
  murals = setMuralCover(murals, "m1", "image", "https://example.com/image.webp");
  check("sets both cover fields", murals[0].coverImageId === "image" && murals[0].coverImageUrl?.endsWith("image.webp") === true);
  murals = clearMuralCover(murals, "m1");
  check("clears both cover fields", !("coverImageId" in murals[0]) && !("coverImageUrl" in murals[0]));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
