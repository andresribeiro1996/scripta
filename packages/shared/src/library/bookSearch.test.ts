import assert from "node:assert/strict";
import test from "node:test";
import { mergeSearchResults, type BookSearchResult } from "./bookSearch.js";

function result(title: string, authors: string[], isbn: string | null): BookSearchResult {
  return { title, authors, year: null, isbn, publisher: null, coverUrl: null, genres: [] };
}

test("inside results come first and outside-only results are appended", () => {
  const messiah = result("Dune Messiah", ["Frank Herbert"], "9780593098233");
  const dune = result("Dune", ["Frank Herbert"], "9780441013593");
  assert.deepEqual(mergeSearchResults([messiah], [dune]), [messiah, dune]);
});

test("the same ISBN is a duplicate, however it is written", () => {
  const inside = result("Dune", ["Frank Herbert"], "9780441013593");
  const outside = result("Dune (50th anniversary)", ["Frank Herbert"], "978-0-441-01359-3");
  assert.deepEqual(mergeSearchResults([inside], [outside]), [inside]);
});

test("different ISBNs with the same title are different editions", () => {
  const inside = result("Dune", ["Frank Herbert"], "9780441013593");
  const outside = result("Dune", ["Frank Herbert"], "9780340960196");
  assert.equal(mergeSearchResults([inside], [outside]).length, 2);
});

test("without an ISBN on either side, title and first author decide", () => {
  const inside = result("Dune", ["Frank Herbert"], null);
  assert.deepEqual(mergeSearchResults([inside], [result("  dune ", ["FRANK HERBERT", "Someone"], "9780441013593")]), [inside]);
  assert.equal(mergeSearchResults([inside], [result("Dune", ["Brian Herbert"], null)]).length, 2);
  assert.equal(mergeSearchResults([result("Dune", [], null)], [result("Dune", [], null)]).length, 1);
});

test("an empty side returns the other unchanged", () => {
  const only = result("Dune", ["Frank Herbert"], null);
  assert.deepEqual(mergeSearchResults([], [only]), [only]);
  assert.deepEqual(mergeSearchResults([only], []), [only]);
});
