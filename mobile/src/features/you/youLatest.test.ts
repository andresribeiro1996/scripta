import assert from "node:assert/strict";
import test from "node:test";
import type { Mural } from "@scripta/shared";
import { latestBooks, latestMural } from "./youLatest";

test("latestBooks orders by added date, newest first, later entries winning ties and gaps", () => {
  const books = [{ Title: "a", DateCreated: "2024-01-01" }, { Title: "b", DateCreated: "2025-01-01" }, { Title: "c" }, { Title: "d", DateCreated: "2025-01-01" }];
  assert.deepEqual(latestBooks(books, 3).map((book) => book.Title), ["d", "b", "a"]);
});

test("latestMural picks the most recently updated and handles none", () => {
  const murals = [{ id: "1", updatedAt: "2025-01-01T00:00:00Z" }, { id: "2", updatedAt: "2026-01-01T00:00:00Z" }] as Mural[];
  assert.equal(latestMural(murals)?.id, "2");
  assert.equal(latestMural([]), undefined);
});

test("latestBooks compares mixed date formats by time, not text", () => {
  const books = [{ Title: "iso", DateCreated: "2024-03-01T00:00:00Z" }, { Title: "slash", DateCreated: "2024/01/05" }, { Title: "later", DateCreated: "2024/12/31" }];
  assert.deepEqual(latestBooks(books, 3).map((book) => book.Title), ["later", "iso", "slash"]);
});
