import assert from "node:assert/strict";
import { test } from "node:test";
import type { LibraryBook } from "@scripta/shared";
import {
  LIBRARY_SHARE_LAYOUTS,
  newestFinished,
  readingNow,
  shelfShareBooks,
  summaryCoverBooks,
  wallColumns
} from "./libraryShareBooks.js";

function book(Title: string, ReadStatus: number, DateLastRead?: string): LibraryBook {
  return { Title, ReadStatus, DateLastRead };
}

const titles = (books: LibraryBook[]) => books.map((b) => b.Title);

test("newestFinished orders finished books newest first", () => {
  const books = [
    book("A", 2, "2026-01-05"),
    book("B", 2, "2026-03-01"),
    book("C", 2, "2025-12-31"),
    book("D", 1, "2026-04-01")
  ];
  assert.deepEqual(titles(newestFinished(books, 5)), ["B", "A", "C"]);
});

test("newestFinished puts undated finished books last in input order", () => {
  const books = [book("U1", 2), book("A", 2, "2026-01-05"), book("U2", 2, "")];
  assert.deepEqual(titles(newestFinished(books, 5)), ["A", "U1", "U2"]);
});

test("newestFinished stops at the limit", () => {
  const books = ["01", "02", "03", "04", "05", "06"].map((m) => book(`M${m}`, 2, `2026-${m}-10`));
  const picked = newestFinished(books, 5);
  assert.equal(picked.length, 5);
  assert.ok(!titles(picked).includes("M01"));
});

test("summaryCoverBooks takes the four newest finished", () => {
  const books = ["01", "02", "03", "04", "05"].map((m) => book(`M${m}`, 2, `2026-${m}-10`));
  assert.deepEqual(titles(summaryCoverBooks(books)), ["M05", "M04", "M03", "M02"]);
});

test("summaryCoverBooks falls back to library order with nothing finished", () => {
  const books = ["a", "b", "c", "d", "e"].map((t) => book(t, 0));
  assert.deepEqual(titles(summaryCoverBooks(books)), ["a", "b", "c", "d"]);
});

test("summaryCoverBooks returns what exists with fewer than four finished", () => {
  const books = [book("X", 0), book("F1", 2, "2026-01-01"), book("Y", 0), book("F2", 2, "2026-02-01"), book("Z", 0)];
  assert.deepEqual(titles(summaryCoverBooks(books)), ["F2", "F1"]);
});

test("readingNow keeps library order", () => {
  const books = [book("R2", 1), book("X", 0), book("R1", 1)];
  assert.deepEqual(titles(readingNow(books)), ["R2", "R1"]);
});

test("shelfShareBooks applies shelf, search and sort", () => {
  const books = [book("Dune", 2), book("Emma", 2), book("Dune Messiah", 1), book("Children of Dune", 2)];
  assert.deepEqual(titles(shelfShareBooks(books, "dune", "finished", "title")), ["Children of Dune", "Dune"]);
});

test("LIBRARY_SHARE_LAYOUTS lists the four layouts in order", () => {
  assert.deepEqual(
    LIBRARY_SHARE_LAYOUTS.map((layout) => layout.label),
    ["Wall", "Summary", "Reading", "This shelf"]
  );
});

test("wallColumns grows with the library to bound wall height", () => {
  assert.equal(wallColumns(0), 8);
  assert.equal(wallColumns(500), 8);
  assert.equal(wallColumns(1000), 12);
  assert.equal(wallColumns(5000), 25);
});
