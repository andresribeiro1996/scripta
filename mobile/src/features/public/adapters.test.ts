/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "@scripta/shared";
import { reconstructBooks, reconstructTierlists } from "./adapters.js";

test("shared mural adapters restore book, highlight, and tier-list renderer inputs", () => {
  const publicBook = { title: "A Book", author: "An Author", isbn: "9780000000001", imageId: null, coverUrl: "https://example.test/cover", readStatus: 1 };
  const key = bookKey({ Title: publicBook.title, Attribution: publicBook.author, ISBN: publicBook.isbn, ImageId: publicBook.imageId });
  const books = reconstructBooks([publicBook], [publicBook], [{ bookKey: key, highlightId: "h1", text: "Text", annotation: "Note" }]);
  assert.equal(books.length, 1);
  assert.deepEqual(books[0]?.highlights, [{ BookmarkID: "h1", Text: "Text", Annotation: "Note" }]);
  assert.deepEqual(reconstructTierlists({ t1: { name: "List", tiers: [{ id: "top", label: "Top", color: "#000000", bookKeys: [key] }], pool: [] } })[0]?.data.pool, []);
});
