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
const { findOrCreateBook } = await import("../../domain/findOrCreate.js");
const { createSqliteBooksRepository, UNCHECKED_COVERS_SQL, UPGRADE_WANTED_SQL, UNCHECKED_DETAILS_SQL, WORK_LOOKUP_SQL } = await import("./sqliteBooksRepository.js");
const { WorkMergeError } = await import("../../domain/errors.js");
const { summaryHashOf } = await import("../../domain/synopsis.js");

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
  summary: string | null;
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

test("fillIdentity gives a titled book with no author its author, and keeps the title", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Hamlet", author: "", isbn: "9789896414672", createdBy: "publisher" }, ["isbn:9789896414672"], NOW);
  repo.fillIdentity(book.id, "Hamlet: edição bilingue", "William Shakespeare");
  const row = repo.getBook(book.id)!;
  assert.equal(row.title, "Hamlet");
  assert.equal(row.author, "William Shakespeare");
  assert.equal(row.title_key, "ta:hamlet|william shakespeare|");
});

test("fillIdentity never overwrites a title or author that is already there", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Hamlet", author: "William Shakespeare", isbn: "9789896414672", createdBy: "publisher" }, ["isbn:9789896414672"], NOW);
  repo.fillIdentity(book.id, "Other", "Someone");
  const row = repo.getBook(book.id)!;
  assert.equal(row.title, "Hamlet");
  assert.equal(row.author, "William Shakespeare");
});

test("fillIdentity with a title and no author makes a blank book searchable without a work title key", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "", author: "", isbn: "9789896414672", createdBy: "publisher" }, ["isbn:9789896414672"], NOW);
  repo.fillIdentity(book.id, "Hamlet", "");
  const row = repo.getBook(book.id)!;
  assert.equal(row.title, "Hamlet");
  assert.equal(row.author, "");
  assert.equal(row.title_key, "");
  assert.equal(repo.isSearchable(book.id), true);
  assert.deepEqual(repo.searchBooks(["hamlet"], 12).map((found) => found.title), ["Hamlet"]);
});

test("findOrCreateBook gives a titled, authorless ISBN book its author and the authored title key", () => {
  const { repo } = freshRepo();
  const first = findOrCreateBook(repo, { isbn: "9789896414672", title: "Poemas", author: "" }, NOW)!;
  const filled = findOrCreateBook(repo, { isbn: "9789896414672", title: "Poemas", author: "Sophia de Mello Breyner Andresen" }, NOW)!;
  assert.equal(filled.id, first.id);
  assert.equal(filled.author, "Sophia de Mello Breyner Andresen");
  assert.equal(repo.findBookByKey("ta:poemas|sophia de mello breyner andresen|")?.id, first.id);
});

test("findOrCreateBook does not store the authorless title key for an ISBN book", () => {
  const { repo } = freshRepo();
  findOrCreateBook(repo, { isbn: "9789896414672", title: "Poemas", author: "" }, NOW);
  assert.equal(repo.findBookByKey("ta:poemas||"), undefined);
});

test("findOrCreateBook still matches an ISBN-less authorless lookup by its own key", () => {
  const { repo } = freshRepo();
  const first = findOrCreateBook(repo, { isbn: null, title: "Poemas", author: "" }, NOW)!;
  const second = findOrCreateBook(repo, { isbn: null, title: "Poemas", author: "" }, NOW)!;
  assert.equal(second.id, first.id);
  assert.equal(repo.findBookByKey("ta:poemas||")?.id, first.id);
});

test("fillIdentity adds a later author to the search index of an already searchable book, without a second entry", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Hamlet", author: "", isbn: "9789896414672", createdBy: "publisher" }, ["isbn:9789896414672"], NOW);
  assert.equal(repo.isSearchable(book.id), true);
  assert.deepEqual(repo.searchBooks(["shakespeare"], 10), []);
  repo.fillIdentity(book.id, "Hamlet", "William Shakespeare");
  assert.deepEqual(repo.searchBooks(["shakespeare"], 10).map((found) => found.id), [book.id]);
  assert.deepEqual(repo.searchBooks(["hamlet"], 10).map((found) => found.id), [book.id]);
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
  repo.insertImage({ id: "img-1", book_id: book.id, source: "apple", source_url: "https://img.test/1", width: 900, height: 1400, byte_size: 10, color: "", created_at: NOW });
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

test("cover_images gains a colour column and a pending-colour index", () => {
  const { db } = freshRepo();
  const columns = db.prepare("PRAGMA table_info(cover_images)").all() as Array<{ name: string }>;
  const indexes = db.prepare("PRAGMA index_list(cover_images)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "color"));
  assert.ok(indexes.some((index) => index.name === "idx_cover_images_color_pending"));
});

test("a stored image row carries its colour", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], NOW);
  repo.insertImage({ id: "tinted", book_id: book.id, source: "apple", source_url: null, width: 900, height: 1400, byte_size: 10, color: "#cc2222", created_at: NOW });
  assert.equal(repo.getImage("tinted")!.color, "#cc2222");
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
  repo.insertImage({ id: "img-1", book_id: good.id, source: "apple", source_url: null, width: 900, height: 1400, byte_size: 10, color: "", created_at: NOW });
  repo.setCover(good.id, { imageId: "img-1", status: "good", checkedAt: NOW });
  repo.setCover(missing.id, { imageId: null, status: "missing", checkedAt: NOW });
  assert.deepEqual(repo.listUncheckedCoverIds(null, 100).ids, [older.id, newer.id]);
});

test("listUncheckedCoverIds includes a low-res cover stored without a check time, never a manual one", () => {
  const { repo } = freshRepo();
  const low = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], NOW);
  const manual = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, ["ta:emma|jane austen|"], NOW);
  repo.insertImage({ id: "img-low", book_id: low.id, source: "apple", source_url: null, width: 300, height: 460, byte_size: 10, color: "", created_at: NOW });
  repo.setCover(low.id, { imageId: "img-low", status: "low_res", checkedAt: null });
  repo.insertImage({ id: "img-manual", book_id: manual.id, source: "upload", source_url: null, width: 300, height: 460, byte_size: 10, color: "", created_at: NOW });
  repo.setCover(manual.id, { imageId: "img-manual", status: "manual", checkedAt: null });
  assert.deepEqual(repo.listUncheckedCoverIds(null, 100).ids, [low.id]);
  repo.setCover(low.id, { imageId: "img-low", status: "low_res", checkedAt: NOW });
  assert.deepEqual(repo.listUncheckedCoverIds(null, 100).ids, []);
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
  assert.deepEqual(repo.listUpgradeWantedIds(null, 100).ids, []);
  repo.setUpgradeWanted(b.id, "2026-10-01T00:00:02.000Z");
  repo.setUpgradeWanted(a.id, "2026-10-01T00:00:01.000Z");
  assert.equal(repo.getBook(a.id)!.cover_upgrade_wanted_at, "2026-10-01T00:00:01.000Z");
  assert.deepEqual(repo.listUpgradeWantedIds(null, 100).ids, [a.id, b.id]);
  repo.setUpgradeWanted(a.id, null);
  assert.equal(repo.getBook(a.id)!.cover_upgrade_wanted_at, null);
  assert.deepEqual(repo.listUpgradeWantedIds(null, 100).ids, [b.id]);
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
  assert.deepEqual(repo.listUpgradeWantedIds(null, 100).ids, ["old"]);
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
  assert.equal(repo.getImage("img")!.color, null);
  assert.deepEqual(repo.listPendingColorImageIds(10), ["img"]);
});

const WORK_COLUMNS = ["work_id", "language", "work_checked_at"];

function assertWorkSchema(db: DatabaseSync) {
  const names = (sql: string) => (db.prepare(sql).all() as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(names("PRAGMA table_info(works)"), ["id", "ol_work_key", "title", "author", "merged_into", "created_at", "summary", "summary_hash"]);
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
  repo.insertImage({ id: "with", book_id: book.id, source: "publisher", source_url: "https://antigona.pt/a.jpg", origin: "https://antigona.pt", width: 900, height: 1400, byte_size: 10, color: "", created_at: NOW });
  repo.insertImage({ id: "without", book_id: book.id, source: "apple", source_url: null, width: 900, height: 1400, byte_size: 10, color: "", created_at: NOW });
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

test("mergeDetails stores the cleaned summary and the hash of the cleaned text", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  repo.mergeDetails(book.id, { ...noDetails, summary: "Sinopse da editora.\r\n\r\nAdicionar aos Favoritos" }, "publisher");
  const row = repo.getBook(book.id)!;
  assert.equal(row.summary, "Sinopse da editora.");
  assert.equal(row.summary_hash, summaryHashOf("Sinopse da editora."));
});

test("a summary that cleans to nothing keeps the stored one", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  repo.mergeDetails(book.id, { ...noDetails, summary: "Uma sinopse." }, "isbndb");
  repo.mergeDetails(book.id, { ...noDetails, summary: "Adicionar aos Favoritos" }, "publisher");
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.summary_source], ["Uma sinopse.", "isbndb"]);
});

test("a summary that cleans to nothing does not fill the original title", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  repo.mergeDetails(book.id, { ...noDetails, summary: "Uma sinopse." }, "isbndb");
  repo.mergeDetails(book.id, { ...noDetails, summary: "Título original The Island" }, "publisher");
  assert.deepEqual([repo.getBook(book.id)!.summary, repo.getBook(book.id)!.original_title], ["Uma sinopse.", null]);
});

test("mergeDetails fills a missing original title from the raw summary", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  repo.mergeDetails(book.id, { ...noDetails, summary: "Uma sinopse longa o bastante.\n\nTítulo original The Island" }, "publisher");
  assert.equal(repo.getBook(book.id)!.original_title, "The Island");
  assert.equal(repo.getBook(book.id)!.summary, "Uma sinopse longa o bastante.");
  repo.mergeDetails(book.id, { ...noDetails, summary: "Outra sinopse longa o bastante.\n\nTítulo original The Other" }, "publisher");
  assert.equal(repo.getBook(book.id)!.original_title, "The Island");
});

test("setWorkSummary stores the cleaned text", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "A", author: "A", isbn: null }, ["ta:a|a|"], NOW);
  repo.setWorkSummary(book.id, "Work text.\r\n\r\n----------\r\nAlso contained in:\r\n - X");
  const work = workOf(db, book.id) as WorkRow & { summary_hash: string | null };
  assert.equal(work.summary, "Work text.");
  assert.equal(work.summary_hash, summaryHashOf("Work text."));
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
  assert.deepEqual(repo.canonicalWorkIds([empty.work_id!, portuguese.work_id!, english.work_id!]), new Map([[empty.work_id!, english.work_id!], [portuguese.work_id!, english.work_id!], [english.work_id!, english.work_id!]]));
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

test("a merge chain longer than one hop is refused rather than followed", () => {
  const { db, repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  const c = repo.createBook({ title: "C", author: "X", isbn: "9789720000003" }, ["isbn:9789720000003"], NOW);
  assert.deepEqual(repo.canonicalWorkIds(["no-such-work", a.work_id!]), new Map([[a.work_id!, a.work_id!]]));
  assert.equal(repo.workPageRows("no-such-work"), undefined);
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(b.work_id, a.work_id);
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(c.work_id, b.work_id);
  assert.throws(() => repo.workPageRows(a.work_id!), /one hop/);
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

function groupingFixture() {
  const { db, repo } = freshRepo();
  const label = new Map<string, string>();
  let isbn = 9780000000000;
  const add = (name: string, title: string, author: string, workKey?: string, created = NOW) => {
    const book = edition(repo, String(++isbn), title, author, workKey, created);
    label.set(book.work_id!, name);
    return book;
  };

  add("keyed", "Dune", "Frank Herbert", "OL1W", at(0));
  add("k1", "Dune", "Frank Herbert", undefined, at(2));
  add("k2", "Dune", "Frank Herbert", undefined, at(1));

  add("ambiguous-a", "Poems", "Emily Dickinson", "OL2W", at(0));
  add("ambiguous-b", "Poems", "Emily Dickinson", "OL3W", at(0));
  add("ambiguous-keyless", "Poems", "Emily Dickinson", undefined, at(1));

  add("m3", "Os Maias", "Eça de Queirós", undefined, at(3));
  add("m1", "Os Maias", "Eça de Queirós", undefined, at(1));
  add("m0", "Os Maias", "Eça de Queirós", undefined, at(0));
  add("m2", "Os Maias", "Eça de Queirós", undefined, at(2));

  const first = edition(repo, String(++isbn), "Hamlet", "William Shakespeare", undefined, at(5));
  const second = edition(repo, String(++isbn), "Hamlet", "William Shakespeare", undefined, at(5));
  const [low, high] = first.work_id! < second.work_id! ? [first, second] : [second, first];
  label.set(low.work_id!, "tie-lo");
  label.set(high.work_id!, "tie-hi");

  const blockedKeyed = add("blocked-keyed", "Emma", "Jane Austen", "OL4W", at(0));
  db.prepare("UPDATE books SET title_group_blocked_at = ? WHERE id = ?").run(at(1), blockedKeyed.id);
  add("b0", "Emma", "Jane Austen", undefined, at(0));
  add("b1", "Emma", "Jane Austen", undefined, at(1));

  add("blocked-keyless-keyed", "Persuasion", "Jane Austen", "OL5W", at(0));
  const detached = add("blocked-keyless", "Persuasion", "Jane Austen", undefined, at(1));
  repo.detachEdition(detached.id, at(1));

  const english = add("mixed-english", "Blindness", "José Saramago", undefined, at(0));
  const portuguese = add("mixed-portuguese", "Ensaio sobre a Cegueira", "José Saramago", undefined, at(1));
  repo.mergeWorks(portuguese.work_id!, english.work_id!, at(1));
  add("mixed-newer", "Ensaio sobre a Cegueira", "José Saramago", undefined, at(2));

  add("empty-a", "Orlando", "", undefined, at(0));
  add("empty-b", "Orlando", "", undefined, at(1));

  add("null-a", "Middlemarch", "George Eliot", undefined, at(0));
  const nullKey = add("null-b", "Middlemarch", "George Eliot", undefined, at(1));
  db.prepare("UPDATE books SET title_key = NULL WHERE id = ?").run(nullKey.id);

  return { db, repo, label };
}

function mergedPairs(db: DatabaseSync, label: Map<string, string>) {
  const rows = db.prepare("SELECT from_work, into_work FROM work_merges WHERE source = 'title-key' ORDER BY id").all() as Array<{ from_work: string; into_work: string }>;
  return rows.map((row) => `${label.get(row.from_work) ?? row.from_work}>${label.get(row.into_work) ?? row.into_work}`);
}

test("grouping picks the same source and target for every rule case", () => {
  const { db, repo, label } = groupingFixture();
  assert.equal(repo.groupKeylessWorks(250, NOW), 7);
  assert.deepEqual(mergedPairs(db, label).sort(), ["b1>b0", "k1>keyed", "k2>keyed", "m1>m0", "m2>m0", "m3>m0", "tie-hi>tie-lo"]);
  assert.equal(repo.groupKeylessWorks(250, NOW), 0);
});

test("batches of one merge the same pairs as one call, oldest first within a title key", () => {
  const one = groupingFixture();
  while (one.repo.groupKeylessWorks(1, NOW) === 1);
  const all = groupingFixture();
  all.repo.groupKeylessWorks(250, NOW);
  assert.deepEqual(mergedPairs(one.db, one.label).sort(), mergedPairs(all.db, all.label).sort());
  assert.deepEqual(mergedPairs(one.db, one.label).filter((pair) => pair.endsWith(">m0")), ["m1>m0", "m2>m0", "m3>m0"]);
});

test("shared title keys that never pair don't end a batch early", () => {
  const { db, repo } = freshRepo();
  edition(repo, "9780000000001", "Alpha Tale", "Ann Author", "OL1W");
  edition(repo, "9780000000002", "Alpha Tale", "Ann Author", "OL2W");
  edition(repo, "9780000000003", "Bravo Tale", "Ann Author", "OL3W");
  edition(repo, "9780000000004", "Bravo Tale", "Ann Author", "OL4W");
  edition(repo, "9780000000005", "Charlie Tale", "Ann Author", "OL5W");
  edition(repo, "9780000000006", "Charlie Tale", "Ann Author", "OL6W");
  const oldest = edition(repo, "9780000000007", "Zulu Tale", "Ann Author", undefined, at(0));
  const newest = edition(repo, "9780000000008", "Zulu Tale", "Ann Author", undefined, at(1));
  assert.equal(repo.groupKeylessWorks(1, NOW), 1);
  assert.equal(workById(db, newest.work_id).merged_into, oldest.work_id);
  assert.equal(repo.groupKeylessWorks(1, NOW), 0);
});

test("a batch never merges more than its limit when shared keys yield uneven pairs", () => {
  const { db, repo } = freshRepo();
  edition(repo, "9780000000001", "Alpha Tale", "Ann Author", undefined, at(0));
  edition(repo, "9780000000002", "Alpha Tale", "Ann Author", undefined, at(1));
  edition(repo, "9780000000003", "Bravo Tale", "Ann Author", "OL1W");
  edition(repo, "9780000000004", "Bravo Tale", "Ann Author", "OL2W");
  edition(repo, "9780000000005", "Charlie Tale", "Ann Author", undefined, at(0));
  edition(repo, "9780000000006", "Charlie Tale", "Ann Author", undefined, at(1));
  edition(repo, "9780000000007", "Charlie Tale", "Ann Author", undefined, at(2));
  assert.deepEqual([repo.groupKeylessWorks(2, NOW), repo.groupKeylessWorks(2, NOW), repo.groupKeylessWorks(2, NOW)], [2, 1, 0]);
  assert.equal(countOf(db, "work_merges", "source = 'title-key'"), 3);
});

function rerunPass(db: DatabaseSync) {
  db.exec("PRAGMA user_version = 1");
  applyBooksMigrations(db);
}

test("the ISBN-10 pass adds the ISBN-13 key when no edition holds it", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597" }, ["isbn:0441013597"], NOW);
  rerunPass(db);
  assert.equal(repo.findBookByKey("isbn:9780441013593")?.id, book.id);
  assert.equal(repo.getBook(book.id)?.isbn, "9780441013593");
});

test("the ISBN-10 pass handles a lowercase check digit", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Gödel", author: "Hofstadter", isbn: "080442957x" }, ["isbn:080442957x"], NOW);
  rerunPass(db);
  assert.equal(repo.findBookByKey("isbn:9780804429573")?.id, book.id);
  assert.equal(repo.getBook(book.id)?.isbn, "9780804429573");
});

test("after the ISBN-10 pass an ISBN-13 lookup finds the legacy row without a second book", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597" }, ["isbn:0441013597"], NOW);
  rerunPass(db);
  const found = findOrCreateBook(repo, { isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }, NOW);
  assert.equal(found?.id, book.id);
  assert.equal(countOf(db, "books"), 1);
});

test("the ISBN-10 pass merges a lone keyless work into the other edition's work", () => {
  const { db, repo } = freshRepo();
  const ten = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597" }, ["isbn:0441013597"], NOW);
  const thirteen = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL893415W" }, ["isbn:9780441013593"], NOW);
  rerunPass(db);
  assert.equal(repo.getBook(ten.id)?.work_id, thirteen.work_id);
  assert.equal(workById(db, ten.work_id).merged_into, thirteen.work_id);
  assert.equal(repo.findBookByKey("isbn:0441013597")?.id, ten.id);
});

test("the ISBN-10 pass merges the other way when only the ISBN-13 work is lone and keyless", () => {
  const { db, repo } = freshRepo();
  const ten = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597", workKey: "OL893415W" }, ["isbn:0441013597"], NOW);
  const thirteen = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], NOW);
  rerunPass(db);
  assert.equal(repo.getBook(thirteen.id)?.work_id, ten.work_id);
  assert.equal(workById(db, thirteen.work_id).merged_into, ten.work_id);
});

test("the ISBN-10 pass leaves two keyed works that disagree alone", () => {
  const { db, repo } = freshRepo();
  const ten = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597", workKey: "OL1W" }, ["isbn:0441013597"], NOW);
  const thirteen = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL2W" }, ["isbn:9780441013593"], NOW);
  rerunPass(db);
  assert.notEqual(repo.getBook(ten.id)?.work_id, repo.getBook(thirteen.id)?.work_id);
});

test("the ISBN-10 pass runs once", () => {
  const { db } = freshRepo();
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 4);
});

test("listUncheckedCoverIds pages by created_at then insert order, and a short page ends the cycle", () => {
  const { repo } = freshRepo();
  const ids = ["a", "b", "c"].map((t) => repo.createBook({ title: t, author: "X", isbn: null }, [`ta:${t}|x|`], NOW).id);
  const first = repo.listUncheckedCoverIds(null, 2);
  assert.deepEqual(first.ids, ids.slice(0, 2));
  assert.ok(first.next);
  assert.deepEqual(repo.listUncheckedCoverIds(first.next, 2), { ids: [ids[2]], next: null });
});

test("a book checked between two pages does not make the next page skip anything", () => {
  const { repo } = freshRepo();
  const ids = ["a", "b", "c", "d"].map((t) => repo.createBook({ title: t, author: "X", isbn: null }, [`ta:${t}|x|`], NOW).id);
  const first = repo.listUncheckedCoverIds(null, 2);
  repo.setCover(ids[1]!, { imageId: null, status: "missing", checkedAt: NOW });
  assert.deepEqual(repo.listUncheckedCoverIds(first.next, 2).ids, ids.slice(2));
});

test("listUpgradeWantedIds pages by wanted time then insert order", () => {
  const { repo } = freshRepo();
  const ids = ["a", "b", "c"].map((t) => repo.createBook({ title: t, author: "X", isbn: null }, [`ta:${t}|x|`], NOW).id);
  for (const id of ids) repo.setUpgradeWanted(id, NOW);
  const first = repo.listUpgradeWantedIds(null, 2);
  assert.deepEqual(first.ids, ids.slice(0, 2));
  assert.deepEqual(repo.listUpgradeWantedIds(first.next, 2), { ids: [ids[2]], next: null });
});

test("every backfill query reads through its own partial index, with no temp sort", () => {
  const { db } = freshRepo();
  const cases: Array<[string, Array<string | number>, string]> = [
    [UNCHECKED_COVERS_SQL, ["", 0, 500], "idx_books_cover_unchecked"],
    [UPGRADE_WANTED_SQL, ["", 0, 500], "idx_books_cover_upgrade"],
    [UNCHECKED_DETAILS_SQL, [50], "idx_books_details_pending"],
    [WORK_LOOKUP_SQL, [NOW, 50], "idx_books_work_lookup"]
  ];
  for (const [sql, params, index] of cases) {
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
    assert.match(plan, new RegExp(`USING INDEX ${index}\\b`), plan);
    assert.doesNotMatch(plan, /TEMP B-TREE/, plan);
  }
});

test("fillSubjectGenres fills empty or Jev genres and keeps source genres", () => {
  const { db, repo } = freshRepo();
  const genresOf = (id: string) => db.prepare("SELECT genres, genres_source, genres_confidence FROM books WHERE id = ?").get(id) as { genres: string; genres_source: string | null; genres_confidence: number | null };
  const make = (title: string, genres: string[]) => repo.createBook({ title, author: "X", isbn: null, genres }, [`ta:${title}|x|`], NOW).id;
  const empty = make("Empty", []);
  const judged = make("Judged", ["Romance"]);
  db.prepare("UPDATE books SET genres_source = 'jev', genres_confidence = 0.8 WHERE id = ?").run(judged);
  const sourced = make("Sourced", ["Fantasy"]);

  repo.fillSubjectGenres(judged, []);
  repo.fillSubjectGenres(empty, []);
  assert.deepEqual({ ...genresOf(judged) }, { genres: '["Romance"]', genres_source: "jev", genres_confidence: 0.8 });
  assert.deepEqual({ ...genresOf(empty) }, { genres: "[]", genres_source: null, genres_confidence: null });

  for (const id of [empty, judged, sourced]) repo.fillSubjectGenres(id, ["Mystery"]);
  assert.deepEqual({ ...genresOf(empty) }, { genres: '["Mystery"]', genres_source: null, genres_confidence: null });
  assert.deepEqual({ ...genresOf(judged) }, { genres: '["Mystery"]', genres_source: null, genres_confidence: null });
  assert.deepEqual({ ...genresOf(sourced) }, { genres: '["Fantasy"]', genres_source: null, genres_confidence: null });
});

test("confirmWithSource makes an unconfirmed book searchable once", () => {
  const { db, repo } = freshRepo();
  const sourcesOf = (id: string) => (db.prepare("SELECT data_sources FROM books WHERE id = ?").get(id) as { data_sources: string }).data_sources;
  const book = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: null }, ["ta:orlando|virginia woolf|"], NOW);
  assert.equal(repo.isSearchable(book.id), false);

  repo.confirmWithSource(book.id, "bnp");
  assert.equal(repo.isSearchable(book.id), true);
  assert.equal(sourcesOf(book.id), '["bnp"]');

  repo.confirmWithSource(book.id, "bnp");
  assert.equal(sourcesOf(book.id), '["bnp"]');
});

test("confirmWithSource leaves a confirmed book unchanged", () => {
  const { db, repo } = freshRepo();
  const seeded = repo.createBook({ title: "Seeded", author: "X", isbn: null, createdBy: "seed" }, ["ta:seeded|x|"], NOW);
  const sourced = repo.createBook({ title: "Sourced", author: "X", isbn: null, sources: ["openlibrary"] }, ["ta:sourced|x|"], NOW);
  repo.confirmWithSource(seeded.id, "bnp");
  repo.confirmWithSource(sourced.id, "bnp");
  const sources = (id: string) => (db.prepare("SELECT data_sources FROM books WHERE id = ?").get(id) as { data_sources: string }).data_sources;
  assert.equal(sources(seeded.id), "[]");
  assert.equal(sources(sourced.id), '["openlibrary"]');
});

test("the harvest cursor starts empty and keeps the last value", () => {
  const { repo } = freshRepo();
  assert.equal(repo.getHarvestCursor("bnp"), null);
  repo.setHarvestCursor("bnp", "2026-10-17");
  repo.setHarvestCursor("bnp", "2026-10-18");
  assert.equal(repo.getHarvestCursor("bnp"), "2026-10-18");
  assert.equal(repo.getHarvestCursor("other"), null);
});

test("the details queue skips bnp books", () => {
  const { repo } = freshRepo();
  repo.createBook({ title: "Imported", author: "X", isbn: null, createdBy: "bnp" }, ["ta:imported|x|"], NOW);
  const plain = repo.createBook({ title: "Plain", author: "X", isbn: null }, ["ta:plain|x|"], NOW);
  assert.deepEqual(repo.listUncheckedDetailIds(10), [plain.id]);
});

test("setWorkSummary keeps the first summary, assigns a missing work and follows merged_into", () => {
  const { db, repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002", workKey: "OL2W" }, ["isbn:9789720000002"], NOW);
  repo.setWorkSummary(a.id, "First.");
  repo.setWorkSummary(a.id, "Second.");
  assert.equal(workById(db, a.work_id).summary, "First.");
  assert.deepEqual({ ...repo.getWorkSummary(a.id) }, { summary: "First.", olWorkKey: null, summaryHash: summaryHashOf("First.") });

  repo.mergeWorks(a.work_id!, b.work_id!);
  assert.deepEqual({ ...repo.getWorkSummary(a.id) }, { summary: "First.", olWorkKey: "OL2W", summaryHash: summaryHashOf("First.") });
  repo.setWorkSummary(b.id, "Third.");
  assert.equal(workById(db, b.work_id).summary, "First.");

  db.exec("UPDATE books SET work_id = NULL WHERE id = '" + b.id + "'");
  repo.setWorkSummary(b.id, "Fourth.");
  assert.ok(repo.getBook(b.id)!.work_id);
});

test("the works.summary migration moves Open Library edition summaries onto the work and leaves the rest", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("ALTER TABLE works DROP COLUMN summary");
  const insertWork = db.prepare("INSERT INTO works (id, title, author, created_at) VALUES (?, 'T', 'A', ?)");
  const insertBook = db.prepare("INSERT INTO books (id, title, author, work_id, summary, summary_source, created_at) VALUES (?, 'T', 'A', ?, ?, ?, ?)");
  insertWork.run("w1", NOW);
  insertWork.run("w2", NOW);
  insertBook.run("b1", "w1", "Work text.", "openlibrary", NOW);
  insertBook.run("b2", "w1", "Work text.", "openlibrary", NOW);
  insertBook.run("b3", "w2", "Publisher text.", "publisher", NOW);
  insertBook.run("b4", "w2", "ISBNdb text.", "isbndb", NOW);
  insertBook.run("b5", null, "Orphan text.", "openlibrary", NOW);

  applyBooksMigrations(db);
  applyBooksMigrations(db);

  const summaryOf = (id: string) => (db.prepare("SELECT summary FROM works WHERE id = ?").get(id) as { summary: string | null }).summary;
  const edition = (id: string) => ({ ...(db.prepare("SELECT summary, summary_source FROM books WHERE id = ?").get(id) as object) });
  assert.deepEqual([summaryOf("w1"), summaryOf("w2")], ["Work text.", null]);
  assert.deepEqual([edition("b1"), edition("b2")], [{ summary: null, summary_source: null }, { summary: null, summary_source: null }]);
  assert.deepEqual(edition("b3"), { summary: "Publisher text.", summary_source: "publisher" });
  assert.deepEqual(edition("b4"), { summary: "ISBNdb text.", summary_source: "isbndb" });
  assert.deepEqual(edition("b5"), { summary: "Orphan text.", summary_source: "openlibrary" });
});

test("seeded and publisher books are searchable from the moment they are created", () => {
  const { repo } = freshRepo();
  repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272", createdBy: "seed" }, ["isbn:9780141184272"], NOW);
  repo.createBook({ title: "Ensaio sobre a Cegueira", author: "José Saramago", isbn: "9789722113002", createdBy: "publisher" }, ["isbn:9789722113002"], NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12).map((book) => book.title), ["Orlando"]);
  assert.deepEqual(repo.searchBooks(["cegueira"], 12).map((book) => book.title), ["Ensaio sobre a Cegueira"]);
});

test("a library book becomes searchable once a source returns its details, and only once", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
  repo.saveDetails(book.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  repo.saveDetails(book.id, richDetails, ["isbndb"], "isbndb", NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12).map((row) => row.id), [book.id]);
  assert.equal(countOf(db, "books_fts"), 1);
});

test("a confirmed book without a title is indexed once it gets one", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "", author: "", isbn: "9780141184272", createdBy: "seed" }, ["isbn:9780141184272"], NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
  repo.fillIdentity(book.id, "Orlando", "Virginia Woolf");
  assert.deepEqual(repo.searchBooks(["orlando"], 12).map((row) => row.id), [book.id]);
});

test("the one-time backfill indexes the confirmed catalog once, keeps earlier search hits and leaves library-only books out", () => {
  const { db, repo } = freshRepo();
  const insert = db.prepare("INSERT INTO books (id, title, author, data_sources, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("seed-1", "Orlando", "Virginia Woolf", "[]", "seed", NOW);
  insert.run("confirmed-1", "Mrs Dalloway", "Virginia Woolf", '["isbndb"]', null, NOW);
  insert.run("hit-1", "To the Lighthouse", "Virginia Woolf", "[]", null, NOW);
  insert.run("both-1", "The Waves", "Virginia Woolf", '["openlibrary"]', null, NOW);
  insert.run("private-1", "My Private Manuscript", "Virginia Woolf", "[]", null, NOW);
  const fts = db.prepare("INSERT INTO books_fts (book_id, title, author) VALUES (?, ?, ?)");
  fts.run("hit-1", "To the Lighthouse", "Virginia Woolf");
  fts.run("both-1", "The Waves", "Virginia Woolf");
  db.exec("PRAGMA user_version = 2");
  applyBooksMigrations(db);
  assert.deepEqual(repo.searchBooks(["woolf"], 12).map((book) => book.id).sort(), ["both-1", "confirmed-1", "hit-1", "seed-1"]);
  assert.equal(countOf(db, "books_fts"), 4);
  assert.equal(repo.isSearchable("hit-1"), true);
  assert.equal(repo.isSearchable("private-1"), false);
  insert.run("seed-2", "Jacob's Room", "Virginia Woolf", "[]", "seed", NOW);
  applyBooksMigrations(db);
  assert.equal(countOf(db, "books_fts"), 4);
});

const userVersion = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
const authorOf = (db: DatabaseSync, id: string) => (db.prepare("SELECT author FROM books WHERE id = ?").get(id) as { author: string }).author;

test("the ISBNdb-first author pass turns a surname-first name with its title key, search row and work", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Herbert, Frank", isbn: "9780000000002", sources: ["isbndb"] }, ["isbn:9780000000002", "ta:dune|herbert|"], NOW);
  assert.equal(repo.isSearchable(book.id), true);
  db.exec("PRAGMA user_version = 3");
  applyBooksMigrations(db);
  assert.deepEqual({ ...db.prepare("SELECT author, title_key FROM books WHERE id = ?").get(book.id) }, { author: "Frank Herbert", title_key: "ta:dune|frank herbert|" });
  assert.equal(repo.findBookByKey("ta:dune|frank herbert|")?.id, book.id);
  assert.equal(repo.findBookByKey("ta:dune|herbert|")?.id, book.id);
  assert.deepEqual({ ...db.prepare("SELECT author FROM books_fts WHERE book_id = ?").get(book.id) }, { author: "Frank Herbert" });
  assert.equal(workById(db, book.work_id).author, "Frank Herbert");
  assert.equal(userVersion(db), 4);
});

test("the ISBNdb-first author pass changes a work only when its author is the turned book's own text", () => {
  const { db, repo } = freshRepo();
  const seeded = repo.createBook({ title: "Dune", author: "Herbert, Brian", isbn: "9780000000002", createdBy: "seed", workKey: "OL1W" }, ["isbn:9780000000002"], NOW);
  const book = repo.createBook({ title: "Dune Messiah", author: "Herbert, Frank", isbn: "9780000000019", sources: ["isbndb"], workKey: "OL1W" }, ["isbn:9780000000019"], NOW);
  assert.equal(book.work_id, seeded.work_id);
  db.exec("PRAGMA user_version = 3");
  applyBooksMigrations(db);
  assert.equal(authorOf(db, book.id), "Frank Herbert");
  assert.equal(workById(db, seeded.work_id).author, "Herbert, Brian");
});

test("the ISBNdb-first author pass turns a row a lookup created and ISBNdb alone answered", () => {
  const { db, repo } = freshRepo();
  const book = findOrCreateBook(repo, { isbn: "9780000000002", title: "Dune", author: "Herbert, Frank" }, NOW)!;
  repo.saveDetails(book.id, { ...richDetails, rating: null, ratingCount: 0, sourceUrl: "https://isbndb.com/book/9780000000002" }, ["isbndb"], "isbndb", NOW);
  assert.deepEqual([book.created_by, repo.getBook(book.id)?.data_sources], [null, '["isbndb"]']);
  db.exec("PRAGMA user_version = 3");
  applyBooksMigrations(db);
  assert.equal(authorOf(db, book.id), "Frank Herbert");
});

test("the ISBNdb-first author pass leaves the same text alone when the row is not ISBNdb-first", () => {
  const { db, repo } = freshRepo();
  repo.createBook({ title: "Dune", author: "Herbert, Frank", isbn: "9780000000002", createdBy: "seed", sources: ["isbndb"] }, ["isbn:9780000000002"], NOW);
  repo.createBook({ title: "Dune Messiah", author: "Herbert, Frank", isbn: "9780000000019", sources: ["openlibrary", "isbndb"] }, ["isbn:9780000000019"], NOW);
  repo.createBook({ title: "Children of Dune", author: "Herbert, Frank", isbn: "9780000000026" }, ["isbn:9780000000026"], NOW);
  const rows = () => [db.prepare("SELECT id, author, title_key FROM books ORDER BY rowid").all(), db.prepare("SELECT id, author FROM works ORDER BY rowid").all(), db.prepare("SELECT * FROM books_fts ORDER BY rowid").all()];
  const before = rows();
  db.exec("PRAGMA user_version = 3");
  applyBooksMigrations(db);
  assert.deepEqual(rows(), before);
  assert.equal(userVersion(db), 4);
});

test("the ISBNdb-first author pass runs once, so a row saved after it is left as stored", () => {
  const { db, repo } = freshRepo();
  const before = repo.createBook({ title: "Dune", author: "Herbert, Frank", isbn: "9780000000002", sources: ["isbndb"] }, ["isbn:9780000000002"], NOW);
  db.exec("PRAGMA user_version = 3");
  applyBooksMigrations(db);
  const after = repo.createBook({ title: "Republic", author: "Plato, Aristotle", isbn: "9780000000019", sources: ["isbndb"] }, ["isbn:9780000000019"], NOW);
  applyBooksMigrations(db);
  assert.equal(authorOf(db, before.id), "Frank Herbert");
  assert.equal(authorOf(db, after.id), "Plato, Aristotle");
});

test("the ISBNdb-first author pass can stop part way and finish on the next boot", () => {
  const { db, repo } = freshRepo();
  const first = repo.createBook({ title: "Dune", author: "Herbert, Frank", isbn: "9780000000002", sources: ["isbndb"] }, ["isbn:9780000000002"], NOW);
  const second = repo.createBook({ title: "Dune Messiah", author: "Herbert, Frank", isbn: "9780000000019", sources: ["isbndb"] }, ["isbn:9780000000019"], NOW);
  db.exec("PRAGMA user_version = 3");
  db.exec(`CREATE TRIGGER stop_second BEFORE UPDATE OF author ON books WHEN NEW.id = '${second.id}' BEGIN SELECT RAISE(ABORT, 'stopped'); END`);
  assert.throws(() => applyBooksMigrations(db), /stopped/);
  assert.deepEqual([userVersion(db), authorOf(db, second.id), workById(db, second.work_id).author], [3, "Herbert, Frank", "Frank Herbert"]);
  db.exec("DROP TRIGGER stop_second");
  applyBooksMigrations(db);
  for (const book of [first, second]) assert.deepEqual([authorOf(db, book.id), workById(db, book.work_id).author], ["Frank Herbert", "Frank Herbert"]);
  assert.equal(userVersion(db), 4);
});

test("the last word matches as a prefix once it has three letters", () => {
  const { repo } = freshRepo();
  repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", createdBy: "seed" }, ["isbn:9780441013593"], NOW);
  assert.deepEqual(repo.searchBooks(["dun"], 12).map((book) => book.title), ["Dune"]);
  assert.deepEqual(repo.searchBooks(["du"], 12), []);
  assert.deepEqual(repo.searchBooks(["dune", "herb"], 12).map((book) => book.title), ["Dune"]);
  assert.deepEqual(repo.searchBooks(["dun", "herbert"], 12), []);
});

const genreRow = (db: DatabaseSync, id: string) => ({ ...db.prepare("SELECT genres, genres_source, genres_confidence FROM books WHERE id = ?").get(id) });
const titled = (repo: ReturnType<typeof freshRepo>["repo"], title: string) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], NOW);

test("works needing a genre judgment have no genres, a finished details lookup and no judgment", () => {
  const { db, repo } = freshRepo();
  const [ready, tagged, unchecked, judged] = ["Ready", "Tagged", "Unchecked", "Judged"].map((title) => titled(repo, title));
  for (const book of [ready, tagged, judged]) repo.markDetailsMissing(book!.id, NOW);
  db.prepare("UPDATE books SET genres = ? WHERE id = ?").run(JSON.stringify(["Poetry"]), tagged!.id);
  repo.saveGenreJudgment({ workId: judged!.work_id!, model: "jev-1.13.0", genre: null, confidence: 0.9, askedAt: NOW });
  const ids = [ready, tagged, unchecked, judged].map((book) => book!.work_id!);
  assert.deepEqual(repo.worksNeedingGenreJudgment(ids, 10, 3), [ready!.work_id]);
  assert.deepEqual(repo.worksNeedingGenreJudgment(ids, 0, 3), []);
  assert.deepEqual(repo.genreJudgments(ids), new Map([[judged!.work_id!, { model: "jev-1.13.0", genre: null, confidence: 0.9 }]]));
});

test("deleting the judgment of a work with an applied Jev genre makes it selectable again", () => {
  const { db, repo } = freshRepo();
  const book = titled(repo, "Applied");
  repo.markDetailsMissing(book.id, NOW);
  repo.saveGenreJudgment({ workId: book.work_id!, model: "jev-1.13.0", genre: "History", confidence: 0.9, askedAt: NOW });
  repo.applyGenreJudgment(book.work_id!, 0.5);
  assert.deepEqual(repo.worksNeedingGenreJudgment([book.work_id!], 10, 3), []);
  db.prepare("DELETE FROM genre_judgments WHERE work_id = ?").run(book.work_id);
  assert.deepEqual(repo.worksNeedingGenreJudgment([book.work_id!], 10, 3), [book.work_id]);
});

test("applying judgments writes Jev genres at or above the save line, idempotently, and undoes them when the line rises", () => {
  const { db, repo } = freshRepo();
  const [sure, unsure, none, manual] = ["Sure", "Unsure", "None", "Manual"].map((title) => titled(repo, title));
  const judge = (book: { work_id: string | null } | undefined, genre: string | null, confidence: number) => repo.saveGenreJudgment({ workId: book!.work_id!, model: "jev-1.13.0", genre, confidence, askedAt: NOW });
  judge(sure, "History", 0.9);
  judge(unsure, "Poetry", 0.3);
  judge(none, null, 0.95);
  judge(manual, "Romance", 0.9);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run(JSON.stringify(["Classics"]), manual!.id);
  const applyAll = (line: number) => [sure, unsure, none, manual].forEach((book) => repo.applyGenreJudgment(book!.work_id!, line));
  applyAll(0.5);
  const changesBefore = (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  applyAll(0.5);
  assert.equal((db.prepare("SELECT total_changes() AS n").get() as { n: number }).n, changesBefore);
  assert.deepEqual(genreRow(db, sure!.id), { genres: JSON.stringify(["History"]), genres_source: "jev", genres_confidence: 0.9 });
  assert.deepEqual(genreRow(db, unsure!.id), { genres: "[]", genres_source: null, genres_confidence: null });
  assert.deepEqual(genreRow(db, none!.id), { genres: "[]", genres_source: null, genres_confidence: null });
  assert.deepEqual(genreRow(db, manual!.id), { genres: JSON.stringify(["Classics"]), genres_source: "manual", genres_confidence: null });
  applyAll(0.95);
  assert.deepEqual(genreRow(db, sure!.id), { genres: "[]", genres_source: null, genres_confidence: null });
});

test("an edition created into an already judged work takes the judgment's genre without a sweep", () => {
  const { db, repo } = freshRepo();
  const first = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  repo.saveGenreJudgment({ workId: first.work_id!, model: "jev-1.13.0", genre: "Science Fiction", confidence: 0.8, askedAt: NOW });
  repo.applyGenreJudgment(first.work_id!, 0.5);
  const second = repo.createBook({ title: "Duna", author: "Frank Herbert", isbn: "9789722046114", workKey: "OL1W" }, ["isbn:9789722046114"], NOW);
  assert.equal(second.work_id, first.work_id);
  assert.deepEqual(genreRow(db, second.id), { genres: JSON.stringify(["Science Fiction"]), genres_source: "jev", genres_confidence: 0.8 });
});

test("an edition moved into a judged work by a merge takes the judgment, keeps its own source and manual genres, and loses a stale Jev guess", () => {
  const { db, repo } = freshRepo();
  const judged = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const doubted = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587", workKey: "OL2W" }, ["isbn:9780141439587"], NOW);
  repo.saveGenreJudgment({ workId: judged.work_id!, model: "jev-1.13.0", genre: "Science Fiction", confidence: 0.8, askedAt: NOW });
  repo.saveGenreJudgment({ workId: doubted.work_id!, model: "jev-1.13.0", genre: "Romance", confidence: 0.3, askedAt: NOW });
  const [bare, sourced, manual, stale] = ["Bare", "Sourced", "Manual", "Stale"].map((title) => titled(repo, title));
  db.prepare("UPDATE books SET genres = ?, genres_source = NULL WHERE id = ?").run(JSON.stringify(["Poetry"]), sourced!.id);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run(JSON.stringify(["Classics"]), manual!.id);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.9 WHERE id = ?").run(JSON.stringify(["History"]), stale!.id);
  for (const book of [bare, sourced, manual]) repo.mergeWorks(book!.work_id!, judged.work_id!);
  repo.mergeWorks(stale!.work_id!, doubted.work_id!);
  assert.deepEqual(genreRow(db, bare!.id), { genres: JSON.stringify(["Science Fiction"]), genres_source: "jev", genres_confidence: 0.8 });
  assert.deepEqual(genreRow(db, sourced!.id), { genres: JSON.stringify(["Poetry"]), genres_source: null, genres_confidence: null });
  assert.deepEqual(genreRow(db, manual!.id), { genres: JSON.stringify(["Classics"]), genres_source: "manual", genres_confidence: null });
  assert.deepEqual(genreRow(db, stale!.id), { genres: "[]", genres_source: null, genres_confidence: null });
});

test("giving a work to an edition and keying it into a judged work both apply the judgment", () => {
  const { db, repo } = freshRepo();
  const judged = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  repo.saveGenreJudgment({ workId: judged.work_id!, model: "jev-1.13.0", genre: "Science Fiction", confidence: 0.8, askedAt: NOW });
  repo.applyGenreJudgment(judged.work_id!, 0.5);
  const keyed = titled(repo, "Duna");
  repo.setWorkKey(keyed.id, "OL1W");
  assert.equal(repo.getBook(keyed.id)!.work_id, judged.work_id);
  assert.deepEqual(genreRow(db, keyed.id), { genres: JSON.stringify(["Science Fiction"]), genres_source: "jev", genres_confidence: 0.8 });
  const unassigned = titled(repo, "Arrakis");
  db.prepare("UPDATE books SET work_id = NULL, ol_work_key = 'OL1W' WHERE id = ?").run(unassigned.id);
  repo.assignMissingWorks(10);
  assert.equal(repo.getBook(unassigned.id)!.work_id, judged.work_id);
  assert.deepEqual(genreRow(db, unassigned.id), { genres: JSON.stringify(["Science Fiction"]), genres_source: "jev", genres_confidence: 0.8 });
});

test("Open Library genres replace a Jev guess, an empty answer keeps it, and manual genres stay", () => {
  const { db, repo } = freshRepo();
  const jev = titled(repo, "Guessed");
  const manual = titled(repo, "Labelled");
  db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.6 WHERE id = ?").run(JSON.stringify(["History"]), jev.id);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run(JSON.stringify(["Poetry"]), manual.id);
  repo.saveDetails(jev.id, { ...richDetails, genres: [] }, ["openlibrary"], "openlibrary", NOW);
  assert.deepEqual(genreRow(db, jev.id), { genres: JSON.stringify(["History"]), genres_source: "jev", genres_confidence: 0.6 });
  repo.saveDetails(jev.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  assert.deepEqual(genreRow(db, jev.id), { genres: JSON.stringify(["Fantasy"]), genres_source: null, genres_confidence: null });
  repo.saveDetails(manual.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  assert.deepEqual(genreRow(db, manual.id), { genres: JSON.stringify(["Poetry"]), genres_source: "manual", genres_confidence: null });
});

test("strikes count per work, keep the latest failure, and stop selection at the limit", () => {
  const { repo } = freshRepo();
  const book = titled(repo, "Struck");
  repo.markDetailsMissing(book.id, NOW);
  const work = book.work_id!;
  repo.recordGenreRejection({ workId: work, status: 400, reason: "HTTP 400", at: NOW });
  repo.recordGenreRejection({ workId: work, status: null, reason: "unexpected answer", at: "2026-10-02T00:00:00.000Z" });
  assert.deepEqual(repo.genreRejections([work]).get(work), { status: null, reason: "unexpected answer", attempts: 2, lastAt: "2026-10-02T00:00:00.000Z" });
  assert.deepEqual(repo.worksNeedingGenreJudgment([work], 10, 3), [work]);
  repo.recordGenreRejection({ workId: work, status: 422, reason: "HTTP 422", at: NOW });
  assert.deepEqual(repo.worksNeedingGenreJudgment([work], 10, 3), []);
  repo.clearGenreRejection(work);
  assert.deepEqual(repo.worksNeedingGenreJudgment([work], 10, 3), [work]);
  assert.equal(repo.genreRejections([work]).size, 0);
});

test("applying one work's judgment touches only that work and repeats as a no-op", () => {
  const { db, repo } = freshRepo();
  const [one, two] = ["One", "Two"].map((title) => titled(repo, title));
  for (const book of [one, two]) repo.saveGenreJudgment({ workId: book!.work_id!, model: "jev-1.13.0", genre: "History", confidence: 0.9, askedAt: NOW });
  repo.applyGenreJudgment(one!.work_id!, 0.5);
  assert.deepEqual(genreRow(db, one!.id), { genres: JSON.stringify(["History"]), genres_source: "jev", genres_confidence: 0.9 });
  assert.deepEqual(genreRow(db, two!.id), { genres: "[]", genres_source: null, genres_confidence: null });
  const changes = () => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const before = changes();
  repo.applyGenreJudgment(one!.work_id!, 0.5);
  assert.equal(changes(), before);
  repo.saveGenreJudgment({ workId: one!.work_id!, model: "jev-1.13.0", genre: null, confidence: 0.9, askedAt: NOW });
  repo.applyGenreJudgment(one!.work_id!, 0.5);
  assert.deepEqual(genreRow(db, one!.id), { genres: "[]", genres_source: null, genres_confidence: null });
});

test("deleting a judgment removes Jev's answer and keeps the owner's", () => {
  const { repo } = freshRepo();
  const [jev, manual] = ["Jev", "Manual"].map((title) => titled(repo, title));
  repo.saveGenreJudgment({ workId: jev!.work_id!, model: "jev-1.13.0", genre: "Poetry", confidence: 0.3, askedAt: NOW });
  repo.saveGenreJudgment({ workId: manual!.work_id!, model: "manual", genre: null, confidence: 1, askedAt: NOW });
  repo.deleteGenreJudgment(jev!.work_id!);
  repo.deleteGenreJudgment(manual!.work_id!);
  const judgments = repo.genreJudgments([jev!.work_id!, manual!.work_id!]);
  assert.equal(judgments.has(jev!.work_id!), false);
  assert.deepEqual(judgments.get(manual!.work_id!), { model: "manual", genre: null, confidence: 1 });
});

test("source genres fill only editions without genres, and repeat as a no-op", () => {
  const { db, repo } = freshRepo();
  const a = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const b = repo.createBook({ title: "Duna", author: "Frank Herbert", isbn: "9789722345671", workKey: "OL1W" }, ["isbn:9789722345671"], NOW);
  const c = repo.createBook({ title: "Dune Messiah", author: "Frank Herbert", isbn: "9780441172696", workKey: "OL1W" }, ["isbn:9780441172696"], NOW);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run(JSON.stringify(["Classics"]), c.id);
  const work = a.work_id!;
  assert.equal(b.work_id, work);
  assert.equal(repo.fillSourceGenres(work, ["Science Fiction"]), 2);
  assert.deepEqual(genreRow(db, a.id), { genres: JSON.stringify(["Science Fiction"]), genres_source: null, genres_confidence: null });
  assert.deepEqual(genreRow(db, b.id), { genres: JSON.stringify(["Science Fiction"]), genres_source: null, genres_confidence: null });
  assert.deepEqual(genreRow(db, c.id), { genres: JSON.stringify(["Classics"]), genres_source: "manual", genres_confidence: null });
  assert.equal(repo.fillSourceGenres(work, ["Fantasy"]), 0);
});

test("empty-genre editions of a work are counted", () => {
  const { db, repo } = freshRepo();
  const a = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const b = repo.createBook({ title: "Duna", author: "Frank Herbert", isbn: "9789722345671", workKey: "OL1W" }, ["isbn:9789722345671"], NOW);
  const other = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587", workKey: "OL2W" }, ["isbn:9780141439587"], NOW);
  const work = a.work_id!;
  assert.equal(b.work_id, work);
  assert.equal(repo.countEmptyGenreEditions(work), 2);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run(JSON.stringify(["Classics"]), b.id);
  assert.equal(repo.countEmptyGenreEditions(work), 1);
  assert.equal(repo.countEmptyGenreEditions(other.work_id!), 1);
  repo.fillSourceGenres(work, ["Fantasy"]);
  assert.equal(repo.countEmptyGenreEditions(work), 0);
});

test("a work key whose work was merged away maps to the merge target", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const target = titled(repo, "Duna");
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target.work_id, keyed.work_id);
  assert.deepEqual(repo.workIdsByWorkKeys(["OL1W"]), new Map([["OL1W", target.work_id!]]));
});

test("work keys map to work ids, and publisher URLs list with their works", () => {
  const { repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const shop = titled(repo, "Shop Book");
  repo.setPublisherUrl(shop.id, "https://shop.test/products/shop-book");
  assert.deepEqual(repo.workIdsByWorkKeys(["OL1W", "OL2W"]), new Map([["OL1W", keyed.work_id!]]));
  assert.deepEqual(repo.listPublisherUrls(), [{ work_id: shop.work_id, publisher_url: "https://shop.test/products/shop-book" }]);
});

test("summary hashes are written with every summary and follow a merge", () => {
  const { db, repo } = freshRepo();
  const details = (summary: string | null) => ({ summary, pages: null, year: null, publisher: null, translator: null });
  const hashOf = (table: string, id: string | null) => (db.prepare(`SELECT summary_hash FROM ${table} WHERE id = ?`).get(id) as { summary_hash: string | null }).summary_hash;
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000021" }, ["isbn:9789720000021"], NOW);
  repo.mergeDetails(a.id, details("  A long publisher\n\nsynopsis. "), "publisher");
  assert.equal(hashOf("books", a.id), summaryHashOf("A long publisher synopsis."));
  repo.mergeDetails(a.id, details("An ISBNdb text."), "isbndb");
  assert.equal(hashOf("books", a.id), summaryHashOf("A long publisher synopsis."));
  repo.mergeDetails(a.id, details("A newer publisher text."), "publisher");
  assert.equal(hashOf("books", a.id), summaryHashOf("A newer publisher text."));
  repo.setWorkSummary(a.id, "Work text.");
  assert.equal(hashOf("works", a.work_id), summaryHashOf("Work text."));
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000022" }, ["isbn:9789720000022"], NOW);
  repo.mergeWorks(a.work_id!, b.work_id!);
  assert.equal(hashOf("works", b.work_id), summaryHashOf("Work text."));
  const c = repo.createBook({ title: "C", author: "X", isbn: "9789720000023" }, ["isbn:9789720000023"], NOW);
  repo.mergeDetails(c.id, details("   "), "publisher");
  assert.equal(hashOf("books", c.id), null);
});

test("the summary hash migration hashes stored summaries once", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("DROP INDEX idx_books_summary_hash; ALTER TABLE books DROP COLUMN summary_hash; DROP INDEX idx_works_summary_hash; ALTER TABLE works DROP COLUMN summary_hash");
  db.prepare("INSERT INTO works (id, title, author, created_at, summary) VALUES ('w1', 'T', 'A', ?, ' Work  text. ')").run(NOW);
  db.prepare("INSERT INTO books (id, title, author, work_id, summary, created_at) VALUES ('b1', 'T', 'A', 'w1', 'Edition text.', ?), ('b2', 'T', 'A', 'w1', NULL, ?), ('b3', 'T', 'A', 'w1', '  ', ?)").run(NOW, NOW, NOW);

  applyBooksMigrations(db);
  applyBooksMigrations(db);

  const hash = (sql: string) => (db.prepare(sql).get() as { h: string | null }).h;
  assert.equal(hash("SELECT summary_hash AS h FROM works WHERE id = 'w1'"), summaryHashOf("Work text."));
  assert.equal(hash("SELECT summary_hash AS h FROM books WHERE id = 'b1'"), summaryHashOf("Edition text."));
  assert.equal(hash("SELECT summary_hash AS h FROM books WHERE id = 'b2'"), null);
  assert.equal(hash("SELECT summary_hash AS h FROM books WHERE id = 'b3'"), null);
});

test("synopsis judgments are stored by text hash, replaced and read back", () => {
  const { repo } = freshRepo();
  repo.saveSynopsisJudgment("h1", { model: "rule", usable: 0, kind: "fragment", askedAt: NOW });
  repo.saveSynopsisJudgment("h2", { model: "jev-1.13.0", usable: 0.12, kind: "praise", askedAt: NOW });
  repo.saveSynopsisJudgment("h2", { model: "manual", usable: 1, kind: "praise", askedAt: "2026-10-02T00:00:00.000Z" });
  const judgments = repo.synopsisJudgments(["h1", "h2", "h3"]);
  assert.equal(judgments.size, 2);
  assert.deepEqual(judgments.get("h1"), { model: "rule", usable: 0, kind: "fragment", askedAt: NOW });
  assert.deepEqual(judgments.get("h2"), { model: "manual", usable: 1, kind: "praise", askedAt: "2026-10-02T00:00:00.000Z" });
});

test("Jev rejections count attempts per task and subject, and clear one task only", () => {
  const { repo } = freshRepo();
  repo.recordJevRejection({ task: "synopses", subject: "h1", status: 400, reason: "HTTP 400", at: NOW });
  repo.recordJevRejection({ task: "synopses", subject: "h1", status: null, reason: "unexpected answer", at: "2026-10-02T00:00:00.000Z" });
  repo.recordJevRejection({ task: "works", subject: "h1", status: 422, reason: "HTTP 422", at: NOW });
  assert.deepEqual(repo.jevRejections("synopses", ["h1", "h2"]).get("h1"), { status: null, reason: "unexpected answer", attempts: 2, lastAt: "2026-10-02T00:00:00.000Z" });
  assert.equal(repo.jevRejections("works", ["h1"]).get("h1")?.attempts, 1);
  repo.clearJevRejection("synopses", "h1");
  assert.equal(repo.jevRejections("synopses", ["h1"]).size, 0);
  assert.equal(repo.jevRejections("works", ["h1"]).size, 1);
});

test("a summary cleared by hand leaves no text to judge or list, even with its hash left behind", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Cleared", author: "X", isbn: "9789720000099" }, ["isbn:9789720000099"], NOW);
  repo.mergeDetails(book.id, { summary: "A publisher text the owner later cleared by hand.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  repo.setWorkSummary(book.id, "A work text the owner later cleared by hand too.");
  const { summary_hash: bookHash, work_id: workId } = repo.getBook(book.id)!;
  const workHash = summaryHashOf("A work text the owner later cleared by hand too.")!;
  db.exec("UPDATE books SET summary = NULL; UPDATE works SET summary = NULL");
  assert.equal(repo.synopsisText(bookHash!), undefined);
  assert.equal(repo.synopsisText(workHash), undefined);
  assert.deepEqual(repo.synopsesNeedingJudgment([workId!], 10, 3), []);
  assert.deepEqual(repo.worksNeedingSynopsisJudgment([workId!], 10, 3), []);
  assert.deepEqual(repo.synopsisBacklog(3), []);
  assert.deepEqual(repo.synopsisCarriers([bookHash!, workHash]), []);
  assert.deepEqual(repo.synopsisTexts(), []);
});

test("original titles fill only empty columns, from the feed or from stored summaries", () => {
  const { db, repo } = freshRepo();
  const a = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000111" }, ["isbn:9789720000111"], NOW);
  repo.fillOriginalTitle(a.id, "To the Lighthouse");
  repo.fillOriginalTitle(a.id, "Something else");
  assert.equal(repo.getBook(a.id)!.original_title, "To the Lighthouse");
  const b = repo.createBook({ title: "O Passeio", author: "Robert Walser", isbn: "9789720000112" }, ["isbn:9789720000112"], NOW);
  repo.mergeDetails(b.id, { summary: "Um passeio por uma cidade suíça, narrado por um escritor.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  db.prepare("UPDATE books SET summary = ? WHERE id = ?").run("Um passeio por uma cidade suíça, narrado por um escritor.\n\nTítulo original: Der Spaziergang", b.id);
  const c = repo.createBook({ title: "Sem rótulo", author: "X", isbn: "9789720000113" }, ["isbn:9789720000113"], NOW);
  repo.mergeDetails(c.id, { summary: "Uma sinopse sem rótulo de origem em parte alguma do texto.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  assert.equal(repo.fillOriginalTitlesFromSummaries(c.work_id!), 0);
  assert.equal(repo.fillOriginalTitlesFromSummaries(), 1);
  assert.equal(repo.getBook(b.id)!.original_title, "Der Spaziergang");
  assert.equal(repo.fillOriginalTitlesFromSummaries(), 0);
});

const AT = "2026-10-15T12:00:00.000Z";
const mergeRows = (db: DatabaseSync) => (db.prepare("SELECT from_work, into_work, source, confidence, moved_book_ids, repointed_work_ids, merged_at, undone_at FROM work_merges ORDER BY id").all() as Array<Record<string, unknown>>).map((row) => ({ ...row }));

test("a new edition carrying a merged work's key lands on the original, by every path", () => {
  const { db, repo } = freshRepo();
  const pt = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000201", workKey: "OL900W" }, ["isbn:9789720000201"], NOW);
  const en = repo.createBook({ title: "To the Lighthouse", author: "Virginia Woolf", isbn: "9780156907392", workKey: "OL901W" }, ["isbn:9780156907392"], NOW);
  assert.equal(repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.95, AT), en.work_id);
  const created = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000202", workKey: "OL900W" }, ["isbn:9789720000202"], NOW);
  assert.equal(created.work_id, en.work_id);
  const keyed = repo.createBook({ title: "Rumo ao Farol", author: "Virginia Woolf", isbn: "9789720000203" }, ["isbn:9789720000203"], NOW);
  repo.setWorkKey(keyed.id, "OL900W");
  assert.equal(repo.getBook(keyed.id)!.work_id, en.work_id);
  db.exec(`UPDATE books SET work_id = NULL WHERE id = '${created.id}'`);
  assert.equal(repo.assignWork(created.id), en.work_id);
  assert.equal(workById(db, pt.work_id).merged_into, en.work_id);
});

test("a translation merge keeps the original's own summary empty; title-key and admin merges still carry it", () => {
  const { db, repo } = freshRepo();
  const pt = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000204", workKey: "OL902W" }, ["isbn:9789720000204"], NOW);
  const en = repo.createBook({ title: "To the Lighthouse", author: "Virginia Woolf", isbn: "9780156907393", workKey: "OL903W" }, ["isbn:9780156907393"], NOW);
  repo.setWorkSummary(pt.id, "Uma família numa casa de férias na Escócia.");
  repo.mergeTranslation(pt.work_id!, en.work_id!, "code", null, AT);
  assert.equal(workById(db, en.work_id).summary, null);
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000205" }, ["isbn:9789720000205"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000206" }, ["isbn:9789720000206"], NOW);
  repo.setWorkSummary(a.id, "Carried.");
  repo.mergeWorks(a.work_id!, b.work_id!, AT);
  assert.equal(workById(db, b.work_id).summary, "Carried.");
});

test("every merge is recorded with the editions it moved and the works it repointed", () => {
  const { db, repo } = freshRepo();
  const alias = repo.createBook({ title: "Alias", author: "X", isbn: "9789720000207" }, ["isbn:9789720000207"], NOW);
  const pt = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000208" }, ["isbn:9789720000208"], NOW);
  const en = repo.createBook({ title: "Walk", author: "X", isbn: "9789720000209", workKey: "OL904W" }, ["isbn:9789720000209"], NOW);
  repo.mergeWorks(alias.work_id!, pt.work_id!, AT);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.93, AT);
  const twin1 = repo.createBook({ title: "Twin", author: "Y", isbn: "9789720000219" }, ["isbn:9789720000219"], NOW);
  const twin2 = repo.createBook({ title: "Twin", author: "Y", isbn: "9789720000210" }, ["isbn:9789720000210"], NOW);
  assert.equal(repo.groupKeylessWorks(10, AT), 1);
  const rows = mergeRows(db);
  assert.deepEqual(rows.map((row) => row.source), ["admin", "jev", "title-key"]);
  assert.deepEqual(rows[0], { from_work: alias.work_id, into_work: pt.work_id, source: "admin", confidence: null, moved_book_ids: JSON.stringify([alias.id]), repointed_work_ids: "[]", merged_at: AT, undone_at: null });
  assert.deepEqual(JSON.parse(String(rows[1]!.moved_book_ids)).sort(), [alias.id, pt.id].sort());
  assert.deepEqual(rows[1]!.repointed_work_ids, JSON.stringify([alias.work_id]));
  assert.equal(rows[1]!.confidence, 0.93);
  assert.ok([twin1.work_id, twin2.work_id].includes(String(rows[2]!.from_work)));
});

test("genre state follows a merge: it moves to a target without any, and drops when the target has its own", () => {
  const { repo } = freshRepo();
  const pt = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000211", workKey: "OL905W" }, ["isbn:9789720000211"], NOW);
  const en = repo.createBook({ title: "Walk", author: "X", isbn: "9789720000212", workKey: "OL906W" }, ["isbn:9789720000212"], NOW);
  repo.saveGenreJudgment({ workId: pt.work_id!, model: "jev-1.13.0", genre: "Literary Fiction", confidence: 0.86, askedAt: AT });
  repo.recordGenreRejection({ workId: pt.work_id!, status: 400, reason: "HTTP 400", at: AT });
  repo.mergeTranslation(pt.work_id!, en.work_id!, "code", null, AT);
  assert.equal(repo.genreJudgments([en.work_id!]).get(en.work_id!)?.genre, "Literary Fiction");
  assert.equal(repo.genreJudgments([pt.work_id!]).size, 0);
  assert.equal(repo.genreRejections([en.work_id!]).get(en.work_id!)?.attempts, 1);

  const other = repo.createBook({ title: "Outro", author: "Z", isbn: "9789720000213", workKey: "OL907W" }, ["isbn:9789720000213"], NOW);
  const target = repo.createBook({ title: "Other", author: "Z", isbn: "9789720000214", workKey: "OL908W" }, ["isbn:9789720000214"], NOW);
  repo.saveGenreJudgment({ workId: other.work_id!, model: "jev-1.13.0", genre: "Poetry", confidence: 0.9, askedAt: AT });
  repo.saveGenreJudgment({ workId: target.work_id!, model: "manual", genre: null, confidence: 1, askedAt: AT });
  repo.mergeTranslation(other.work_id!, target.work_id!, "manual", null, AT);
  assert.equal(repo.genreJudgments([target.work_id!]).get(target.work_id!)?.model, "manual");
  assert.equal(repo.genreJudgments([other.work_id!]).size, 0);
});

test("setWorkKey's emptied work hands its genre state to the work it joined", () => {
  const { repo } = freshRepo();
  const keyed = repo.createBook({ title: "Kept", author: "X", isbn: "9789720000215", workKey: "OL909W" }, ["isbn:9789720000215"], NOW);
  const loose = repo.createBook({ title: "Kept", author: "X", isbn: "9789720000216" }, ["isbn:9789720000216"], NOW);
  repo.saveGenreJudgment({ workId: loose.work_id!, model: "jev-1.13.0", genre: "History", confidence: 0.7, askedAt: AT });
  repo.setWorkKey(loose.id, "OL909W");
  assert.equal(repo.genreJudgments([keyed.work_id!]).get(keyed.work_id!)?.genre, "History");
  assert.equal(repo.genreJudgments([loose.work_id!]).size, 0);
});

test("mergeTranslation refuses a merged or missing work and a work into itself; mergeWorks still refuses keyed works", () => {
  const { repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000217", workKey: "OL910W" }, ["isbn:9789720000217"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000218", workKey: "OL911W" }, ["isbn:9789720000218"], NOW);
  assert.throws(() => repo.mergeTranslation(a.work_id!, a.work_id!, "manual", null, AT), WorkMergeError);
  assert.throws(() => repo.mergeTranslation("missing", b.work_id!, "manual", null, AT), WorkMergeError);
  assert.throws(() => repo.mergeWorks(a.work_id!, b.work_id!, AT), WorkMergeError);
  repo.mergeTranslation(a.work_id!, b.work_id!, "manual", null, AT);
  assert.throws(() => repo.mergeTranslation(a.work_id!, b.work_id!, "manual", null, AT), WorkMergeError);
});

test("undo reverses a translation merge, later arrivals with the key and repointed aliases included", () => {
  const { db, repo } = freshRepo();
  const alias = repo.createBook({ title: "Alias", author: "X", isbn: "9789720000301" }, ["isbn:9789720000301"], NOW);
  const pt = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000302", workKey: "OL920W" }, ["isbn:9789720000302"], NOW);
  const en = repo.createBook({ title: "Walk", author: "X", isbn: "9789720000303", workKey: "OL921W" }, ["isbn:9789720000303"], NOW);
  repo.mergeWorks(alias.work_id!, pt.work_id!, AT);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.92, AT);
  const later = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000304", workKey: "OL920W" }, ["isbn:9789720000304"], NOW);
  assert.equal(later.work_id, en.work_id);

  assert.deepEqual(repo.undoMerge(pt.work_id!, "2026-10-16T00:00:00.000Z"), { into: en.work_id, editions: 3 });
  assert.equal(workById(db, pt.work_id).merged_into, null);
  for (const id of [alias.id, pt.id, later.id]) assert.equal(repo.getBook(id)!.work_id, pt.work_id);
  assert.equal(repo.getBook(en.id)!.work_id, en.work_id);
  assert.equal(workById(db, alias.work_id).merged_into, pt.work_id);
  assert.equal((db.prepare("SELECT undone_at FROM work_merges WHERE from_work = ? AND source = 'jev'").get(pt.work_id) as { undone_at: string }).undone_at, "2026-10-16T00:00:00.000Z");
  assert.equal(repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000305", workKey: "OL920W" }, ["isbn:9789720000305"], NOW).work_id, pt.work_id);
  assert.throws(() => repo.undoMerge(pt.work_id!, AT), WorkMergeError);
});

test("undo refuses once the target itself merged elsewhere", () => {
  const { repo } = freshRepo();
  const pt = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000306", workKey: "OL922W" }, ["isbn:9789720000306"], NOW);
  const en = repo.createBook({ title: "Walk", author: "X", isbn: "9789720000307", workKey: "OL923W" }, ["isbn:9789720000307"], NOW);
  const other = repo.createBook({ title: "Walking", author: "X", isbn: "9789720000308", workKey: "OL924W" }, ["isbn:9789720000308"], NOW);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "code", null, AT);
  repo.mergeTranslation(en.work_id!, other.work_id!, "manual", null, AT);
  assert.throws(() => repo.undoMerge(pt.work_id!, AT), WorkMergeError);
});

test("an undone translation merge stays undone through the next title-key grouping, and takes back a later keyless copy", () => {
  const { db, repo } = freshRepo();
  const pt = repo.createBook({ title: "Poemas", author: "John Keats", isbn: "9789720000351" }, ["isbn:9789720000351"], NOW);
  const en = repo.createBook({ title: "Poems", author: "Emily Dickinson", isbn: "9780000000352", workKey: "OL930W" }, ["isbn:9780000000352"], NOW);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.92, AT);
  const copy = repo.createBook({ title: "Poemas", author: "John Keats", isbn: "9789720000353" }, ["isbn:9789720000353"], NOW);
  assert.equal(repo.groupKeylessWorks(10, AT), 1);
  assert.equal(repo.getBook(copy.id)!.work_id, en.work_id);

  repo.undoMerge(pt.work_id!, "2026-10-16T00:00:00.000Z");
  assert.equal(repo.getBook(copy.id)!.work_id, pt.work_id);
  assert.equal(workById(db, copy.work_id).merged_into, pt.work_id);
  assert.equal(repo.groupKeylessWorks(10, "2026-10-17T00:00:00.000Z"), 0);
  assert.equal(workById(db, pt.work_id).merged_into, null);
  assert.equal(repo.getBook(pt.id)!.work_id, pt.work_id);
});

test("createBook marks a new lossy book with a valid ISBN for a re-title, and no other", () => {
  const { repo } = freshRepo();
  const lossyTitle = repo.createBook({ title: "P©ssaro Azul", author: "Ana Lima", isbn: "9789720000101" }, ["isbn:9789720000101"], NOW);
  const lossyAuthor = repo.createBook({ title: "Pássaro Azul", author: "In©s Duarte", isbn: "9789720000118" }, ["isbn:9789720000118"], NOW);
  const clean = repo.createBook({ title: "Pássaro Verde", author: "Ana Lima", isbn: "9789720000125" }, ["isbn:9789720000125"], NOW);
  const noIsbn = repo.createBook({ title: "P©ssaro Branco", author: "Ana Lima", isbn: null }, ["ta:p ssaro branco|ana lima|"], NOW);
  const existing = repo.createBook({ title: "P©ssaro Verde", author: "Ana Lima", isbn: "9789720000125" }, ["isbn:9789720000125"], NOW);
  assert.deepEqual([lossyTitle, lossyAuthor, clean, noIsbn].map((book) => book.retitle_wanted_at), [NOW, NOW, null, null]);
  assert.equal(existing.id, clean.id);
  assert.equal(existing.retitle_wanted_at, null);
});

test("listRetitleWanted lists marked books oldest first with their work's text, and clearRetitleWanted unmarks one", () => {
  const { repo } = freshRepo();
  const later = repo.createBook({ title: "P©ssaro Azul", author: "Ana Lima", isbn: "9789720000101" }, ["isbn:9789720000101"], at(1));
  const earlier = repo.createBook({ title: "Can©o", author: "In©s Duarte", isbn: "9789720000118" }, ["isbn:9789720000118"], NOW);
  repo.createBook({ title: "Pássaro Verde", author: "Ana Lima", isbn: "9789720000125" }, ["isbn:9789720000125"], NOW);
  assert.deepEqual(repo.listRetitleWanted(10).map((row) => ({ ...row })), [
    { id: earlier.id, title: "Can©o", author: "In©s Duarte", isbn: "9789720000118", work_id: earlier.work_id, work_title: "Can©o", work_author: "In©s Duarte" },
    { id: later.id, title: "P©ssaro Azul", author: "Ana Lima", isbn: "9789720000101", work_id: later.work_id, work_title: "P©ssaro Azul", work_author: "Ana Lima" }
  ]);
  assert.deepEqual(repo.listRetitleWanted(1).map((row) => row.id), [earlier.id]);
  repo.clearRetitleWanted(earlier.id);
  assert.deepEqual(repo.listRetitleWanted(10).map((row) => row.id), [later.id]);
});

test("retitle_wanted_at and its index are added to an existing database once", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("DROP INDEX idx_books_retitle_wanted");
  db.exec("ALTER TABLE books DROP COLUMN retitle_wanted_at");
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  const columns = (db.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(columns.includes("retitle_wanted_at"));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_retitle_wanted'").get());
});
