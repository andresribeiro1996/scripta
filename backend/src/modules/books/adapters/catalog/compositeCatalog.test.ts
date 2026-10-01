import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookMetadata } from "@scripta/shared";
import { SourcePausedError, SourceUnavailableError } from "../../domain/errors.js";
import type { BookCatalog, CatalogDetails, CatalogSearchHit } from "../../domain/ports.js";
import { createCompositeCatalog } from "./compositeCatalog.js";

const lookup = { isbn: "9780441013593", title: "Dune", author: "Frank Herbert" };
const down = () => new SourceUnavailableError("test", "HTTP 503");

const olMetadata: BookMetadata = { summary: "OL summary.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"], pages: 412, publisher: "Ace", year: 1965, translator: "Ana" };
const bnMetadata: BookMetadata = { summary: "ISBNdb summary.", rating: null, ratingCount: 0, sourceUrl: "https://isbndb.com/book/9780441013593", genres: ["Fantasy"], pages: 544, publisher: "Penguin", year: 2005, translator: "Bob" };
const openLibrary: CatalogDetails = { metadata: olMetadata, sources: ["openlibrary"], summarySource: "openlibrary" };
const isbndb: CatalogDetails = { metadata: bnMetadata, sources: ["isbndb"], summarySource: "isbndb" };
const ol = (changes: Partial<BookMetadata>): CatalogDetails => ({ ...openLibrary, metadata: { ...olMetadata, ...changes } });
const bn = (changes: Partial<BookMetadata>): CatalogDetails => ({ ...isbndb, metadata: { ...bnMetadata, ...changes } });

function hit(title: string, isbn: string | null, author = "Frank Herbert", source: CatalogSearchHit["source"] = "openlibrary"): CatalogSearchHit {
  return { result: { title, authors: [author], year: null, isbn, publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source };
}

type Outcome<T> = T | Error;

function fake(details: Outcome<CatalogDetails | null>, hits: Outcome<CatalogSearchHit[]> = []) {
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
  const olFake = fake(openLibrary);
  const bnFake = fake(isbndb);
  assert.deepEqual(await createCompositeCatalog(olFake.catalog, bnFake.catalog).fetchDetails(lookup), openLibrary);
  assert.deepEqual(bnFake.calls, []);
});

test("details fill what Open Library lacks, keep its rating and source URL, and name both sources", async () => {
  const bnFake = fake(isbndb);
  assert.deepEqual(await createCompositeCatalog(fake(ol({ summary: null })).catalog, bnFake.catalog).fetchDetails(lookup), {
    metadata: { ...olMetadata, summary: "ISBNdb summary." },
    sources: ["openlibrary", "isbndb"],
    summarySource: "isbndb"
  });
  assert.deepEqual(await createCompositeCatalog(fake(ol({ genres: [] })).catalog, bnFake.catalog).fetchDetails(lookup), {
    metadata: { ...olMetadata, genres: ["Fantasy"] },
    sources: ["openlibrary", "isbndb"],
    summarySource: "openlibrary"
  });
});

test("when ISBNdb is asked anyway, its pages, year and publisher fill what Open Library left empty", async () => {
  assert.deepEqual(await createCompositeCatalog(fake(ol({ genres: [], pages: null, year: null, publisher: null })).catalog, fake(isbndb).catalog).fetchDetails(lookup), {
    metadata: { ...olMetadata, genres: ["Fantasy"], pages: 544, year: 2005, publisher: "Penguin" },
    sources: ["openlibrary", "isbndb"],
    summarySource: "openlibrary"
  });
  assert.deepEqual(await createCompositeCatalog(fake(ol({ summary: null, pages: 300 })).catalog, fake(isbndb).catalog).fetchDetails(lookup), {
    metadata: { ...olMetadata, summary: "ISBNdb summary.", pages: 300 },
    sources: ["openlibrary", "isbndb"],
    summarySource: "isbndb"
  });
});

test("missing pages, year or publisher alone never ask ISBNdb", async () => {
  const bnFake = fake(isbndb);
  const partial = ol({ pages: null, year: null, publisher: null });
  assert.deepEqual(await createCompositeCatalog(fake(partial).catalog, bnFake.catalog).fetchDetails(lookup), partial);
  assert.deepEqual(bnFake.calls, []);
});

test("details name only Open Library when ISBNdb adds nothing", async () => {
  const empty = ol({ summary: null, genres: [] });
  assert.deepEqual(await createCompositeCatalog(fake(empty).catalog, fake(bn({ summary: null, genres: [] })).catalog).fetchDetails(lookup), empty);
  assert.deepEqual(await createCompositeCatalog(fake(empty).catalog, fake(null).catalog).fetchDetails(lookup), empty);
});

test("details come from ISBNdb alone when Open Library finds nothing", async () => {
  assert.deepEqual(await createCompositeCatalog(fake(null).catalog, fake(isbndb).catalog).fetchDetails(lookup), isbndb);
  assert.equal(await createCompositeCatalog(fake(null).catalog, fake(null).catalog).fetchDetails(lookup), null);
});

test("details never ask ISBNdb without an ISBN", async () => {
  const bnFake = fake(isbndb);
  assert.equal(await createCompositeCatalog(fake(null).catalog, bnFake.catalog).fetchDetails({ ...lookup, isbn: null }), null);
  assert.deepEqual(bnFake.calls, []);
  await assert.rejects(createCompositeCatalog(fake(down()).catalog, bnFake.catalog).fetchDetails({ ...lookup, isbn: null }), SourceUnavailableError);
  assert.deepEqual(bnFake.calls, []);
});

test("details survive one source being unavailable, but not both", async () => {
  assert.deepEqual(await createCompositeCatalog(fake(down()).catalog, fake(isbndb).catalog).fetchDetails(lookup), isbndb);
  assert.deepEqual(await createCompositeCatalog(fake(ol({ summary: null })).catalog, fake(down()).catalog).fetchDetails(lookup), ol({ summary: null }));
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

test("a merged details record keeps Open Library's work key", async () => {
  const merged = await createCompositeCatalog(fake({ ...ol({ summary: null }), workKey: "/works/OL1W" }).catalog, fake(isbndb).catalog).fetchDetails(lookup);
  assert.equal(merged?.workKey, "/works/OL1W");
  assert.deepEqual(merged?.sources, ["openlibrary", "isbndb"]);
});

test("a strict catalog refuses a partial Open Library answer when ISBNdb is unavailable, a normal one returns it", async () => {
  const partial = ol({ summary: null });
  for (const failure of [down(), new SourcePausedError("isbndb", "paused", { retryAt: 1 })]) {
    await assert.rejects(createCompositeCatalog(fake(partial).catalog, fake(failure).catalog, true).fetchDetails(lookup), failure.constructor as typeof SourceUnavailableError);
    assert.deepEqual(await createCompositeCatalog(fake(partial).catalog, fake(failure).catalog).fetchDetails(lookup), partial);
  }
});

test("a strict catalog behaves as usual when ISBNdb answers or is not asked", async () => {
  assert.deepEqual((await createCompositeCatalog(fake(ol({ summary: null })).catalog, fake(isbndb).catalog, true).fetchDetails(lookup))?.metadata.summary, "ISBNdb summary.");
  const bnFake = fake(down());
  assert.deepEqual(await createCompositeCatalog(fake(openLibrary).catalog, bnFake.catalog, true).fetchDetails(lookup), openLibrary);
  assert.deepEqual(bnFake.calls, []);
});
