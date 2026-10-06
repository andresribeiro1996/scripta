/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey, workIdOf } from "@scripta/shared";
import { reconstructBooks, reconstructTierlists } from "./adapters.js";

const publicBook = { key: "isbn:9780000000001", workId: "w1", title: "A Book", author: "An Author", isbn: "9780000000001", imageId: null, coverUrl: "https://example.test/cover", readStatus: 1 };

test("shared mural adapters restore book, highlight, and tier-list renderer inputs", () => {
  const books = reconstructBooks([publicBook], [publicBook], [{ bookKey: publicBook.key, highlightId: "h1", text: "Text", annotation: "Note" }]);
  assert.equal(books.length, 1);
  assert.deepEqual(books[0]?.highlights, [{ BookmarkID: "h1", Text: "Text", Annotation: "Note" }]);
  assert.equal(workIdOf(books[0]!), "w1");
  assert.deepEqual(reconstructTierlists({ t1: { name: "List", tiers: [{ id: "top", label: "Top", color: "#000000", workIds: ["w1"] }], pool: [] } })[0]?.data.pool, []);
});

test("a public book with an empty author keeps the server's key for highlights and shelf blocks", () => {
  const orlando = { ...publicBook, key: "ta:orlando|", workId: null, title: "Orlando", author: "", isbn: null };
  const books = reconstructBooks([orlando], [], [{ bookKey: "ta:orlando|", highlightId: "h2", text: "Text", annotation: null }]);
  assert.equal(books.length, 1);
  assert.equal(bookKey(books[0]!), "ta:orlando|");
  assert.equal(workIdOf(books[0]!), undefined);
  assert.equal((books[0]!.highlights as unknown[]).length, 1);
});
