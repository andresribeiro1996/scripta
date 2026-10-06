import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookCatalog, CatalogDetails } from "../../domain/ports.js";
import { onlyMatchingLanguage, summaryMatchesLanguage } from "./languageFilter.js";

const ENGLISH = "The story of a boy who leaves his village and the war that is waiting for him in the north.";
const PORTUGUESE = "A história de um rapaz que deixa a sua aldeia e a guerra que o espera no norte, com os seus amigos.";

test("a summary in the other language is rejected for pt and en editions", () => {
  assert.equal(summaryMatchesLanguage(ENGLISH, "pt-PT"), false);
  assert.equal(summaryMatchesLanguage(PORTUGUESE, "en"), false);
  assert.equal(summaryMatchesLanguage(PORTUGUESE, "pt-BR"), true);
  assert.equal(summaryMatchesLanguage(ENGLISH, "en"), true);
});

test("unknown edition language, other languages and ambiguous text are accepted", () => {
  assert.equal(summaryMatchesLanguage(ENGLISH, null), true);
  assert.equal(summaryMatchesLanguage(ENGLISH, "fr"), true);
  assert.equal(summaryMatchesLanguage("Dune", "pt"), true);
});

test("the filter drops a mismatched summary and keeps the rest", async () => {
  const details: CatalogDetails = {
    metadata: { summary: ENGLISH, rating: 4, ratingCount: 2, sourceUrl: "u", genres: ["Fantasy"], pages: null, publisher: null, year: null, translator: null },
    sources: ["openlibrary"],
    summarySource: "openlibrary"
  };
  const catalog: BookCatalog = { fetchDetails: async () => details, search: async () => [] };
  const filtered = await onlyMatchingLanguage(catalog).fetchDetails({ isbn: "9789722000000", title: "t", author: "a", language: "pt" });
  assert.equal(filtered?.metadata.summary, null);
  assert.equal(filtered?.summarySource, null);
  assert.deepEqual(filtered?.metadata.genres, ["Fantasy"]);
  assert.equal((await onlyMatchingLanguage(catalog).fetchDetails({ isbn: null, title: "t", author: "a", language: "en" }))?.metadata.summary, ENGLISH);
});

test("the filter leaves the work summary for read time", async () => {
  const details: CatalogDetails = {
    metadata: { summary: ENGLISH, rating: null, ratingCount: 0, sourceUrl: "u", genres: [], pages: null, publisher: null, year: null, translator: null },
    sources: ["openlibrary"],
    summarySource: "openlibrary",
    workSummary: ENGLISH
  };
  const catalog: BookCatalog = { fetchDetails: async () => details, search: async () => [] };
  const filtered = await onlyMatchingLanguage(catalog).fetchDetails({ isbn: "9789722000000", title: "t", author: "a", language: "pt" });
  assert.deepEqual([filtered?.metadata.summary, filtered?.workSummary], [null, ENGLISH]);
});
