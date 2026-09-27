import assert from "node:assert/strict";
import { test } from "node:test";
import { validBookRating } from "@scripta/shared";

test("ratings preserve fractional values and reject invalid scales", () => {
  assert.equal(validBookRating(3.75), 3.75);
  for (const value of [0, -1, 6, NaN, Infinity, "4", null]) assert.equal(validBookRating(value), null);
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
