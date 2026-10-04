import assert from "node:assert/strict";
import { test } from "node:test";
import { PORTUGAL_ISBN13_PREFIXES } from "../domain/normalize.js";
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
    subjects: ["Habit", "Self-help"],
    languages: ["por"]
  });
});

test("skips works without an ISBN in that language", () => {
  assert.equal(parseRankedWorks(page, "por").length, 1);
});

test("falls back to ISBN-10 and the work title when the edition has only those", () => {
  const entries = parseRankedWorks({ docs: [{ key: "/works/OL3W", title: "Work Title", author_name: ["C"], readinglog_count: 1, editions: { docs: [{ language: ["eng"], isbn: ["0306406152"] }] } }] }, "eng");
  assert.equal(entries[0]?.isbn, "0306406152");
  assert.equal(entries[0]?.title, "Work Title");
});

test("skips an edition in another language", () => {
  const entries = parseRankedWorks({ docs: [{ key: "/works/OL4W", title: "Dune", author_name: ["F"], readinglog_count: 1, editions: { docs: [{ language: ["eng"], isbn: ["9780306406157"] }] } }] }, "por");
  assert.deepEqual(entries, []);
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

test("searches by ISBN prefix instead of language when given one", () => {
  const url = new URL(rankedWorksUrl("por", 0, 1000, "978972"));
  assert.equal(url.searchParams.get("q"), "isbn:978972*");
  assert.equal(url.searchParams.get("lang"), "por");
  assert.equal(url.searchParams.get("sort"), "readinglog");
  assert.deepEqual(PORTUGAL_ISBN13_PREFIXES, ["978972", "978989"]);
});

const withEdition = (edition: Record<string, unknown>) => ({ docs: [{ key: "/works/OL5W", title: "Work", author_name: ["G"], readinglog_count: 5, editions: { docs: [edition] } }] });

test("with a prefix, keeps an edition that has no language field", () => {
  const entries = parseRankedWorks(withEdition({ title: "A Guerra dos Tronos", isbn: ["9789896370107"] }), "por", "978989");
  assert.equal(entries[0]?.isbn, "9789896370107");
});

test("with a prefix, drops an edition whose ISBNs do not start with it", () => {
  assert.deepEqual(parseRankedWorks(withEdition({ language: ["por"], isbn: ["8550807567", "9788550807560"] }), "por", "978989"), []);
});

test("with a prefix, prefers the 13-digit ISBN", () => {
  const entries = parseRankedWorks(withEdition({ isbn: ["9722365592", "9789722365598"] }), "por", "978972");
  assert.equal(entries[0]?.isbn, "9789722365598");
});

test("keeps the languages the edition states, in order, and none when it states none", () => {
  assert.deepEqual(parseRankedWorks(withEdition({ language: ["fre", "eng", 7], isbn: ["9789896370107"] }), "por", "978989")[0]?.languages, ["fre", "eng"]);
  assert.deepEqual(parseRankedWorks(withEdition({ isbn: ["9789896370107"] }), "por", "978989")[0]?.languages, []);
});
