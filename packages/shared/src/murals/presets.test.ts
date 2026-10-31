import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "../library/merge.js";
import { readerIdentity } from "../library/readerIdentity.js";
import { buildMuralPreset, muralPresets, presetAvailability, shelfPresetSummary } from "./presets.js";
import { DEFAULT_BLOCK_STYLE } from "../library/libraryStyle.js";
import { ensureBookBlockHeights, updateBlock, type Mural, type MuralBlock } from "./murals.js";

const book = (title: string, fields: Record<string, unknown> = {}) => ({ Title: title, Attribution: "Author", ...fields });
const key = (title: string) => `ta:${title.toLowerCase()}|author`;
const passage = { Type: "highlight", Text: "A line worth keeping.", BookmarkID: "h1" };

const library = [
  book("Reading One", { ReadStatus: 1 }),
  book("Old Finish", { ReadStatus: 2, DateLastRead: "2024-03-01", Rating: 5 }),
  book("New Finish", { ReadStatus: 2, DateLastRead: "2026-09-01", Rating: 4, highlights: [passage] }),
  book("Undated Finish", { ReadStatus: 2, Rating: 3 }),
  book("To Read", { ReadStatus: 0, DateCreated: "2026-01-01" })
];

function shelves(blocks: MuralBlock[]) {
  return blocks.filter((block): block is Extract<MuralBlock, { type: "shelf" }> => block.type === "shelf");
}

test("every preset is in English with the spec's names and descriptions", () => {
  assert.deepEqual(muralPresets("en").map(({ id, name, description }) => ({ id, name, description })), [
    { id: "best", name: "All-time favourites", description: "The books that stayed with you." },
    { id: "recent", name: "Recently finished", description: "Your last pages, newest first." },
    { id: "next", name: "Want to read", description: "Stories waiting their turn." },
    { id: "shelf", name: "My shelf", description: "What you're reading, what you've finished, and a passage to revisit." }
  ]);
});

test("no preset produces an empty block or a text block narrower than 6 columns", () => {
  for (const { id } of muralPresets("en")) {
    for (const block of buildMuralPreset(id, library, "en").blocks) {
      if (block.type === "text") assert.ok(block.layout.w >= 6, `${id}: text block is ${block.layout.w} wide`);
      if (block.type === "shelf") assert.ok(block.bookKeys.length > 0, `${id}: empty shelf`);
      if (block.type === "spotlight") assert.ok(block.bookKey, `${id}: empty spotlight`);
    }
  }
});

test("best keeps only books rated 4 or 5, highest first", () => {
  const { blocks, bookCount } = buildMuralPreset("best", library, "en");
  assert.equal(bookCount, 2);
  const spotlight = blocks.find((block) => block.type === "spotlight");
  assert.equal(spotlight?.type === "spotlight" ? spotlight.bookKey : "", key("Old Finish"));
});

test("presetAvailability explains why a preset would be empty", () => {
  assert.equal(presetAvailability("best", [book("Unrated")], "en"), "Needs books rated 4 or 5");
  assert.equal(presetAvailability("recent", [book("Unread", { ReadStatus: 0 })], "en"), "Needs finished books");
  assert.equal(presetAvailability("next", [book("Done", { ReadStatus: 2 })], "en"), "Needs books on your to-read list");
  assert.equal(presetAvailability("shelf", [], "en"), "Needs books in your library");
  for (const { id } of muralPresets("en")) assert.equal(presetAvailability(id, library, "en"), null);
});

test("the My shelf preset stacks profile, stats, reading, finished, then passage and favourites side by side", () => {
  const { blocks } = buildMuralPreset("shelf", library, "en");
  assert.deepEqual(blocks.map((block) => block.type), ["profile", "stats", "currentlyReading", "shelf", "quote", "shelf"]);
  const [finished, favourites] = shelves(blocks);
  assert.equal(finished.role, "finished");
  assert.equal(finished.title, "Finished");
  assert.deepEqual(finished.bookKeys, [key("New Finish"), key("Old Finish"), key("Undated Finish")]);
  assert.equal(favourites.role, "favourites");
  assert.equal(favourites.title, "Favourites");
  assert.deepEqual(favourites.bookKeys, [key("Old Finish"), key("New Finish")]);
  const quote = blocks.find((block) => block.type === "quote")!;
  assert.equal(quote.type === "quote" ? quote.mode : undefined, "rediscover");
  assert.equal(quote.layout.y, favourites.layout.y);
  assert.equal(quote.layout.w + favourites.layout.w, 12);
  const stats = blocks.find((block) => block.type === "stats")!;
  assert.deepEqual(stats.type === "stats" ? stats.metrics : [], ["totalBooks", "booksFinished", "booksInProgress"]);
  assert.equal(stats.layout.h, 4);
  const profile = blocks.find((block) => block.type === "profile")!;
  assert.equal(profile.layout.h, 5);
  const reading = blocks.find((block) => block.type === "currentlyReading")!;
  assert.equal(reading.layout.h, 6);
  assert.equal(finished.layout.y, reading.layout.y + 6);
  assert.equal(ensureBookBlockHeights(blocks), blocks);
});

test("the My shelf preset leaves out blocks with no data and widens a lone bottom block", () => {
  const { blocks } = buildMuralPreset("shelf", [book("Just Finished", { ReadStatus: 2, Rating: 2 })], "en");
  assert.deepEqual(blocks.map((block) => block.type), ["profile", "stats", "shelf"]);
  const onlyFavourite = buildMuralPreset("shelf", [book("Loved", { Rating: 5 })], "en").blocks.at(-1)!;
  assert.equal(onlyFavourite.type === "shelf" ? onlyFavourite.role : undefined, "favourites");
  assert.equal(onlyFavourite.layout.w, 12);
});

test("preset blocks never overlap", () => {
  for (const { id } of muralPresets("en")) {
    const { blocks } = buildMuralPreset(id, library, "en");
    for (const a of blocks) for (const b of blocks) {
      if (a === b) continue;
      const overlap = a.layout.x < b.layout.x + b.layout.w && b.layout.x < a.layout.x + a.layout.w && a.layout.y < b.layout.y + b.layout.h && b.layout.y < a.layout.y + a.layout.h;
      assert.ok(!overlap, `${id}: ${a.type} overlaps ${b.type}`);
    }
  }
});

test("preset blocks follow the theme: no colour or chrome overrides, only the heading's display font", () => {
  for (const { id } of muralPresets("en")) {
    for (const block of buildMuralPreset(id, library, "en").blocks) {
      if (block.type === "text") assert.deepEqual(block.style, { ...DEFAULT_BLOCK_STYLE, fontFamily: "playfairDisplay" }, `${id}: heading style`);
      else assert.equal(block.style, undefined, `${id}: ${block.type} has a style override`);
    }
  }
});

test("shelfPresetSummary counts the reader's books", () => {
  assert.equal(shelfPresetSummary(library, false, "en"), "Made from your 5 books: 1 you're reading and 3 you've finished. Only you can see it.");
  assert.equal(shelfPresetSummary([book("One", { ReadStatus: 1 })], false, "en"), "Made from your 1 book: 1 you're reading and 0 you've finished. Only you can see it.");
});

test("shelfPresetSummary warns a published profile that visitors will see the kept shelf", () => {
  assert.equal(shelfPresetSummary(library, true, "en"), "Made from your 5 books: 1 you're reading and 3 you've finished. Keep this shelf to show it on your published page.");
});

test("editing a shelf block through updateBlock keeps its role", () => {
  const shelf = buildMuralPreset("shelf", library, "en").blocks.find((block) => block.type === "shelf")!;
  const mural: Mural = { id: "m1", name: "My shelf", theme: "light", blocks: [shelf], createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null };
  const edited = shelf.type === "shelf" ? { ...shelf, title: "Read in 2026" } : shelf;
  const [saved] = updateBlock([mural], "m1", edited)[0].blocks;
  assert.equal(saved.type === "shelf" ? saved.role : undefined, "finished");
});

test("the My shelf preset places a settled reader card beside stats, below the profile", () => {
  const books = Array.from({ length: 10 }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2 }));
  const groups = [{ id: "g", type: "series" as const, name: "S", bookKeys: books.slice(0, 3).map(bookKey), createdAt: "", updatedAt: "" }];
  const blocks = buildMuralPreset("shelf", books, "en", groups).blocks;
  const card = blocks.find((block) => block.type === "readerCard");
  const stats = blocks.find((block) => block.type === "stats")!;
  const profile = blocks.find((block) => block.type === "profile")!;
  assert.ok(card, "settled card is placed");
  const cardBottom = profile.layout.y + profile.layout.h;
  assert.deepEqual(card!.layout, { x: 0, y: cardBottom, w: 6, h: 6 });
  assert.deepEqual(stats.layout, { x: 6, y: cardBottom, w: 6, h: 6 });
  assert.equal(buildMuralPreset("shelf", books.slice(0, 4), "en", []).blocks.some((block) => block.type === "readerCard"), false);
});

test("the My shelf preset omits a reader card while leaning", () => {
  const seriesBooks = Array.from({ length: 3 }, (_, i) => ({ Title: `Series ${i}`, Attribution: `Author ${i}`, ReadStatus: 2 }));
  const otherBooks = Array.from({ length: 9 }, (_, i) => ({ Title: `Standalone ${i}`, Attribution: `Author ${i + 3}`, ReadStatus: 2 }));
  const books = [...seriesBooks, ...otherBooks];
  const groups = [{ id: "g", type: "series" as const, name: "S", bookKeys: seriesBooks.map(bookKey), createdAt: "", updatedAt: "" }];
  assert.equal(readerIdentity(books, groups, "en").state, "leaning");
  assert.equal(buildMuralPreset("shelf", books, "en", groups).blocks.some((block) => block.type === "readerCard"), false);
});

test("a Portuguese preset writes its names and block titles in Portuguese", () => {
  assert.deepEqual(muralPresets("pt-PT").map(({ name }) => name), ["Favoritos de sempre", "Lidos recentemente", "Quero ler", "A minha estante"]);
  assert.equal(presetAvailability("recent", [book("Unread", { ReadStatus: 0 })], "pt-PT"), "Precisa de livros lidos");
  const shelf = buildMuralPreset("shelf", library, "pt-PT");
  assert.equal(shelf.name, "A minha estante");
  assert.deepEqual(shelves(shelf.blocks).map((block) => block.title), ["Lidos", "Favoritos"]);
  assert.equal(shelfPresetSummary([book("One", { ReadStatus: 1 })], false, "pt-PT"), "Feito a partir do seu 1 livro: 1 que está a ler e 0 que já leu. Só você a pode ver.");
});
