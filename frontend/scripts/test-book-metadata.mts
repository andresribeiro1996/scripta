import assert from "node:assert/strict";
import { test } from "node:test";
import { validBookRating } from "@scripta/shared";

test("ratings preserve fractional values and reject invalid scales", () => {
  assert.equal(validBookRating(3.75), 3.75);
  for (const value of [0, -1, 6, NaN, Infinity, "4", null]) assert.equal(validBookRating(value), null);
});

test("mural preloads select only referenced books, quotes included, each once", async () => {
  const { muralMetadataBooks } = await import("../src/hooks/useMuralBookMetadata.ts");
  const { bookKey } = await import("../src/lib/merge.ts");
  const { createBlockCandidate } = await import("../src/lib/murals.ts");
  const books = ["Spotlight", "Shelf", "Reading", "Ranked", "Pool", "Unrelated"].map((Title, index) => ({
    Title, Attribution: "Author", ReadStatus: index === 2 ? 1 : 0, _workId: `work-${index}`
  }));
  const makeBlock = (type: Parameters<typeof createBlockCandidate>[0]) => createBlockCandidate(type, []);
  const blocks = [
    { ...makeBlock("spotlight"), type: "spotlight" as const, bookKey: bookKey(books[0]) },
    { ...makeBlock("shelf"), type: "shelf" as const, title: "Shelf", bookKeys: [bookKey(books[1]), bookKey(books[0]), "missing"] },
    makeBlock("currentlyReading"),
    { ...makeBlock("tierlist"), type: "tierlist" as const, tierlistId: "tiers" },
    { ...makeBlock("quoteCollection"), type: "quoteCollection" as const, title: "Q", quotes: [{ bookKey: bookKey(books[5]), highlightId: "h" }, { bookKey: bookKey(books[0]), highlightId: "h2" }] }
  ];
  assert.deepEqual(muralMetadataBooks(blocks, books).map((book) => book.Title), ["Spotlight", "Shelf", "Reading", "Unrelated"]);
  assert.deepEqual(muralMetadataBooks(blocks, books, () => ({
    name: "Tiers", tiers: [{ id: "tier", label: "A", color: "red", workIds: ["work-3"] }], pool: ["work-4"]
  })).map((book) => book.Title), ["Spotlight", "Shelf", "Reading", "Ranked", "Pool", "Unrelated"]);
});

test("opening details reuses completed and in-flight preloads", async (t) => {
  const { QueryClient } = await import("@tanstack/react-query");
  const { bookMetadataOptions } = await import("../src/lib/bookMetadata.ts");
  const client = new QueryClient();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ metadata: { summary: "Ready before tapping.", rating: null, ratingCount: 0, sourceUrl: "https://openlibrary.org/works/OL1W", genres: [], pages: null, publisher: null, year: null, translator: null, summarySource: "openlibrary" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; client.clear(); });
  const book = { ISBN: "9780553348477", Title: "Ecotopia", Attribution: "Ernest Callenbach" };
  const preload = client.prefetchQuery(bookMetadataOptions(book));
  const details = client.fetchQuery(bookMetadataOptions(book));
  await preload;
  assert.equal((await details)?.summary, "Ready before tapping.");
  assert.equal(requests, 1);
  await client.fetchQuery(bookMetadataOptions(book));
  assert.equal(requests, 1);
});

test("the source line names where the summary came from", async () => {
  const { summarySourceName } = await import("../src/lib/bookMetadata.ts");
  const base = { summary: "S", rating: null, ratingCount: 0, sourceUrl: "", genres: [], pages: null, publisher: "Antígona", year: null, translator: null };
  assert.equal(summarySourceName({ ...base, summarySource: "openlibrary" }), "Open Library");
  assert.equal(summarySourceName({ ...base, summarySource: "isbndb" }), "ISBNdb");
  assert.equal(summarySourceName({ ...base, summarySource: "publisher" }), "Antígona");
  assert.equal(summarySourceName({ ...base, summarySource: "publisher", publisher: null }), "Publisher");
});
