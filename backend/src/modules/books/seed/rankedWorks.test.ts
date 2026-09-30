import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRankedWorks, rankedWorksUrl } from "./rankedWorks.js";

const page = {
  docs: [
    {
      key: "/works/OL17930368W",
      title: "Atomic Habits",
      author_name: ["James Clear"],
      readinglog_count: 63264,
      subject: ["Habit", "Self-help", 42],
      editions: { docs: [{ key: "/books/OL40216430M", title: "Hábitos Atômicos", language: ["por"], isbn: ["8550807567", "9788550807560"] }] }
    },
    { key: "/works/OL1W", title: "No Edition", author_name: ["A"], readinglog_count: 10, editions: { docs: [] } },
    { key: "/works/OL2W", title: "Bad Isbn", author_name: ["B"], readinglog_count: 9, editions: { docs: [{ title: "Bad Isbn", isbn: ["123"] }] } }
  ]
};

test("builds an entry from the language edition, preferring ISBN-13 and the edition title", () => {
  assert.deepEqual(parseRankedWorks(page, "por")[0], {
    isbn: "9788550807560",
    title: "Hábitos Atômicos",
    author: "James Clear",
    lang: "por",
    workKey: "/works/OL17930368W",
    readers: 63264,
    subjects: ["Habit", "Self-help"]
  });
});

test("skips works without an ISBN in that language", () => {
  assert.equal(parseRankedWorks(page, "por").length, 1);
});

test("falls back to ISBN-10 and the work title when the edition has only those", () => {
  const entries = parseRankedWorks({ docs: [{ key: "/works/OL3W", title: "Work Title", author_name: ["C"], readinglog_count: 1, editions: { docs: [{ isbn: ["0306406152"] }] } }] }, "eng");
  assert.equal(entries[0]?.isbn, "0306406152");
  assert.equal(entries[0]?.title, "Work Title");
});

test("ignores malformed pages", () => {
  assert.deepEqual(parseRankedWorks("nonsense", "eng"), []);
  assert.deepEqual(parseRankedWorks({ docs: [null, 3] }, "eng"), []);
});

test("asks Open Library for that language's editions, ranked by reading log", () => {
  const url = new URL(rankedWorksUrl("por", 2000, 1000));
  assert.equal(url.origin + url.pathname, "https://openlibrary.org/search.json");
  assert.equal(url.searchParams.get("q"), "language:por");
  assert.equal(url.searchParams.get("lang"), "por");
  assert.equal(url.searchParams.get("sort"), "readinglog");
  assert.equal(url.searchParams.get("offset"), "2000");
  assert.equal(url.searchParams.get("limit"), "1000");
});
