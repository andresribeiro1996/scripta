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
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./connection.js");
const { createSqliteBooksRepository } = await import("./sqliteBooksRepository.js");

const NOW = "2026-10-01T00:00:00.000Z";
const richDetails = { summary: "Open Library synopsis.", rating: 4, ratingCount: 3, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Fantasy" as const], pages: 300, publisher: "Bantam", year: 1975, translator: null };

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
  const first = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW);
  const second = repo.createBook({ title: "Other", author: "Other", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW);
  assert.equal(second.id, first.id);
  assert.equal(second.title, "Orlando");
  assert.equal(repo.getBook(first.id)!.genres, "[]");
});

test("fillIdentity only fills an empty title and does not make the book searchable", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "", author: "", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
  repo.fillIdentity(book.id, "Orlando", "Virginia Woolf");
  repo.fillIdentity(book.id, "Changed", "Nobody");
  assert.equal(repo.getBook(book.id)!.title, "Orlando");
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
});

test("createBook alone does not make a book searchable", () => {
  const { repo } = freshRepo();
  repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
});

test("makeSearchable indexes a titled book, skips an untitled one, and is idempotent", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW);
  const untitled = repo.createBook({ title: "", author: "", isbn: "9780374520731" }, ["isbn:9780374520731"], NOW);

  repo.makeSearchable(untitled.id);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);

  repo.makeSearchable(book.id);
  repo.makeSearchable(book.id);
  assert.equal(repo.searchBooks(["orlando"], 12).length, 1);
});

test("search is diacritic-insensitive, requires every token and ignores an empty token list", () => {
  const { repo } = freshRepo();
  const antidoto = repo.createBook({ title: "Antídoto", author: "José Luís Peixoto", isbn: null }, ["ta:antidoto|jose luis peixoto|"], NOW);
  const dune = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], NOW);
  repo.makeSearchable(antidoto.id);
  repo.makeSearchable(dune.id);
  assert.equal(repo.searchBooks(["antidoto"], 12)[0]!.title, "Antídoto");
  assert.equal(repo.searchBooks(["dune", "herbert"], 12).length, 1);
  assert.equal(repo.searchBooks(["dune", "messiah"], 12).length, 0);
  assert.deepEqual(repo.searchBooks([], 12), []);
});

test("covers, rejections and details round-trip", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], NOW);
  repo.insertImage({ id: "img-1", book_id: book.id, source: "apple", source_url: "https://img.test/1", width: 900, height: 1400, byte_size: 10, created_at: NOW });
  repo.setCover(book.id, { imageId: "img-1", status: "good", checkedAt: NOW });
  assert.equal(repo.getBook(book.id)!.cover_image_id, "img-1");
  assert.equal(repo.getImage("img-1")!.width, 900);

  repo.addRejection(book.id, "https://img.test/1", NOW);
  repo.addRejection(book.id, "https://img.test/1", NOW);
  assert.deepEqual([...repo.listRejectedUrls(book.id)], ["https://img.test/1"]);

  repo.saveDetails(book.id, { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"], pages: null, publisher: null, year: null, translator: null }, ["openlibrary", "isbndb"], "openlibrary", NOW);
  const saved = repo.getBook(book.id)!;
  assert.equal(saved.details_status, "found");
  assert.equal(saved.summary, "Spice.");
  assert.equal(saved.genres, '["Science Fiction"]');
  assert.equal(saved.data_sources, '["openlibrary","isbndb"]');

  repo.markDetailsMissing(book.id, NOW);
  assert.equal(repo.getBook(book.id)!.details_status, "missing");
});

test("createBook registers every key and addKey aliases an existing book", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593", "ta:dune|frank herbert|"], "2026-09-30T00:00:00.000Z");
  assert.equal(repo.findBookByKey("ta:dune|frank herbert|")?.id, book.id);
  repo.addKey("isbn:9780593099322", book.id);
  repo.addKey("isbn:9780593099322", "someone-else");
  assert.equal(repo.findBookByKey("isbn:9780593099322")?.id, book.id);
});

test("backfill adds a title key to existing rows once", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.prepare("INSERT INTO books (id, title, author, genres, created_at) VALUES ('b1', 'Orlando', 'Virginia Woolf', '[]', 't')").run();
  db.exec("PRAGMA user_version = 0");
  applyBooksMigrations(db);
  assert.equal((db.prepare("SELECT book_id FROM book_keys WHERE key = 'ta:orlando|virginia woolf|'").get() as { book_id: string }).book_id, "b1");
});

test("listUncheckedCoverIds returns only never-checked books, oldest first", () => {
  const { repo } = freshRepo();
  const newer = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, ["ta:emma|jane austen|"], "2026-10-02T00:00:00.000Z");
  const older = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], "2026-10-01T00:00:00.000Z");
  const good = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: null }, ["ta:orlando|virginia woolf|"], NOW);
  const missing = repo.createBook({ title: "Ulysses", author: "James Joyce", isbn: null }, ["ta:ulysses|james joyce|"], NOW);
  repo.insertImage({ id: "img-1", book_id: good.id, source: "apple", source_url: null, width: 900, height: 1400, byte_size: 10, created_at: NOW });
  repo.setCover(good.id, { imageId: "img-1", status: "good", checkedAt: NOW });
  repo.setCover(missing.id, { imageId: null, status: "missing", checkedAt: NOW });
  assert.deepEqual(repo.listUncheckedCoverIds(), [older.id, newer.id]);
});

test("listUncheckedDetailIds returns never-checked books, oldest first, up to the limit", () => {
  const { repo } = freshRepo();
  const newest = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, ["ta:emma|jane austen|"], "2026-10-03T00:00:00.000Z");
  const oldest = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], "2026-10-01T00:00:00.000Z");
  const middle = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: null }, ["ta:orlando|virginia woolf|"], "2026-10-02T00:00:00.000Z");
  const found = repo.createBook({ title: "Ulysses", author: "James Joyce", isbn: null }, ["ta:ulysses|james joyce|"], NOW);
  const missing = repo.createBook({ title: "Kim", author: "Rudyard Kipling", isbn: null }, ["ta:kim|rudyard kipling|"], NOW);
  repo.saveDetails(found.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  repo.markDetailsMissing(missing.id, NOW);
  assert.deepEqual(repo.listUncheckedDetailIds(10), [oldest.id, middle.id, newest.id]);
  assert.deepEqual(repo.listUncheckedDetailIds(2), [oldest.id, middle.id]);
});

test("books users brought in come before the seed and publisher backlog, whatever their age", () => {
  const { repo } = freshRepo();
  const seeded = Array.from({ length: 60 }, (_, index) => repo.createBook({ title: `Seed ${index}`, author: "Author", isbn: null, createdBy: index % 2 === 0 ? "seed" : "publisher" }, [`ta:seed ${index}|author|`], `2026-09-01T00:00:${String(index).padStart(2, "0")}.000Z`));
  const user = repo.createBook({ title: "Mine", author: "Reader", isbn: null }, ["ta:mine|reader|"], "2026-10-01T00:00:00.000Z");
  const batch = repo.listUncheckedDetailIds(50);
  assert.equal(batch[0], user.id);
  assert.deepEqual(batch.slice(1), seeded.slice(0, 49).map((book) => book.id));
});

test("failing user books fall behind every untried book and cannot starve the backlog", () => {
  const { repo } = freshRepo();
  const failing = Array.from({ length: 60 }, (_, index) => repo.createBook({ title: `Mine ${index}`, author: "Reader", isbn: null }, [`ta:mine ${index}|reader|`], "2026-09-01T00:00:00.000Z"));
  for (const book of failing) repo.markDetailsAttempted(book.id, NOW);
  const seed = repo.createBook({ title: "Seed", author: "Author", isbn: null, createdBy: "seed" }, ["ta:seed|author|"], "2026-10-02T00:00:00.000Z");
  const batch = repo.listUncheckedDetailIds(50);
  assert.equal(batch[0], seed.id);
  assert.equal(batch.length, 50);
});

test("a book whose lookup failed moves behind the untried ones without being marked checked", () => {
  const { repo } = freshRepo();
  const failed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], "2026-10-01T00:00:00.000Z");
  const untried = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, ["ta:emma|jane austen|"], "2026-10-02T00:00:00.000Z");
  repo.markDetailsAttempted(failed.id, NOW);
  assert.deepEqual(repo.listUncheckedDetailIds(10), [untried.id, failed.id]);
  assert.equal(repo.getBook(failed.id)!.details_status, null);
});

test("createBook stores the sources of a new row and defaults to none", () => {
  const { repo } = freshRepo();
  const tagged = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null, sources: ["isbndb"] }, ["ta:dune|frank herbert|"], NOW);
  assert.equal(tagged.data_sources, '["isbndb"]');
  assert.equal(repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, ["ta:emma|jane austen|"], NOW).data_sources, "[]");
});

test("the upgrade-wanted mark round-trips and lists oldest first", () => {
  const { repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  const b = repo.createBook({ title: "B", author: "B", isbn: null }, ["ta:b|b|"], NOW);
  const c = repo.createBook({ title: "C", author: "C", isbn: null }, ["ta:c|c|"], NOW);
  assert.equal(a.cover_upgrade_wanted_at, null);
  assert.deepEqual(repo.listUpgradeWantedIds(), []);
  repo.setUpgradeWanted(b.id, "2026-10-01T00:00:02.000Z");
  repo.setUpgradeWanted(a.id, "2026-10-01T00:00:01.000Z");
  assert.equal(repo.getBook(a.id)!.cover_upgrade_wanted_at, "2026-10-01T00:00:01.000Z");
  assert.deepEqual(repo.listUpgradeWantedIds(), [a.id, b.id]);
  repo.setUpgradeWanted(a.id, null);
  assert.equal(repo.getBook(a.id)!.cover_upgrade_wanted_at, null);
  assert.deepEqual(repo.listUpgradeWantedIds(), [b.id]);
  assert.equal(repo.getBook(c.id)!.cover_upgrade_wanted_at, null);
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
  assert.equal(repo.getBook("old")!.cover_upgrade_wanted_at, null);
  repo.setUpgradeWanted("old", NOW);
  assert.deepEqual(repo.listUpgradeWantedIds(), ["old"]);
  repo.saveDetails("old", { summary: "Spice.", rating: null, ratingCount: 0, sourceUrl: "https://isbndb.com/book/1", genres: [], pages: null, publisher: null, year: null, translator: null }, ["isbndb"], "isbndb", NOW);
  assert.equal(repo.getBook("old")!.data_sources, '["isbndb"]');
});

const LAPSE_CLEANUP = `UPDATE books SET summary = CASE WHEN summary_source IS NULL OR summary_source = 'isbndb' THEN NULL ELSE summary END, summary_source = CASE WHEN summary_source = 'isbndb' THEN NULL ELSE summary_source END, genres = '[]', details_status = NULL, details_checked_at = NULL, source_url = NULL, data_sources = '[]' WHERE EXISTS (SELECT 1 FROM json_each(books.data_sources) WHERE value = 'isbndb')`;

test("the ISBNdb lapse cleanup clears only rows tagged with it, and only an ISBNdb synopsis", () => {
  const { db, repo } = freshRepo();
  const details = { summary: "Spice.", rating: 4, ratingCount: 1, sourceUrl: "https://example.test/", genres: ["Fantasy" as const], pages: null, publisher: null, year: null, translator: null };
  const both = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  const only = repo.createBook({ title: "B", author: "B", isbn: null, sources: ["isbndb"], genres: ["Fantasy"] }, ["ta:b|b|"], NOW);
  const open = repo.createBook({ title: "C", author: "C", isbn: null }, ["ta:c|c|"], NOW);
  const publisher = repo.createBook({ title: "D", author: "D", isbn: null, sources: ["isbndb"] }, ["ta:d|d|"], NOW);
  const legacy = repo.createBook({ title: "E", author: "E", isbn: null, sources: ["isbndb"] }, ["ta:e|e|"], NOW);
  repo.saveDetails(both.id, details, ["isbndb"], "isbndb", NOW);
  repo.saveDetails(open.id, details, ["openlibrary"], "openlibrary", NOW);
  repo.mergeDetails(publisher.id, { ...details, summary: "Sinopse." }, "publisher");
  repo.saveDetails(only.id, { ...details, summary: null }, ["openlibrary"], null, NOW);
  db.exec(`UPDATE books SET summary = 'Old.', summary_source = NULL WHERE id = '${legacy.id}'`);
  db.exec(LAPSE_CLEANUP);
  for (const id of [both.id, only.id, legacy.id]) {
    const row = repo.getBook(id)!;
    assert.deepEqual([row.summary, row.summary_source, row.genres, row.details_status, row.source_url, row.data_sources], [null, null, "[]", null, null, "[]"]);
  }
  const kept = repo.getBook(publisher.id)!;
  assert.deepEqual([kept.summary, kept.summary_source, kept.data_sources], ["Sinopse.", "publisher", "[]"]);
  assert.deepEqual([repo.getBook(open.id)!.summary, repo.getBook(open.id)!.data_sources], ["Spice.", '["openlibrary"]']);
});

test("saving details keeps the sources already recorded, in order and without repeats", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null, sources: ["isbndb"], genres: ["Romance"] }, ["ta:a|a|"], NOW);
  repo.saveDetails(book.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  assert.equal(repo.getBook(book.id)!.data_sources, '["isbndb","openlibrary"]');
  assert.equal(repo.getBook(book.id)!.genres, '["Romance"]');
  repo.markDetailsMissing(book.id, NOW);
  repo.saveDetails(book.id, richDetails, ["isbndb", "openlibrary"], "openlibrary", NOW);
  assert.equal(repo.getBook(book.id)!.data_sources, '["isbndb","openlibrary"]');
});

test("an existing database gains ol_work_key on boot, empty", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, year INTEGER, publisher TEXT, isbn TEXT, ol_cover_id INTEGER,
    summary TEXT, rating REAL, rating_count INTEGER NOT NULL DEFAULT 0, genres TEXT NOT NULL DEFAULT '[]', source_url TEXT,
    details_status TEXT, details_checked_at TEXT, cover_image_id TEXT, cover_status TEXT, cover_checked_at TEXT, created_at TEXT NOT NULL
  )`);
  db.prepare(`INSERT INTO books (id, title, author, created_at) VALUES ('old', 'Dune', 'Frank Herbert', ?)`).run(NOW);
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  assert.equal(createSqliteBooksRepository(db).getBook("old")!.ol_work_key, null);
});

test("createBook stores a work key as the bare id and nulls a malformed one", () => {
  const { repo } = freshRepo();
  const bare = repo.createBook({ title: "A", author: "A", isbn: null, workKey: "OL82563W" }, ["ta:a|a|"], NOW);
  const prefixed = repo.createBook({ title: "B", author: "B", isbn: null, workKey: "/works/OL1W" }, ["ta:b|b|"], NOW);
  assert.equal(bare.ol_work_key, "OL82563W");
  assert.equal(prefixed.ol_work_key, "OL1W");
  const bad = ["/books/OL1M", "OL1", "//untrusted.test/works/OL1W", "", null, undefined].map((workKey, index) =>
    repo.createBook({ title: `C${index}`, author: "C", isbn: null, workKey }, [`ta:c${index}|c|`], NOW)
  );
  assert.deepEqual(bad.map((book) => book.ol_work_key), [null, null, null, null, null, null]);
});

test("setWorkKey fills a null key, never overwrites one, and ignores a malformed key", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  repo.setWorkKey(book.id, "not a key");
  repo.setWorkKey(book.id, null);
  assert.equal(repo.getBook(book.id)!.ol_work_key, null);
  repo.setWorkKey(book.id, "/works/OL1W");
  assert.equal(repo.getBook(book.id)!.ol_work_key, "OL1W");
  repo.setWorkKey(book.id, "OL2W");
  assert.equal(repo.getBook(book.id)!.ol_work_key, "OL1W");
});

test("an existing database gains publisher_url, created_by and cover_images.origin on boot, idempotently", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, year INTEGER, publisher TEXT, isbn TEXT, ol_cover_id INTEGER,
    summary TEXT, rating REAL, rating_count INTEGER NOT NULL DEFAULT 0, genres TEXT NOT NULL DEFAULT '[]', source_url TEXT,
    details_status TEXT, details_checked_at TEXT, cover_image_id TEXT, cover_status TEXT, cover_checked_at TEXT, created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE cover_images (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT, width INTEGER NOT NULL, height INTEGER NOT NULL,
    byte_size INTEGER NOT NULL, created_at TEXT NOT NULL
  )`);
  db.prepare(`INSERT INTO books (id, title, author, created_at) VALUES ('old', 'Dune', 'Frank Herbert', ?)`).run(NOW);
  db.prepare(`INSERT INTO cover_images VALUES ('img', 'old', 'publisher', 'https://x.test/a.jpg', 900, 1400, 10, ?)`).run(NOW);
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const book = repo.getBook("old")!;
  assert.equal(book.publisher_url, null);
  assert.equal(book.created_by, null);
  assert.equal(book.pages, null);
  assert.equal(book.translator, null);
  assert.equal(book.summary_source, null);
  assert.equal(repo.getImage("img")!.origin, null);
});

test("insertImage stores the origin and createBook stores its creator", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null, createdBy: "publisher" }, ["ta:a|a|"], NOW);
  const plain = repo.createBook({ title: "B", author: "B", isbn: null }, ["ta:b|b|"], NOW);
  assert.equal(book.created_by, "publisher");
  assert.equal(plain.created_by, null);
  repo.insertImage({ id: "with", book_id: book.id, source: "publisher", source_url: "https://antigona.pt/a.jpg", origin: "https://antigona.pt", width: 900, height: 1400, byte_size: 10, created_at: NOW });
  repo.insertImage({ id: "without", book_id: book.id, source: "apple", source_url: null, width: 900, height: 1400, byte_size: 10, created_at: NOW });
  assert.equal(repo.getImage("with")!.origin, "https://antigona.pt");
  assert.equal(repo.getImage("without")!.origin, null);
});

test("setPublisherUrl fills a null value and never overwrites it", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  assert.equal(book.publisher_url, null);
  repo.setPublisherUrl(book.id, "https://antigona.pt/products/a");
  assert.equal(repo.getBook(book.id)!.publisher_url, "https://antigona.pt/products/a");
  repo.setPublisherUrl(book.id, "https://other.pt/products/a");
  assert.equal(repo.getBook(book.id)!.publisher_url, "https://antigona.pt/products/a");
});

const noDetails = { summary: null, pages: null, year: null, publisher: null, translator: null };

test("a publisher synopsis replaces an Open Library one, and never the other way round", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  repo.saveDetails(book.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.summary_source], ["Open Library synopsis.", "openlibrary"]);

  repo.mergeDetails(book.id, { ...noDetails, summary: "Sinopse da editora." }, "publisher");
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.summary_source], ["Sinopse da editora.", "publisher"]);

  repo.mergeDetails(book.id, { ...noDetails, summary: "Outra sinopse." }, "publisher");
  repo.saveDetails(book.id, { ...richDetails, summary: "Later Open Library synopsis." }, ["openlibrary"], "openlibrary", NOW);
  repo.mergeDetails(book.id, { ...noDetails, summary: "ISBNdb synopsis." }, "isbndb");
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.summary_source], ["Sinopse da editora.", "publisher"]);
});

test("a non-publisher synopsis only fills an empty summary and an absent one changes nothing", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  repo.mergeDetails(book.id, noDetails, "openlibrary");
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.summary_source], [null, null]);
  repo.mergeDetails(book.id, { ...noDetails, summary: "ISBNdb synopsis." }, "isbndb");
  repo.mergeDetails(book.id, { ...noDetails, summary: "Open Library synopsis." }, "openlibrary");
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.summary_source], ["ISBNdb synopsis.", "isbndb"]);
});

test("pages, year, publisher, translator and genres only fill what is empty, while the rating is overwritten", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null, genres: ["Romance"] }, ["ta:a|a|"], NOW);
  repo.mergeDetails(book.id, { summary: null, pages: 250, year: 2001, publisher: "Antígona", translator: "Maria" }, "publisher");
  repo.saveDetails(book.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  const row = repo.getBook(book.id)!;
  assert.deepEqual([row.pages, row.year, row.publisher, row.translator], [250, 2001, "Antígona", "Maria"]);
  assert.equal(row.genres, '["Romance"]');
  assert.deepEqual([row.rating, row.rating_count, row.source_url, row.details_status, row.data_sources], [4, 3, "https://openlibrary.org/works/OL1W", "found", '["openlibrary"]']);

  const empty = repo.createBook({ title: "B", author: "B", isbn: null }, ["ta:b|b|"], NOW);
  repo.saveDetails(empty.id, { ...richDetails, translator: "Ana" }, ["openlibrary"], "openlibrary", NOW);
  const filled = repo.getBook(empty.id)!;
  assert.deepEqual([filled.pages, filled.year, filled.publisher, filled.translator, filled.genres], [300, 1975, "Bantam", "Ana", '["Fantasy"]']);
});

test("publisher details never mark a book found or touch its data sources", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  repo.mergeDetails(book.id, { summary: "Sinopse.", pages: 100, year: 2020, publisher: "Antígona", translator: null }, "publisher");
  const row = repo.getBook(book.id)!;
  assert.deepEqual([row.details_status, row.details_checked_at, row.data_sources, row.rating], [null, null, "[]", null]);
});
