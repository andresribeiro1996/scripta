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

const { applyBooksMigrations, openBooksDb } = await import("./connection.js");
const { createSqliteBooksRepository } = await import("./sqliteBooksRepository.js");
const { WorkMergeError } = await import("../../domain/errors.js");

const NOW = "2026-10-01T00:00:00.000Z";
const richDetails = { summary: "Open Library synopsis.", rating: 4, ratingCount: 3, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Fantasy" as const], pages: 300, publisher: "Bantam", year: 1975, translator: null };

function freshRepo() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

interface WorkRow {
  id: string;
  ol_work_key: string | null;
  title: string;
  author: string;
  merged_into: string | null;
  created_at: string;
}

const countOf = (db: DatabaseSync, table: string, where = "1") => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
const workById = (db: DatabaseSync, id: string | null) => db.prepare("SELECT * FROM works WHERE id = ?").get(id) as unknown as WorkRow;
const workOf = (db: DatabaseSync, bookId: string) => db.prepare("SELECT works.* FROM books JOIN works ON works.id = books.work_id WHERE books.id = ?").get(bookId) as unknown as WorkRow;

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

test("createBook returns the existing row for a key that is already taken, and creates no work", () => {
  const { db, repo } = freshRepo();
  const first = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW);
  const second = repo.createBook({ title: "Other", author: "Other", isbn: "9780141184272", workKey: "OL1W" }, ["isbn:9780141184272"], NOW);
  assert.equal(second.id, first.id);
  assert.equal(second.title, "Orlando");
  assert.equal(repo.getBook(first.id)!.genres, "[]");
  assert.equal(db.isTransaction, false);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 1);
  assert.equal(countOf(db, "works"), 1);
});

test("setCoverIf writes only while the book still has the expected cover", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], NOW);
  assert.equal(repo.setCoverIf(book.id, "img-0", { imageId: "img-1", status: "manual", checkedAt: NOW }), false);
  assert.equal(repo.getBook(book.id)!.cover_image_id, null);
  assert.equal(repo.setCoverIf(book.id, null, { imageId: "img-1", status: "manual", checkedAt: NOW }), true);
  assert.equal(repo.getBook(book.id)!.cover_image_id, "img-1");
  assert.equal(repo.setCoverIf(book.id, null, { imageId: "img-2", status: "manual", checkedAt: NOW }), false);
  assert.equal(repo.setCoverIf(book.id, "img-1", { imageId: "img-2", status: "good", checkedAt: NOW }), true);
  assert.equal(repo.getBook(book.id)!.cover_image_id, "img-2");
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

test("createBook surfaces the insert's own error and leaves nothing behind when the key insert aborts", () => {
  const { db, repo } = freshRepo();
  db.exec(`CREATE TRIGGER fail_key BEFORE INSERT ON book_keys BEGIN SELECT RAISE(ABORT, 'key insert refused'); END`);
  assert.throws(
    () => repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW),
    /key insert refused/
  );
  assert.equal(db.isTransaction, false);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM book_keys`).get() as { n: number }).n, 0);
});

test("createBook surfaces the insert's own error when SQLite already rolled the transaction back", () => {
  const { db, repo } = freshRepo();
  db.exec(`CREATE TRIGGER fail_key BEFORE INSERT ON book_keys BEGIN SELECT RAISE(ROLLBACK, 'key insert rolled back'); END`);
  assert.throws(
    () => repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW),
    /key insert rolled back/
  );
  assert.equal(db.isTransaction, false);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 0);
});

test("createBook starts its transaction as a write", () => {
  const { db, repo } = freshRepo();
  const seen: boolean[] = [];
  const exec = db.exec.bind(db);
  db.exec = (sql: string) => {
    seen.push(sql === "BEGIN IMMEDIATE");
    return exec(sql);
  };
  repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW);
  assert.equal(seen[0], true);
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

test("listUncheckedCoverIds includes a low-res cover stored without a check time, never a manual one", () => {
  const { repo } = freshRepo();
  const low = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], NOW);
  const manual = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, ["ta:emma|jane austen|"], NOW);
  repo.insertImage({ id: "img-low", book_id: low.id, source: "apple", source_url: null, width: 300, height: 460, byte_size: 10, created_at: NOW });
  repo.setCover(low.id, { imageId: "img-low", status: "low_res", checkedAt: null });
  repo.insertImage({ id: "img-manual", book_id: manual.id, source: "upload", source_url: null, width: 300, height: 460, byte_size: 10, created_at: NOW });
  repo.setCover(manual.id, { imageId: "img-manual", status: "manual", checkedAt: null });
  assert.deepEqual(repo.listUncheckedCoverIds(), [low.id]);
  repo.setCover(low.id, { imageId: "img-low", status: "low_res", checkedAt: NOW });
  assert.deepEqual(repo.listUncheckedCoverIds(), []);
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
  assert.equal(book.apple_checked_at, null);
  assert.equal(repo.getImage("img")!.origin, null);
});

const WORK_COLUMNS = ["work_id", "language", "work_checked_at"];

function assertWorkSchema(db: DatabaseSync) {
  const names = (sql: string) => (db.prepare(sql).all() as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(names("PRAGMA table_info(works)"), ["id", "ol_work_key", "title", "author", "merged_into", "created_at"]);
  assert.deepEqual(names("PRAGMA table_info(books)").filter((name) => WORK_COLUMNS.includes(name)), WORK_COLUMNS);
  assert.deepEqual(names("PRAGMA index_info(idx_books_work)"), ["work_id"]);
  assert.throws(() => db.prepare("INSERT INTO books (id, title, author, work_id, created_at) VALUES ('orphan', 'A', 'A', 'missing', ?)").run(NOW), /FOREIGN KEY constraint failed/);
}

test("an existing database gains works, work_id, language, work_checked_at and the work index on boot, and a second boot changes nothing", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, year INTEGER, publisher TEXT, isbn TEXT, ol_cover_id INTEGER,
    summary TEXT, rating REAL, rating_count INTEGER NOT NULL DEFAULT 0, genres TEXT NOT NULL DEFAULT '[]', source_url TEXT,
    details_status TEXT, details_checked_at TEXT, cover_image_id TEXT, cover_status TEXT, cover_checked_at TEXT, created_at TEXT NOT NULL
  )`);
  db.prepare(`INSERT INTO books (id, title, author, created_at) VALUES ('old', 'Dune', 'Frank Herbert', ?)`).run(NOW);
  const snapshot = () => ({
    schema: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all(),
    books: db.prepare("SELECT * FROM books").all()
  });

  applyBooksMigrations(db);
  const booted = snapshot();
  assertWorkSchema(db);
  applyBooksMigrations(db);
  assert.deepEqual(snapshot(), booted);

  const old = createSqliteBooksRepository(db).getBook("old")!;
  assert.deepEqual([old.work_id, old.language, old.work_checked_at], [null, null, null]);
});

test("a new database has works, work_id, language, work_checked_at and the work index", () => {
  assertWorkSchema(freshRepo().db);
});

test("works allow any number of keyless rows but one row per Open Library key, and merged_into must name a work", () => {
  const { db } = freshRepo();
  const insert = db.prepare("INSERT INTO works (id, ol_work_key, title, author, merged_into, created_at) VALUES (?, ?, 'Dune', 'Frank Herbert', ?, ?)");
  insert.run("w1", "OL1W", null, NOW);
  insert.run("w2", null, null, NOW);
  insert.run("w3", null, "w1", NOW);
  assert.throws(() => insert.run("w4", "OL1W", null, NOW), /UNIQUE constraint failed: works\.ol_work_key/);
  assert.throws(() => insert.run("w5", null, "missing", NOW), /FOREIGN KEY constraint failed/);
});

test("editions created with one work key share a work, titled by the first of them", () => {
  const { db, repo } = freshRepo();
  const english = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "/works/OL893415W" }, ["isbn:9780441013593"], NOW);
  const portuguese = repo.createBook({ title: "Duna", author: "Frank Herbert", isbn: "9789722046114", workKey: "OL893415W" }, ["isbn:9789722046114"], "2026-10-02T00:00:00.000Z");
  assert.equal(portuguese.work_id, english.work_id);
  assert.equal(countOf(db, "works"), 1);
  const work = workOf(db, english.id);
  assert.deepEqual([work.ol_work_key, work.title, work.author, work.merged_into, work.created_at], ["OL893415W", "Dune", "Frank Herbert", null, NOW]);
});

test("a keyless edition gets a work of its own, even beside another edition with the same title and author", () => {
  const { db, repo } = freshRepo();
  const first = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], NOW);
  const second = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322" }, ["isbn:9780593099322"], NOW);
  assert.notEqual(second.work_id, first.work_id);
  assert.equal(countOf(db, "works"), 2);
  const work = workOf(db, first.id);
  assert.deepEqual([work.ol_work_key, work.title, work.author, work.merged_into], [null, "Dune", "Frank Herbert", null]);
});

test("a late key lands on the edition's own work when no work holds it", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], NOW);
  repo.setWorkKey(book.id, "/works/OL1W");
  assert.equal(repo.getBook(book.id)!.work_id, book.work_id);
  assert.equal(workOf(db, book.id).ol_work_key, "OL1W");
  assert.equal(countOf(db, "works"), 1);
});

test("a late key whose work already holds other editions moves the edition there and leaves merged_into on its old work", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const late = repo.createBook({ title: "Duna", author: "Frank Herbert", isbn: "9789722046114" }, ["isbn:9789722046114"], NOW);
  repo.setWorkKey(late.id, "/works/OL1W");
  const moved = repo.getBook(late.id)!;
  assert.deepEqual([moved.ol_work_key, moved.work_id], ["OL1W", keyed.work_id]);
  const old = workById(db, late.work_id);
  assert.deepEqual([old.merged_into, old.ol_work_key], [keyed.work_id, null]);
  assert.equal(workById(db, keyed.work_id).merged_into, null);
  assert.equal(repo.getBook(keyed.id)!.work_id, keyed.work_id);
  assert.equal(countOf(db, "works"), 2);
});

test("setWorkKey changes nothing on an edition that already has a key", () => {
  const { db, repo } = freshRepo();
  const first = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587", workKey: "OL2W" }, ["isbn:9780141439587"], NOW);
  const snapshot = () => ({
    works: db.prepare("SELECT * FROM works ORDER BY id").all(),
    books: db.prepare("SELECT id, ol_work_key, work_id FROM books ORDER BY id").all()
  });
  const before = snapshot();
  repo.setWorkKey(first.id, "OL2W");
  repo.setWorkKey(first.id, "OL3W");
  assert.deepEqual(snapshot(), before);
});

test("a late key never replaces the key a work already holds", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], NOW);
  db.prepare("UPDATE works SET ol_work_key = 'OL1W' WHERE id = ?").run(book.work_id);
  repo.setWorkKey(book.id, "OL2W");
  assert.equal(workById(db, book.work_id).ol_work_key, "OL1W");
});

test("a late key on an edition with no work yet joins or creates the keyed work", () => {
  const { db, repo } = freshRepo();
  const first = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], NOW);
  const second = repo.createBook({ title: "Duna", author: "Frank Herbert", isbn: "9789722046114" }, ["isbn:9789722046114"], "2026-10-02T00:00:00.000Z");
  db.exec("UPDATE books SET work_id = NULL; DELETE FROM works");
  repo.setWorkKey(first.id, "OL1W");
  repo.setWorkKey(second.id, "OL1W");
  assert.equal(countOf(db, "works"), 1);
  const work = workOf(db, first.id);
  assert.deepEqual([work.ol_work_key, work.title, work.author, work.merged_into, work.created_at], ["OL1W", "Dune", "Frank Herbert", null, NOW]);
  assert.equal(repo.getBook(second.id)!.work_id, work.id);
});

test("a late key leaves a work that still holds other editions alone, and merges it only once it is empty", () => {
  const { db, repo } = freshRepo();
  const first = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], NOW);
  const second = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322" }, ["isbn:9780593099322"], NOW);
  db.prepare("UPDATE books SET work_id = ? WHERE id = ?").run(first.work_id, second.id);

  repo.setWorkKey(first.id, "OL1W");
  const keyedId = repo.getBook(first.id)!.work_id;
  assert.notEqual(keyedId, first.work_id);
  assert.deepEqual([workById(db, keyedId).ol_work_key, workById(db, keyedId).title], ["OL1W", "Dune"]);
  assert.deepEqual([workById(db, first.work_id).ol_work_key, workById(db, first.work_id).merged_into], [null, null]);
  assert.equal(repo.getBook(second.id)!.work_id, first.work_id);

  repo.setWorkKey(second.id, "OL1W");
  assert.equal(repo.getBook(second.id)!.work_id, keyedId);
  assert.equal(workById(db, first.work_id).merged_into, keyedId);
});

test("fillIdentity titles the empty work of an importer-style edition, once", () => {
  const { db, repo } = freshRepo();
  const blank = repo.createBook({ title: "", author: "", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW);
  assert.deepEqual([workOf(db, blank.id).title, workOf(db, blank.id).author], ["", ""]);
  repo.fillIdentity(blank.id, "Orlando", "Virginia Woolf");
  repo.fillIdentity(blank.id, "Changed", "Nobody");
  assert.deepEqual([workOf(db, blank.id).title, workOf(db, blank.id).author], ["Orlando", "Virginia Woolf"]);
});

test("a titled edition that joins an empty keyed work titles it, whether it arrives with the key or gets it late", () => {
  const { db, repo } = freshRepo();
  const blank = repo.createBook({ title: "", author: "", isbn: "9780141184272", workKey: "OL1W" }, ["isbn:9780141184272"], NOW);
  repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780374520731", workKey: "OL1W" }, ["isbn:9780374520731"], NOW);
  assert.deepEqual([workOf(db, blank.id).title, workOf(db, blank.id).author], ["Orlando", "Virginia Woolf"]);

  const blankToo = repo.createBook({ title: "", author: "", isbn: "9780062315007", workKey: "OL2W" }, ["isbn:9780062315007"], NOW);
  const late = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], NOW);
  repo.setWorkKey(late.id, "OL2W");
  assert.deepEqual([workOf(db, blankToo.id).title, workOf(db, blankToo.id).author], ["Emma", "Jane Austen"]);
});

test("a work takes the author of a later edition when its first edition had none, and keeps its title", () => {
  const { db, repo } = freshRepo();
  const first = repo.createBook({ title: "Dune", author: "", isbn: "9780441013593", workKey: "OL2W" }, ["isbn:9780441013593"], NOW);
  repo.createBook({ title: "Duna", author: "Frank Herbert", isbn: "9789722046114", workKey: "OL2W" }, ["isbn:9789722046114"], NOW);
  assert.deepEqual([workOf(db, first.id).title, workOf(db, first.id).author], ["Dune", "Frank Herbert"]);
});

test("createBook leaves no work behind when the edition cannot be inserted", () => {
  const { db, repo } = freshRepo();
  db.exec("CREATE TRIGGER refuse_books BEFORE INSERT ON books BEGIN SELECT RAISE(ABORT, 'refused'); END");
  assert.throws(() => repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null, workKey: "OL1W" }, ["ta:dune|frank herbert|"], NOW), /refused/);
  assert.equal(countOf(db, "works"), 0);
  db.exec("DROP TRIGGER refuse_books");
  assert.ok(repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null, workKey: "OL1W" }, ["ta:dune|frank herbert|"], NOW).work_id);
});

test("setWorkKey leaves the edition without its key when the keyed work cannot be created", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], NOW);
  db.exec("UPDATE books SET work_id = NULL; DELETE FROM works");
  db.exec("CREATE TRIGGER refuse_works BEFORE INSERT ON works BEGIN SELECT RAISE(ABORT, 'refused'); END");
  assert.throws(() => repo.setWorkKey(book.id, "OL1W"), /refused/);
  const row = repo.getBook(book.id)!;
  assert.deepEqual([row.ol_work_key, row.work_id], [null, null]);
});

function afterFirstRead(db: DatabaseSync, other: () => void) {
  const prepare = db.prepare.bind(db);
  let done = false;
  db.prepare = (sql) => {
    const statement = prepare(sql);
    const get = statement.get.bind(statement) as (...args: unknown[]) => unknown;
    statement.get = ((...args: unknown[]) => {
      const row = get(...args);
      if (!done) {
        done = true;
        other();
      }
      return row;
    }) as typeof statement.get;
    return statement;
  };
}

test("createBook holds the write lock from its first read, so another connection cannot commit between its read and its write", () => {
  const mine = openBooksDb();
  const other = openBooksDb();
  other.exec("PRAGMA busy_timeout = 0");
  const insertOther = () => other.prepare("INSERT INTO books (id, title, author, created_at) VALUES ('other', 'Other', 'Author', ?)").run(NOW);
  let refused = "";
  afterFirstRead(mine, () => {
    try {
      insertOther();
    } catch (error) {
      refused = (error as Error).message;
    }
  });

  const book = createSqliteBooksRepository(mine).createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);

  assert.equal(book.title, "Dune");
  assert.match(refused, /database is locked/);
  insertOther();
  assert.equal(countOf(mine, "books"), 2);
});

test("assignMissingWorks gives editions without a work their works, grouping the keyed ones across batches", () => {
  const { db, repo } = freshRepo();
  const create = (title: string, author: string, isbn: string, workKey?: string) => repo.createBook({ title, author, isbn, workKey }, [`isbn:${isbn}`], NOW);
  const kept = create("Dune", "Frank Herbert", "9780441013593", "OL1W");
  const duna = create("Duna", "Frank Herbert", "9789722046114", "OL1W");
  const emma = create("Emma", "Jane Austen", "9780141439587", "OL2W");
  const emmaToo = create("Emma", "Jane Austen", "9780141439588", "OL2W");
  const orlando = create("Orlando", "Virginia Woolf", "9780141184272");
  const orlandoToo = create("Orlando", "Virginia Woolf", "9780374520731");
  const blankKeyed = create("", "", "9780062315007", "OL3W");
  const kim = create("Kim", "Rudyard Kipling", "9780141324906", "OL3W");
  const blank = create("", "", "9780140449136");
  db.prepare("UPDATE books SET work_id = NULL WHERE id != ?").run(kept.id);
  db.exec("DELETE FROM works WHERE id NOT IN (SELECT work_id FROM books WHERE work_id IS NOT NULL)");

  const batches = [repo.assignMissingWorks(3), repo.assignMissingWorks(3), repo.assignMissingWorks(3), repo.assignMissingWorks(3)];

  assert.deepEqual(batches, [3, 3, 2, 0]);
  assert.equal(countOf(db, "books", "work_id IS NULL"), 0);
  const workIdOf = (book: { id: string }) => repo.getBook(book.id)!.work_id;
  assert.equal(workIdOf(kept), kept.work_id);
  assert.equal(workIdOf(duna), kept.work_id);
  assert.equal(workIdOf(emmaToo), workIdOf(emma));
  assert.notEqual(workIdOf(orlandoToo), workIdOf(orlando));
  assert.equal(workIdOf(kim), workIdOf(blankKeyed));
  assert.deepEqual([workOf(db, kim.id).title, workOf(db, kim.id).author], ["Kim", "Rudyard Kipling"]);
  assert.deepEqual([workOf(db, blank.id).title, workOf(db, orlando.id).ol_work_key], ["", null]);
  assert.equal(countOf(db, "works"), 6);
  assert.equal(countOf(db, "books b JOIN works w ON w.id = b.work_id", "b.ol_work_key IS NOT w.ol_work_key"), 0);
  assert.equal(countOf(db, "works", "merged_into IS NOT NULL"), 0);
});

test("a failed assignMissingWorks batch assigns nothing, and the next one picks the same editions up", () => {
  const { db, repo } = freshRepo();
  repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  repo.createBook({ title: "Kim", author: "Rudyard Kipling", isbn: "9780141324906" }, ["isbn:9780141324906"], NOW);
  db.exec("UPDATE books SET work_id = NULL; DELETE FROM works");
  db.exec("CREATE TRIGGER refuse_kim BEFORE INSERT ON works WHEN NEW.title = 'Kim' BEGIN SELECT RAISE(ABORT, 'refused'); END");

  assert.throws(() => repo.assignMissingWorks(250), /refused/);
  assert.equal(countOf(db, "works"), 0);
  assert.equal(countOf(db, "books", "work_id IS NULL"), 2);

  db.exec("DROP TRIGGER refuse_kim");
  assert.equal(repo.assignMissingWorks(250), 2);
  assert.equal(countOf(db, "books", "work_id IS NULL"), 0);
});

test("assignMissingWorks puts a legacy edition whose key a work already holds into that work, without a second one", () => {
  const { db, repo } = freshRepo();
  const held = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const legacy = repo.createBook({ title: "Duna", author: "Frank Herbert", isbn: "9789722046114", workKey: "OL1W" }, ["isbn:9789722046114"], NOW);
  db.prepare("UPDATE books SET work_id = NULL WHERE id = ?").run(legacy.id);

  assert.equal(repo.assignMissingWorks(250), 1);

  assert.equal(repo.getBook(legacy.id)!.work_id, held.work_id);
  assert.equal(countOf(db, "works"), 1);
});

test("assignMissingWorks gives a legacy edition with no key a keyless work of its own, never a keyed work with the same title", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const legacy = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322" }, ["isbn:9780593099322"], NOW);
  const legacyToo = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099323" }, ["isbn:9780593099323"], NOW);
  db.prepare("UPDATE books SET work_id = NULL WHERE id IN (?, ?)").run(legacy.id, legacyToo.id);
  db.exec("DELETE FROM works WHERE id NOT IN (SELECT work_id FROM books WHERE work_id IS NOT NULL)");

  assert.equal(repo.assignMissingWorks(250), 2);

  const own = workOf(db, legacy.id);
  assert.equal(own.ol_work_key, null);
  assert.notEqual(own.id, keyed.work_id);
  assert.notEqual(workOf(db, legacyToo.id).id, own.id);
  assert.deepEqual((db.prepare("SELECT id FROM books WHERE work_id = ?").all(keyed.work_id) as Array<{ id: string }>).map((row) => row.id), [keyed.id]);
  assert.equal(countOf(db, "works"), 3);
});

test("setAppleChecked stamps the book and survives a repeated migration", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  assert.equal(book.apple_checked_at, null);
  repo.setAppleChecked(book.id, NOW);
  applyBooksMigrations(db);
  assert.equal(repo.getBook(book.id)!.apple_checked_at, NOW);
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

test("setLanguage fills an empty language and never overwrites one", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], NOW);
  assert.equal(book.language, null);
  repo.setLanguage(book.id, null);
  assert.equal(repo.getBook(book.id)!.language, null);
  repo.setLanguage(book.id, "pt");
  repo.setLanguage(book.id, "pt-BR");
  assert.equal(repo.getBook(book.id)!.language, "pt");
});

const noDetails = { summary: null, pages: null, year: null, publisher: null, translator: null };

test("a publisher synopsis replaces any earlier summary including a publisher one, and others never replace it", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  repo.saveDetails(book.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.summary_source], ["Open Library synopsis.", "openlibrary"]);

  repo.mergeDetails(book.id, { ...noDetails, summary: "Sinopse da editora." }, "publisher");
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.summary_source], ["Sinopse da editora.", "publisher"]);

  repo.saveDetails(book.id, { ...richDetails, summary: "Later Open Library synopsis." }, ["openlibrary"], "openlibrary", NOW);
  repo.mergeDetails(book.id, { ...noDetails, summary: "ISBNdb synopsis." }, "isbndb");
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.summary_source], ["Sinopse da editora.", "publisher"]);

  repo.mergeDetails(book.id, { ...noDetails, summary: "Sinopse corrigida." }, "publisher");
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.summary_source], ["Sinopse corrigida.", "publisher"]);
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

test("createBook and fillIdentity store the edition's title key, and only a titled edition gets one", () => {
  const { repo } = freshRepo();
  const dune = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], NOW);
  const authorless = repo.createBook({ title: "Dune", author: "", isbn: "9780441013594" }, ["isbn:9780441013594"], NOW);
  const untitled = repo.createBook({ title: "", author: "", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  assert.deepEqual([dune.title_key, authorless.title_key, untitled.title_key], ["ta:dune|frank herbert|", "", null]);
  assert.equal(untitled.title_group_blocked_at, null);
  repo.fillIdentity(untitled.id, "Ensaio sobre a Cegueira", "José Saramago");
  assert.equal(repo.getBook(untitled.id)!.title_key, "ta:ensaio sobre a cegueira|jose saramago|");
});

test("fillTitleKeys computes the keys stored rows lack, in batches, and leaves untitled rows for fillIdentity", () => {
  const { db, repo } = freshRepo();
  const ids = [
    repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], NOW).id,
    repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], NOW).id,
    repo.createBook({ title: "Orlando", author: "", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW).id
  ];
  const untitled = repo.createBook({ title: "", author: "", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW).id;
  db.exec("UPDATE books SET title_key = NULL");
  assert.equal(repo.fillTitleKeys(2), 2);
  assert.equal(repo.fillTitleKeys(2), 1);
  assert.equal(repo.fillTitleKeys(2), 0);
  assert.deepEqual(ids.map((id) => repo.getBook(id)!.title_key), ["ta:dune|frank herbert|", "ta:emma|jane austen|", ""]);
  assert.equal(repo.getBook(untitled)!.title_key, null);
});

test("the title key columns are added to an existing database once", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("DROP INDEX idx_books_title_key");
  db.exec("ALTER TABLE books DROP COLUMN title_key");
  db.exec("ALTER TABLE books DROP COLUMN title_group_blocked_at");
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  const columns = (db.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(columns.includes("title_key") && columns.includes("title_group_blocked_at"));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_title_key'").get());
});

const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.parse(NOW) + days * DAY_MS).toISOString();

test("mergeWorks moves every edition into the target, leaves merged_into, and keeps chains one hop long", () => {
  const { db, repo } = freshRepo();
  const empty = repo.createBook({ title: "", author: "", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const portuguese = repo.createBook({ title: "Ensaio sobre a Cegueira", author: "José Saramago", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  const english = repo.createBook({ title: "Blindness", author: "José Saramago", isbn: "9780156007757", workKey: "OL1W" }, ["isbn:9780156007757"], NOW);

  assert.equal(repo.mergeWorks(portuguese.work_id!, empty.work_id!), empty.work_id);
  assert.deepEqual([workById(db, empty.work_id).title, workById(db, empty.work_id).author], ["Ensaio sobre a Cegueira", "José Saramago"]);
  assert.equal(repo.getBook(portuguese.id)!.work_id, empty.work_id);
  assert.equal(workById(db, portuguese.work_id).merged_into, empty.work_id);

  assert.equal(repo.mergeWorks(empty.work_id!, english.work_id!), english.work_id);
  assert.deepEqual([empty.id, portuguese.id, english.id].map((id) => repo.getBook(id)!.work_id), [english.work_id, english.work_id, english.work_id]);
  assert.deepEqual([empty.work_id, portuguese.work_id].map((id) => workById(db, id).merged_into), [english.work_id, english.work_id]);
  assert.deepEqual([empty.work_id, portuguese.work_id, english.work_id].map((id) => repo.resolveWorkId(id!)), [english.work_id, english.work_id, english.work_id]);
  assert.equal(workById(db, english.work_id).title, "Blindness");
  assert.equal(repo.getBook(portuguese.id)!.ol_work_key, null);
});

test("mergeWorks resolves a merged target first", () => {
  const { repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  const c = repo.createBook({ title: "C", author: "X", isbn: "9789720000003" }, ["isbn:9789720000003"], NOW);
  repo.mergeWorks(b.work_id!, a.work_id!);
  assert.equal(repo.mergeWorks(c.work_id!, b.work_id!), a.work_id);
  assert.equal(repo.getBook(c.id)!.work_id, a.work_id);
});

test("mergeWorks refuses an unknown, merged or keyed source, an unknown target and a merge into itself, and changes nothing", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  repo.mergeWorks(b.work_id!, a.work_id!);
  const snapshot = () => ({ works: db.prepare("SELECT * FROM works ORDER BY id").all(), books: db.prepare("SELECT id, work_id FROM books ORDER BY id").all() });
  const before = snapshot();
  assert.throws(() => repo.mergeWorks("no-such-work", a.work_id!), WorkMergeError);
  assert.throws(() => repo.mergeWorks(b.work_id!, keyed.work_id!), WorkMergeError);
  assert.throws(() => repo.mergeWorks(keyed.work_id!, a.work_id!), WorkMergeError);
  assert.throws(() => repo.mergeWorks(a.work_id!, "no-such-work"), WorkMergeError);
  assert.throws(() => repo.mergeWorks(a.work_id!, b.work_id!), WorkMergeError);
  assert.deepEqual(snapshot(), before);
});

test("resolveWorkId returns null for an unknown id and throws on a chain longer than one hop", () => {
  const { db, repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  const c = repo.createBook({ title: "C", author: "X", isbn: "9789720000003" }, ["isbn:9789720000003"], NOW);
  assert.equal(repo.resolveWorkId("no-such-work"), null);
  assert.equal(repo.resolveWorkId(a.work_id!), a.work_id);
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(b.work_id, a.work_id);
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(c.work_id, b.work_id);
  assert.throws(() => repo.resolveWorkId(a.work_id!), /one hop/);
});

test("an edition leaving a grouped work through setWorkKey repoints the works merged into it", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Os Maias", author: "Eça de Queirós", isbn: "9789725681367", workKey: "OL846513W" }, ["isbn:9789725681367"], NOW);
  const first = repo.createBook({ title: "Maias", author: "Eça de Queirós", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const second = repo.createBook({ title: "Maias", author: "Eça de Queirós", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  repo.mergeWorks(second.work_id!, first.work_id!);
  repo.setWorkKey(first.id, "OL846513W");
  repo.setWorkKey(second.id, "OL846513W");
  assert.equal(workById(db, first.work_id).merged_into, keyed.work_id);
  assert.equal(workById(db, second.work_id).merged_into, keyed.work_id);
  assert.equal(repo.resolveWorkId(second.work_id!), keyed.work_id);
});

test("detachEdition gives a grouped edition a keyless work of its own and blocks it, and only blocks an edition already alone", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const joined = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322" }, ["isbn:9780593099322"], NOW);
  repo.mergeWorks(joined.work_id!, keyed.work_id!);

  const own = repo.detachEdition(joined.id, at(1));
  const detached = repo.getBook(joined.id)!;
  assert.equal(detached.work_id, own);
  assert.notEqual(own, keyed.work_id);
  assert.equal(detached.title_group_blocked_at, at(1));
  assert.deepEqual([workById(db, own).ol_work_key, workById(db, own).title, workById(db, own).created_at], [null, "Dune", at(1)]);
  assert.equal(repo.getBook(keyed.id)!.work_id, keyed.work_id);

  const alone = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], NOW);
  assert.equal(repo.detachEdition(alone.id, at(2)), alone.work_id);
  assert.equal(repo.getBook(alone.id)!.title_group_blocked_at, at(2));
});

test("detachEdition refuses an edition with its own Open Library key, an edition without a work and an unknown edition", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const legacy = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], NOW);
  db.prepare("UPDATE books SET work_id = NULL WHERE id = ?").run(legacy.id);
  assert.throws(() => repo.detachEdition(keyed.id, at(1)), WorkMergeError);
  assert.throws(() => repo.detachEdition(legacy.id, at(1)), WorkMergeError);
  assert.throws(() => repo.detachEdition("no-such-book", at(1)), WorkMergeError);
  assert.equal(repo.getBook(keyed.id)!.title_group_blocked_at, null);
  assert.equal(repo.getBook(legacy.id)!.title_group_blocked_at, null);
});

test("getWorkView lists a work's editions oldest first", () => {
  const { repo } = freshRepo();
  const english = repo.createBook({ title: "Blindness", author: "José Saramago", isbn: "9780156007757", workKey: "OL1W" }, ["isbn:9780156007757"], NOW);
  const portuguese = repo.createBook({ title: "Ensaio sobre a Cegueira", author: "José Saramago", isbn: "9789720000002" }, ["isbn:9789720000002"], at(1));
  repo.mergeWorks(portuguese.work_id!, english.work_id!);
  assert.deepEqual(repo.getWorkView(english.work_id!), {
    id: english.work_id,
    olWorkKey: "OL1W",
    title: "Blindness",
    author: "José Saramago",
    editions: [
      { id: english.id, isbn: "9780156007757", title: "Blindness", author: "José Saramago", olWorkKey: "OL1W" },
      { id: portuguese.id, isbn: "9789720000002", title: "Ensaio sobre a Cegueira", author: "José Saramago", olWorkKey: null }
    ]
  });
  assert.equal(repo.getWorkView("no-such-work"), undefined);
});

const edition = (repo: ReturnType<typeof createSqliteBooksRepository>, isbn: string, title: string, author: string, workKey?: string, created = NOW) =>
  repo.createBook({ title, author, isbn, workKey }, [`isbn:${isbn}`], created);

test("a keyless work joins the single keyed work that shares its title key, and keeps no key of its own", () => {
  const { db, repo } = freshRepo();
  const keyed = edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL893415W");
  const keyless = edition(repo, "9780593099322", "Dune", "Frank Herbert");
  assert.equal(repo.groupKeylessWorks(250), 1);
  const moved = repo.getBook(keyless.id)!;
  assert.deepEqual([moved.work_id, moved.ol_work_key], [keyed.work_id, null]);
  assert.equal(workById(db, keyless.work_id).merged_into, keyed.work_id);
  assert.equal(repo.groupKeylessWorks(250), 0);
});

test("keyless works sharing a title key merge into the oldest of them", () => {
  const { db, repo } = freshRepo();
  const oldest = edition(repo, "9789720000001", "Ensaio sobre a Cegueira", "José Saramago", undefined, at(0));
  const middle = edition(repo, "9789720000002", "Ensaio Sobre a Cegueira", "Saramago, José", undefined, at(1));
  const newest = edition(repo, "9789720000003", "Ensaio sobre a cegueira", "José Saramago", undefined, at(2));
  assert.equal(repo.groupKeylessWorks(250), 1);
  assert.deepEqual([oldest, newest].map((book) => repo.getBook(book.id)!.work_id), [oldest.work_id, oldest.work_id]);
  assert.equal(repo.getBook(middle.id)!.work_id, middle.work_id);
  assert.equal(workById(db, oldest.work_id).merged_into, null);
});

test("grouping skips ambiguous title keys, authorless and unkeyed editions, mixed works and blocked editions", () => {
  const { db, repo } = freshRepo();
  edition(repo, "9780000000001", "Poems", "Emily Dickinson", "OL1W");
  edition(repo, "9780000000002", "Poems", "Emily Dickinson", "OL2W");
  edition(repo, "9780000000003", "Poems", "Emily Dickinson");
  edition(repo, "9780000000004", "Orlando", "");
  edition(repo, "9780000000005", "Orlando", "");
  const pending = edition(repo, "9780000000006", "Emma", "Jane Austen");
  edition(repo, "9780000000007", "Emma", "Jane Austen", "OL3W");
  db.prepare("UPDATE books SET title_key = NULL WHERE id = ?").run(pending.id);
  const english = edition(repo, "9780000000008", "Blindness", "José Saramago");
  const portuguese = edition(repo, "9780000000009", "Ensaio sobre a Cegueira", "José Saramago");
  repo.mergeWorks(portuguese.work_id!, english.work_id!);
  edition(repo, "9780000000010", "Blindness", "José Saramago", "OL4W");
  const blocked = edition(repo, "9780000000011", "Dune", "Frank Herbert");
  repo.detachEdition(blocked.id, at(1));
  edition(repo, "9780000000012", "Dune", "Frank Herbert", "OL5W");
  assert.equal(repo.groupKeylessWorks(250), 0);
  assert.equal(repo.getBook(blocked.id)!.work_id, blocked.work_id);
});

test("a keyed edition arriving later pulls a keyless group into its work, and every old id resolves there", () => {
  const { db, repo } = freshRepo();
  const first = edition(repo, "9789720000001", "Os Maias", "Eça de Queirós", undefined, at(0));
  const second = edition(repo, "9789720000002", "Os Maias", "Eça de Queirós", undefined, at(1));
  assert.equal(repo.groupKeylessWorks(250), 1);
  const keyed = edition(repo, "9789725681367", "Os Maias", "Eça de Queirós", "OL846513W", at(2));
  assert.equal(repo.groupKeylessWorks(250), 1);
  assert.deepEqual([first, second, keyed].map((book) => repo.getBook(book.id)!.work_id), [keyed.work_id, keyed.work_id, keyed.work_id]);
  assert.deepEqual([first.work_id, second.work_id].map((id) => workById(db, id).merged_into), [keyed.work_id, keyed.work_id]);
});

test("Open Library's key moves a title-grouped edition out to its own work, and grouping leaves it there", () => {
  const { repo } = freshRepo();
  const keyed = edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL1W");
  const grouped = edition(repo, "9780593099322", "Dune", "Frank Herbert");
  repo.groupKeylessWorks(250);
  repo.setWorkKey(grouped.id, "OL9W");
  const moved = repo.getBook(grouped.id)!;
  assert.notEqual(moved.work_id, keyed.work_id);
  assert.equal(repo.getWorkView(moved.work_id!)!.olWorkKey, "OL9W");
  assert.equal(repo.getBook(keyed.id)!.work_id, keyed.work_id);
  assert.equal(repo.groupKeylessWorks(250), 0);
});

test("groupKeylessWorks merges at most its limit per batch", () => {
  const { repo } = freshRepo();
  edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL1W");
  edition(repo, "9780593099322", "Dune", "Frank Herbert");
  edition(repo, "9780141439587", "Emma", "Jane Austen", "OL2W");
  edition(repo, "9780141439588", "Emma", "Jane Austen");
  assert.equal(repo.groupKeylessWorks(1), 1);
  assert.equal(repo.groupKeylessWorks(1), 1);
  assert.equal(repo.groupKeylessWorks(1), 0);
});
