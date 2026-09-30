import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-repo-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.COVERS_STORAGE_PATH = join(scratch, "covers-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./connection.js");
const { createSqliteBooksRepository } = await import("./sqliteBooksRepository.js");

const NOW = "2026-10-01T00:00:00.000Z";

function freshRepo() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

function legacyDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE cover_cache (
    id TEXT PRIMARY KEY, cache_key TEXT NOT NULL UNIQUE, source TEXT NOT NULL, mime_type TEXT NOT NULL,
    extension TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, byte_size INTEGER NOT NULL, created_at TEXT NOT NULL
  )`);
  const insert = db.prepare(`INSERT INTO cover_cache VALUES (?, ?, 'openlibrary', 'image/webp', 'webp', ?, ?, 1000, '2026-01-01T00:00:00.000Z')`);
  insert.run("11111111-1111-4111-8111-111111111111", "isbn:9780141184272", 300, 460);
  insert.run("22222222-2222-4222-8222-222222222222", "isbn:9780374520731", 800, 1200);
  insert.run("33333333-3333-4333-8333-333333333333", "kobo:c6a6a5e2-0000-4000-8000-000000000000", 600, 900);
  return db;
}

test("migration turns legacy ISBN cache rows into books and drops cover_cache", () => {
  const db = legacyDb();
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);

  const low = repo.findBookByKey("isbn:9780141184272")!;
  assert.equal(low.isbn, "9780141184272");
  assert.equal(low.title, "");
  assert.equal(low.cover_image_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(low.cover_status, "low_res");
  assert.equal(low.cover_checked_at, "1970-01-01T00:00:00.000Z");
  assert.equal(repo.getImage(low.cover_image_id!)!.source_url, null);

  assert.equal(repo.findBookByKey("isbn:9780374520731")!.cover_status, "good");
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 2);
  assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'cover_cache'`).get(), undefined);

  applyBooksMigrations(db);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 2);
});

test("createBook returns the existing row for a key that is already taken", () => {
  const { repo } = freshRepo();
  const first = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, "isbn:9780141184272", NOW);
  const second = repo.createBook({ title: "Other", author: "Other", isbn: "9780141184272" }, "isbn:9780141184272", NOW);
  assert.equal(second.id, first.id);
  assert.equal(second.title, "Orlando");
  assert.equal(repo.getBook(first.id)!.genres, "[]");
});

test("fillIdentity only fills an empty title and does not make the book searchable", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "", author: "", isbn: "9780141184272" }, "isbn:9780141184272", NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
  repo.fillIdentity(book.id, "Orlando", "Virginia Woolf");
  repo.fillIdentity(book.id, "Changed", "Nobody");
  assert.equal(repo.getBook(book.id)!.title, "Orlando");
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
});

test("createBook alone does not make a book searchable", () => {
  const { repo } = freshRepo();
  repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, "isbn:9780141184272", NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
});

test("makeSearchable indexes a titled book, skips an untitled one, and is idempotent", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, "isbn:9780141184272", NOW);
  const untitled = repo.createBook({ title: "", author: "", isbn: "9780374520731" }, "isbn:9780374520731", NOW);

  repo.makeSearchable(untitled.id);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);

  repo.makeSearchable(book.id);
  repo.makeSearchable(book.id);
  assert.equal(repo.searchBooks(["orlando"], 12).length, 1);
});

test("search is diacritic-insensitive, requires every token and ignores an empty token list", () => {
  const { repo } = freshRepo();
  const antidoto = repo.createBook({ title: "Antídoto", author: "José Luís Peixoto", isbn: null }, "ta:antidoto|jose luis peixoto", NOW);
  const dune = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, "isbn:9780441013593", NOW);
  repo.makeSearchable(antidoto.id);
  repo.makeSearchable(dune.id);
  assert.equal(repo.searchBooks(["antidoto"], 12)[0]!.title, "Antídoto");
  assert.equal(repo.searchBooks(["dune", "herbert"], 12).length, 1);
  assert.equal(repo.searchBooks(["dune", "messiah"], 12).length, 0);
  assert.deepEqual(repo.searchBooks([], 12), []);
});

test("covers, rejections and details round-trip", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, "ta:dune|frank herbert", NOW);
  repo.insertImage({ id: "img-1", book_id: book.id, source: "apple", source_url: "https://img.test/1", width: 900, height: 1400, byte_size: 10, created_at: NOW });
  repo.setCover(book.id, { imageId: "img-1", status: "good", checkedAt: NOW });
  assert.equal(repo.getBook(book.id)!.cover_image_id, "img-1");
  assert.equal(repo.getImage("img-1")!.width, 900);

  repo.addRejection(book.id, "https://img.test/1", NOW);
  repo.addRejection(book.id, "https://img.test/1", NOW);
  assert.deepEqual([...repo.listRejectedUrls(book.id)], ["https://img.test/1"]);

  repo.saveDetails(book.id, { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"] }, ["openlibrary", "isbndb"], NOW);
  const saved = repo.getBook(book.id)!;
  assert.equal(saved.details_status, "found");
  assert.equal(saved.summary, "Spice.");
  assert.equal(saved.genres, '["Science Fiction"]');
  assert.equal(saved.data_sources, '["openlibrary","isbndb"]');

  repo.markDetailsMissing(book.id, NOW);
  assert.equal(repo.getBook(book.id)!.details_status, "missing");
});

test("listUncheckedCoverIds returns only never-checked books, oldest first", () => {
  const { repo } = freshRepo();
  const newer = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, "ta:emma|jane austen", "2026-10-02T00:00:00.000Z");
  const older = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, "ta:dune|frank herbert", "2026-10-01T00:00:00.000Z");
  const good = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: null }, "ta:orlando|virginia woolf", NOW);
  const missing = repo.createBook({ title: "Ulysses", author: "James Joyce", isbn: null }, "ta:ulysses|james joyce", NOW);
  repo.insertImage({ id: "img-1", book_id: good.id, source: "apple", source_url: null, width: 900, height: 1400, byte_size: 10, created_at: NOW });
  repo.setCover(good.id, { imageId: "img-1", status: "good", checkedAt: NOW });
  repo.setCover(missing.id, { imageId: null, status: "missing", checkedAt: NOW });
  assert.deepEqual(repo.listUncheckedCoverIds(), [older.id, newer.id]);
});

test("createBook stores the sources of a new row and defaults to none", () => {
  const { repo } = freshRepo();
  const tagged = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null, sources: ["isbndb"] }, "ta:dune|frank herbert", NOW);
  assert.equal(tagged.data_sources, '["isbndb"]');
  assert.equal(repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, "ta:emma|jane austen", NOW).data_sources, "[]");
});

test("the migration adds data_sources to a books table that predates it", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, year INTEGER, publisher TEXT, isbn TEXT, ol_cover_id INTEGER,
    summary TEXT, rating REAL, rating_count INTEGER NOT NULL DEFAULT 0, genres TEXT NOT NULL DEFAULT '[]', source_url TEXT,
    details_status TEXT, details_checked_at TEXT, cover_image_id TEXT, cover_status TEXT, cover_checked_at TEXT, created_at TEXT NOT NULL
  )`);
  db.prepare(`INSERT INTO books (id, title, author, created_at) VALUES ('old', 'Dune', 'Frank Herbert', ?)`).run(NOW);
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  assert.equal(repo.getBook("old")!.data_sources, "[]");
  repo.saveDetails("old", { summary: "Spice.", rating: null, ratingCount: 0, sourceUrl: "https://isbndb.com/book/1", genres: [] }, ["isbndb"], NOW);
  assert.equal(repo.getBook("old")!.data_sources, '["isbndb"]');
});

test("the ISBNdb lapse cleanup clears only rows tagged with it", () => {
  const { db, repo } = freshRepo();
  const details = { summary: "Spice.", rating: 4, ratingCount: 1, sourceUrl: "https://example.test/", genres: ["Fantasy" as const] };
  const both = repo.createBook({ title: "A", author: "A", isbn: null }, "ta:a|a", NOW);
  const only = repo.createBook({ title: "B", author: "B", isbn: null, sources: ["isbndb"], genres: ["Fantasy"] }, "ta:b|b", NOW);
  const open = repo.createBook({ title: "C", author: "C", isbn: null }, "ta:c|c", NOW);
  repo.saveDetails(both.id, details, ["openlibrary", "isbndb"], NOW);
  repo.saveDetails(open.id, details, ["openlibrary"], NOW);
  db.exec(`UPDATE books SET summary = NULL, genres = '[]', details_status = NULL, details_checked_at = NULL, source_url = NULL, data_sources = '[]' WHERE EXISTS (SELECT 1 FROM json_each(books.data_sources) WHERE value = 'isbndb')`);
  for (const id of [both.id, only.id]) {
    const row = repo.getBook(id)!;
    assert.deepEqual([row.summary, row.genres, row.details_status, row.source_url, row.data_sources], [null, "[]", null, null, "[]"]);
  }
  assert.deepEqual([repo.getBook(open.id)!.summary, repo.getBook(open.id)!.data_sources], ["Spice.", '["openlibrary"]']);
});
