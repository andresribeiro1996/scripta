import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchBookMetadata, validBookRating } from "../src/lib/bookMetadata.ts";

test("ratings preserve fractional values and reject invalid scales", () => {
  assert.equal(validBookRating(3.75), 3.75);
  for (const value of [0, -1, 6, NaN, Infinity, "4", null]) assert.equal(validBookRating(value), null);
});

test("metadata lookup validates matching and handles unavailable data", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let responses: unknown[] = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const body = responses.shift();
    if (body instanceof Error) throw body;
    return Response.json(body);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const doc = { key: "/works/OL123W", title: "Ecotopia", author_name: ["Ernest Callenbach"], ratings_average: 3.8, ratings_count: 42 };

  responses = [{ docs: [doc] }, { description: { value: "A book summary." } }];
  const result = await fetchBookMetadata("9780553348477", "Ecotopia", "Ernest Callenbach");
  assert.deepEqual(result, { summary: "A book summary.", rating: 3.8, ratingCount: 42, sourceUrl: "https://openlibrary.org/works/OL123W" });
  assert.equal(new URL(requests[0]).searchParams.get("isbn"), "9780553348477");

  responses = [{ docs: [doc] }, { description: "**Plain summary.** Source: [Wikipedia](https://en.wikipedia.org/wiki/Ecotopia)" }];
  assert.equal((await fetchBookMetadata("", "ECOTOPIA", "Ernest Callenbach"))?.summary, "Plain summary. Source: Wikipedia");

  responses = [{ docs: [doc] }];
  assert.equal(await fetchBookMetadata("", "Different title", "Ernest Callenbach"), null);
  responses = [{ docs: [doc] }];
  assert.equal(await fetchBookMetadata("", "Ecotopia", "Different author"), null);

  responses = [{ docs: [{ ...doc, key: "//untrusted.test/work" }] }];
  assert.equal(await fetchBookMetadata("9780553348477", "", ""), null);

  responses = [{ docs: [{ ...doc, ratings_average: 8, ratings_count: -2 }] }, {}];
  const missing = await fetchBookMetadata("9780553348477", "", "");
  assert.equal(missing?.summary, null);
  assert.equal(missing?.rating, null);
  assert.equal(missing?.ratingCount, 0);

  responses = [{ docs: [] }];
  assert.equal(await fetchBookMetadata("9780553348477", "", ""), null);
  responses = [new Error("Offline")];
  await assert.rejects(fetchBookMetadata("9780553348477", "", ""), /Offline/);
});

test("mural preloads select only referenced books and include resolved tiers", async () => {
  const { muralMetadataBooks } = await import("../src/hooks/useMuralBookMetadata.ts");
  const { bookKey } = await import("../src/lib/merge.ts");
  const { createBlockCandidate } = await import("../src/lib/murals.ts");
  const books = ["Spotlight", "Shelf", "Reading", "Ranked", "Pool", "Unrelated"].map((Title, index) => ({
    Title, Attribution: "Author", ReadStatus: index === 2 ? 1 : 0
  }));
  const makeBlock = (type: Parameters<typeof createBlockCandidate>[0]) => createBlockCandidate(type, []);
  const blocks = [
    { ...makeBlock("spotlight"), type: "spotlight" as const, bookKey: bookKey(books[0]) },
    { ...makeBlock("shelf"), type: "shelf" as const, title: "Shelf", bookKeys: [bookKey(books[1]), bookKey(books[0]), "missing"] },
    makeBlock("currentlyReading"),
    { ...makeBlock("tierlist"), type: "tierlist" as const, tierlistId: "tiers" }
  ];
  assert.deepEqual(muralMetadataBooks(blocks, books).map((book) => book.Title), ["Spotlight", "Shelf", "Reading"]);
  assert.deepEqual(muralMetadataBooks(blocks, books, () => ({
    name: "Tiers", tiers: [{ id: "tier", label: "A", color: "red", bookKeys: [bookKey(books[3])] }], pool: [bookKey(books[4])]
  })).map((book) => book.Title), ["Spotlight", "Shelf", "Reading", "Ranked", "Pool"]);
});

test("opening details reuses completed and in-flight preloads", async (t) => {
  const { QueryClient } = await import("@tanstack/react-query");
  const { bookMetadataOptions } = await import("../src/lib/bookMetadata.ts");
  const client = new QueryClient();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json(requests === 1 ? { docs: [{ key: "/works/OL123W" }] } : { description: "Ready before tapping." });
  };
  t.after(() => { globalThis.fetch = originalFetch; client.clear(); });
  const book = { ISBN: "9780553348477", Title: "Ecotopia", Attribution: "Ernest Callenbach" };
  const preload = client.prefetchQuery(bookMetadataOptions(book));
  const details = client.fetchQuery(bookMetadataOptions(book));
  await preload;
  assert.equal((await details)?.summary, "Ready before tapping.");
  assert.equal(requests, 2);
  await client.fetchQuery(bookMetadataOptions(book));
  assert.equal(requests, 2);
});
