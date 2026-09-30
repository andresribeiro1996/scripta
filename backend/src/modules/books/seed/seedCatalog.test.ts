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

const { openBooksDb } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { seedCatalog } = await import("./seedCatalog.js");

const NOW = new Date("2026-10-01T00:00:00.000Z");

function entry(isbn: string, title: string, author = "Author") {
  return { isbn, title, author, lang: "eng" as const, workKey: `/works/${isbn}`, readers: 1, subjects: [] };
}

function setup() {
  const db = openBooksDb();
  db.exec("DELETE FROM book_keys; DELETE FROM books");
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
