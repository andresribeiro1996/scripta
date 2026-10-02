import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "seed-catalog-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { catalogTitleKey } = await import("../domain/normalize.js");
const { openBooksDb } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { seedBook, seedCatalog } = await import("./seedCatalog.js");

const NOW = new Date("2026-10-01T00:00:00.000Z");

function entry(isbn: string, title: string, author = "Author") {
  return { isbn, title, author, lang: "eng" as const, workKey: `/works/${isbn}`, readers: 1, subjects: [] };
}

function setup() {
  const db = openBooksDb();
  db.exec("DELETE FROM book_keys; DELETE FROM books; DELETE FROM works");
  return { db, repo: createSqliteBooksRepository(db) };
}

test("first run creates unchecked rows and a second run creates none", () => {
  const { repo } = setup();
  const entries = [entry("9780141184272", "One"), entry("9780374520731", "Two"), entry("9780062315007", "Three")];

  assert.deepEqual(seedCatalog(entries, repo, () => NOW), { created: 3, existing: 0, invalid: 0 });
  assert.equal(repo.listUncheckedCoverIds().length, 3);
  const book = repo.findBookByKey("isbn:9780141184272")!;
  assert.equal(book.cover_status, null);
  assert.equal(book.title, "One");
  assert.equal(book.created_at, NOW.toISOString());

  assert.deepEqual(seedCatalog(entries, repo, () => NOW), { created: 0, existing: 3, invalid: 0 });
  assert.equal(repo.listUncheckedCoverIds().length, 3);
});

test("an entry with no usable identity counts as invalid", () => {
  const { repo } = setup();
  assert.deepEqual(seedCatalog([entry("not-an-isbn", "")], repo, () => NOW), { created: 0, existing: 0, invalid: 1 });
  assert.equal(repo.listUncheckedCoverIds().length, 0);
});

test("entries that share a key create one row", () => {
  const { repo } = setup();
  const entries = [entry("9780141184272", "One"), entry("978-0-14-118427-2", "One again")];
  assert.deepEqual(seedCatalog(entries, repo, () => NOW), { created: 1, existing: 1, invalid: 0 });
  assert.equal(repo.listUncheckedCoverIds().length, 1);
});

test("seedBook returns the created row, then the existing one", () => {
  const { repo } = setup();
  const input = { isbn: "9780141184272", title: "One", author: "Author" };

  const created = seedBook(input, repo, () => NOW);
  assert.equal(created.outcome, "created");
  assert.equal(created.book?.isbn, "9780141184272");

  const existing = seedBook(input, repo, () => NOW);
  assert.equal(existing.outcome, "existing");
  assert.equal(existing.book?.id, created.book?.id);
  assert.deepEqual(seedBook({ isbn: "", title: "", author: "" }, repo, () => NOW), { outcome: "invalid" });
});

test("seedBook fills an untitled existing row and gives it its title key", () => {
  const { repo } = setup();
  const blank = seedBook({ isbn: "9780141184272", title: "", author: "" }, repo, () => NOW).book!;
  assert.equal(blank.title, "");
  assert.equal(repo.findBookByKey(catalogTitleKey("One", "Author")!), undefined);

  const result = seedBook({ isbn: "9780141184272", title: "One", author: "Author" }, repo, () => NOW);

  assert.equal(result.outcome, "existing");
  const filled = repo.getBook(blank.id)!;
  assert.equal(filled.title, "One");
  assert.equal(filled.author, "Author");
  assert.equal(repo.findBookByKey(catalogTitleKey("One", "Author")!)?.id, blank.id);
});

test("seedBook leaves a titled row alone and does not steal a taken title key", () => {
  const { repo } = setup();
  const titled = seedBook({ isbn: "9780374520731", title: "Two", author: "Author" }, repo, () => NOW).book!;
  const blank = seedBook({ isbn: "9780062315007", title: "", author: "" }, repo, () => NOW).book!;

  seedBook({ isbn: "9780374520731", title: "Other", author: "Someone" }, repo, () => NOW);
  assert.equal(repo.getBook(titled.id)!.title, "Two");

  seedBook({ isbn: "9780062315007", title: "Two", author: "Author" }, repo, () => NOW);
  assert.equal(repo.getBook(blank.id)!.title, "Two");
  assert.equal(repo.findBookByKey(catalogTitleKey("Two", "Author")!)?.id, titled.id);
});

test("seed entries store their work key on created rows, fill empty ones, and never replace one", () => {
  const { repo } = setup();
  const created = seedBook({ isbn: "9780141184272", title: "One", author: "Author", workKey: "/works/OL1W" }, repo, () => NOW);
  assert.equal(created.outcome, "created");
  assert.equal(repo.getBook(created.book!.id)!.ol_work_key, "OL1W");

  const bare = repo.createBook({ title: "Two", author: "Author", isbn: "9780374520731" }, ["isbn:9780374520731"], NOW.toISOString());
  assert.equal(seedBook({ isbn: "9780374520731", title: "Two", author: "Author", workKey: "/works/OL2W" }, repo, () => NOW).outcome, "existing");
  assert.equal(repo.getBook(bare.id)!.ol_work_key, "OL2W");

  seedBook({ isbn: "9780141184272", title: "One", author: "Author", workKey: "/works/OL9W" }, repo, () => NOW);
  assert.equal(repo.getBook(created.book!.id)!.ol_work_key, "OL1W");
});

test("seedCatalog passes each entry's work key through", () => {
  const { repo } = setup();
  seedCatalog([{ ...entry("9780141184272", "One"), workKey: "/works/OL5W" }], repo, () => NOW);
  assert.equal(repo.findBookByKey("isbn:9780141184272")!.ol_work_key, "OL5W");
});

test("seedCatalog marks created rows as seeded and an existing row keeps its creator", () => {
  const { repo } = setup();
  seedCatalog([entry("9780141184272", "One")], repo, () => NOW);
  assert.equal(repo.findBookByKey("isbn:9780141184272")!.created_by, "seed");

  const bare = repo.createBook({ title: "Two", author: "Author", isbn: "9780374520731" }, ["isbn:9780374520731"], NOW.toISOString());
  seedCatalog([entry("9780374520731", "Two")], repo, () => NOW);
  assert.equal(repo.getBook(bare.id)!.created_by, null);

  const byPublisher = seedBook({ isbn: "9780062315007", title: "Three", author: "Author" }, repo, () => NOW, "publisher").book!;
  seedCatalog([entry("9780062315007", "Three")], repo, () => NOW);
  assert.equal(repo.getBook(byPublisher.id)!.created_by, "publisher");
});
