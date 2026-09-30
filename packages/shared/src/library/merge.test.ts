import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey, bookMatchKeys } from "./merge.js";

test("bookMatchKeys returns the ISBN key then the title-and-author key, normalized like bookKey", () => {
  const book = { ISBN: "978-0-00-000000-2", Title: " Dune ", Attribution: "Frank  Herbert" };
  assert.deepEqual(bookMatchKeys(book), ["isbn:9780000000002", "ta:dune|frank herbert"]);
  assert.equal(bookMatchKeys(book)[0], bookKey(book));
});

test("bookMatchKeys returns only the title-and-author key without a usable ISBN", () => {
  const book = { Title: "Dune", Attribution: "Frank Herbert" };
  assert.deepEqual(bookMatchKeys(book), ["ta:dune|frank herbert"]);
  assert.deepEqual(bookMatchKeys({ ...book, ISBN: "not an isbn" }), [bookKey(book)]);
});

test("bookMatchKeys lets a book with an ISBN match the same book without one", () => {
  const withIsbn = bookMatchKeys({ ISBN: "9780000000002", Title: "Dune", Attribution: "Frank Herbert" });
  const withoutIsbn = bookMatchKeys({ Title: "DUNE", Attribution: "frank herbert" });
  assert.ok(withoutIsbn.some((key) => withIsbn.includes(key)));
});
