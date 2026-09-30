import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookMetadata } from "@scripta/shared";
import { SourceUnavailableError } from "../../domain/errors.js";
import type { BookCatalog, CatalogSearchHit } from "../../domain/ports.js";
import { createCompositeCatalog } from "./compositeCatalog.js";

const lookup = { isbn: "9780441013593", title: "Dune", author: "Frank Herbert" };
const down = () => new SourceUnavailableError("test", "HTTP 503");

const openLibrary: BookMetadata = { summary: "OL summary.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"] };
const isbndb: BookMetadata = { summary: "ISBNdb summary.", rating: null, ratingCount: 0, sourceUrl: "https://isbndb.com/book/9780441013593", genres: ["Fantasy"] };

function hit(title: string, isbn: string | null, author = "Frank Herbert"): CatalogSearchHit {
  return { result: { title, authors: [author], year: null, isbn, publisher: null, coverUrl: null, genres: [] }, olCoverId: null };
}

type Outcome<T> = T | Error;

function fake(details: Outcome<BookMetadata | null>, hits: Outcome<CatalogSearchHit[]> = []) {
  const calls: string[] = [];
  const settle = <T>(outcome: Outcome<T>) => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome));
  const catalog: BookCatalog = {
    fetchDetails: () => {
      calls.push("details");
      return settle(details);
    },
    search: (query) => {
      calls.push("isbn" in query ? "search-isbn" : "search-text");
      return settle(hits);
    }
  };
  return { calls, catalog };
}

test("details stay with Open Library when it is complete", async () => {
  const ol = fake(openLibrary);
  const bn = fake(isbndb);
  assert.deepEqual(await createCompositeCatalog(ol.catalog, bn.catalog).fetchDetails(lookup), openLibrary);
  assert.deepEqual(bn.calls, []);
});

test("details fill only what Open Library lacks and keep its rating", async () => {
  const bn = fake(isbndb);
  const noSummary = fake({ ...openLibrary, summary: null });
  assert.deepEqual(await createCompositeCatalog(noSummary.catalog, bn.catalog).fetchDetails(lookup), { ...openLibrary, summary: "ISBNdb summary.", sourceUrl: isbndb.sourceUrl });
  const noGenres = fake({ ...openLibrary, genres: [] });
  assert.deepEqual(await createCompositeCatalog(noGenres.catalog, bn.catalog).fetchDetails(lookup), { ...openLibrary, genres: ["Fantasy"], sourceUrl: isbndb.sourceUrl });
  const complete = fake(openLibrary);
  assert.deepEqual(await createCompositeCatalog(complete.catalog, bn.catalog).fetchDetails(lookup), openLibrary);
  const nothingNew = fake({ ...openLibrary, summary: null, genres: [] });
  assert.deepEqual(await createCompositeCatalog(nothingNew.catalog, fake({ ...isbndb, summary: null, genres: [] }).catalog).fetchDetails(lookup), { ...openLibrary, summary: null, genres: [] });
  const partialAgain = fake({ ...openLibrary, summary: null });
  assert.deepEqual(await createCompositeCatalog(partialAgain.catalog, fake(null).catalog).fetchDetails(lookup), { ...openLibrary, summary: null });
});

test("details come from ISBNdb when Open Library finds nothing", async () => {
  assert.deepEqual(await createCompositeCatalog(fake(null).catalog, fake(isbndb).catalog).fetchDetails(lookup), isbndb);
  assert.equal(await createCompositeCatalog(fake(null).catalog, fake(null).catalog).fetchDetails(lookup), null);
});

test("details never ask ISBNdb without an ISBN", async () => {
  const bn = fake(isbndb);
  assert.equal(await createCompositeCatalog(fake(null).catalog, bn.catalog).fetchDetails({ ...lookup, isbn: null }), null);
  assert.deepEqual(bn.calls, []);
  await assert.rejects(createCompositeCatalog(fake(down()).catalog, bn.catalog).fetchDetails({ ...lookup, isbn: null }), SourceUnavailableError);
  assert.deepEqual(bn.calls, []);
});

test("details survive one source being unavailable, but not both", async () => {
  assert.deepEqual(await createCompositeCatalog(fake(down()).catalog, fake(isbndb).catalog).fetchDetails(lookup), isbndb);
  assert.deepEqual(await createCompositeCatalog(fake({ ...openLibrary, summary: null }).catalog, fake(down()).catalog).fetchDetails(lookup), { ...openLibrary, summary: null });
  await assert.rejects(createCompositeCatalog(fake(down()).catalog, fake(down()).catalog).fetchDetails(lookup), SourceUnavailableError);
  await assert.rejects(createCompositeCatalog(fake(null).catalog, fake(down()).catalog).fetchDetails(lookup), SourceUnavailableError);
  await assert.rejects(createCompositeCatalog(fake(down()).catalog, fake(null).catalog).fetchDetails(lookup), SourceUnavailableError);
});

test("other errors are not swallowed", async () => {
  await assert.rejects(createCompositeCatalog(fake(new Error("boom")).catalog, fake(isbndb).catalog).fetchDetails(lookup), /boom/);
});

test("an ISBN search asks ISBNdb first and Open Library only when it finds nothing", async () => {
  const ol = fake(null, [hit("Dune", "9780441013593")]);
  const found = fake(null, [hit("Dune", "9780441013593", "F. Herbert")]);
  assert.equal((await createCompositeCatalog(ol.catalog, found.catalog).search({ isbn: "9780441013593" }))[0]!.result.authors[0], "F. Herbert");
  assert.deepEqual(ol.calls, []);

  const empty = fake(null, []);
  assert.equal((await createCompositeCatalog(ol.catalog, empty.catalog).search({ isbn: "9780441013593" }))[0]!.result.authors[0], "Frank Herbert");
  assert.deepEqual(ol.calls, ["search-isbn"]);

  const broken = fake(null, down());
  assert.equal((await createCompositeCatalog(ol.catalog, broken.catalog).search({ isbn: "9780441013593" })).length, 1);
  await assert.rejects(createCompositeCatalog(fake(null, down()).catalog, broken.catalog).search({ isbn: "9780441013593" }), SourceUnavailableError);
  await assert.rejects(createCompositeCatalog(fake(null, down()).catalog, empty.catalog).search({ isbn: "9780441013593" }), SourceUnavailableError);
});

const titles = (hits: CatalogSearchHit[]) => hits.map((one) => one.result.title);

test("a text search alternates Open Library and ISBNdb hits, dropping repeats", async () => {
  const ol = fake(null, [hit("Dune", "9780441013593"), hit("Emma", null, "Jane Austen"), hit("Ubik", null, "Philip K. Dick")]);
  const bn = fake(null, [hit("Dune", "9780441013593"), hit("Emma", "9780141439587", "Jane Austen"), hit("Emma", null, "Jane Austen"), hit("Dune Messiah", "9780593098233")]);
  assert.deepEqual(titles(await createCompositeCatalog(ol.catalog, bn.catalog).search({ text: "dune" })), ["Dune", "Emma", "Emma", "Ubik", "Dune Messiah"]);

  const first = fake(null, [hit("A", "9780000000001"), hit("B", "9780000000002")]);
  const second = fake(null, [hit("C", "9780000000003"), hit("D", "9780000000004")]);
  assert.deepEqual(titles(await createCompositeCatalog(first.catalog, second.catalog).search({ text: "x" })), ["A", "C", "B", "D"]);
});

test("a text search lets the longer side finish the list", async () => {
  const short = fake(null, [hit("A", "9780000000001")]);
  const long = fake(null, [hit("B", "9780000000002"), hit("C", "9780000000003"), hit("D", "9780000000004")]);
  assert.deepEqual(titles(await createCompositeCatalog(short.catalog, long.catalog).search({ text: "x" })), ["A", "B", "C", "D"]);
  assert.deepEqual(titles(await createCompositeCatalog(long.catalog, short.catalog).search({ text: "x" })), ["B", "A", "C", "D"]);
});

test("a text search is capped with both sources represented", async () => {
  const many = (prefix: string) => Array.from({ length: 20 }, (_, index) => hit(`${prefix}${index}`, null, prefix));
  const hits = await createCompositeCatalog(fake(null, many("O")).catalog, fake(null, many("I")).catalog).search({ text: "book" });
  assert.equal(hits.length, 12);
  assert.deepEqual(titles(hits).slice(0, 4), ["O0", "I0", "O1", "I1"]);
  assert.equal(titles(hits).filter((title) => title.startsWith("I")).length, 6);
});

test("a text search survives one source being unavailable, but not both", async () => {
  const hits = [hit("Dune", "9780441013593")];
  assert.equal((await createCompositeCatalog(fake(null, down()).catalog, fake(null, hits).catalog).search({ text: "dune" })).length, 1);
  assert.equal((await createCompositeCatalog(fake(null, hits).catalog, fake(null, down()).catalog).search({ text: "dune" })).length, 1);
  await assert.rejects(createCompositeCatalog(fake(null, down()).catalog, fake(null, down()).catalog).search({ text: "dune" }), SourceUnavailableError);
  await assert.rejects(createCompositeCatalog(fake(null, down()).catalog, fake(null, []).catalog).search({ text: "dune" }), SourceUnavailableError);
});

test("without ISBNdb the Open Library catalog is used as is", () => {
  const ol = fake(openLibrary);
  assert.equal(createCompositeCatalog(ol.catalog, null), ol.catalog);
});
