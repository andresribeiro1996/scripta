import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { CatalogSearchHit } from "./domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "save-hits-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { catalogTitleKey } = await import("./domain/normalize.js");
const { saveCatalogHits } = await import("./saveHits.js");

const AT = "2026-10-25T09:00:00.000Z";

function fresh() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  return { db, repo, deps: { repo, sharesArena: () => false } };
}

const bookCount = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n;

function hit(overrides: Partial<CatalogSearchHit["result"]> = {}, workKey: string | null = null): CatalogSearchHit {
  return {
    result: { title: "Dune", authors: ["Frank Herbert"], year: 1965, isbn: "9780441013593", publisher: "Ace", coverUrl: null, genres: [], ...overrides },
    olCoverId: null,
    workKey,
    source: "openlibrary"
  };
}

test("saveCatalogHits creates a book with the hit's work key and makes it searchable", () => {
  const { repo, deps } = fresh();
  const [saved] = saveCatalogHits(deps, [hit({}, "OL893415W")], AT);
  const book = repo.findBookByKey("isbn:9780441013593");
  assert.ok(book);
  assert.equal(saved?.id, book.id);
  assert.equal(book.ol_work_key, "OL893415W");
  assert.deepEqual(repo.searchBooks(["dune"], 10).map(({ id }) => id), [book.id]);
});

test("an Open Library hit's year is the work's first publication, kept out of the edition year", () => {
  const { repo, deps } = fresh();
  saveCatalogHits(deps, [hit({ year: 1954 })], AT);
  const book = repo.findBookByKey("isbn:9780441013593")!;
  assert.deepEqual([book.year, book.first_published_year], [null, 1954]);
});

test("an ISBNdb hit's year is the edition's own", () => {
  const { repo, deps } = fresh();
  saveCatalogHits(deps, [{ ...hit({ year: 2015 }), source: "isbndb" }], AT);
  const book = repo.findBookByKey("isbn:9780441013593")!;
  assert.deepEqual([book.year, book.first_published_year], [2015, null]);
});

function existing(repo: ReturnType<typeof fresh>["repo"], years: { year?: number | null; firstPublishedYear?: number | null } = {}) {
  repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", ...years }, ["isbn:9780441013593"], AT);
}

test("an Open Library hit fills the first-publication year of a row it reuses", () => {
  const { repo, deps } = fresh();
  existing(repo);
  saveCatalogHits(deps, [hit({ year: 1954 })], AT);
  const book = repo.findBookByKey("isbn:9780441013593")!;
  assert.deepEqual([book.year, book.first_published_year], [null, 1954]);
});

test("an Open Library hit never overwrites a stored first-publication year", () => {
  const { repo, deps } = fresh();
  existing(repo, { firstPublishedYear: 1960 });
  saveCatalogHits(deps, [hit({ year: 1954 })], AT);
  assert.equal(repo.findBookByKey("isbn:9780441013593")!.first_published_year, 1960);
});

test("an ISBNdb hit leaves the first-publication year of a row it reuses empty", () => {
  const { repo, deps } = fresh();
  existing(repo);
  saveCatalogHits(deps, [{ ...hit({ year: 2015 }), source: "isbndb" }], AT);
  const book = repo.findBookByKey("isbn:9780441013593")!;
  assert.deepEqual([book.year, book.first_published_year], [null, null]);
});

test("saveCatalogHits finds an existing book by ISBN instead of creating one", () => {
  const { db, deps } = fresh();
  const [first] = saveCatalogHits(deps, [hit({}, "OL893415W")], AT);
  const [again] = saveCatalogHits(deps, [hit({ title: "Dune (reissue)" }, "OL893415W")], AT);
  assert.ok(first);
  assert.equal(again?.id, first.id);
  assert.equal(bookCount(db), 1);
});

test("a hit with no title and no ISBN saves nothing", () => {
  const { db, deps } = fresh();
  const saved = saveCatalogHits(deps, [hit({ title: "", isbn: null }), hit({ title: "Dune", isbn: null })], AT);
  assert.equal(saved[0], null);
  assert.ok(saved[1]);
  assert.equal(bookCount(db), 1);
});

test("a hit with no ISBN saves by title and author with its work key", () => {
  const { repo, deps } = fresh();
  const [saved] = saveCatalogHits(deps, [hit({ title: "The Left Hand of Darkness", authors: ["Ursula K. Le Guin"], isbn: null }, "OL59852W")], AT);
  const book = repo.findBookByKey(catalogTitleKey("The Left Hand of Darkness", "Ursula K. Le Guin") ?? "");
  assert.ok(book);
  assert.equal(saved?.id, book.id);
  assert.equal(book.isbn, null);
  assert.equal(book.ol_work_key, "OL59852W");
  assert.equal(repo.searchBooks(["left", "hand"], 10).length, 1);
});

test("saved books that share a title key end up in one work", () => {
  const { repo, db, deps } = fresh();
  const saved = saveCatalogHits(deps, [hit({ isbn: "9780441013593" }), hit({ isbn: "9780593099322" })], AT);
  assert.equal(bookCount(db), 2);
  const [first, second] = saved.map((book) => (book ? repo.getBook(book.id) : undefined));
  assert.ok(first?.work_id);
  assert.equal(first.work_id, second?.work_id);
});
