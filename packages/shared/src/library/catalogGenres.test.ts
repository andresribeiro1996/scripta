import assert from "node:assert/strict";
import { test } from "node:test";
import { GENRES_FROM_CATALOG } from "./bookGenres.js";
import { withCatalogGenres } from "./catalogGenres.js";

const dune = { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" };
const key = "isbn:9780441013593";

test("a book with no genres takes the catalog's and is marked", () => {
  for (const book of [dune, { ...dune, _genres: [] }]) {
    const next = withCatalogGenres({ books: [book] }, { [key]: ["Science Fiction", "Classics"] });
    assert.deepEqual(next.books, [{ ...book, _genres: ["Science Fiction", "Classics"], _genresFrom: GENRES_FROM_CATALOG }]);
  }
});

test("a marked book follows the catalog when it changes", () => {
  const book = { ...dune, _genres: ["Biography & Memoir"], _genresFrom: GENRES_FROM_CATALOG };
  const next = withCatalogGenres({ books: [book] }, { [key]: ["Historical Fiction"] });
  assert.deepEqual(next.books[0], { ...book, _genres: ["Historical Fiction"] });
});

test("genres of the reader's own are never replaced", () => {
  const data = { books: [{ ...dune, _genres: ["Romance"] }] };
  assert.equal(withCatalogGenres(data, { [key]: ["Science Fiction"] }), data);
});

test("nothing to apply returns the same object", () => {
  const marked = { ...dune, _genres: ["Science Fiction"], _genresFrom: GENRES_FROM_CATALOG };
  for (const data of [{ books: [dune] }, { books: [marked] }]) {
    assert.equal(withCatalogGenres(data, {}), data);
    assert.equal(withCatalogGenres(data, { [key]: [] }), data);
  }
  const same = { books: [marked] };
  assert.equal(withCatalogGenres(same, { [key]: ["Science Fiction"] }), same);
});
