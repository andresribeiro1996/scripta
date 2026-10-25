import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "scorecard-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { gainOf, ndcgAt, scoreQueries, scorecardCandidates } = await import("./scorecard.js");
const { withoutArticle } = await import("./domain/searchRank.js");

const NOW = "2026-10-01T00:00:00.000Z";
const gains = new Map([["a", 2], ["b", 1]]);

test("ndcgAt is 1 for the ideal order, less for a worse one, and 0 without any gain", () => {
  assert.equal(ndcgAt(["a", "b"], gains, 10), 1);
  const worse = ndcgAt(["b", "a"], gains, 10);
  assert.ok(worse > 0 && worse < 1);
  assert.equal(ndcgAt(["x"], new Map(), 10), 0);
});

test("gainOf scales the grade by its confidence", () => {
  assert.equal(gainOf({ workId: "a", grade: "named", confidence: 0.5 }), 1);
  assert.equal(gainOf({ workId: "a", grade: "related", confidence: 1 }), 1);
  assert.equal(gainOf({ workId: "a", grade: "unrelated", confidence: 1 }), 0);
});

test("scoreQueries averages the tuning and hidden sets separately and lists ungraded top-10 ids", () => {
  const grades = new Map([
    ["one", [{ workId: "a", grade: "named" as const, confidence: 1 }, { workId: "b", grade: "related" as const, confidence: 1 }]],
    ["two", [{ workId: "a", grade: "named" as const, confidence: 1 }, { workId: "b", grade: "related" as const, confidence: 1 }]],
    ["three", [{ workId: "a", grade: "named" as const, confidence: 1 }]]
  ]);
  const ranked = new Map([["one", ["a", "b"]], ["two", ["b", "a", "z"]], ["three", ["a"]]]);
  const { perQuery, tune, hidden } = scoreQueries([{ q: "one", hidden: false }, { q: "two", hidden: false }, { q: "three", hidden: true }], ranked, grades);
  assert.deepEqual(perQuery.map(({ unlabelled }) => unlabelled), [[], ["z"], []]);
  assert.equal(hidden, 1);
  assert.equal(tune, (1 + perQuery[1]!.ndcg) / 2);
  assert.ok(tune < 1);
});

test("withoutArticle drops a leading article word only", () => {
  assert.equal(withoutArticle("the lord of the rings"), "lord of the rings");
  assert.equal(withoutArticle("theory"), "theory");
  assert.equal(withoutArticle("o senhor dos aneis"), "senhor dos aneis");
  assert.equal(withoutArticle("os maias"), "maias");
  assert.equal(withoutArticle("uma familia inglesa"), "familia inglesa");
  assert.equal(withoutArticle("osso"), "osso");
  assert.equal(withoutArticle("o"), "o");
});

test("scorecardCandidates puts series members first and still finds the title matches", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const add = (title: string, author: string, isbn: string) => {
    const book = repo.createBook({ title, author, isbn }, [`isbn:${isbn}`], NOW);
    repo.makeSearchable(book.id);
    return book;
  };
  const members = [
    add("Harry Potter and the Philosopher's Stone", "J. K. Rowling", "9780747532699"),
    add("The Chamber of Secrets", "J. K. Rowling", "9780747538493"),
    add("The Prisoner of Azkaban", "J. K. Rowling", "9780747542155")
  ];
  members.forEach((book, index) => repo.addWorkSeries(book.work_id!, [{ name: "Harry Potter", position: String(index + 1) }], "wikidata", NOW));
  const others = [add("Harry Potter Page to Screen", "Bob McCabe", "9781608870448"), add("Harry Potter Cookbook", "Dinah Bucholz", "9780345511379")];
  const found = scorecardCandidates(repo, "harry potter");
  assert.deepEqual(found.slice(0, 3).map(({ workId }) => workId), members.map((book) => book.work_id));
  assert.ok(!repo.searchBooks(["harry", "potter"], 500).some((row) => row.work_id === members[1]!.work_id));
  assert.ok(found.some(({ workId, title }) => workId === members[1]!.work_id && title === "The Chamber of Secrets"));
  assert.equal(found.length, 5);
  assert.ok(others.every((book) => found.some(({ workId }) => workId === book.work_id)));
  assert.deepEqual(found[1], { workId: members[1]!.work_id, title: "The Chamber of Secrets", author: "J. K. Rowling", year: null });
});

test("scorecardCandidates keeps the works with the most editions even when they rank past the limit", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const add = (title: string, isbn: string, workKey?: string) => {
    const book = repo.createBook({ title, author: "Some Author", isbn, workKey }, [`isbn:${isbn}`], NOW);
    repo.makeSearchable(book.id);
    return book;
  };
  for (let n = 0; n < 8; n++) add(`Dune ${n}`, `97800000000${n}0`);
  const popular = add("Dune with many extra words in the long title", "9780000009990", "OL1W");
  for (let n = 0; n < 3; n++) add("Dune with many extra words in the long title", `97800000008${n}0`, "OL1W");
  const found = scorecardCandidates(repo, "dune", 5);
  assert.equal(found.length, 5);
  assert.ok(found.some(({ workId }) => workId === popular.work_id));
});
