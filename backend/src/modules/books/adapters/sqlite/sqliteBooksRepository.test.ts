import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-repo-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations, openBooksDb, UNKEYED_ORIGINALS_SQL } = await import("./connection.js");
const { findOrCreateBook } = await import("../../domain/findOrCreate.js");
const { createSqliteBooksRepository, ORIGINAL_CLAIMS_SQL, ORIGINAL_KEYS_OF_WHOLE_SQL, UNCHECKED_COVERS_SQL, UPGRADE_WANTED_SQL, UNCHECKED_DETAILS_SQL, HELD_BNP_DETAILS_SQL, WORK_LOOKUP_SQL, GROUPABLE_KEYS_SQL, KEYED_EDITIONS_SQL, KEYED_WORKS_SQL, KEYLESS_CANDIDATES_SQL } = await import("./sqliteBooksRepository.js");
const { WorkMergeError } = await import("../../domain/errors.js");
const { summaryHashOf } = await import("../../domain/synopsis.js");
const { authorPattern, originalKey, originalWholeKey, seriesLikeOriginals } = await import("../../domain/translation.js");
const { catalogTitleKey } = await import("../../domain/normalize.js");
const { groupKeylessWorks } = await import("../../duplicateWorks.js");

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

test("setCoverIf refuses an image whose URL is rejected for that book only", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, ["ta:dune|frank herbert|"], NOW);
  const other = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, ["ta:emma|jane austen|"], NOW);
  repo.insertImage({ id: "img-u", book_id: book.id, source: "apple", source_url: "https://a/u", width: 900, height: 1400, byte_size: 1, color: "", created_at: NOW });
  repo.addRejection(book.id, "https://a/u", NOW);
  assert.equal(repo.setCoverIf(book.id, null, { imageId: "img-u", status: "good", checkedAt: NOW }), false);
  assert.equal(repo.getBook(book.id)!.cover_image_id, null);
  assert.equal(repo.setCoverIf(book.id, null, { imageId: null, status: "missing", checkedAt: NOW }), true);
  assert.equal(repo.setCoverIf(other.id, null, { imageId: "img-u", status: "good", checkedAt: NOW }), true);
  assert.equal(repo.getBook(other.id)!.cover_image_id, "img-u");
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

test("search puts the closer match first and keeps the order books became searchable for equal scores, even when the limit cuts the tie", () => {
  const { repo } = freshRepo();
  const searchable = (title: string, isbn: string) => {
    const book = repo.createBook({ title, author: "Ana Lima", isbn }, [`isbn:${isbn}`], NOW);
    repo.makeSearchable(book.id);
    return book;
  };
  const firstTwin = searchable("O Mar Azul", "9789720000001");
  const closer = searchable("Mar", "9789720000002");
  const secondTwin = searchable("O Mar Azul", "9789720000003");

  assert.deepEqual(repo.searchBooks(["mar"], 10).map((book) => book.id), [closer.id, firstTwin.id, secondTwin.id]);
  assert.deepEqual(repo.searchBooks(["mar"], 2).map((book) => book.id), [closer.id, firstTwin.id]);
});

test("search ranks inside the full-text index and reads books only for the rows it keeps", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const prepare = mock.method(db, "prepare");
  createSqliteBooksRepository(db);
  const statements = prepare.mock.calls.map((call) => String(call.arguments[0])).filter((sql) => /books_fts MATCH/.test(sql));
  prepare.mock.restore();

  assert.equal(statements.length, 1);
  const steps = (db.prepare(`EXPLAIN QUERY PLAN ${statements[0]}`).all('"mar"*', 12) as Array<{ detail: string }>).map((row) => row.detail);
  const position = (pattern: RegExp) => steps.findIndex((detail) => pattern.test(detail));
  const order = [/^CO-ROUTINE hits$/, /^SCAN books_fts VIRTUAL TABLE INDEX 0:M/, /USE TEMP B-TREE FOR ORDER BY/, /^SCAN hits$/, /^SCAN books_fts VIRTUAL TABLE INDEX 0:=$/, /^SEARCH books USING INDEX sqlite_autoindex_books_1 \(id=\?\)/].map(position);
  assert.ok(order.every((index) => index >= 0), steps.join(" | "));
  assert.deepEqual(order, [...order].sort((left, right) => left - right), steps.join(" | "));
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
  db.exec("DROP TRIGGER books_original_arrival; DROP TRIGGER books_original_retitle; DROP TRIGGER books_original_keyed");
  db.exec("DROP INDEX idx_books_title_work");
  db.exec("DROP INDEX idx_books_author_key");
  db.exec("ALTER TABLE books DROP COLUMN title_key");
  db.exec("ALTER TABLE books DROP COLUMN title_group_blocked_at");
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  const columns = (db.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(columns.includes("title_key") && columns.includes("title_group_blocked_at"));
  const triggers = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(triggers, ["books_original_arrival", "books_original_keyed", "books_original_retitle"]);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_title_work'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_author_key'").get());
});

test("the old title key index is dropped from an existing database", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("CREATE INDEX idx_books_title_key ON books(title_key)");
  applyBooksMigrations(db);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_title_key'").get(), undefined);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_title_work'").get());
});

test("the old work lookup index is replaced on an existing database and the other queue indexes stay", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("CREATE INDEX idx_books_work_lookup ON books(work_checked_at IS NOT NULL, created_by IS NOT NULL, work_checked_at, created_at) WHERE ol_work_key IS NULL AND isbn IS NOT NULL AND details_status IS NOT NULL");
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  const exists = (name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name) !== undefined;
  assert.equal(exists("idx_books_work_lookup"), false);
  assert.deepEqual(["idx_books_work_queue", "idx_books_bnp_details", "idx_books_details_pending"].map(exists), [true, true, true]);
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

test("a keyless work joins the single keyed work that shares its title key, and keeps no key of its own", async () => {
  const { db, repo } = freshRepo();
  const keyed = edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL893415W");
  const keyless = edition(repo, "9780593099322", "Dune", "Frank Herbert");
  assert.equal(await groupKeylessWorks(repo, 250), 1);
  const moved = repo.getBook(keyless.id)!;
  assert.deepEqual([moved.work_id, moved.ol_work_key], [keyed.work_id, null]);
  assert.equal(workById(db, keyless.work_id).merged_into, keyed.work_id);
  assert.equal(await groupKeylessWorks(repo, 250), 0);
});

test("keyless works sharing a title key merge into the oldest of them", async () => {
  const { db, repo } = freshRepo();
  const oldest = edition(repo, "9789720000001", "Ensaio sobre a Cegueira", "José Saramago", undefined, at(0));
  const middle = edition(repo, "9789720000002", "Ensaio Sobre a Cegueira", "Saramago, José", undefined, at(1));
  const newest = edition(repo, "9789720000003", "Ensaio sobre a cegueira", "José Saramago", undefined, at(2));
  assert.equal(await groupKeylessWorks(repo, 250), 1);
  assert.deepEqual([oldest, newest].map((book) => repo.getBook(book.id)!.work_id), [oldest.work_id, oldest.work_id]);
  assert.equal(repo.getBook(middle.id)!.work_id, middle.work_id);
  assert.equal(workById(db, oldest.work_id).merged_into, null);
});

test("grouping skips ambiguous title keys, authorless and unkeyed editions, mixed works and blocked editions", async () => {
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
  assert.equal(await groupKeylessWorks(repo, 250), 0);
  assert.equal(repo.getBook(blocked.id)!.work_id, blocked.work_id);
});

test("a keyed edition arriving later pulls a keyless group into its work, and every old id resolves there", async () => {
  const { db, repo } = freshRepo();
  const first = edition(repo, "9789720000001", "Os Maias", "Eça de Queirós", undefined, at(0));
  const second = edition(repo, "9789720000002", "Os Maias", "Eça de Queirós", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 250), 1);
  const keyed = edition(repo, "9789725681367", "Os Maias", "Eça de Queirós", "OL846513W", at(2));
  assert.equal(await groupKeylessWorks(repo, 250), 1);
  assert.deepEqual([first, second, keyed].map((book) => repo.getBook(book.id)!.work_id), [keyed.work_id, keyed.work_id, keyed.work_id]);
  assert.deepEqual([first.work_id, second.work_id].map((id) => workById(db, id).merged_into), [keyed.work_id, keyed.work_id]);
});

test("Open Library's key moves a title-grouped edition out to its own work, and grouping leaves it there", async () => {
  const { repo } = freshRepo();
  const keyed = edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL1W");
  const grouped = edition(repo, "9780593099322", "Dune", "Frank Herbert");
  await groupKeylessWorks(repo, 250);
  repo.setWorkKey(grouped.id, "OL9W");
  const moved = repo.getBook(grouped.id)!;
  assert.notEqual(moved.work_id, keyed.work_id);
  assert.equal(repo.getWorkView(moved.work_id!)!.olWorkKey, "OL9W");
  assert.equal(repo.getBook(keyed.id)!.work_id, keyed.work_id);
  assert.equal(await groupKeylessWorks(repo, 250), 0);
});

test("groupKeylessWorks merges at most its limit per batch", async () => {
  const { repo } = freshRepo();
  edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL1W");
  edition(repo, "9780593099322", "Dune", "Frank Herbert");
  edition(repo, "9780141439587", "Emma", "Jane Austen", "OL2W");
  edition(repo, "9780141439588", "Emma", "Jane Austen");
  assert.equal(await groupKeylessWorks(repo, 1), 1);
  assert.equal(await groupKeylessWorks(repo, 1), 1);
  assert.equal(await groupKeylessWorks(repo, 1), 0);
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
  add("mixed-newer", "Blindness", "José Saramago", undefined, at(2));

  add("empty-a", "Orlando", "", undefined, at(0));
  add("empty-b", "Orlando", "", undefined, at(1));

  const nullA = add("null-a", "Middlemarch", "George Eliot", undefined, at(0));
  const nullB = add("null-b", "Middlemarch", "George Eliot", undefined, at(1));
  const nullWork = nullA.work_id!;
  repo.mergeWorks(nullB.work_id!, nullWork, at(1));
  db.prepare("UPDATE books SET title_key = NULL WHERE id = ?").run(nullB.id);
  add("null-c", "Middlemarch", "George Eliot", undefined, at(2));

  return { db, repo, label };
}

function mergedPairs(db: DatabaseSync, label: Map<string, string>) {
  const rows = db.prepare("SELECT from_work, into_work FROM work_merges WHERE source = 'title-key' ORDER BY id").all() as Array<{ from_work: string; into_work: string }>;
  return rows.map((row) => `${label.get(row.from_work) ?? row.from_work}>${label.get(row.into_work) ?? row.into_work}`);
}

test("grouping picks the same source and target for every rule case", async () => {
  const { db, repo, label } = groupingFixture();
  assert.equal(await groupKeylessWorks(repo, 250, { at: NOW }), 7);
  assert.deepEqual(mergedPairs(db, label).sort(), ["b1>b0", "k1>keyed", "k2>keyed", "m1>m0", "m2>m0", "m3>m0", "tie-hi>tie-lo"]);
  assert.equal(await groupKeylessWorks(repo, 250, { at: NOW }), 0);
});

test("batches of one merge the same pairs as one call, oldest first within a title key", async () => {
  const one = groupingFixture();
  let merged = 0;
  while (merged < 20 && await groupKeylessWorks(one.repo, 1, { at: NOW }) === 1) merged++;
  assert.equal(merged, 7);
  const all = groupingFixture();
  await groupKeylessWorks(all.repo, 250, { at: NOW });
  assert.deepEqual(mergedPairs(one.db, one.label).sort(), mergedPairs(all.db, all.label).sort());
  assert.deepEqual(mergedPairs(one.db, one.label).filter((pair) => pair.endsWith(">m0")), ["m1>m0", "m2>m0", "m3>m0"]);
});

test("keyless grouping one title key a page, each page its own transaction, merges the same pairs in the same order as one page", async () => {
  const paged = groupingFixture();
  const events: string[] = [];
  const open: boolean[] = [];
  const spy = {
    ...paged.repo,
    groupableTitleKeys: (...args: Parameters<typeof paged.repo.groupableTitleKeys>) => {
      open.push(paged.db.isTransaction);
      events.push("keys");
      setImmediate(() => events.push("tick"));
      return paged.repo.groupableTitleKeys(...args);
    },
    groupTitleKeys: (...args: Parameters<typeof paged.repo.groupTitleKeys>) => {
      open.push(paged.db.isTransaction);
      events.push("group");
      return paged.repo.groupTitleKeys(...args);
    }
  };
  assert.equal(await groupKeylessWorks(spy, 250, { at: NOW, pageSize: 1 }), 7);
  const all = groupingFixture();
  assert.equal(await groupKeylessWorks(all.repo, 250, { at: NOW }), 7);
  assert.deepEqual(mergedPairs(paged.db, paged.label), mergedPairs(all.db, all.label));
  assert.ok(open.length > 0 && open.every((inTransaction) => !inTransaction));
  assert.ok(events.filter((event) => event === "keys").length > 1);
  assert.ok(events.includes("group"));
  events.forEach((event, i) => {
    if (event === "group") assert.deepEqual(events.slice(i - 2, i), ["keys", "tick"]);
  });
});

test("keyless grouping stops on an aborted signal", async () => {
  const { db, repo } = groupingFixture();
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await groupKeylessWorks(repo, 250, { at: NOW, signal: aborted.signal }), 0);
  assert.equal(countOf(db, "work_merges", "source = 'title-key'"), 0);

  const reading = new AbortController();
  let grouped = 0;
  const spy = {
    ...repo,
    groupableTitleKeys: (...args: Parameters<typeof repo.groupableTitleKeys>) => {
      reading.abort();
      return repo.groupableTitleKeys(...args);
    },
    groupTitleKeys: (...args: Parameters<typeof repo.groupTitleKeys>) => {
      grouped++;
      return repo.groupTitleKeys(...args);
    }
  };
  assert.equal(await groupKeylessWorks(spy, 250, { at: NOW, signal: reading.signal }), 0);
  assert.equal(grouped, 0);
  assert.equal(countOf(db, "work_merges", "source = 'title-key'"), 0);
});

test("shared title keys that never pair don't end a batch early", async () => {
  const { db, repo } = freshRepo();
  edition(repo, "9780000000001", "Alpha Tale", "Ann Author", "OL1W");
  edition(repo, "9780000000002", "Alpha Tale", "Ann Author", "OL2W");
  edition(repo, "9780000000003", "Bravo Tale", "Ann Author", "OL3W");
  edition(repo, "9780000000004", "Bravo Tale", "Ann Author", "OL4W");
  edition(repo, "9780000000005", "Charlie Tale", "Ann Author", "OL5W");
  edition(repo, "9780000000006", "Charlie Tale", "Ann Author", "OL6W");
  const detached = edition(repo, "9780000000007", "Delta Tale", "Ann Author", undefined, at(0));
  repo.detachEdition(detached.id, at(1));
  edition(repo, "9780000000008", "Delta Tale", "Ann Author", undefined, at(1));
  const echo = edition(repo, "9780000000009", "Echo Tale", "Ann Author", undefined, at(0));
  const foxtrot = edition(repo, "9780000000010", "Foxtrot Tale", "Ann Author", undefined, at(1));
  repo.mergeWorks(foxtrot.work_id!, echo.work_id!, at(1));
  edition(repo, "9780000000011", "Echo Tale", "Ann Author", undefined, at(2));
  const oldest = edition(repo, "9780000000012", "Zulu Tale", "Ann Author", undefined, at(0));
  const newest = edition(repo, "9780000000013", "Zulu Tale", "Ann Author", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 1, { at: NOW }), 1);
  assert.equal(workById(db, newest.work_id).merged_into, oldest.work_id);
  assert.equal(await groupKeylessWorks(repo, 1, { at: NOW }), 0);
});

test("a batch never merges more than its limit when shared keys yield uneven pairs", async () => {
  const { db, repo } = freshRepo();
  edition(repo, "9780000000001", "Alpha Tale", "Ann Author", undefined, at(0));
  edition(repo, "9780000000002", "Alpha Tale", "Ann Author", undefined, at(1));
  edition(repo, "9780000000003", "Bravo Tale", "Ann Author", "OL1W");
  edition(repo, "9780000000004", "Bravo Tale", "Ann Author", "OL2W");
  edition(repo, "9780000000005", "Charlie Tale", "Ann Author", undefined, at(0));
  edition(repo, "9780000000006", "Charlie Tale", "Ann Author", undefined, at(1));
  edition(repo, "9780000000007", "Charlie Tale", "Ann Author", undefined, at(2));
  assert.deepEqual([await groupKeylessWorks(repo, 2, { at: NOW }), await groupKeylessWorks(repo, 2, { at: NOW }), await groupKeylessWorks(repo, 2, { at: NOW })], [2, 1, 0]);
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
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 5);
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
    [WORK_LOOKUP_SQL, [NOW, 50], "idx_books_work_queue"]
  ];
  for (const [sql, params, index] of cases) {
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
    assert.match(plan, new RegExp(`USING INDEX ${index}\\b`), plan);
    assert.doesNotMatch(plan, /TEMP B-TREE/, plan);
  }
});

test("the work lookup seeks both flags and the check time in its index", () => {
  const { db } = freshRepo();
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${WORK_LOOKUP_SQL}`).all(NOW, 50) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  assert.match(plan, /SEARCH books USING INDEX idx_books_work_queue \(<expr>=\? AND <expr>=\? AND <expr><\?\)/, plan);
});

test("grouping reads shared title keys from the covering index, with no temp sort", () => {
  const { db } = freshRepo();
  const plan = (sql: string, ...params: Array<string | number>) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  const keys = plan(GROUPABLE_KEYS_SQL, "", 250);
  assert.match(keys, /USING COVERING INDEX idx_books_title_work\b/, keys);
  assert.doesNotMatch(keys, /TEMP B-TREE/, keys);
});

test("looking up keyed works and keyless candidates for a title key reads through the title index, never a scan of books, and enters works by their key", () => {
  const { db } = freshRepo();
  for (const sql of [KEYED_WORKS_SQL, KEYED_EDITIONS_SQL, KEYLESS_CANDIDATES_SQL]) {
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("[]") as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
    assert.match(plan, /SEARCH books USING (COVERING )?INDEX idx_books_title_work \(title_key=\?\)/, plan);
    assert.doesNotMatch(plan, /SCAN books/, plan);
    assert.match(plan, /SEARCH works USING INDEX sqlite_autoindex_works_1 \(id=\?\)/, plan);
    assert.doesNotMatch(plan, /AUTOMATIC|SEARCH works USING (COVERING )?INDEX idx_/, plan);
  }
  const editions = (db.prepare(`EXPLAIN QUERY PLAN ${KEYED_EDITIONS_SQL}`).all("[]") as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  assert.match(editions, /SEARCH merged USING INDEX idx_works_merged_into \(merged_into=\?\)/, editions);
  assert.match(editions, /SEARCH m USING INDEX idx_work_merges_from \(from_work=\?\)/, editions);
  assert.doesNotMatch(editions, /SCAN (works|work_merges|merged|m)\b/, editions);
  const keyed = (db.prepare(`EXPLAIN QUERY PLAN ${KEYED_WORKS_SQL}`).all("[]") as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  assert.match(keyed, /SEARCH work_merges USING COVERING INDEX idx_work_merges_into \(into_work=\? AND source=\? AND undone_at=\?\)/, keyed);
  assert.doesNotMatch(keyed, /SCAN work_merges/, keyed);
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

test("listHeldBnpDetailIds returns unchecked bnp books in the given works, untried first, up to the limit", () => {
  const { repo } = freshRepo();
  const bnp = (title: string, at: string) => repo.createBook({ title, author: "X", isbn: null, createdBy: "bnp" }, [`ta:${title.toLowerCase()}|x|`], at);
  const failed = bnp("Failed", "2026-09-01T00:00:00.000Z");
  const older = bnp("Older", "2026-09-02T00:00:00.000Z");
  const newer = bnp("Newer", "2026-09-03T00:00:00.000Z");
  const found = bnp("Found", NOW);
  const missing = bnp("Missing", NOW);
  const elsewhere = bnp("Elsewhere", NOW);
  const plain = repo.createBook({ title: "Plain", author: "X", isbn: null }, ["ta:plain|x|"], NOW);
  repo.markDetailsAttempted(failed.id, NOW);
  repo.saveDetails(found.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  repo.markDetailsMissing(missing.id, NOW);
  const held = [failed, older, newer, found, missing, plain].map((book) => book.work_id!);

  assert.deepEqual(repo.listHeldBnpDetailIds(held, 10), [older.id, newer.id, failed.id]);
  assert.deepEqual(repo.listHeldBnpDetailIds(held, 1), [older.id]);
  assert.deepEqual(repo.listHeldBnpDetailIds([], 10), []);
  assert.ok(!repo.listHeldBnpDetailIds(held, 10).includes(elsewhere.id));
});

test("the held bnp read probes the bnp details index by work and never the work index", () => {
  const { db } = freshRepo();
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${HELD_BNP_DETAILS_SQL}`).all("[]", 50) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  assert.match(plan, /SEARCH books USING COVERING INDEX idx_books_bnp_details \(work_id=\?/, plan);
  assert.doesNotMatch(plan, /idx_books_work\b/, plan);
});

test("the Portuguese read for given works starts from the ids", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const prepare = mock.method(db, "prepare");
  createSqliteBooksRepository(db);
  const statements = prepare.mock.calls.map((call) => String(call.arguments[0])).filter((sql) => /CROSS JOIN works w ON w\.id = ids\.value/.test(sql));
  prepare.mock.restore();

  assert.equal(statements.length, 1);
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${statements[0]}`).all({ $ids: "[]", $recheck: null, $rejections: 3, $limit: 50 }) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  assert.match(plan, /SEARCH w USING INDEX sqlite_autoindex_works_1 \(id=\?\)/, plan);
  assert.doesNotMatch(plan, /idx_works_merged_into/, plan);
});

test("portugueseWorksNeedingMatch for given works returns each live work once, oldest first, up to the limit", () => {
  const { repo } = freshRepo();
  const portuguese = (title: string, isbn: string, createdAt: string) => {
    const book = repo.createBook({ title, author: "X", isbn }, [`isbn:${isbn}`], createdAt);
    repo.setLanguage(book.id, "pt-PT");
    return book;
  };
  const newest = portuguese("Terceiro", "9789720000003", at(-1));
  const oldest = portuguese("Primeiro", "9789720000001", at(-3));
  const middle = portuguese("Segundo", "9789720000002", at(-2));
  const absorbed = portuguese("Quarto", "9789720000004", at(-4));
  repo.mergeWorks(absorbed.work_id!, middle.work_id!);

  const ids = [newest.work_id!, oldest.work_id!, newest.work_id!, absorbed.work_id!, middle.work_id!];
  assert.deepEqual(repo.portugueseWorksNeedingMatch(ids, 10, 3, null), [oldest.work_id, middle.work_id, newest.work_id]);
  assert.deepEqual(repo.portugueseWorksNeedingMatch(ids, 2, 3, null), [oldest.work_id, middle.work_id]);
  assert.deepEqual(repo.portugueseWorksNeedingMatch([absorbed.work_id!], 10, 3, null), []);
});

test("authorCandidates returns the works whose first author is exactly the one asked for, with a non-Portuguese edition, most editions first then by id", () => {
  const { repo } = freshRepo();
  let next = 0;
  const edition = (title: string, author: string, options: { language?: string; workKey?: string } = {}) => {
    const isbn = `97897200${String(++next).padStart(5, "0")}`;
    const book = repo.createBook({ title, author, isbn, workKey: options.workKey }, [`isbn:${isbn}`], NOW);
    if (options.language) repo.setLanguage(book.id, options.language);
    return book;
  };
  const twoEditions = edition("Ondas", "Ana Lima", { workKey: "OL1W" });
  edition("Ondas", "Ana Lima, Bo Roe", { workKey: "OL1W" });
  const coAuthored = edition("Mar Alto", "Ana Lima, Bo Roe");
  const alone = edition("Maré Baixa", "Ana Lima");
  edition("Terra Firme", "Ana Limao");
  edition("Rio Longo", "Ana Lima Costa");
  edition("Céu Aberto", "Bo Roe, Ana Lima");
  edition("Vento Sul", "Ana Lima", { language: "pt-PT" });

  assert.deepEqual(repo.authorCandidates(authorPattern("Ana Lima, Bo Roe")!), [twoEditions.work_id, ...[coAuthored.work_id, alone.work_id].sort()]);
});

test("authorCandidates reports the live work of a merged one", () => {
  const { db, repo } = freshRepo();
  const kept = repo.createBook({ title: "Ondas", author: "Zed Roe", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const absorbed = repo.createBook({ title: "Mar Alto", author: "Ana Lima", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  repo.mergeWorks(absorbed.work_id!, kept.work_id!);
  db.prepare("UPDATE books SET work_id = ? WHERE id = ?").run(absorbed.work_id, absorbed.id);

  assert.deepEqual(repo.authorCandidates(authorPattern("Ana Lima")!), [kept.work_id]);
});

test("the author read of candidate works searches the author index", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const prepare = mock.method(db, "prepare");
  createSqliteBooksRepository(db);
  const statements = prepare.mock.calls.map((call) => String(call.arguments[0])).filter((sql) => /COUNT\(\*\) AS editions/.test(sql));
  prepare.mock.restore();

  assert.equal(statements.length, 1);
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${statements[0]}`).all("x|*") as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  assert.match(plan, /SEARCH b USING INDEX idx_books_author_key \(<expr>>\? AND <expr><\?\)/, plan);
});

test("listWorkLookupIds returns due editions never-checked first, user editions before seed and bnp, oldest check first", () => {
  const { repo } = freshRepo();
  let next = 0;
  const edition = (title: string, createdAt: string, options: { createdBy?: "seed" | "bnp" | "publisher"; workKey?: string; isbn?: string | null; details?: boolean; checkedAt?: string } = {}) => {
    const isbn = options.isbn === undefined ? `97897200${String(++next).padStart(5, "0")}` : options.isbn;
    const book = repo.createBook({ title, author: "X", isbn, createdBy: options.createdBy, workKey: options.workKey }, [isbn ? `isbn:${isbn}` : `ta:${title.toLowerCase()}|x|`], createdAt);
    if (options.details !== false) repo.markDetailsMissing(book.id, NOW);
    if (options.checkedAt) repo.markWorkChecked(book.id, options.checkedAt);
    return book.id;
  };
  const recheckBefore = at(-30);

  const seedChecked33 = edition("Seed checked 33", at(-90), { createdBy: "seed", checkedAt: at(-33) });
  const userChecked35 = edition("User checked 35", at(-90), { checkedAt: at(-35) });
  const bnpChecked45 = edition("Bnp checked 45", at(-90), { createdBy: "bnp", checkedAt: at(-45) });
  const userChecked40 = edition("User checked 40", at(-90), { checkedAt: at(-40) });
  const seedNever = edition("Seed never", at(-60), { createdBy: "seed" });
  const tieA = edition("Tie A", at(-10));
  const tieB = edition("Tie B", at(-10));
  const userOld = edition("User old", at(-20));
  edition("User checked 5", at(-90), { checkedAt: at(-5) });
  edition("Publisher", at(-90), { createdBy: "publisher" });
  edition("Keyed", at(-90), { workKey: "OL1W" });
  edition("No details", at(-90), { details: false });
  edition("No ISBN", at(-90), { isbn: null });

  const due = [userOld, tieA, tieB, seedNever, userChecked40, userChecked35, bnpChecked45, seedChecked33];
  assert.deepEqual(repo.listWorkLookupIds(50, recheckBefore), due);
  assert.deepEqual(repo.listWorkLookupIds(5, recheckBefore), due.slice(0, 5));
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
  assert.equal(userVersion(db), 5);
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
  assert.equal(userVersion(db), 5);
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
  assert.equal(userVersion(db), 5);
});

const originalTitleOf = (db: DatabaseSync, id: string) => (db.prepare("SELECT original_title FROM books WHERE id = ?").get(id) as { original_title: string | null }).original_title;

test("the original-title pass clears stored values that are not titles and keeps the rest", () => {
  const { db, repo } = freshRepo();
  const stored = [":", "", "—", "Tradução: Ana Lima", "Tradução", "• Tradução: Ana Lima", "Solaris", "1984", "Солярис"];
  const books = stored.map((value, index) => {
    const isbn = `9789720001${String(index).padStart(3, "0")}`;
    const book = repo.createBook({ title: `Livro ${index}`, author: "X", isbn }, [`isbn:${isbn}`], NOW);
    db.prepare("UPDATE books SET original_title = ? WHERE id = ?").run(value, book.id);
    return book;
  });
  db.exec("PRAGMA user_version = 4");
  applyBooksMigrations(db);
  assert.deepEqual(books.map((book) => originalTitleOf(db, book.id)), [null, null, null, null, null, null, "Solaris", "1984", "Солярис"]);
  assert.equal(userVersion(db), 5);
});

test("the original-title pass runs once, so a value stored after it is left as stored", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Livro", author: "X", isbn: "9789720001900" }, ["isbn:9789720001900"], NOW);
  db.exec("PRAGMA user_version = 4");
  applyBooksMigrations(db);
  db.prepare("UPDATE books SET original_title = ':' WHERE id = ?").run(book.id);
  applyBooksMigrations(db);
  assert.equal(originalTitleOf(db, book.id), ":");
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

test("fillOriginalTitle writes no value that is not a title, so a later real one still lands", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Solaris", author: "Stanislaw Lem", isbn: "9789720000131" }, ["isbn:9789720000131"], NOW);
  repo.fillOriginalTitle(book.id, ":");
  assert.equal(repo.getBook(book.id)!.original_title, null);
  repo.fillOriginalTitle(book.id, "Solaris");
  assert.equal(repo.getBook(book.id)!.original_title, "Solaris");
});

test("original title claims read the column and the summary label, skip books with neither, and write nothing", () => {
  const { db, repo } = freshRepo();
  const column = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000121" }, ["isbn:9789720000121"], NOW);
  repo.setLanguage(column.id, "pt-PT");
  repo.fillOriginalTitle(column.id, "To the Lighthouse");
  const labelled = repo.createBook({ title: "O Passeio", author: "Robert Walser", isbn: "9789720000122" }, ["isbn:9789720000122"], NOW);
  db.prepare("UPDATE books SET summary = ? WHERE id = ?").run("Um passeio por uma cidade suíça.\n\nTítulo original: Der Spaziergang", labelled.id);
  const both = repo.createBook({ title: "Solaris", author: "Stanislaw Lem", isbn: "9789720000123" }, ["isbn:9789720000123"], NOW);
  repo.fillOriginalTitle(both.id, "Solaris");
  db.prepare("UPDATE books SET summary = ? WHERE id = ?").run("Um planeta.\n\nTítulo original: Solyaris", both.id);
  const unlabelled = repo.createBook({ title: "Sem rótulo", author: "X", isbn: "9789720000124" }, ["isbn:9789720000124"], NOW);
  db.prepare("UPDATE books SET summary = ? WHERE id = ?").run("Uma sinopse sem rótulo de origem.", unlabelled.id);
  repo.createBook({ title: "Sem nada", author: "Y", isbn: "9789720000125" }, ["isbn:9789720000125"], NOW);
  const empty = repo.createBook({ title: "Vazio", author: "Z", isbn: "9789720000126" }, ["isbn:9789720000126"], NOW);
  db.prepare("UPDATE books SET original_title = '', summary = 'Título original:   ' WHERE id = ?").run(empty.id);
  const claims = repo.originalTitleClaims().sort((a, b) => a.title.localeCompare(b.title));
  assert.deepEqual(claims, [
    { workId: labelled.work_id, title: "O Passeio", author: "Robert Walser", language: null, originalTitle: "Der Spaziergang" },
    { workId: column.work_id, title: "Passeio ao Farol", author: "Virginia Woolf", language: "pt-PT", originalTitle: "To the Lighthouse" },
    { workId: both.work_id, title: "Solaris", author: "Stanislaw Lem", language: null, originalTitle: "Solaris" }
  ]);
  assert.equal(repo.getBook(labelled.id)!.original_title, null);
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

test("every merge is recorded with the editions it moved and the works it repointed", async () => {
  const { db, repo } = freshRepo();
  const alias = repo.createBook({ title: "Alias", author: "X", isbn: "9789720000207" }, ["isbn:9789720000207"], NOW);
  const pt = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000208" }, ["isbn:9789720000208"], NOW);
  const en = repo.createBook({ title: "Walk", author: "X", isbn: "9789720000209", workKey: "OL904W" }, ["isbn:9789720000209"], NOW);
  repo.mergeWorks(alias.work_id!, pt.work_id!, AT);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.93, AT);
  const twin1 = repo.createBook({ title: "Twin", author: "Y", isbn: "9789720000219" }, ["isbn:9789720000219"], NOW);
  const twin2 = repo.createBook({ title: "Twin", author: "Y", isbn: "9789720000210" }, ["isbn:9789720000210"], NOW);
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 1);
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

test("active merges list one source's merges that are not undone, newest first, with the books they moved", () => {
  const { repo } = freshRepo();
  const target = repo.createBook({ title: "Walk", author: "X", isbn: "9780000000401", workKey: "OL940W" }, ["isbn:9780000000401"], NOW);
  const [first, second, third, judged] = ["9789720000402", "9789720000403", "9789720000404", "9789720000405"].map((isbn) => repo.createBook({ title: `Passeio ${isbn}`, author: "X", isbn }, [`isbn:${isbn}`], NOW));
  for (const edition of [first!, second!, third!]) repo.mergeTranslation(edition.work_id!, target.work_id!, "code", null, AT);
  repo.mergeTranslation(judged!.work_id!, target.work_id!, "jev", 0.95, AT);
  repo.undoMerge(second!.work_id!, "2026-10-16T00:00:00.000Z");
  assert.deepEqual(repo.activeMerges("code"), [
    { id: 3, fromWork: third!.work_id, intoWork: target.work_id, movedBookIds: [third!.id], mergedAt: AT },
    { id: 1, fromWork: first!.work_id, intoWork: target.work_id, movedBookIds: [first!.id], mergedAt: AT }
  ]);
  assert.deepEqual(repo.activeMerges("jev").map((merge) => merge.fromWork), [judged!.work_id]);
  assert.deepEqual(repo.activeMerges("manual"), []);
});

test("editions of works carry the original title from the column or the summary label, and only for the works asked", () => {
  const { db, repo } = freshRepo();
  const column = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000411" }, ["isbn:9789720000411"], NOW);
  repo.setLanguage(column.id, "pt-PT");
  repo.fillOriginalTitle(column.id, "To the Lighthouse");
  const labelled = repo.createBook({ title: "O Passeio", author: "Robert Walser", isbn: "9789720000412" }, ["isbn:9789720000412"], NOW);
  db.prepare("UPDATE books SET work_id = ?, summary = ? WHERE id = ?").run(column.work_id, "Um passeio.\n\nTítulo original: Der Spaziergang", labelled.id);
  const bare = repo.createBook({ title: "Sem nada", author: "Y", isbn: "9789720000413" }, ["isbn:9789720000413"], NOW);
  repo.createBook({ title: "Outro", author: "Z", isbn: "9789720000414" }, ["isbn:9789720000414"], NOW);
  assert.deepEqual(repo.editionsOf([column.work_id!, bare.work_id!]), [
    { id: column.id, workId: column.work_id, title: "Passeio ao Farol", author: "Virginia Woolf", language: "pt-PT", isbn: "9789720000411", originalTitle: "To the Lighthouse" },
    { id: labelled.id, workId: column.work_id, title: "O Passeio", author: "Robert Walser", language: null, isbn: "9789720000412", originalTitle: "Der Spaziergang" },
    { id: bare.id, workId: bare.work_id, title: "Sem nada", author: "Y", language: null, isbn: "9789720000413", originalTitle: null }
  ]);
});

test("an undone translation merge stays undone through the next title-key grouping, and takes back a later keyless copy", async () => {
  const { db, repo } = freshRepo();
  const pt = repo.createBook({ title: "Poemas", author: "John Keats", isbn: "9789720000351" }, ["isbn:9789720000351"], NOW);
  const en = repo.createBook({ title: "Poems", author: "Emily Dickinson", isbn: "9780000000352", workKey: "OL930W" }, ["isbn:9780000000352"], NOW);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.92, AT);
  const copy = repo.createBook({ title: "Poemas", author: "John Keats", isbn: "9789720000353" }, ["isbn:9789720000353"], NOW);
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 1);
  assert.equal(repo.getBook(copy.id)!.work_id, en.work_id);

  repo.undoMerge(pt.work_id!, "2026-10-16T00:00:00.000Z");
  assert.equal(repo.getBook(copy.id)!.work_id, pt.work_id);
  assert.equal(workById(db, copy.work_id).merged_into, pt.work_id);
  assert.equal(await groupKeylessWorks(repo, 10, { at: "2026-10-17T00:00:00.000Z" }), 0);
  assert.equal(workById(db, pt.work_id).merged_into, null);
  assert.equal(repo.getBook(pt.id)!.work_id, pt.work_id);
});

const fourthWing = () => {
  const { db, repo } = freshRepo();
  const novel = edition(repo, "9780000000401", "Fourth Wing", "Rebecca Yarros", "OL1W", at(0));
  const novelAgain = edition(repo, "9780000000406", "Fourth Wing", "Rebecca Yarros", "OL1W", at(0));
  const graphic = edition(repo, "9780000000402", "Fourth Wing: The Graphic Novel", "Rebecca Yarros", "OL2W", at(0));
  const piatkus = edition(repo, "9780000000403", "Fourth wing", "Rebecca Yarros", undefined, at(1));
  const graphicKeyless = edition(repo, "9780000000404", "Fourth Wing: The Graphic Novel", "Rebecca Yarros", undefined, at(2));
  const coloring = edition(repo, "9780000000405", "Fourth Wing: The Coloring Book", "Rebecca Yarros", undefined, at(1));
  return { db, repo, novel, novelAgain, graphic, piatkus, graphicKeyless, coloring, key: repo.getBook(novel.id)!.title_key! };
};

test("keyedWorksWithTitleKeys lists live keyed works with an edition under the key", () => {
  const { db, repo } = freshRepo();
  const novel = edition(repo, "9780000000501", "Fourth Wing", "Rebecca Yarros", "OL1W", at(1));
  edition(repo, "9780000000502", "Quarta Asa", "Rebecca Yarros", "OL1W", at(1));
  const graphic = edition(repo, "9780000000503", "Fourth Wing: The Graphic Novel", "Rebecca Yarros", "OL2W", at(2));
  const flame = edition(repo, "9780000000504", "Iron Flame", "Rebecca Yarros", "OL3W", at(3));
  const both = edition(repo, "9780000000505", "Fourth Wing", "Rebecca Yarros", "OL4W", at(4));
  edition(repo, "9780000000506", "Iron Flame", "Rebecca Yarros", "OL4W", at(4));
  edition(repo, "9780000000507", "Fourth Wing", "Rebecca Yarros", undefined, at(5));
  const merged = edition(repo, "9780000000508", "Fourth Wing", "Rebecca Yarros", "OL5W", at(6));
  repo.mergeTranslation(merged.work_id!, novel.work_id!, "manual", null, AT);
  const blocked = edition(repo, "9780000000509", "Fourth Wing", "Rebecca Yarros", "OL6W", at(7));
  db.prepare("UPDATE books SET title_group_blocked_at = ? WHERE id = ?").run(AT, blocked.id);
  const partlyBlocked = edition(repo, "9780000000510", "Fourth Wing", "Rebecca Yarros", "OL7W", at(8));
  const sibling = edition(repo, "9780000000511", "Fourth Wing", "Rebecca Yarros", "OL7W", at(8));
  db.prepare("UPDATE books SET title_group_blocked_at = ? WHERE id = ?").run(AT, sibling.id);
  const key = repo.getBook(novel.id)!.title_key!;
  const flameKey = repo.getBook(flame.id)!.title_key!;
  const row = (titleKey: string, book: { work_id: string | null }, title: string, editions: number, createdAt: string) => ({ titleKey, id: book.work_id, title, author: "Rebecca Yarros", editions, absorbed: 0, createdAt });

  assert.deepEqual(repo.keyedWorksWithTitleKeys([key]).map((work) => ({ ...work })), [
    row(key, novel, "Fourth Wing", 3, at(1)),
    row(key, graphic, "Fourth Wing: The Graphic Novel", 1, at(2)),
    row(key, both, "Fourth Wing", 2, at(4)),
    row(key, partlyBlocked, "Fourth Wing", 2, at(8))
  ]);
  const pairs = repo.keyedWorksWithTitleKeys([key, flameKey]).map((work) => `${work.titleKey}>${work.id}`);
  assert.deepEqual(pairs.sort(), [key, flameKey].flatMap((titleKey) => (titleKey === key ? [novel, graphic, both, partlyBlocked] : [flame, both]).map((book) => `${titleKey}>${book.work_id}`)).sort());
  assert.deepEqual(repo.keyedWorksWithTitleKeys([]), []);
});

test("keyedWorksWithTitleKeys counts only a work's live ol-duplicate merges as absorbed", () => {
  const { db, repo } = freshRepo();
  const target = edition(repo, "9780000000521", "Fourth Wing", "Rebecca Yarros", "OL1W", at(0));
  edition(repo, "9780000000522", "Fourth Wing", "Rebecca Yarros", undefined, at(1));
  const key = repo.getBook(target.id)!.title_key!;
  assert.equal(repo.groupTitleKeys([key], 10, AT), 1);
  const keyless = edition(repo, "9780000000523", "Iron Flame", "Rebecca Yarros", undefined, at(2));
  repo.mergeWorks(keyless.work_id!, target.work_id!, AT);
  const translated = edition(repo, "9780000000524", "Quarta Asa", "Rebecca Yarros", undefined, at(3));
  repo.mergeTranslation(translated.work_id!, target.work_id!, "code", null, AT);
  const first = edition(repo, "9780000000525", "Fourth Wing", "Rebecca Yarros", "OL2W", at(4));
  const second = edition(repo, "9780000000526", "Fourth Wing", "Rebecca Yarros", "OL3W", at(5));
  repo.mergeDuplicateWork(first.work_id!, target.work_id!, AT);
  repo.mergeDuplicateWork(second.work_id!, target.work_id!, AT);
  repo.undoMerge(second.work_id!, "2026-10-16T00:00:00.000Z");

  assert.deepEqual(mergeRows(db).map((merge) => [merge.source, merge.undone_at]), [
    ["title-key", null],
    ["admin", null],
    ["code", null],
    ["ol-duplicate", null],
    ["ol-duplicate", "2026-10-16T00:00:00.000Z"]
  ]);
  assert.deepEqual(repo.keyedWorksWithTitleKeys([key]).map((work) => [work.id, work.absorbed]), [[target.work_id, 1], [second.work_id, 0]]);

  repo.mergeDuplicateWork(second.work_id!, target.work_id!, AT);
  assert.deepEqual(repo.keyedWorksWithTitleKeys([key]).map((work) => [work.id, work.absorbed]), [[target.work_id, 2]]);
});

test("a joined survivor's duplicates stay with it", () => {
  const { repo } = freshRepo();
  const survivor = edition(repo, "9780000000531", "Quarta Asa", "Rebecca Yarros", "OL1W", at(0));
  const duplicate = edition(repo, "9780000000532", "Quarta Asa", "Rebecca Yarros", "OL2W", at(1));
  const other = edition(repo, "9780000000533", "Fourth Wing", "Rebecca Yarros", "OL3W", at(2));
  const keys = [survivor, other].map((book) => repo.getBook(book.id)!.title_key!);
  const absorbed = () => Object.fromEntries(repo.keyedWorksWithTitleKeys(keys).map((work) => [work.id, work.absorbed]));

  repo.mergeDuplicateWork(duplicate.work_id!, survivor.work_id!, AT);
  assert.deepEqual(absorbed(), { [survivor.work_id!]: 1, [other.work_id!]: 0 });

  repo.mergeTranslation(survivor.work_id!, other.work_id!, "code", null, AT);
  assert.deepEqual(absorbed(), { [other.work_id!]: 0 });

  repo.undoMerge(survivor.work_id!, "2026-10-16T00:00:00.000Z");
  assert.deepEqual(absorbed(), { [survivor.work_id!]: 1, [other.work_id!]: 0 });
});

test("mergeDuplicateWork moves editions and logs an ol-duplicate merge", () => {
  const { db, repo } = freshRepo();
  const from = edition(repo, "9780000000601", "Fourth WIng", "Rebecca Yarros", "OL1W", at(1));
  const fromOther = edition(repo, "9780000000602", "Quarta Asa", "Rebecca Yarros", "OL1W", at(1));
  const into = edition(repo, "9780000000603", "Fourth Wing", "Rebecca Yarros", "OL2W", at(0));
  repo.setWorkSummary(from.id, "Carried.");

  assert.equal(repo.mergeDuplicateWork(from.work_id!, into.work_id!, AT), into.work_id);
  assert.deepEqual(mergeRows(db), [{ from_work: from.work_id, into_work: into.work_id, source: "ol-duplicate", confidence: null, moved_book_ids: JSON.stringify([from.id, fromOther.id]), repointed_work_ids: "[]", merged_at: AT, undone_at: null }]);
  assert.equal(repo.canonicalWorkIds([from.work_id!]).get(from.work_id!), into.work_id);
  for (const book of [from, fromOther, into]) assert.equal(repo.getBook(book.id)!.work_id, into.work_id);
  assert.equal(workById(db, into.work_id).summary, "Carried.");
  assert.equal(workById(db, from.work_id).ol_work_key, "OL1W");

  const later = repo.createBook({ title: "Fourth Wing", author: "Rebecca Yarros", isbn: "9780000000604" }, ["isbn:9780000000604"], NOW);
  repo.setWorkKey(later.id, "OL1W");
  assert.equal(repo.getBook(later.id)!.work_id, into.work_id);
});

test("mergeDuplicateWork refuses a keyless or already merged work", () => {
  const { db, repo } = freshRepo();
  const a = edition(repo, "9780000000701", "Fourth Wing", "Rebecca Yarros", "OL1W");
  const b = edition(repo, "9780000000702", "Fourth Wing", "Rebecca Yarros", "OL2W");
  const c = edition(repo, "9780000000703", "Fourth Wing", "Rebecca Yarros", "OL3W");
  const keyless = edition(repo, "9780000000704", "Fourth Wing", "Rebecca Yarros");
  assert.throws(() => repo.mergeDuplicateWork(keyless.work_id!, a.work_id!, AT), WorkMergeError);
  assert.throws(() => repo.mergeDuplicateWork(a.work_id!, keyless.work_id!, AT), WorkMergeError);
  assert.throws(() => repo.mergeDuplicateWork("no-such-work", a.work_id!, AT), WorkMergeError);
  assert.throws(() => repo.mergeDuplicateWork(a.work_id!, "no-such-work", AT), WorkMergeError);
  assert.throws(() => repo.mergeDuplicateWork(a.work_id!, a.work_id!, AT), WorkMergeError);
  assert.equal(countOf(db, "work_merges"), 0);

  repo.mergeDuplicateWork(b.work_id!, a.work_id!, AT);
  assert.throws(() => repo.mergeDuplicateWork(b.work_id!, c.work_id!, AT), WorkMergeError);
  assert.throws(() => repo.mergeDuplicateWork(c.work_id!, b.work_id!, AT), WorkMergeError);
  assert.equal(countOf(db, "work_merges"), 1);
  assert.equal(repo.getBook(b.id)!.work_id, a.work_id);
  assert.equal(repo.getBook(c.id)!.work_id, c.work_id);
});

test("undoneMergeAmong is true after undoMerge, whichever way the ids are listed", () => {
  const { repo } = freshRepo();
  const a = edition(repo, "9780000000801", "Fourth Wing", "Rebecca Yarros", "OL1W");
  const b = edition(repo, "9780000000802", "Fourth Wing", "Rebecca Yarros", "OL2W");
  const c = edition(repo, "9780000000803", "Fourth Wing", "Rebecca Yarros", "OL3W");
  const [wa, wb, wc] = [a.work_id!, b.work_id!, c.work_id!];
  repo.mergeDuplicateWork(wb, wa, AT);
  assert.equal(repo.undoneMergeAmong([wa, wb]), false);
  repo.undoMerge(wb, "2026-10-16T00:00:00.000Z");
  for (const ids of [[wa, wb], [wb, wa], [wa, wc, wb], [wc, wb, wa]]) assert.equal(repo.undoneMergeAmong(ids), true, ids.join());
  for (const ids of [[wa, wc], [wb, wc], [wa], []]) assert.equal(repo.undoneMergeAmong(ids), false, ids.join());
});

test("undoing an ol-duplicate merge keeps the survivor's own keyless editions", async () => {
  const { db, repo } = freshRepo();
  const survivor = edition(repo, "9780000000901", "Fourth Wing", "Rebecca Yarros", "OL2W", at(0));
  const before = edition(repo, "9780000000902", "Fourth Wing", "Rebecca Yarros", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 10, { at: at(2) }), 1);
  const duplicate = edition(repo, "9780000000903", "Fourth Wing", "Rebecca Yarros", "OL1W", at(3));
  const duplicateOther = edition(repo, "9780000000904", "Quarta Asa", "Rebecca Yarros", "OL1W", at(3));
  repo.mergeDuplicateWork(duplicate.work_id!, survivor.work_id!, at(4));
  const after = edition(repo, "9780000000905", "Fourth Wing", "Rebecca Yarros", undefined, at(5));
  assert.equal(await groupKeylessWorks(repo, 10, { at: at(6) }), 1);
  assert.deepEqual([survivor, before, after, duplicate].map((book) => repo.getBook(book.id)!.work_id), Array(4).fill(survivor.work_id));

  assert.deepEqual(repo.undoMerge(duplicate.work_id!, at(7)), { into: survivor.work_id, editions: 2 });
  for (const book of [survivor, before, after]) assert.equal(repo.getBook(book.id)!.work_id, survivor.work_id);
  for (const book of [duplicate, duplicateOther]) assert.equal(repo.getBook(book.id)!.work_id, duplicate.work_id);
  assert.equal(workById(db, duplicate.work_id).merged_into, null);
  assert.equal(workById(db, before.work_id).merged_into, survivor.work_id);
  assert.equal((db.prepare("SELECT undone_at FROM work_merges WHERE source = 'ol-duplicate'").get() as { undone_at: string }).undone_at, at(7));
});

const lupin = (workKey?: string) => {
  const { db, repo } = freshRepo();
  const volumes = [
    ["9789720001001", "Arsène Lupin: Gentleman Ladrão", workKey],
    ["9789720001002", "Arsène Lupin: A Agulha Oca", undefined],
    ["9789720001003", "Arsène Lupin: O Triângulo de Ouro", undefined]
  ] as const;
  const [first, second, third] = volumes.map(([isbn, title, key], day) => edition(repo, isbn, title, "Maurice Leblanc", key, at(day)));
  return { db, repo, first: first!, second: second!, third: third! };
};

const blockedBooks = (db: DatabaseSync) => (db.prepare("SELECT id FROM books WHERE title_group_blocked_at IS NOT NULL").all() as Array<{ id: string }>).map((row) => row.id);

const foldAsTitleKey = (db: DatabaseSync, repo: ReturnType<typeof createSqliteBooksRepository>, into: { work_id: string | null }, ...sources: Array<{ work_id: string | null }>) => {
  for (const source of sources) {
    repo.mergeWorks(source.work_id!, into.work_id!, AT);
    db.prepare("UPDATE work_merges SET source = 'title-key' WHERE from_work = ?").run(source.work_id);
  }
};

for (const [name, workKey] of [["keyless", undefined], ["keyed", "OL1W"]] as const) {
  test(`undoing a title-key merge in a ${name} target restores only that merge's edition and blocks no book`, async () => {
    const { db, repo, first, second, third } = lupin(workKey);
    foldAsTitleKey(db, repo, first, second, third);
    for (const book of [first, second, third]) assert.equal(repo.getBook(book.id)!.work_id, first.work_id);

    assert.deepEqual(repo.undoMerge(second.work_id!, at(7)), { into: first.work_id, editions: 1 });
    assert.equal(repo.getBook(second.id)!.work_id, second.work_id);
    assert.equal(workById(db, second.work_id).merged_into, null);
    for (const book of [first, third]) assert.equal(repo.getBook(book.id)!.work_id, first.work_id);
    assert.equal(workById(db, third.work_id).merged_into, first.work_id);
    assert.deepEqual(
      (db.prepare("SELECT from_work, undone_at FROM work_merges WHERE source = 'title-key' ORDER BY id").all() as Array<Record<string, unknown>>).map((row) => ({ ...row })),
      [{ from_work: second.work_id, undone_at: at(7) }, { from_work: third.work_id, undone_at: null }]
    );

    assert.equal(await groupKeylessWorks(repo, 10, { at: at(8) }), 0);
    assert.equal(repo.getBook(second.id)!.work_id, second.work_id);
    assert.equal(workById(db, second.work_id).merged_into, null);
    assert.deepEqual(blockedBooks(db), []);
  });
}

test("two copies of one volume folded into the same target and both undone stay apart from it, unblocked", async () => {
  const { db, repo } = freshRepo();
  const target = edition(repo, "9789720001101", "Arsène Lupin: Gentleman Ladrão", "Maurice Leblanc", undefined, at(0));
  const [copy, other] = ["9789720001102", "9789720001103"].map((isbn, n) => edition(repo, isbn, "Arsène Lupin: A Agulha Oca", "Maurice Leblanc", undefined, at(n + 1)));
  foldAsTitleKey(db, repo, target, copy!, other!);
  for (const book of [copy!, other!]) assert.equal(repo.getBook(book.id)!.work_id, target.work_id);
  for (const book of [copy!, other!]) repo.undoMerge(book.work_id!, at(7));

  assert.equal(await groupKeylessWorks(repo, 10, { at: at(8) }), 1);
  assert.equal(repo.getBook(other!.id)!.work_id, copy!.work_id);
  assert.equal(repo.getBook(copy!.id)!.work_id, copy!.work_id);
  assert.equal(repo.getBook(target.id)!.work_id, target.work_id);
  assert.deepEqual(blockedBooks(db), []);
});

const heldNeedle = (otherKeyed: boolean) => {
  const { db, repo } = freshRepo();
  const keyed = edition(repo, "9789720001201", "Arsène Lupin: Gentleman Ladrão", "Maurice Leblanc", "OL1W", at(0));
  const held = edition(repo, "9789720001202", "Arsène Lupin: A Agulha Oca", "Maurice Leblanc", undefined, at(1));
  if (otherKeyed) edition(repo, "9789720001203", "Arsène Lupin: O Triângulo de Ouro", "Maurice Leblanc", "OL2W", at(2));
  foldAsTitleKey(db, repo, keyed, held);
  const copy = edition(repo, "9789720001204", "Arsène Lupin: A Agulha Oca", "Maurice Leblanc", undefined, at(3));
  return { db, repo, keyed, held, copy };
};

for (const [name, otherKeyed] of [["beside another keyed volume", true], ["alone", false]] as const) {
  test(`an edition a title-key merge moved into a keyed work ${name} attracts no keyless copy, and the copy folds with it once the merge is undone`, async () => {
    const { db, repo, keyed, held, copy } = heldNeedle(otherKeyed);
    assert.equal(await groupKeylessWorks(repo, 250, { at: at(4) }), 0);
    assert.equal(repo.getBook(copy.id)!.work_id, copy.work_id);
    assert.equal(repo.getBook(held.id)!.work_id, keyed.work_id);

    repo.undoMerge(held.work_id!, at(7));
    assert.equal(await groupKeylessWorks(repo, 250, { at: at(8) }), 1);
    assert.equal(repo.getBook(copy.id)!.work_id, held.work_id);
    assert.equal(repo.getBook(held.id)!.work_id, held.work_id);
    assert.equal(repo.getBook(keyed.id)!.work_id, keyed.work_id);
    assert.deepEqual(blockedBooks(db), []);
  });
}

test("an edition an undone title-key merge once moved in attracts keyless copies again when an admin merge moves it back in", async () => {
  const { db, repo, keyed, held, copy } = heldNeedle(false);
  repo.undoMerge(held.work_id!, at(7));
  repo.mergeWorks(held.work_id!, keyed.work_id!, at(8));
  assert.equal(countOf(db, "work_merges", "source = 'title-key' AND undone_at IS NOT NULL"), 1);

  assert.equal(await groupKeylessWorks(repo, 250, { at: at(9) }), 1);
  assert.equal(repo.getBook(copy.id)!.work_id, keyed.work_id);
});

test("a pair skipped for an undone merge does not use up the batch limit", async () => {
  const { repo } = freshRepo();
  const [target, ...copies] = ["9789720001101", "9789720001102", "9789720001103"].map((isbn, n) => edition(repo, isbn, "O Profeta", "Kahlil Gibran", undefined, at(n)));
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 2);
  for (const copy of copies) repo.undoMerge(copy.work_id!, at(7));
  const later = edition(repo, "9789720001104", "O Profeta", "Kahlil Gibran", undefined, at(9));

  assert.equal(await groupKeylessWorks(repo, 1, { at: at(10) }), 1);
  assert.equal(repo.getBook(later.id)!.work_id, target!.work_id);
  for (const copy of copies) assert.notEqual(repo.getBook(copy.id)!.work_id, target!.work_id);
});

test("grouping does not redo an undone translation join between works that share a title key", async () => {
  const { db, repo } = freshRepo();
  const keyed = edition(repo, "9780000001201", "Fourth Wing", "Rebecca Yarros", "OL1W", at(0));
  const keyless = edition(repo, "9780000001202", "Fourth Wing", "Rebecca Yarros", undefined, at(1));
  repo.mergeTranslation(keyless.work_id!, keyed.work_id!, "jev", 0.9, AT);
  repo.undoMerge(keyless.work_id!, at(7));

  assert.equal(await groupKeylessWorks(repo, 10, { at: at(8) }), 0);
  assert.equal(repo.getBook(keyless.id)!.work_id, keyless.work_id);
  assert.equal(workById(db, keyless.work_id).merged_into, null);
});

test("groupTitleKeys does not redo an undone merge when a key has several keyed works", () => {
  const { repo, graphic, piatkus, graphicKeyless, key } = fourthWing();
  assert.equal(repo.groupTitleKeys([key], 10, AT), 2);
  repo.undoMerge(piatkus.work_id!, at(7));

  assert.equal(repo.groupTitleKeys([key], 10, at(8)), 0);
  assert.equal(repo.getBook(piatkus.id)!.work_id, piatkus.work_id);
  assert.equal(repo.getBook(graphicKeyless.id)!.work_id, graphic.work_id);
});

test("grouping does not redo an undone merge into a work that has since been joined onward", async () => {
  const { repo } = freshRepo();
  const a = edition(repo, "9780000001301", "Fourth Wing", "Rebecca Yarros", undefined, at(0));
  const b = edition(repo, "9780000001302", "Fourth Wing", "Rebecca Yarros", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 1);
  repo.undoMerge(b.work_id!, at(7));
  const keyed = edition(repo, "9780000001303", "Fourth Wing", "Rebecca Yarros", "OL1W", at(8));
  repo.mergeTranslation(a.work_id!, keyed.work_id!, "code", null, at(8));

  assert.equal(await groupKeylessWorks(repo, 10, { at: at(9) }), 0);
  assert.equal(repo.getBook(b.id)!.work_id, b.work_id);
  assert.equal(repo.getBook(a.id)!.work_id, keyed.work_id);
});

test("grouping does not redo an undone merge whose restored work has since been joined into the keyed original", async () => {
  const { repo } = freshRepo();
  const a = edition(repo, "9780000001601", "Fourth Wing", "Rebecca Yarros", undefined, at(0));
  const b = edition(repo, "9780000001602", "Fourth Wing", "Rebecca Yarros", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 1);
  repo.undoMerge(b.work_id!, at(7));
  const original = edition(repo, "9780000001603", "Fourth Wing", "Rebecca Yarros", "OL1W", at(8));
  repo.mergeTranslation(b.work_id!, original.work_id!, "code", null, at(8));
  assert.equal(repo.undoneMergeAmong([a.work_id!, original.work_id!]), true);

  assert.equal(await groupKeylessWorks(repo, 10, { at: at(9) }), 0);
  assert.equal(repo.getBook(a.id)!.work_id, a.work_id);
  assert.equal(repo.getBook(b.id)!.work_id, original.work_id);
});

test("an undone merge whose two ends were later merged into the same work blocks no pair", async () => {
  const { repo } = freshRepo();
  const x = edition(repo, "9780000001701", "Duna", "Frank Herbert", undefined, at(0));
  const y = edition(repo, "9780000001702", "Duna", "Frank Herbert", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 1);
  repo.undoMerge(y.work_id!, at(7));
  const original = edition(repo, "9780000001703", "Dune", "Frank Herbert", "OL1W", at(8));
  const other = edition(repo, "9780000001704", "Dune Messiah", "Frank Herbert", "OL2W", at(8));
  for (const portuguese of [x, y]) repo.mergeTranslation(portuguese.work_id!, original.work_id!, "code", null, at(8));
  assert.equal(repo.undoneMergeAmong([original.work_id!, other.work_id!]), false);
  const unrelated = edition(repo, "9780000001705", "Dune", "Frank Herbert", undefined, at(9));

  assert.equal(await groupKeylessWorks(repo, 10, { at: at(10) }), 1);
  assert.equal(repo.getBook(unrelated.id)!.work_id, original.work_id);
});

test("undoneMergeAmong also counts an undone merge into a work that has since been merged into one of the ids", () => {
  const { repo } = freshRepo();
  const [a, b, c] = ["9780000001401", "9780000001402", "9780000001403"].map((isbn, n) => edition(repo, isbn, "Fourth Wing", "Rebecca Yarros", `OL${n + 1}W`));
  const [wa, wb, wc] = [a!.work_id!, b!.work_id!, c!.work_id!];
  repo.mergeDuplicateWork(wb, wa, AT);
  repo.undoMerge(wb, at(7));
  repo.mergeDuplicateWork(wa, wc, at(8));
  for (const ids of [[wc, wb], [wb, wc], [wa, wb]]) assert.equal(repo.undoneMergeAmong(ids), true, ids.join());
  for (const ids of [[wa, wc], [wb], [wc]]) assert.equal(repo.undoneMergeAmong(ids), false, ids.join());
});

test("undoing a title-key merge takes back the synopsis it carried onto the target, and only that one", () => {
  const { db, repo, first, second } = lupin();
  repo.setWorkSummary(second.id, "Um ladrão cavalheiro em Paris.");
  foldAsTitleKey(db, repo, first, second);
  assert.equal(workById(db, first.work_id).summary, "Um ladrão cavalheiro em Paris.");

  repo.undoMerge(second.work_id!, at(7));
  assert.deepEqual({ summary: workById(db, first.work_id).summary, hash: (db.prepare("SELECT summary_hash AS hash FROM works WHERE id = ?").get(first.work_id) as { hash: string | null }).hash }, { summary: null, hash: null });
  assert.equal(workById(db, second.work_id).summary, "Um ladrão cavalheiro em Paris.");
});

test("undoing an ol-duplicate merge leaves the synopsis it carried, since it is the same book's", () => {
  const { db, repo } = freshRepo();
  const survivor = edition(repo, "9780000001501", "Fourth Wing", "Rebecca Yarros", "OL2W", at(0));
  const duplicate = edition(repo, "9780000001502", "Fourth Wing", "Rebecca Yarros", "OL1W", at(1));
  repo.setWorkSummary(duplicate.id, "Carried.");
  repo.mergeDuplicateWork(duplicate.work_id!, survivor.work_id!, at(2));
  repo.undoMerge(duplicate.work_id!, at(7));
  assert.equal(workById(db, survivor.work_id).summary, "Carried.");
});

test("undoing a title-key merge leaves a target that had its own synopsis before the fold alone", () => {
  const { db, repo, first, second } = lupin();
  repo.setWorkSummary(first.id, "Own synopsis.");
  repo.setWorkSummary(second.id, "Another synopsis.");
  foldAsTitleKey(db, repo, first, second);

  repo.undoMerge(second.work_id!, at(7));
  assert.equal(workById(db, first.work_id).summary, "Own synopsis.");
  assert.equal(workById(db, second.work_id).summary, "Another synopsis.");
});

test("groupTitleKeys folds a keyless edition into the keyed work with its full title when a key has several keyed works", () => {
  const { db, repo, novel, graphic, piatkus, graphicKeyless, coloring, key } = fourthWing();
  assert.equal(repo.groupTitleKeys([key], 10, AT), 2);
  assert.equal(repo.getBook(piatkus.id)!.work_id, novel.work_id);
  assert.equal(repo.getBook(graphicKeyless.id)!.work_id, graphic.work_id);
  assert.equal(repo.getBook(coloring.id)!.work_id, coloring.work_id);
  assert.deepEqual(
    (db.prepare("SELECT from_work, into_work, source, merged_at FROM work_merges ORDER BY id").all() as Array<Record<string, unknown>>).map((row) => ({ ...row })),
    [
      { from_work: piatkus.work_id, into_work: novel.work_id, source: "title-key", merged_at: AT },
      { from_work: graphicKeyless.work_id, into_work: graphic.work_id, source: "title-key", merged_at: AT }
    ]
  );
  assert.equal(repo.groupTitleKeys([key], 10, AT), 0);
});

test("groupKeylessWorks folds each keyless edition into the keyed work with its full title when a key has several keyed works", async () => {
  const { repo, novel, graphic, piatkus, graphicKeyless, coloring } = fourthWing();
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 2);
  assert.deepEqual([piatkus, graphicKeyless, coloring].map((book) => repo.getBook(book.id)!.work_id), [novel.work_id, graphic.work_id, coloring.work_id]);
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 0);
});

test("groupTitleKeys leaves a keyless edition alone when two keyed works have its full title", () => {
  const { repo } = freshRepo();
  edition(repo, "9780000001001", "Fourth Wing", "Rebecca Yarros", "OL1W");
  edition(repo, "9780000001002", "Fourth WIng", "Rebecca Yarros", "OL2W");
  const keyless = edition(repo, "9780000001003", "Fourth Wing", "Rebecca Yarros");
  assert.equal(repo.groupTitleKeys([repo.getBook(keyless.id)!.title_key!], 10, AT), 0);
  assert.equal(repo.getBook(keyless.id)!.work_id, keyless.work_id);
});

for (const [name, workKey] of [["three keyless volumes of one series stay three works", undefined], ["two keyless volumes beside the keyed first volume of a series stay apart from it and from each other", "OL1W"]] as const) {
  test(name, async () => {
    const { db, repo, first, second, third } = lupin(workKey);
    assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 0);
    for (const book of [first, second, third]) assert.equal(repo.getBook(book.id)!.work_id, book.work_id);
    assert.equal(countOf(db, "works", "merged_into IS NOT NULL"), 0);
    assert.equal(countOf(db, "work_merges"), 0);
  });
}

test("two keyless copies of one volume fold together and not into the keyed volume beside them", async () => {
  const { repo, first, second, third } = lupin("OL1W");
  const copy = edition(repo, "9789720001004", "Arsène Lupin: A Agulha Oca", "Maurice Leblanc", undefined, at(3));
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 1);
  assert.equal(repo.getBook(copy.id)!.work_id, second.work_id);
  for (const book of [first, second, third]) assert.equal(repo.getBook(book.id)!.work_id, book.work_id);
});

test("a keyless copy of a Portuguese edition folds into the English keyed work that holds it through a translation join", async () => {
  const { repo } = freshRepo();
  const english = edition(repo, "9780000002001", "1984", "George Orwell", "OL1W", at(0));
  const portuguese = edition(repo, "9780000002002", "Mil Novecentos e Oitenta e Quatro", "George Orwell", undefined, at(1));
  repo.mergeTranslation(portuguese.work_id!, english.work_id!, "jev", 0.9, AT);
  const copy = edition(repo, "9780000002003", "Mil Novecentos e Oitenta e Quatro", "George Orwell", undefined, at(2));
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 1);
  assert.equal(repo.getBook(copy.id)!.work_id, english.work_id);
});

test("the plain book and its graphic novel stay apart", async () => {
  const { repo } = freshRepo();
  const graphic = edition(repo, "9789720001101", "O Profeta: Novela Gráfica", "Kahlil Gibran", undefined, at(0));
  const [plain, copy] = ["9789720001102", "9789720001103"].map((isbn, n) => edition(repo, isbn, "O Profeta", "Kahlil Gibran", undefined, at(n + 1)));
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 1);
  assert.equal(repo.getBook(copy!.id)!.work_id, plain!.work_id);
  assert.equal(repo.getBook(plain!.id)!.work_id, plain!.work_id);
  assert.equal(repo.getBook(graphic.id)!.work_id, graphic.work_id);
});

test("groupTitleKeys groups only the keys it is given", () => {
  const { repo } = freshRepo();
  const dune = edition(repo, "9780000001101", "Dune", "Frank Herbert", "OL1W");
  const duneKeyless = edition(repo, "9780000001102", "Dune", "Frank Herbert");
  const emma = edition(repo, "9780000001103", "Emma", "Jane Austen", "OL2W");
  const emmaKeyless = edition(repo, "9780000001104", "Emma", "Jane Austen");
  const keyOf = (book: { id: string }) => repo.getBook(book.id)!.title_key!;
  assert.equal(repo.groupTitleKeys([keyOf(dune)], 10, AT), 1);
  assert.equal(repo.getBook(duneKeyless.id)!.work_id, dune.work_id);
  assert.equal(repo.getBook(emmaKeyless.id)!.work_id, emmaKeyless.work_id);
  assert.equal(repo.groupTitleKeys([], 10, AT), 0);
  assert.equal(repo.groupTitleKeys([keyOf(emma)], 10, AT), 1);
  assert.equal(repo.getBook(emmaKeyless.id)!.work_id, emma.work_id);
});

test("groupTitleKeys stops at its limit across the keys it is given, and the next call finishes the rest", () => {
  const { repo, key } = fourthWing();
  const dune = edition(repo, "9780000001201", "Dune", "Frank Herbert", "OL9W");
  edition(repo, "9780000001202", "Dune", "Frank Herbert", undefined, at(1));
  edition(repo, "9780000001203", "Dune", "Frank Herbert", undefined, at(2));
  const keys = [repo.getBook(dune.id)!.title_key!, key];
  assert.deepEqual([repo.groupTitleKeys(keys, 3, AT), repo.groupTitleKeys(keys, 3, AT), repo.groupTitleKeys(keys, 3, AT)], [3, 1, 0]);
});

test("groupTitleKeys leaves a pair apart when skip rejects it, and still makes another", () => {
  const { repo, novel, graphic, piatkus, graphicKeyless, key } = fourthWing();
  const seen: Array<[string, string]> = [];
  const skip = (from: string, into: string) => {
    seen.push([from, into]);
    return from === piatkus.work_id;
  };
  assert.equal(repo.groupTitleKeys([key], 10, AT, skip), 1);
  assert.equal(repo.getBook(piatkus.id)!.work_id, piatkus.work_id);
  assert.equal(repo.getBook(graphicKeyless.id)!.work_id, graphic.work_id);
  assert.deepEqual(seen, [[piatkus.work_id, novel.work_id], [graphicKeyless.work_id, graphic.work_id]]);
});

test("groupTitleKeys counts only the merges it makes against its limit when skip rejects a groupable pair", () => {
  const { repo } = freshRepo();
  const dune = edition(repo, "9780000001301", "Dune", "Frank Herbert", "OL9W", at(0));
  const first = edition(repo, "9780000001302", "Dune", "Frank Herbert", undefined, at(1));
  const second = edition(repo, "9780000001303", "Dune", "Frank Herbert", undefined, at(2));
  const key = repo.getBook(dune.id)!.title_key!;
  assert.equal(repo.groupTitleKeys([key], 1, AT, (from) => from === first.work_id), 1);
  assert.equal(repo.getBook(first.id)!.work_id, first.work_id);
  assert.equal(repo.getBook(second.id)!.work_id, dune.work_id);
});

test("groupKeylessWorks leaves a pair apart when skip rejects it, and makes it once skip stops rejecting", async () => {
  const { repo, novel, graphic, piatkus, graphicKeyless } = fourthWing();
  const skip = (from: string) => from === piatkus.work_id;
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT, skip }), 1);
  assert.deepEqual([piatkus, graphicKeyless].map((book) => repo.getBook(book.id)!.work_id), [piatkus.work_id, graphic.work_id]);
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT, skip }), 0);
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 1);
  assert.equal(repo.getBook(piatkus.id)!.work_id, novel.work_id);
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

const MALAZAN = "Malazan Book of the Fallen";
const seriesBook = (repo: ReturnType<typeof freshRepo>["repo"], title: string, isbn: string, author = "Steven Erikson", workKey?: string) =>
  repo.createBook({ title, author, isbn, workKey }, [`isbn:${isbn}`], NOW);

test("addWorkSeries stores the name with its position, a second source adds a row, and only new rows count", () => {
  const { db, repo } = freshRepo();
  const book = seriesBook(repo, "Memories of Ice", "9780765348807");
  assert.equal(repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "3" }], "ol-subject", AT), 1);
  assert.deepEqual(db.prepare("SELECT name, name_key, position, source, created_at FROM work_series WHERE work_id = ?").all(book.work_id).map((row) => ({ ...row })), [
    { name: MALAZAN, name_key: "malazan book of the fallen", position: "3", source: "ol-subject", created_at: AT }
  ]);
  assert.equal(repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", AT), 1);
  assert.equal(countOf(db, "work_series"), 2);
  assert.equal(repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", at(1)), 0);
  assert.equal(countOf(db, "work_series"), 2);
});

test("addWorkSeries fills a missing position but never overwrites a set one", () => {
  const { db, repo } = freshRepo();
  const book = seriesBook(repo, "Memories of Ice", "9780765348807");
  const position = () => (db.prepare("SELECT position FROM work_series WHERE work_id = ? AND source = 'wikidata'").get(book.work_id) as { position: string | null }).position;
  repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: null }], "wikidata", AT);
  assert.equal(position(), null);
  assert.equal(repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", at(1)), 0);
  assert.equal(position(), "3");
  assert.equal(repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "4" }], "wikidata", at(2)), 0);
  assert.equal(repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: null }], "wikidata", at(3)), 0);
  assert.equal(position(), "3");
});

test("addWorkSeries stores several entries at once and drops names with no letters or digits", () => {
  const { db, repo } = freshRepo();
  const book = seriesBook(repo, "Gardens of the Moon", "9780765348807");
  const added = repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "1" }, { name: "--", position: "2" }, { name: "  ", position: null }, { name: "Malazan Empire", position: null }], "ol-subject", AT);
  assert.equal(added, 2);
  assert.deepEqual(db.prepare("SELECT name_key FROM work_series ORDER BY name_key").all().map((row) => (row as { name_key: string }).name_key), ["malazan book of the fallen", "malazan empire"]);
});

test("addWorkSeries refuses a work that does not exist instead of storing an orphan", () => {
  const { db, repo } = freshRepo();
  assert.throws(() => repo.addWorkSeries("missing", [{ name: MALAZAN, position: null }], "wikidata", AT), /missing/);
  assert.equal(countOf(db, "work_series"), 0);
  assert.equal(countOf(db, "series_fts"), 0);
});

test("a series is indexed once per work and name, however many sources give it", () => {
  const { db, repo } = freshRepo();
  const book = seriesBook(repo, "Memories of Ice", "9780765348807");
  repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "3" }], "ol-subject", AT);
  repo.addWorkSeries(book.work_id!, [{ name: "Malazan: Book of the Fallen", position: "3" }], "wikidata", AT);
  repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", at(1));
  repo.addWorkSeries(book.work_id!, [{ name: "Malazan Empire", position: null }], "ol-subject", AT);
  assert.deepEqual(db.prepare("SELECT work_id, name, author FROM series_fts ORDER BY rowid").all().map((row) => ({ ...row })), [
    { work_id: book.work_id, name: MALAZAN, author: "Steven Erikson" },
    { work_id: book.work_id, name: "Malazan Empire", author: "Steven Erikson" }
  ]);
});

test("filling a work's blank author with fillIdentity makes its series findable by author, and leaves other works alone", () => {
  const { repo } = freshRepo();
  const blank = repo.createBook({ title: "Memories of Ice", author: "", isbn: "9780765348807" }, ["isbn:9780765348807"], NOW);
  const other = seriesBook(repo, "Return of the Crimson Guard", "9780765348821", "Ian Esslemont");
  repo.addWorkSeries(blank.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", AT);
  repo.addWorkSeries(other.work_id!, [{ name: MALAZAN, position: "1" }], "wikidata", AT);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 12), []);
  repo.fillIdentity(blank.id, "Memories of Ice", "Steven Erikson");
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 12), [blank.work_id]);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "esslemont"], 12), [other.work_id]);
  assert.deepEqual(new Set(repo.searchSeriesWorks(["malazan"], 12)), new Set([blank.work_id, other.work_id]));
});

test("a second edition that fills a held work's blank author makes every series on that work findable by author", () => {
  const { repo } = freshRepo();
  const first = repo.createBook({ title: "Memories of Ice", author: "", isbn: "9780765348807", workKey: "OL1W" }, ["isbn:9780765348807"], NOW);
  repo.addWorkSeries(first.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", AT);
  repo.addWorkSeries(first.work_id!, [{ name: "Malazan Empire", position: null }], "ol-subject", AT);
  assert.deepEqual(repo.searchSeriesWorks(["empire", "erikson"], 12), []);
  repo.createBook({ title: "Memories of Ice", author: "Steven Erikson", isbn: "9780765316974", workKey: "OL1W" }, ["isbn:9780765316974"], NOW);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 12), [first.work_id]);
  assert.deepEqual(repo.searchSeriesWorks(["empire", "erikson"], 12), [first.work_id]);
});

test("assigning a legacy edition to a held work with a blank author makes the work's series findable by author", () => {
  const { db, repo } = freshRepo();
  const held = repo.createBook({ title: "Memories of Ice", author: "", isbn: "9780765348807", workKey: "OL1W" }, ["isbn:9780765348807"], NOW);
  const legacy = repo.createBook({ title: "Memories of Ice", author: "Steven Erikson", isbn: "9780765316974", workKey: "OL1W" }, ["isbn:9780765316974"], NOW);
  db.prepare("UPDATE books SET work_id = NULL WHERE id = ?").run(legacy.id);
  db.prepare("UPDATE works SET author = '' WHERE id = ?").run(held.work_id);
  repo.addWorkSeries(held.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", AT);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 12), []);
  assert.equal(repo.assignMissingWorks(250), 1);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 12), [held.work_id]);
});

test("keying an edition into a held work with a blank author makes the work's series findable by author", () => {
  const { repo } = freshRepo();
  const held = repo.createBook({ title: "Memories of Ice", author: "", isbn: "9780765348807", workKey: "OL1W" }, ["isbn:9780765348807"], NOW);
  const edition = repo.createBook({ title: "Memories of Ice", author: "Steven Erikson", isbn: "9780765316974" }, ["isbn:9780765316974"], NOW);
  repo.addWorkSeries(held.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", AT);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 12), []);
  repo.setWorkKey(edition.id, "OL1W");
  assert.equal(repo.getBook(edition.id)!.work_id, held.work_id);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 12), [held.work_id]);
});

test("merging an edition with an author into a blank-authored work makes the target's series findable by author", () => {
  const { repo } = freshRepo();
  const target = repo.createBook({ title: "Memories of Ice", author: "", isbn: "9780765348807" }, ["isbn:9780765348807"], NOW);
  const source = repo.createBook({ title: "Memórias de Gelo", author: "Steven Erikson", isbn: "9789896414672" }, ["isbn:9789896414672"], NOW);
  repo.addWorkSeries(target.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", AT);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 12), []);
  assert.equal(repo.mergeWorks(source.work_id!, target.work_id!), target.work_id);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 12), [target.work_id]);
});

test("a work whose author is already set keeps its indexed author when a later edition has a different one", () => {
  const { repo } = freshRepo();
  const first = repo.createBook({ title: "Memories of Ice", author: "Steven Erikson", isbn: "9780765348807", workKey: "OL1W" }, ["isbn:9780765348807"], NOW);
  repo.addWorkSeries(first.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", AT);
  repo.createBook({ title: "Memories of Ice", author: "S. Erikson", isbn: "9780765316974", workKey: "OL1W" }, ["isbn:9780765316974"], NOW);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 12), [first.work_id]);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "steven"], 12), [first.work_id]);
});

test("bestSeriesOf prefers Wikidata to an Open Library subject, whichever arrived first", () => {
  const { repo } = freshRepo();
  const book = seriesBook(repo, "Memories of Ice", "9780765348807");
  repo.addWorkSeries(book.work_id!, [{ name: "Malazan Empire", position: "3" }], "ol-subject", AT);
  repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", at(1));
  repo.addWorkSeries(book.work_id!, [{ name: "Erikson saga", position: null }], "original-title", AT);
  assert.deepEqual([...repo.bestSeriesOf([book.work_id!])], [[book.work_id, { name: MALAZAN, position: "3" }]]);
});

test("bestSeriesOf ranks by source, then by the earliest row, and leaves out works without a series", () => {
  const { repo } = freshRepo();
  const first = seriesBook(repo, "A", "9780000000001");
  const plain = seriesBook(repo, "B", "9780000000002");
  repo.addWorkSeries(first.work_id!, [{ name: "Later", position: null }], "ol-subject", at(2));
  repo.addWorkSeries(first.work_id!, [{ name: "Earlier", position: "2" }], "ol-subject", at(1));
  assert.deepEqual(repo.bestSeriesOf([first.work_id!, plain.work_id!]).get(first.work_id!), { name: "Earlier", position: "2" });
  assert.equal(repo.bestSeriesOf([first.work_id!, plain.work_id!]).has(plain.work_id!), false);
  assert.equal(repo.bestSeriesOf([]).size, 0);
});

test("bestSeriesOf takes the position from the best-ranked row of the same name that has one", () => {
  const { repo } = freshRepo();
  const book = seriesBook(repo, "Memories of Ice", "9780765348807");
  repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: null }], "wikidata", AT);
  repo.addWorkSeries(book.work_id!, [{ name: "Malazan book of the fallen", position: "3" }], "ol-subject", AT);
  repo.addWorkSeries(book.work_id!, [{ name: "Malazan Empire", position: "9" }], "original-title", AT);
  assert.deepEqual(repo.bestSeriesOf([book.work_id!]).get(book.work_id!), { name: MALAZAN, position: "3" });
});

test("an Open Library edition collection becomes the work's series only when Wikidata or a subject names it too", () => {
  const { repo } = freshRepo();
  const book = seriesBook(repo, "Memories of Ice", "9780765348807");
  repo.addBookCollection(book.id, { name: MALAZAN, position: "3" }, "ol-edition", AT);
  assert.equal(repo.bestSeriesOf([book.work_id!]).size, 0);

  repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: null }], "original-title", AT);
  assert.deepEqual(repo.bestSeriesOf([book.work_id!]).get(book.work_id!), { name: MALAZAN, position: null });

  repo.addWorkSeries(book.work_id!, [{ name: "Malazan Empire", position: null }], "ol-subject", AT);
  assert.equal(repo.bestSeriesOf([book.work_id!]).size, 1);
  assert.deepEqual(repo.bestSeriesOf([book.work_id!]).get(book.work_id!), { name: "Malazan Empire", position: null });

  repo.addWorkSeries(book.work_id!, [{ name: "malazan, book of the fallen", position: null }], "ol-subject", AT);
  assert.deepEqual(repo.bestSeriesOf([book.work_id!]).get(book.work_id!), { name: MALAZAN, position: "3" });

  repo.addWorkSeries(book.work_id!, [{ name: "Malazan Book of the Fallen.", position: "3" }], "wikidata", AT);
  assert.deepEqual(repo.bestSeriesOf([book.work_id!]).get(book.work_id!), { name: "Malazan Book of the Fallen.", position: "3" });
});

test("a promoted collection counts from any edition of the work or its aliases, and a BNP collection never does", () => {
  const { repo } = freshRepo();
  const target = seriesBook(repo, "Memories of Ice", "9780765348807");
  const alias = seriesBook(repo, "Memórias de Gelo", "9789720000401", "Steven Erikson");
  repo.mergeTranslation(alias.work_id!, target.work_id!, "manual", null, AT);
  repo.addWorkSeries(target.work_id!, [{ name: MALAZAN, position: null }], "ol-subject", AT);
  repo.addBookCollection(alias.id, { name: MALAZAN, position: "3" }, "bnp", AT);
  assert.deepEqual(repo.bestSeriesOf([target.work_id!]).get(target.work_id!), { name: MALAZAN, position: null });
  repo.addBookCollection(alias.id, { name: MALAZAN, position: "3" }, "ol-edition", AT);
  assert.deepEqual(repo.bestSeriesOf([target.work_id!]).get(target.work_id!), { name: MALAZAN, position: "3" });
});

test("a series follows its work through a merge and comes back with an undo", () => {
  const { repo } = freshRepo();
  const a = seriesBook(repo, "Passeio", "9789720000402", "X", "OL930W");
  const b = seriesBook(repo, "Walk", "9780156907394", "X", "OL931W");
  repo.addWorkSeries(a.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", AT);
  assert.deepEqual(repo.bestSeriesOf([a.work_id!]).get(a.work_id!), { name: MALAZAN, position: "3" });

  repo.mergeTranslation(a.work_id!, b.work_id!, "manual", null, AT);
  assert.deepEqual(repo.bestSeriesOf([b.work_id!]).get(b.work_id!), { name: MALAZAN, position: "3" });

  repo.undoMerge(a.work_id!, "2026-10-16T00:00:00.000Z");
  assert.deepEqual(repo.bestSeriesOf([a.work_id!]).get(a.work_id!), { name: MALAZAN, position: "3" });
  assert.equal(repo.bestSeriesOf([b.work_id!]).has(b.work_id!), false);
});

test("searchSeriesWorks finds a work by its series name, with or without its author", () => {
  const { repo } = freshRepo();
  const book = seriesBook(repo, "Memories of Ice", "9780765348807");
  const other = seriesBook(repo, "Dune", "9780441013593", "Frank Herbert");
  repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", AT);
  repo.addWorkSeries(other.work_id!, [{ name: "Dune Chronicles", position: "1" }], "wikidata", AT);

  assert.deepEqual(repo.searchSeriesWorks(["malazan"], 10), [book.work_id]);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "erikson"], 10), [book.work_id]);
  assert.deepEqual(repo.searchSeriesWorks(["malaz"], 10), [book.work_id]);
  assert.deepEqual(repo.searchSeriesWorks(["malazan", "herbert"], 10), []);
  assert.deepEqual(repo.searchSeriesWorks(["fallen", "book"], 10), [book.work_id]);
  assert.deepEqual(repo.searchSeriesWorks([], 10), []);
});

test("searchSeriesWorks ignores diacritics in the series name", () => {
  const { repo } = freshRepo();
  const book = seriesBook(repo, "O Hobbit", "9789720000403", "J. R. R. Tolkien");
  repo.addWorkSeries(book.work_id!, [{ name: "Sénior Coleção", position: null }], "wikidata", AT);
  assert.deepEqual(repo.searchSeriesWorks(["senior", "colecao"], 10), [book.work_id]);
});

test("searchSeriesWorks returns a merged-away work as its canonical work, once", () => {
  const { repo } = freshRepo();
  const a = seriesBook(repo, "Passeio", "9789720000404", "Steven Erikson", "OL932W");
  const b = seriesBook(repo, "Walk", "9780156907395", "Steven Erikson", "OL933W");
  repo.addWorkSeries(a.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", AT);
  assert.deepEqual(repo.searchSeriesWorks(["malazan"], 10), [a.work_id]);
  repo.mergeTranslation(a.work_id!, b.work_id!, "manual", null, AT);
  assert.deepEqual(repo.searchSeriesWorks(["malazan"], 10), [b.work_id]);
  repo.addWorkSeries(b.work_id!, [{ name: MALAZAN, position: "3" }], "ol-subject", AT);
  assert.deepEqual(repo.searchSeriesWorks(["malazan"], 10), [b.work_id]);
});

test("searchSeriesWorks dedupes merged works before it applies the limit", () => {
  const { repo } = freshRepo();
  const target = seriesBook(repo, "Target", "9780000000011", "Steven Erikson", "OL934W");
  const aliases = [1, 2, 3].map((n) => seriesBook(repo, `Alias ${n}`, `978000000002${n}`, "Steven Erikson"));
  const other = seriesBook(repo, "Other", "9780000000031", "Steven Erikson");
  for (const alias of aliases) repo.addWorkSeries(alias.work_id!, [{ name: "Saga", position: null }], "wikidata", AT);
  repo.addWorkSeries(other.work_id!, [{ name: "Saga", position: null }], "wikidata", AT);
  for (const alias of aliases) repo.mergeTranslation(alias.work_id!, target.work_id!, "manual", null, AT);

  assert.deepEqual(repo.searchSeriesWorks(["saga"], 2), [target.work_id, other.work_id]);
  assert.deepEqual(repo.searchSeriesWorks(["saga"], 1), [target.work_id]);
});

test("addBookCollection stores a collection on an edition, and collectionsOf and searchCollectionBooks find it", () => {
  const { db, repo } = freshRepo();
  const book = seriesBook(repo, "Os Lobos", "9789720000405", "Ana Lima");
  const plain = seriesBook(repo, "Sem Coleção", "9789720000406", "Ana Lima");
  repo.makeSearchable(book.id);
  assert.equal(repo.addBookCollection(book.id, { name: "Bang!", position: "248" }, "bnp", AT), true);
  assert.deepEqual(db.prepare("SELECT name, name_key, position, source, created_at FROM book_collections WHERE book_id = ?").all(book.id).map((row) => ({ ...row })), [
    { name: "Bang!", name_key: "bang", position: "248", source: "bnp", created_at: AT }
  ]);

  assert.deepEqual([...repo.collectionsOf([book.id, plain.id])], [[book.id, { name: "Bang!", position: "248" }]]);
  assert.deepEqual(repo.searchCollectionBooks(["bang"], 5), [{ bookId: book.id, name: "Bang!", position: "248" }]);
  assert.deepEqual(repo.searchCollectionBooks(["ban"], 5), [{ bookId: book.id, name: "Bang!", position: "248" }]);
  assert.deepEqual(repo.searchCollectionBooks(["lobos"], 5), []);
  assert.deepEqual(repo.searchCollectionBooks([], 5), []);
  assert.equal(repo.collectionsOf([]).size, 0);
});

test("addBookCollection fills a missing position, never overwrites one, indexes a name once and drops a name with no letters", () => {
  const { db, repo } = freshRepo();
  const book = seriesBook(repo, "Os Lobos", "9789720000405", "Ana Lima");
  assert.equal(repo.addBookCollection(book.id, { name: "Bang!", position: null }, "bnp", AT), true);
  assert.equal(repo.addBookCollection(book.id, { name: "Bang!", position: "248" }, "bnp", at(1)), false);
  assert.equal(repo.addBookCollection(book.id, { name: "Bang!", position: "249" }, "bnp", at(2)), false);
  assert.equal(repo.addBookCollection(book.id, { name: "bang", position: "248" }, "ol-edition", at(3)), true);
  assert.equal(repo.addBookCollection(book.id, { name: "--", position: "1" }, "bnp", at(4)), false);
  assert.deepEqual(db.prepare("SELECT source, position FROM book_collections ORDER BY source").all().map((row) => ({ ...row })), [
    { source: "bnp", position: "248" },
    { source: "ol-edition", position: "248" }
  ]);
  assert.equal(countOf(db, "collections_fts"), 1);
});

test("collectionsOf picks the earliest collection of each edition", () => {
  const { repo } = freshRepo();
  const book = seriesBook(repo, "Os Lobos", "9789720000405", "Ana Lima");
  repo.addBookCollection(book.id, { name: "Clássicos", position: "7" }, "ol-edition", at(2));
  repo.addBookCollection(book.id, { name: "Bang!", position: "248" }, "bnp", at(1));
  assert.deepEqual(repo.collectionsOf([book.id]).get(book.id), { name: "Bang!", position: "248" });
});

test("searchCollectionBooks caps its result at the limit and lists an edition once", () => {
  const { repo } = freshRepo();
  const books = [1, 2, 3, 4].map((n) => seriesBook(repo, `Livro ${n}`, `978972000050${n}`, "Ana Lima"));
  for (const book of books) {
    repo.makeSearchable(book.id);
    repo.addBookCollection(book.id, { name: "Bang!", position: null }, "bnp", AT);
  }
  repo.addBookCollection(books[0]!.id, { name: "Bang! Fantasia", position: null }, "ol-edition", AT);
  const ids = (limit: number) => repo.searchCollectionBooks(["bang"], limit).map((hit) => hit.bookId);
  assert.equal(ids(3).length, 3);
  assert.deepEqual([...ids(10)].sort(), books.map((book) => book.id).sort());
  assert.equal(new Set(ids(10)).size, ids(10).length);
});

test("searchCollectionBooks returns the collection that matched, not the edition's earliest", () => {
  const { repo } = freshRepo();
  const book = seriesBook(repo, "Os Lobos", "9789720000405", "Ana Lima");
  repo.makeSearchable(book.id);
  repo.addBookCollection(book.id, { name: "Bang!", position: "248" }, "bnp", at(1));
  repo.addBookCollection(book.id, { name: "Clássicos", position: "7" }, "ol-edition", at(2));
  assert.deepEqual(repo.searchCollectionBooks(["bang"], 5), [{ bookId: book.id, name: "Bang!", position: "248" }]);
  assert.deepEqual(repo.searchCollectionBooks(["classicos"], 5), [{ bookId: book.id, name: "Clássicos", position: "7" }]);
  assert.deepEqual(repo.collectionsOf([book.id]).get(book.id), { name: "Bang!", position: "248" });
});

test("searchCollectionBooks takes the matched collection's position from any source that has one", () => {
  const { repo } = freshRepo();
  const book = seriesBook(repo, "Os Lobos", "9789720000405", "Ana Lima");
  repo.makeSearchable(book.id);
  repo.addBookCollection(book.id, { name: "Bang!", position: null }, "bnp", at(1));
  assert.deepEqual(repo.searchCollectionBooks(["bang"], 5), [{ bookId: book.id, name: "Bang!", position: null }]);
  repo.addBookCollection(book.id, { name: "Bang!", position: "248" }, "ol-edition", at(2));
  assert.deepEqual(repo.searchCollectionBooks(["bang"], 5), [{ bookId: book.id, name: "Bang!", position: "248" }]);
});

test("searchCollectionBooks skips editions outside the search index before it applies the limit", () => {
  const { repo } = freshRepo();
  const hidden = [1, 2, 3].map((n) => seriesBook(repo, `Escondido ${n}`, `978972000060${n}`, "Ana Lima"));
  const shown = seriesBook(repo, "Visível", "9789720000604", "Ana Lima");
  repo.makeSearchable(shown.id);
  for (const book of [...hidden, shown]) repo.addBookCollection(book.id, { name: "Bang!", position: null }, "bnp", AT);
  assert.deepEqual(repo.searchCollectionBooks(["bang"], 2), [{ bookId: shown.id, name: "Bang!", position: null }]);
});

test("series and collection tables are added to an existing database once", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("DROP TABLE work_series");
  db.exec("DROP TABLE book_collections");
  db.exec("DROP TABLE series_fts");
  db.exec("DROP TABLE collections_fts");
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE name IN ('work_series', 'book_collections', 'series_fts', 'collections_fts') ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(names, ["book_collections", "collections_fts", "series_fts", "work_series"]);
});

const versions = (db: DatabaseSync) => (db.prepare("SELECT version FROM original_key_version").all() as Array<{ version: number }>).map((row) => row.version);
const keyOf = (db: DatabaseSync, id: string) => (db.prepare("SELECT original_key FROM books WHERE id = ?").get(id) as { original_key: string | null }).original_key;
const originalsOf = (db: DatabaseSync, id: string) => ({ ...(db.prepare("SELECT original_title, original_key, original_whole_key FROM books WHERE id = ?").get(id) as { original_title: string | null; original_key: string | null; original_whole_key: string | null }) });
const rawBook = (db: DatabaseSync, id: string, title: string, originalTitle: string | null, summary: string | null) =>
  db.prepare("INSERT INTO books (id, title, author, original_title, summary, created_at) VALUES (?, ?, 'A', ?, ?, ?)").run(id, title, originalTitle, summary, NOW);
const portuguese = (repo: ReturnType<typeof freshRepo>["repo"], title: string, author: string, isbn: string) => {
  const book = repo.createBook({ title, author, isbn }, [`isbn:${isbn}`], NOW);
  repo.setLanguage(book.id, "pt-PT");
  return book;
};

test("every new title key is queued as an arrival, and a blank-author row only once it has an author", () => {
  const { repo } = freshRepo();
  repo.createBook({ title: "To the Lighthouse", author: "Virginia Woolf", isbn: "9780156907392" }, ["isbn:9780156907392"], NOW);
  assert.deepEqual(repo.originalArrivals(10), [catalogTitleKey("To the Lighthouse", "Virginia Woolf")]);
  repo.dropOriginalArrival(catalogTitleKey("To the Lighthouse", "Virginia Woolf")!);
  assert.deepEqual(repo.originalArrivals(10), []);
  const blank = repo.createBook({ title: "Orlando", author: "", isbn: "9780156701600" }, ["isbn:9780156701600"], NOW);
  repo.createBook({ title: "", author: "", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  assert.deepEqual(repo.originalArrivals(10), []);
  repo.fillIdentity(blank.id, "Orlando", "Virginia Woolf");
  assert.deepEqual(repo.originalArrivals(10), [catalogTitleKey("Orlando", "Virginia Woolf")]);
});

test("a title key written again unchanged is not queued again", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780156701600" }, ["isbn:9780156701600"], NOW);
  repo.dropOriginalArrival(catalogTitleKey("Orlando", "Virginia Woolf")!);
  db.prepare("UPDATE books SET title_key = title_key WHERE id = ?").run(book.id);
  assert.deepEqual(repo.originalArrivals(10), []);
});

test("a book's first work key queues its title key again, and replacing or clearing it does not", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780156701600" }, ["isbn:9780156701600"], NOW);
  const key = catalogTitleKey("Orlando", "Virginia Woolf")!;
  repo.dropOriginalArrival(key);
  repo.setWorkKey(book.id, "OL5W");
  assert.deepEqual(repo.originalArrivals(10), [key]);
  repo.dropOriginalArrival(key);
  db.prepare("UPDATE books SET ol_work_key = 'OL6W' WHERE id = ?").run(book.id);
  db.prepare("UPDATE books SET ol_work_key = NULL WHERE id = ?").run(book.id);
  assert.deepEqual(repo.originalArrivals(10), []);
});

test("originalArrivals returns at most the limit", () => {
  const { repo } = freshRepo();
  repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780156701600" }, ["isbn:9780156701600"], NOW);
  repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], NOW);
  assert.equal(repo.originalArrivals(1).length, 1);
  assert.equal(repo.originalArrivals(10).length, 2);
});

test("every writer of an original title writes its key in the same statement", () => {
  const { db, repo } = freshRepo();
  const filled = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000111" }, ["isbn:9789720000111"], NOW);
  repo.fillOriginalTitle(filled.id, "To the Lighthouse");
  assert.deepEqual(originalsOf(db, filled.id), { original_title: "To the Lighthouse", original_key: originalKey("To the Lighthouse"), original_whole_key: originalWholeKey("To the Lighthouse") });

  const stopped = repo.createBook({ title: "O Senhor Mercedes", author: "Stephen King", isbn: "9789720000115" }, ["isbn:9789720000115"], NOW);
  repo.fillOriginalTitle(stopped.id, "Mr. Mercedes");
  assert.deepEqual(originalsOf(db, stopped.id), { original_title: "Mr. Mercedes", original_key: "mr|", original_whole_key: "mr mercedes|" });

  const merged = repo.createBook({ title: "O Rei de Ferro", author: "Maurice Druon", isbn: "9789720000112" }, ["isbn:9789720000112"], NOW);
  repo.saveDetails(merged.id, { ...richDetails, summary: "Uma sinopse longa o bastante.\n\nTítulo original: Les rois maudits. Le roi de fer" }, ["openlibrary"], "openlibrary", NOW);
  assert.deepEqual(originalsOf(db, merged.id), { original_title: "Les rois maudits. Le roi de fer", original_key: "les rois maudits|", original_whole_key: "les rois maudits le roi de fer|" });

  const kept = repo.createBook({ title: "Outro", author: "X", isbn: "9789720000113" }, ["isbn:9789720000113"], NOW);
  repo.fillOriginalTitle(kept.id, "Orlando");
  repo.mergeDetails(kept.id, { ...noDetails, summary: "Uma sinopse longa o bastante.\n\nTítulo original: Dune" }, "publisher");
  assert.deepEqual(originalsOf(db, kept.id), { original_title: "Orlando", original_key: "orlando|", original_whole_key: "orlando|" });

  const labelled = repo.createBook({ title: "O Telefone do Sr. Harrigan", author: "Stephen King", isbn: "9789720000114" }, ["isbn:9789720000114"], NOW);
  db.prepare("UPDATE books SET summary = ? WHERE id = ?").run("Um telefone.\n\nTítulo original: Mr. Harrigan's Phone", labelled.id);
  assert.equal(repo.fillOriginalTitlesFromSummaries(), 1);
  assert.deepEqual(originalsOf(db, labelled.id), { original_title: "Mr. Harrigan's Phone", original_key: "mr|", original_whole_key: "mr harrigan s phone|" });
});

test("originalClaimsOf reads the claims of one original key by index", () => {
  const { db, repo } = freshRepo();
  const pt = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "9789720000111");
  repo.fillOriginalTitle(pt.id, "To the Lighthouse");
  const other = portuguese(repo, "Orlando em Português", "Virginia Woolf", "9789720000112");
  repo.fillOriginalTitle(other.id, "Orlando");
  repo.createBook({ title: "To the Lighthouse", author: "Virginia Woolf", isbn: "9780156907392" }, ["isbn:9780156907392"], NOW);
  const key = originalKey("To the Lighthouse")!;
  assert.deepEqual(repo.originalClaimsOf(key), [{ workId: pt.work_id, title: "Passeio ao Farol", author: "Virginia Woolf", language: "pt-PT", originalTitle: "To the Lighthouse" }]);
  assert.deepEqual(repo.originalClaimsOf("nothing|"), []);
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${ORIGINAL_CLAIMS_SQL}`).all(key) as Array<{ detail: string }>).map((row) => row.detail).join(" ");
  assert.match(plan, /idx_books_original_key/);
});

test("originalKeysOf reads the stem keys of one whole key from its covering index", () => {
  const { db, repo } = freshRepo();
  repo.fillOriginalTitle(portuguese(repo, "O Senhor Mercedes", "Stephen King", "9789720000401").id, "Mr. Mercedes");
  repo.fillOriginalTitle(portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "9789720000402").id, "To the Lighthouse");
  assert.deepEqual(repo.originalKeysOf("mr mercedes|"), ["mr|"]);
  assert.deepEqual(repo.originalKeysOf("to the lighthouse|"), ["to the lighthouse|"]);
  assert.deepEqual(repo.originalKeysOf("mr|"), []);
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${ORIGINAL_KEYS_OF_WHOLE_SQL}`).all("mr mercedes|") as Array<{ detail: string }>).map((row) => row.detail).join(" ");
  assert.match(plan, /COVERING INDEX idx_books_original_whole_key/);
});

test("the series rule built from one key's claims answers like the one built from every claim", () => {
  const { db, repo } = freshRepo();
  const poppies = [
    portuguese(repo, "Poppy e o Pónei", "Janey Louise Jones", "9789720000201"),
    portuguese(repo, "Poppy no Mar", "Janey Louise Jones", "9789720000202"),
    portuguese(repo, "Poppy na Neve", "Janey Louise Jones", "9789720000203")
  ];
  repo.fillOriginalTitle(poppies[0]!.id, "Princess Poppy");
  repo.fillOriginalTitle(poppies[1]!.id, "Princess Poppy");
  db.prepare("UPDATE books SET summary = ? WHERE id = ?").run("Um pónei.\n\nTítulo original: Princess Poppy", poppies[2]!.id);
  repo.fillOriginalTitle(portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "9789720000301").id, "To the Lighthouse");
  repo.fillOriginalTitle(portuguese(repo, "Rumo ao Farol", "Virginia Woolf", "9789720000302").id, "To the Lighthouse");
  repo.fillOriginalTitle(portuguese(repo, "O Rei de Ferro", "Maurice Druon", "9789720000501").id, "Les rois maudits. Le roi de fer");
  repo.fillOriginalTitle(portuguese(repo, "A Rainha Estrangulada", "Maurice Druon", "9789720000502").id, "Les rois maudits. La reine étranglée");
  repo.fillOriginalTitle(portuguese(repo, "Os Venenos da Coroa", "Maurice Druon", "9789720000503").id, "Les rois maudits. Les poisons de la couronne");
  db.exec("DELETE FROM original_key_version");
  applyBooksMigrations(db);

  const everything = seriesLikeOriginals(repo.originalTitleClaims());
  const cases: Array<[string, string]> = [["Princess Poppy", "Janey Louise Jones"], ["To the Lighthouse", "Virginia Woolf"], ["Princess Poppy", "Someone Else"], ["Les rois maudits. Le roi de fer", "Maurice Druon"]];
  for (const [original, author] of cases) {
    assert.equal(seriesLikeOriginals(repo.originalClaimsOf(originalKey(original)!))(original, author), everything(original, author), `${original} / ${author}`);
    const found = repo.originalKeysOf(originalWholeKey(original)!).flatMap((stem) => repo.originalClaimsOf(stem));
    assert.equal(seriesLikeOriginals(found)(original, author), everything(original, author), `whole ${original} / ${author}`);
  }
  assert.equal(everything("Princess Poppy", "Janey Louise Jones"), true);
  assert.equal(everything("Les rois maudits. Le roi de fer", "Maurice Druon"), true);
  assert.equal(everything("To the Lighthouse", "Virginia Woolf"), false);
});

test("the original keys are stored once, recomputed when the version changes, and cleared with their title", () => {
  const { db, repo } = freshRepo();
  rawBook(db, "keyed", "O Senhor Mercedes", "Mr. Mercedes", null);
  rawBook(db, "labelled", "Orlando em Português", null, "Uma vida.\n\nTítulo original: Orlando");
  db.exec("DROP INDEX idx_books_original_key");
  db.exec("DROP INDEX idx_books_original_whole_key");
  db.exec("DROP INDEX idx_books_original_keys_missing");
  db.exec("ALTER TABLE books DROP COLUMN original_key");
  db.exec("ALTER TABLE books DROP COLUMN original_whole_key");
  db.exec("DELETE FROM original_key_version");
  applyBooksMigrations(db);
  assert.deepEqual(originalsOf(db, "keyed"), { original_title: "Mr. Mercedes", original_key: "mr|", original_whole_key: "mr mercedes|" });
  assert.deepEqual(originalsOf(db, "labelled"), { original_title: "Orlando", original_key: "orlando|", original_whole_key: "orlando|" });
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_original_key'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_original_whole_key'").get());
  assert.deepEqual(versions(db), [1]);
  assert.equal(repo.originalClaimsOf("orlando|").length, 1);

  db.prepare("UPDATE books SET original_key = 'x', original_whole_key = 'x' WHERE id = 'keyed'").run();
  applyBooksMigrations(db);
  assert.equal(keyOf(db, "keyed"), "x");
  assert.equal(originalsOf(db, "keyed").original_whole_key, "x");

  db.exec("UPDATE original_key_version SET version = 0");
  db.prepare("UPDATE books SET original_title = NULL, summary = NULL WHERE id = 'labelled'").run();
  applyBooksMigrations(db);
  assert.deepEqual(originalsOf(db, "keyed"), { original_title: "Mr. Mercedes", original_key: "mr|", original_whole_key: "mr mercedes|" });
  assert.equal(keyOf(db, "labelled"), null);
  assert.equal(originalsOf(db, "labelled").original_whole_key, null);
  assert.deepEqual(versions(db), [1]);
});

test("a title stored without its key is keyed at the next boot, found through its own index", () => {
  const { db } = freshRepo();
  rawBook(db, "stray", "Passeio ao Farol", "To the Lighthouse", null);
  rawBook(db, "blank", "Sem título", "   ", null);
  rawBook(db, "rolled", "O Senhor Mercedes", "Mr. Mercedes", null);
  db.prepare("UPDATE books SET original_key = 'mr|', original_whole_key = NULL WHERE id = 'rolled'").run();
  db.exec("CREATE INDEX idx_books_original_key_missing ON books(id) WHERE original_title IS NOT NULL AND original_key IS NULL");
  assert.equal(keyOf(db, "stray"), null);
  applyBooksMigrations(db);
  assert.equal(keyOf(db, "stray"), originalKey("To the Lighthouse"));
  assert.equal(originalsOf(db, "stray").original_whole_key, originalWholeKey("To the Lighthouse"));
  assert.equal(keyOf(db, "blank"), null);
  assert.equal(originalsOf(db, "blank").original_whole_key, null);
  assert.equal(keyOf(db, "rolled"), "mr|");
  assert.equal(originalsOf(db, "rolled").original_whole_key, "mr mercedes|");
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_original_key_missing'").get(), undefined);
  assert.deepEqual(versions(db), [1]);
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${UNKEYED_ORIGINALS_SQL}`).all() as Array<{ detail: string }>).map((row) => row.detail).join(" ");
  assert.match(plan, /idx_books_original_keys_missing/);
});
