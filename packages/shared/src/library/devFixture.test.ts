import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { eligiblePassages } from "../murals/home.js";
import { buildMuralPreset } from "../murals/presets.js";
import { genresForBook } from "./bookGenres.js";
import type { Group } from "./groups.js";
import { bookKey } from "./merge.js";

type Book = Record<string, unknown>;
const fixture = JSON.parse(readFileSync(new URL("../../../../scripts/fixtures/library.json", import.meta.url), "utf8")) as { books: Book[]; groups: Group[] };

const validIsbn13 = (isbn: string) => /^97[89]\d{10}$/.test(isbn) && [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0) % 10 === 0;

test("every fixture ISBN has a valid check digit", () => {
  assert.deepEqual(fixture.books.filter((book) => !validIsbn13(String(book.ISBN))).map((book) => book.Title), []);
});

test("every group key names a fixture book", () => {
  const keys = new Set(fixture.books.map(bookKey));
  assert.deepEqual(fixture.groups.flatMap((group) => group.bookKeys.filter((key) => !keys.has(key))), []);
});

test("every fixture book carries known genres, so none waits on a network genre lookup", () => {
  const unknown = fixture.books.filter((book) => !Array.isArray(book._genres) || genresForBook(book).length !== book._genres.length);
  assert.deepEqual(unknown.map((book) => book.Title), []);
});

test("every finished fixture book has a rating and a read date", () => {
  const bare = fixture.books.filter((book) => book.ReadStatus === 2 && (typeof book.Rating !== "number" || typeof book.DateLastRead !== "string"));
  assert.deepEqual(bare.map((book) => book.Title), []);
});

test("the fixture's shelf preset has a reader card, a passage and favourites", () => {
  const blocks = buildMuralPreset("shelf", fixture.books, "en", fixture.groups).blocks;
  assert.deepEqual(blocks.map((block) => (block.type === "shelf" ? `shelf:${block.title}` : block.type)), ["profile", "readerCard", "stats", "currentlyReading", "shelf:Finished", "quote", "shelf:Favourites"]);
  assert.equal(eligiblePassages(fixture.books).length, 4);
});
