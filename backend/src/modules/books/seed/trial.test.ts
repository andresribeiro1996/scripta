import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoverSources, FetchCoverImage } from "../coverResolver.js";
import { SourceUnavailableError } from "../domain/errors.js";
import type { CoverSource } from "../domain/ports.js";
import type { SeedEntry } from "./rankedWorks.js";
import { pendingEntries, summarizeTrial, trialBook, type TrialRow } from "./trial.js";

const entry: SeedEntry = { isbn: "9780306406157", title: "Dune", author: "Frank Herbert", lang: "eng", workKey: "/works/OL1W", readers: 1, subjects: [] };
const none: CoverSource = { byIsbn: async () => [], byTitle: async () => [] };
const giving = (source: "apple" | "isbndb" | "openlibrary", url: string): CoverSource => ({ byIsbn: async () => [{ source, url }], byTitle: async () => [] });
const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("isbndb", "HTTP 429"); }, byTitle: async () => [] };
const sized = (sizes: Record<string, [number, number]>): FetchCoverImage => async (candidate) => {
  const size = sizes[candidate.url];
  return size ? { full: Buffer.alloc(0), thumb: Buffer.alloc(0), width: size[0], height: size[1] } : null;
};

test("records the free chain's cover and ISBNdb's width separately", async () => {
  const free: CoverSources = { isbndb: null, apple: giving("apple", "a"), openlibrary: none };
  const isbndbOnly: CoverSources = { isbndb: giving("isbndb", "i"), apple: none, openlibrary: none };
  const row = await trialBook(entry, free, isbndbOnly, sized({ a: [300, 450], i: [500, 750] }));
  assert.deepEqual(row, { isbn: entry.isbn, lang: "eng", free: { source: "apple", width: 300 }, isbndb: { width: 500 } });
});

test("the ISBNdb placeholder is not a find", async () => {
  const free: CoverSources = { isbndb: null, apple: none, openlibrary: none };
  const isbndbOnly: CoverSources = { isbndb: giving("isbndb", "p"), apple: none, openlibrary: none };
  const row = await trialBook(entry, free, isbndbOnly, sized({ p: [200, 248] }));
  assert.equal(row?.isbndb, null);
});

test("an incomplete ISBNdb pass is not recorded", async () => {
  const free: CoverSources = { isbndb: null, apple: giving("apple", "a"), openlibrary: none };
  const isbndbOnly: CoverSources = { isbndb: failing, apple: none, openlibrary: none };
  assert.equal(await trialBook(entry, free, isbndbOnly, sized({ a: [600, 900] })), null);
});

test("resume skips isbns already recorded", () => {
  const other = { ...entry, isbn: "9780000000002" };
  assert.deepEqual(pendingEntries([entry, other], new Set([entry.isbn])), [other]);
});

test("summarizes per language and projects gap fills to the seed", () => {
  const rows: TrialRow[] = [
    { isbn: "1", lang: "eng", free: { source: "apple", width: 900 }, isbndb: { width: 1000 } },
    { isbn: "2", lang: "eng", free: { source: "openlibrary", width: 300 }, isbndb: { width: 500 } },
    { isbn: "3", lang: "por", free: null, isbndb: { width: 450 } },
    { isbn: "4", lang: "por", free: null, isbndb: null }
  ];
  const summary = summarizeTrial(rows, { eng: 35000, por: 5000 });
  assert.deepEqual(summary.byLang.eng, { books: 2, freeGood: 1, isbndbGood: 2, gapFills: 1, isbndbWider: 2, noCover: 0 });
  assert.deepEqual(summary.byLang.por, { books: 2, freeGood: 0, isbndbGood: 1, gapFills: 1, isbndbWider: 0, noCover: 1 });
  assert.equal(summary.projectedGapFills, 17500 + 2500);
});
