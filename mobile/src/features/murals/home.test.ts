import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey, buildHomeBlocks, eligiblePassages, pinPassage, rediscoverPassage, resolveHomeBlock, scrubBooksFromMurals, type Group, type Mural, type MuralBlock } from "@scripta/shared";

const book = { Title: "One", Attribution: "Author", highlights: [
  { BookmarkID: "passage", Type: "highlight", Text: "A passage" },
  { BookmarkID: "review", Type: "review", Text: "My review" },
  { BookmarkID: "note", Type: "note", Text: "My note" },
  { BookmarkID: "legacy", Text: "Unknown origin" },
  { BookmarkID: "blank", Type: "highlight", Text: "  " },
  null
] };
const other = { Title: "Two", Attribution: "Author", highlights: [{ BookmarkID: "second", Type: "highlight", Text: "Another passage" }] };
const books = [book, other];
const layout = { x: 2, y: 8, w: 8, h: 7 };

test("rediscovery excludes reviews, notes, malformed and ambiguous highlights, and pins exact references", () => {
  assert.deepEqual(eligiblePassages([book]), [{ bookKey: bookKey(book), highlightId: "passage" }]);
  const block: MuralBlock = { id: "quote", type: "quote", mode: "rediscover", bookKey: "", highlightId: "", layout };
  const first = rediscoverPassage(block.id, books, "2026-09-09")!;
  assert.deepEqual(rediscoverPassage(block.id, [...books].reverse(), "2026-09-09"), first);
  assert.notDeepEqual(rediscoverPassage(block.id, books, "2026-09-09", 1), first);
  assert.equal(rediscoverPassage(block.id, [], "2026-09-09"), undefined);
  const resolved = resolveHomeBlock(block, books, [], "2026-09-09");
  const pinned = pinPassage(block, resolved, books);
  assert.deepEqual(resolveHomeBlock(pinned, books, [], "2027-01-01"), pinned);
  assert.deepEqual(pinned.layout, layout);
  assert.equal(block.mode, "rediscover");
});

test("collection shelves follow membership and preserve title/layout; missing sources stay empty", () => {
  const group: Group = { id: "collection", name: "Up next", type: "collection", bookKeys: [bookKey(other), bookKey(book)], createdAt: "", updatedAt: "" };
  const shelf: MuralBlock = { id: "shelf", type: "shelf", title: "", bookKeys: [], collectionId: group.id, layout };
  const resolved = resolveHomeBlock(shelf, books, [group], "");
  assert.equal(resolved.type, "shelf");
  if (resolved.type !== "shelf") return;
  assert.deepEqual(resolved.bookKeys, group.bookKeys);
  assert.equal(resolved.title, "Up next");
  assert.deepEqual(resolved.layout, layout);
  assert.deepEqual(resolveHomeBlock({ ...shelf, title: "Mine" }, books, [{ ...group, name: "Renamed" }], "").type, "shelf");
  const missing = resolveHomeBlock(shelf, books, [], "");
  assert.ok(missing.type === "shelf" && missing.bookKeys.length === 0);
  const manual = { ...shelf, collectionId: undefined, bookKeys: [bookKey(book)] };
  assert.equal(resolveHomeBlock(manual, books, [], ""), manual);
  const mural = { blocks: [shelf] } as Mural;
  assert.equal(scrubBooksFromMurals([mural], [bookKey(book)])[0], mural);
});

test("starter is editable, leaves Up next intentional, and includes passages only when available", () => {
  assert.equal(buildHomeBlocks(false).some((block) => block.type === "quote"), false);
  const blocks = buildHomeBlocks(true);
  assert.equal(blocks.length, 4);
  assert.ok(blocks.some((block) => block.type === "shelf" && block.bookKeys.length === 0));
  assert.equal(new Set(blocks.map((block) => block.id)).size, blocks.length);
});
