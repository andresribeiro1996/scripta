import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import { bookKey, localDay } from "@scripta/shared";

// service.js reaches config/env.ts through covers/index.js (peekCachedCoverUrl),
// and that module process.exit(1)s on an unsatisfied schema at import time. Set
// the required vars before the deferred imports below, exactly as
// import/parseImport.test.ts and the other env-reaching tests do — a static
// import would hoist above these assignments. The LibraryService tests below
// run against :memory:; the tests of the cross-module readers and the backfill
// further down are the exception — they open the real file at LIBRARY_DB_PATH,
// since that's the connection publicResolver.js's own module-scoped cache uses.
const scratch = mkdtempSync(join(tmpdir(), "library-service-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { createSqliteLibraryRepository } = await import("./adapters/sqlite/sqliteLibraryRepository.js");
const { applyLibrarySchema, openLibraryDb } = await import("./adapters/sqlite/connection.js");
const { LibraryConflictError, LibraryTooLargeError } = await import("./domain/errors.js");
const { backfillLibraryDerived, readEmbeddedMurals } = await import("./migration.js");
const { LIBRARY_DERIVED_VERSION, LIBRARY_MATCH_BOOK_CAP, LIBRARY_PUT_HEADROOM_BYTES } = await import("./domain/constants.js");
const { createLibraryService, deriveLibraryData } = await import("./service.js");
const { readerGlyphFor, sharedBookCounts, sharedBooks } = await import("./publicResolver.js");
const { peekCachedCoverUrl } = await import("../books/index.js");

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  return db;
}

type RecordedEvent = { userId: string; type: "book_added" | "book_finished"; refId: string; payload: Record<string, unknown> };

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function setup(maxDocumentBytes = MAX_DOCUMENT_BYTES) {
  const db = memoryDb();
  const repo = createSqliteLibraryRepository(db);
  const events: RecordedEvent[] = [];
  const service = createLibraryService(repo, () => "", maxDocumentBytes, (userId, batch) => {
    events.push(...batch.map((event) => ({ userId, ...event })));
  });
  return { db, repo, service, events };
}

function setupCovers() {
  const db = memoryDb();
  const batches: unknown[][] = [];
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", MAX_DOCUMENT_BYTES, undefined, (lookups) => { batches.push(lookups); });
  return { service, batches };
}

function booksOf(service: ReturnType<typeof createLibraryService>, userId: string): Array<Record<string, unknown>> {
  const data = service.getLibrary(userId)?.data as { books?: Array<Record<string, unknown>> } | null;
  return data?.books ?? [];
}

test("library saves reject stale and missing versions without overwriting", () => {
  const { db, service } = setup();
  const first = service.saveLibrary("user-1", { books: [{ Title: "First" }] });
  const second = service.saveLibrary("user-1", { books: [{ Title: "Second" }] }, first.updatedAt);

  assert.notEqual(second.updatedAt, first.updatedAt);
  assert.throws(() => service.saveLibrary("user-1", { books: [] }, first.updatedAt), LibraryConflictError);
  assert.throws(() => service.saveLibrary("user-1", { books: [] }), LibraryConflictError);
  assert.deepEqual(service.getLibrary("user-1")?.data, { books: [{ Title: "Second" }] });
  db.close();
});

test("saveLibrary emits book_added for books new since the previous save", () => {
  const { db, service, events } = setup();
  const first = service.saveLibrary("user-1", { books: [{ ContentID: "k1", Title: "Old", Attribution: "A", ReadStatus: 0 }] });
  events.length = 0;

  service.saveLibrary("user-1", {
    books: [
      { ContentID: "k1", Title: "Old", Attribution: "A", ReadStatus: 0 },
      { ContentID: "k2", Title: "New Book", Attribution: "Auth B", ISBN: "9781111111111", _coverUrl: "https://c/x.jpg", ReadStatus: 0 }
    ]
  }, first.updatedAt);

  assert.deepEqual(events, [
    {
      userId: "user-1",
      type: "book_added",
      refId: "k2",
      payload: { title: "New Book", author: "Auth B", isbn: "9781111111111", coverUrl: "https://c/x.jpg", status: 0 }
    }
  ]);
  db.close();
});

test("saveLibrary emits at most 10 events for one save, the first ones in document order", () => {
  const { db, service, events } = setup();
  const first = service.saveLibrary("user-1", { books: [] });
  const added = Array.from({ length: 25 }, (_, i) => ({ ContentID: `k${i}`, Title: `Book ${i}`, Attribution: "A", ReadStatus: 0 }));

  service.saveLibrary("user-1", { books: added }, first.updatedAt);

  assert.deepEqual(events.map((event) => event.refId), added.slice(0, 10).map((book) => book.ContentID));
  db.close();
});

test("saveLibrary emits every event of a save that changes fewer books than the cap", () => {
  const { db, service, events } = setup();
  const first = service.saveLibrary("user-1", { books: [] });
  const added = Array.from({ length: 3 }, (_, i) => ({ ContentID: `k${i}`, Title: `Book ${i}`, Attribution: "A", ReadStatus: 0 }));

  service.saveLibrary("user-1", { books: added }, first.updatedAt);

  assert.deepEqual(events.map((event) => event.refId), ["k0", "k1", "k2"]);
  db.close();
});

test("saveLibrary emits book_finished when ReadStatus crosses into 2", () => {
  const { db, service, events } = setup();
  const first = service.saveLibrary("user-1", { books: [{ ContentID: "k1", Title: "T", Attribution: "A", ReadStatus: 1 }] });
  events.length = 0;

  service.saveLibrary("user-1", { books: [{ ContentID: "k1", Title: "T", Attribution: "A", ReadStatus: 2 }] }, first.updatedAt);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "book_finished");
  assert.equal(events[0]?.refId, "k1");
  assert.equal(events[0]?.payload.status, 2);
  db.close();
});

test("saveLibrary with unchanged books emits nothing", () => {
  const { db, service, events } = setup();
  const doc = { books: [{ ContentID: "k1", Title: "T", Attribution: "A", ReadStatus: 2 }] };
  const first = service.saveLibrary("user-1", doc);
  service.saveLibrary("user-1", doc, first.updatedAt);

  assert.deepEqual(events, []);
  db.close();
});

test("saveLibrary with source 'import' skips diff emission", () => {
  const { db, service, events } = setup();
  const first = service.saveLibrary("user-1", { books: [{ ContentID: "k0", Title: "Seed", Attribution: "A", ReadStatus: 0 }] });
  events.length = 0;

  service.saveLibrary("user-1", {
    books: [
      { ContentID: "a", Title: "A", Attribution: "A", ReadStatus: 0 },
      { ContentID: "b", Title: "B", Attribution: "A", ReadStatus: 0 },
      { ContentID: "c", Title: "C", Attribution: "A", ReadStatus: 0 }
    ]
  }, first.updatedAt, "import");

  assert.deepEqual(events, []);
  db.close();
});

test("addBook with no match appends a manual book and emits book_added", () => {
  const { db, service, events } = setup();

  const result = service.addBook("user-1", { title: "Stoner", author: "John Williams", readStatus: 0 });

  assert.equal(result.updated, false);
  assert.ok(result.key.startsWith("manual:"));
  const books = booksOf(service, "user-1");
  assert.equal(books.length, 1);
  assert.equal(books[0]?.ContentID, result.key);
  assert.equal(books[0]?.ReadStatus, 0);
  assert.deepEqual(events.map(({ type, refId }) => ({ type, refId })), [{ type: "book_added", refId: result.key }]);
  assert.equal(events[0]?.payload.title, "Stoner");
  assert.equal(events[0]?.payload.status, 0);
  db.close();
});

test("addBook with no match, finished with a given day, records that day", () => {
  const { db, service } = setup();

  const result = service.addBook("user-1", { title: "Stoner", author: "John Williams", readStatus: 2, day: "2026-01-01" });

  const books = booksOf(service, "user-1");
  assert.equal(books[0]?.ContentID, result.key);
  assert.equal(books[0]?.DateLastRead, "2026-01-01");
  db.close();
});

test("addBook matches by trimmed ISBN, finishing records the given day and 100%", () => {
  const { db, service, events } = setup();
  service.saveLibrary("user-1", {
    books: [{ ContentID: "k1", Title: "Stoner", Attribution: "John Williams", ISBN: " 9780394729685 ", ReadStatus: 1, ___PercentRead: 40, DateLastRead: null }],
    groups: [{ name: "g" }]
  });
  events.length = 0;

  const result = service.addBook("user-1", { title: "Stoner", author: "John Williams", isbn: "9780394729685", readStatus: 2, day: "2024-03-02" });

  assert.deepEqual(result, { key: "k1", updated: true });
  const books = booksOf(service, "user-1");
  assert.equal(books.length, 1);
  assert.equal(books[0]?.ReadStatus, 2);
  assert.equal(books[0]?.___PercentRead, 100);
  assert.equal(books[0]?.DateLastRead, "2024-03-02");
  assert.deepEqual((service.getLibrary("user-1")?.data as { groups?: unknown }).groups, [{ name: "g" }]);
  assert.deepEqual(events.map(({ type, refId }) => ({ type, refId })), [{ type: "book_finished", refId: "k1" }]);
  db.close();
});

test("addBook finishing without a day falls back to the server's local day", () => {
  const { db, service } = setup();
  service.saveLibrary("user-1", {
    books: [{ ContentID: "k1", Title: "Stoner", Attribution: "John Williams", ReadStatus: 0 }]
  });

  const result = service.addBook("user-1", { title: "Stoner", author: "John Williams", readStatus: 2 });

  assert.deepEqual(result, { key: "k1", updated: true });
  assert.equal(booksOf(service, "user-1")[0]?.DateLastRead, localDay());
  db.close();
});

test("addBook moving out of Finished keeps DateLastRead and ___PercentRead", () => {
  const { db, service, events } = setup();
  service.saveLibrary("user-1", {
    books: [{ ContentID: "k1", Title: "Stoner", Attribution: "John Williams", ReadStatus: 2, ___PercentRead: 100, DateLastRead: "2020-06-01" }]
  });
  events.length = 0;

  const result = service.addBook("user-1", { title: "Stoner", author: "John Williams", readStatus: 0 });

  assert.deepEqual(result, { key: "k1", updated: true });
  const book = booksOf(service, "user-1")[0];
  assert.equal(book?.ReadStatus, 0);
  assert.equal(book?.___PercentRead, 100);
  assert.equal(book?.DateLastRead, "2020-06-01");
  assert.deepEqual(events, []);
  db.close();
});

test("addBook to an unfinished status updates in place but emits nothing", () => {
  const { db, service, events } = setup();
  service.saveLibrary("user-1", {
    books: [{ ContentID: "k1", Title: "Stoner", Attribution: "John Williams", ISBN: "9780394729685", ReadStatus: 0, ___PercentRead: 0, DateLastRead: null }]
  });
  events.length = 0;

  const result = service.addBook("user-1", { title: "Stoner", author: "John Williams", isbn: "9780394729685", readStatus: 1 });

  assert.deepEqual(result, { key: "k1", updated: true });
  const book = booksOf(service, "user-1")[0];
  assert.equal(book?.ReadStatus, 1);
  assert.equal(book?.___PercentRead, 0);
  assert.equal(book?.DateLastRead, null);
  assert.deepEqual(events, []);
  db.close();
});

test("addBook without ISBN matches case-insensitive trimmed title+author", () => {
  const { db, service, events } = setup();
  service.saveLibrary("user-1", {
    books: [{ ContentID: "k9", Title: "  Stoner ", Attribution: " john williams ", ReadStatus: 0 }]
  });
  events.length = 0;

  const result = service.addBook("user-1", { title: "stoner", author: "John Williams", readStatus: 1 });

  assert.deepEqual(result, { key: "k9", updated: true });
  assert.equal(booksOf(service, "user-1")[0]?.ReadStatus, 1);
  db.close();
});

test("addBook with the same status on a match writes nothing and emits nothing", () => {
  const { db, service, events } = setup();
  service.saveLibrary("user-1", { books: [{ ContentID: "k1", Title: "Stoner", Attribution: "John Williams", ReadStatus: 1 }] });
  events.length = 0;
  const before = service.getLibrary("user-1")?.updatedAt;

  const result = service.addBook("user-1", { title: "Stoner", author: "John Williams", readStatus: 1 });

  assert.deepEqual(result, { key: "k1", updated: false });
  assert.deepEqual(events, []);
  assert.equal(service.getLibrary("user-1")?.updatedAt, before);
  db.close();
});

const rawBytes = (db: DatabaseSync, userId: string) =>
  Buffer.byteLength((db.prepare(`SELECT data FROM library_documents WHERE user_id = ?`).get(userId) as { data: string }).data);

const lusiadas = { title: "Os Lusíadas", author: "Luís de Camões", readStatus: 0 } as const;

test("addBook stores a document of exactly the limit minus the PUT headroom and refuses one byte more", () => {
  const base = { books: [{ ContentID: "k1", Title: "Stoner", Attribution: "John Williams", ReadStatus: 1 }] };
  const probe = setup();
  probe.service.saveLibrary("user-1", base);
  probe.service.addBook("user-1", lusiadas);
  const grown = rawBytes(probe.db, "user-1");
  probe.db.close();

  const exact = setup(grown + LIBRARY_PUT_HEADROOM_BYTES);
  exact.service.saveLibrary("user-1", base);
  exact.service.addBook("user-1", lusiadas);
  assert.equal(booksOf(exact.service, "user-1").length, 2);
  exact.db.close();

  const over = setup(grown + LIBRARY_PUT_HEADROOM_BYTES - 1);
  const saved = over.service.saveLibrary("user-1", base);
  assert.throws(() => over.service.addBook("user-1", lusiadas), LibraryTooLargeError);
  assert.deepEqual(over.service.getLibrary("user-1")?.data, base);
  assert.equal(over.service.getLibrary("user-1")?.updatedAt, saved.updatedAt);
  assert.deepEqual(over.events, []);
  over.db.close();
});

test("addBook refuses a re-shelve that grows the document past the limit minus the PUT headroom, and allows one that does not", () => {
  const base = { books: [{ ContentID: "k1", Title: "Stoner", Attribution: "John Williams", ReadStatus: 0 }] };
  const { db, service, events } = setup(Buffer.byteLength(JSON.stringify(base)) + LIBRARY_PUT_HEADROOM_BYTES);
  const saved = service.saveLibrary("user-1", base);

  assert.throws(() => service.addBook("user-1", { title: "Stoner", author: "John Williams", readStatus: 2, day: "2024-03-02" }), LibraryTooLargeError);
  assert.deepEqual(service.getLibrary("user-1")?.data, base);
  assert.equal(service.getLibrary("user-1")?.updatedAt, saved.updatedAt);
  assert.deepEqual(events, []);

  assert.deepEqual(service.addBook("user-1", { title: "Stoner", author: "John Williams", readStatus: 1 }), { key: "k1", updated: true });
  assert.equal(booksOf(service, "user-1")[0]?.ReadStatus, 1);
  db.close();
});

type Book = Record<string, unknown>;
const shelf = (count: number): Book[] => Array.from({ length: count }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2 }));
const seriesGroup = (books: Book[]) => ({ id: "g1", type: "series", name: "Discworld", bookKeys: books.map(bookKey) });

const fileDb = openLibraryDb();
const fileService = createLibraryService(createSqliteLibraryRepository(fileDb), () => "", MAX_DOCUMENT_BYTES);

function rawDocument(userId: string, data: string, updatedAt = new Date().toISOString()) {
  fileDb.prepare(`INSERT OR REPLACE INTO library_documents (user_id, data, updated_at) VALUES (?, ?, ?)`).run(userId, data, updatedAt);
}

const keyRows = (db: DatabaseSync, userId: string) =>
  (db.prepare(`SELECT key, book_ref, title, author, isbn, cover FROM library_match_keys WHERE user_id = ? ORDER BY book_ref, key`).all(userId) as Array<Record<string, unknown>>).map((row) => ({ ...row }));

const storedGlyph = (db: DatabaseSync, userId: string) => (db.prepare(`SELECT glyph FROM library_derived WHERE user_id = ?`).get(userId) as { glyph: string | null } | undefined)?.glyph;

const derivedSource = (db: DatabaseSync, userId: string) => (db.prepare(`SELECT source_updated_at FROM library_derived WHERE user_id = ?`).get(userId) as { source_updated_at: string } | undefined)?.source_updated_at;

const userVersion = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

test("readerGlyphFor returns the settled identity for a library that clears the threshold", () => {
  const books = shelf(10);
  fileService.saveLibrary("settled-user", { books, groups: [seriesGroup(books.slice(0, 3))] });
  assert.equal(readerGlyphFor("settled-user"), "carto");
});

test("readerGlyphFor returns null for a library that only leans toward an identity", () => {
  const books = shelf(11);
  fileService.saveLibrary("leaning-user", { books, groups: [seriesGroup(books.slice(0, 3))] });
  assert.equal(readerGlyphFor("leaning-user"), null);
});

test("readerGlyphFor returns null for an Unwritten library, distinct from a missing document", () => {
  const books = shelf(3);
  fileService.saveLibrary("unwritten-user", { books, groups: [] });
  assert.equal(readerGlyphFor("unwritten-user"), null);
});

test("readerGlyphFor returns null when the user has no library document", () => {
  assert.equal(readerGlyphFor("ghost-user"), null);
});

test("readerGlyphFor returns the stored glyph without reading the document", () => {
  const books = shelf(10);
  fileService.saveLibrary("stored-user", { books, groups: [seriesGroup(books.slice(0, 3))] });
  fileDb.prepare(`UPDATE library_documents SET data = ? WHERE user_id = ?`).run("not json", "stored-user");
  assert.equal(readerGlyphFor("stored-user"), "carto");
});

test("an import save queues covers for every book once; other saves queue nothing", () => {
  const { service, batches } = setupCovers();
  const data = { books: [
    { Title: "Orlando", Attribution: "Virginia Woolf", ISBN: "9780141184272", ImageId: "2f1c6a1e-3b0d-4b6e-9a53-1d2f9c0a7b11" },
    { Title: "Dune", Attribution: "Frank Herbert" },
    { ReadStatus: 1 },
    "junk"
  ] };
  service.saveLibrary("user-1", data, undefined, "import");
  assert.deepEqual(batches, [[
    { isbn: "9780141184272", imageId: "2f1c6a1e-3b0d-4b6e-9a53-1d2f9c0a7b11", title: "Orlando", author: "Virginia Woolf" },
    { isbn: undefined, imageId: undefined, title: "Dune", author: "Frank Herbert" }
  ]]);
  const saved = service.getLibrary("user-1")!;
  service.saveLibrary("user-1", data, saved.updatedAt);
  assert.equal(batches.length, 1);
});

function setupMerge(maxDocumentBytes = MAX_DOCUMENT_BYTES) {
  const db = memoryDb();
  const rekeys: Array<[string, string[], string]> = [];
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", maxDocumentBytes, undefined, undefined, (userId, fromKeys, toKey) => {
    rekeys.push([userId, fromKeys, toKey]);
  });
  return { db, service, rekeys };
}

const koboDune = { ContentID: "k1", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1 };
const goodreadsDune = { ContentID: "g1", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 };

test("mergeBooks rewrites references, then saves the merged library", () => {
  const { service, rekeys } = setupMerge();
  const saved = service.saveLibrary("u1", { books: [koboDune, goodreadsDune], groups: [{ id: "g", type: "collection", name: "c", bookKeys: [bookKey(goodreadsDune)], createdAt: "t", updatedAt: "t" }] });
  const merged = service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], saved.updatedAt);
  assert.deepEqual(rekeys, [["u1", [bookKey(goodreadsDune)], bookKey(koboDune)]]);
  const data = merged.data as { books: Array<Record<string, unknown>>; groups: Array<{ bookKeys: string[] }> };
  assert.equal(data.books.length, 1);
  assert.equal(data.books[0]!.ReadStatus, 2);
  assert.deepEqual(data.groups[0]!.bookKeys, [bookKey(koboDune)]);
  assert.equal(bookKey(data.books[0]!), bookKey(koboDune));
});

test("mergeBooks with a stale updatedAt throws a conflict before touching any reference", () => {
  const { service, rekeys } = setupMerge();
  service.saveLibrary("u1", { books: [koboDune, goodreadsDune] });
  assert.throws(() => service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], "2000-01-01T00:00:00.000Z"), LibraryConflictError);
  assert.deepEqual(rekeys, []);
});

test("mergeBooks is a no-op when the keys are already gone", () => {
  const { service, rekeys } = setupMerge();
  const saved = service.saveLibrary("u1", { books: [koboDune] });
  const again = service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], saved.updatedAt);
  assert.equal(again.updatedAt, saved.updatedAt);
  assert.deepEqual(rekeys, []);
});

test("mergeBooks with a stale updatedAt still succeeds when the keys are already gone", () => {
  const { service, rekeys } = setupMerge();
  const saved = service.saveLibrary("u1", { books: [koboDune] });
  const again = service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], "2000-01-01T00:00:00.000Z");
  assert.equal(again.updatedAt, saved.updatedAt);
  assert.deepEqual(rekeys, []);
});

test("mergeBooks without a library throws NoLibraryDocumentError", async () => {
  const { NoLibraryDocumentError } = await import("./domain/errors.js");
  const { service } = setupMerge();
  assert.throws(() => service.mergeBooks("nobody", "a", ["b"], "2000-01-01T00:00:00.000Z"), NoLibraryDocumentError);
});

test("mergeBooks does not save the library when a reference rewrite fails", () => {
  const db = memoryDb();
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", MAX_DOCUMENT_BYTES, undefined, undefined, () => {
    throw new Error("murals db locked");
  });
  const saved = service.saveLibrary("u1", { books: [koboDune, goodreadsDune] });
  assert.throws(() => service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], saved.updatedAt), /murals db locked/);
  assert.equal((service.getLibrary("u1")!.data as { books: unknown[] }).books.length, 2);
});

test("mergeBooks refuses a merge that grows the document past the limit minus the PUT headroom, before rewriting any reference", () => {
  const short = { ContentID: "k1", Title: "a", Attribution: "b" };
  const isbn = { ContentID: "g1", Title: "a", Attribution: "b", ISBN: "9780441013593" };
  const stamp = "2026-01-01T00:00:00.000Z";
  const shelves = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, type: "collection", name: `Shelf ${i}`, bookKeys: [bookKey(short)], createdAt: stamp, updatedAt: stamp }));
  const base = { books: [isbn, short], groups: shelves };
  const merge = (service: ReturnType<typeof createLibraryService>, updatedAt: string) => service.mergeBooks("u1", bookKey(isbn), [bookKey(short)], updatedAt);

  const probe = setupMerge();
  merge(probe.service, probe.service.saveLibrary("u1", base).updatedAt);
  assert.ok(rawBytes(probe.db, "u1") > Buffer.byteLength(JSON.stringify(base)));
  probe.db.close();

  const { db, service, rekeys } = setupMerge(Buffer.byteLength(JSON.stringify(base)) + LIBRARY_PUT_HEADROOM_BYTES);
  const saved = service.saveLibrary("u1", base);
  assert.throws(() => merge(service, saved.updatedAt), LibraryTooLargeError);
  assert.deepEqual(rekeys, []);
  assert.deepEqual(service.getLibrary("u1")?.data, base);
  assert.equal(service.getLibrary("u1")?.updatedAt, saved.updatedAt);
  db.close();
});

test("addBook matches an ISBN-less copy by title and author", () => {
  const { service } = setup();
  service.saveLibrary("u1", { books: [koboDune] });
  const result = service.addBook("u1", { title: "Dune", author: "Frank Herbert", isbn: "9780441013593", readStatus: 2 });
  assert.equal(result.updated, true);
  assert.equal(booksOf(service, "u1").length, 1);
});

test("an existing library database gains the derived tables and keeps its documents", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE library_documents (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`);
  db.prepare(`INSERT INTO library_documents (user_id, data) VALUES ('old', '{"books":[]}')`).run();
  applyLibrarySchema(db);
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((row) => row.name);
  assert.ok(tables.includes("library_derived"));
  assert.ok(tables.includes("library_match_keys"));
  assert.equal((db.prepare(`SELECT data FROM library_documents WHERE user_id = 'old'`).get() as { data: string }).data, '{"books":[]}');
  db.close();
});

test("deriveLibraryData gives each book one row per match key, numbered by its place among the records", () => {
  const derived = deriveLibraryData({
    books: [null, 7, { Title: "Dune", Attribution: "Frank Herbert", ISBN: "978-0-441-01359-3", _coverUrl: "https://covers.test/dune.jpg" }, { Title: "Emma", Attribution: "Jane Austen", _coverUrl: 5 }]
  });
  assert.deepEqual(derived.keys, [
    { key: "isbn:9780441013593", book_ref: 0, title: "Dune", author: "Frank Herbert", isbn: "9780441013593", cover: "https://covers.test/dune.jpg" },
    { key: "ta:dune|frank herbert", book_ref: 0, title: "Dune", author: "Frank Herbert", isbn: "9780441013593", cover: "https://covers.test/dune.jpg" },
    { key: "ta:emma|jane austen", book_ref: 1, title: "Emma", author: "Jane Austen", isbn: null, cover: null }
  ]);
});

test("deriveLibraryData skips books that have no key and survives a document without books", () => {
  assert.deepEqual(deriveLibraryData({ books: [{ Title: "Untitled" }, { ReadStatus: 2 }] }), { glyph: null, keys: [] });
  for (const junk of [{ books: "none" }, {}, [], null, "text", 7]) assert.deepEqual(deriveLibraryData(junk), { glyph: null, keys: [] });
});

test("deriveLibraryData keys a book by the fields that are text, whatever its others hold", () => {
  const odd = { toString: 5 };
  const derived = deriveLibraryData({
    books: [
      { Title: "Dune", Attribution: odd, ISBN: "9780441013593", ReadStatus: 2 },
      { Title: odd, Attribution: "Jane Austen", ReadStatus: 2 },
      { Title: "Emma", Attribution: "Jane Austen", ISBN: odd, ReadStatus: 2 },
      { Title: 42, Attribution: ["Someone"], ISBN: 9780441013593 }
    ]
  });
  assert.deepEqual(derived.keys, [
    { key: "isbn:9780441013593", book_ref: 0, title: "Dune", author: "", isbn: "9780441013593", cover: null },
    { key: "ta:emma|jane austen", book_ref: 2, title: "Emma", author: "Jane Austen", isbn: null, cover: null }
  ]);
});

test("deriveLibraryData settles the glyph whatever the odd books around it hold", () => {
  const odd = { toString: 5 };
  const books = shelf(10);
  books[5] = { ...books[5], Attribution: odd, ContentID: odd, highlights: [{ Type: "highlight", Text: odd, Annotation: odd }, null, 7] };
  books[6] = { ...books[6], Title: odd, ISBN: odd };
  assert.equal(deriveLibraryData({ books, groups: [seriesGroup(books.slice(0, 3))] }).glyph, "carto");
});

test("deriveLibraryData stores each key once, for the first book that has it", () => {
  const derived = deriveLibraryData({
    books: [
      { Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 2 },
      { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 },
      { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 0 }
    ]
  });
  assert.deepEqual(derived.keys.map((row) => [row.key, row.book_ref]), [["ta:dune|frank herbert", 0], ["isbn:9780441013593", 1]]);
});

test("deriveLibraryData stores a title and author cut to 200 characters, and no title key longer than 300", () => {
  const derived = deriveLibraryData({
    books: [
      { Title: "t".repeat(600), Attribution: "a".repeat(600), ISBN: "9780441013593" },
      { Title: "u".repeat(600), Attribution: "Writer" }
    ]
  });
  assert.deepEqual(derived.keys.map((row) => [row.key, row.title.length, row.author.length]), [["isbn:9780441013593", 200, 200]]);
  const keyLengths = (titleLength: number) => deriveLibraryData({ books: [{ Title: "t".repeat(titleLength), Attribution: "a" }] }).keys.map((row) => row.key.length);
  assert.deepEqual(keyLengths(295), [300]);
  assert.deepEqual(keyLengths(296), []);
});

test("deriveLibraryData stores a cover only when it is an http or https URL of at most 2,048 characters", () => {
  const coverOf = (_coverUrl: unknown) => deriveLibraryData({ books: [{ Title: "Dune", Attribution: "Frank Herbert", _coverUrl }] }).keys[0]?.cover;
  const url = (length: number) => `https://covers.test/${"c".repeat(length - 20)}`;
  assert.equal(coverOf("https://covers.test/dune.jpg"), "https://covers.test/dune.jpg");
  assert.equal(coverOf("http://covers.test/dune.jpg"), "http://covers.test/dune.jpg");
  assert.equal(coverOf(url(2048)), url(2048));
  assert.equal(coverOf(url(2049)), null);
  assert.equal(coverOf(url(24000)), null);
  assert.equal(coverOf("data:image/png;base64,AAAA"), null);
  assert.equal(coverOf("javascript:alert(1)"), null);
  assert.equal(coverOf("/covers/dune.jpg"), null);
});

test("deriveLibraryData keys the first 20,000 books but settles the glyph on all of them", () => {
  const filler = Array.from({ length: LIBRARY_MATCH_BOOK_CAP }, (_, i) => ({ Title: `Filler ${i}`, Attribution: `Writer ${i}`, ReadStatus: 0 }));
  const finished = shelf(10);
  const derived = deriveLibraryData({ books: [...filler, ...finished], groups: [seriesGroup(finished.slice(0, 3))] });
  assert.equal(derived.keys.length, LIBRARY_MATCH_BOOK_CAP);
  assert.equal(derived.keys.at(-1)?.book_ref, LIBRARY_MATCH_BOOK_CAP - 1);
  assert.equal(derived.glyph, "carto");
});

test("saving a library stores each book's match keys and its reader glyph", () => {
  const { db, service } = setup();
  const books = shelf(10);
  books[0] = { ...books[0], ISBN: "978-0-441-01359-3", _coverUrl: "https://covers.test/0.jpg" };
  const saved = service.saveLibrary("u1", { books, groups: [seriesGroup(books.slice(0, 3))] });
  assert.equal(storedGlyph(db, "u1"), "carto");
  assert.equal(derivedSource(db, "u1"), saved.updatedAt);
  const rows = keyRows(db, "u1");
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.slice(0, 3), [
    { key: "isbn:9780441013593", book_ref: 0, title: "Book 0", author: "Author 0", isbn: "9780441013593", cover: "https://covers.test/0.jpg" },
    { key: "ta:book 0|author 0", book_ref: 0, title: "Book 0", author: "Author 0", isbn: "9780441013593", cover: "https://covers.test/0.jpg" },
    { key: "ta:book 1|author 1", book_ref: 1, title: "Book 1", author: "Author 1", isbn: null, cover: null }
  ]);
  db.close();
});

test("a thousand copies of one book store two key rows, for the first copy", () => {
  const { db, service } = setup();
  const copy = { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" };
  service.saveLibrary("u1", { books: Array.from({ length: 1000 }, () => copy) });
  assert.deepEqual(keyRows(db, "u1").map((row) => [row.key, row.book_ref]), [["isbn:9780441013593", 0], ["ta:dune|frank herbert", 0]]);
  db.close();
});

test("saving again replaces the stored keys and glyph", () => {
  const { db, service } = setup();
  const books = shelf(10);
  const first = service.saveLibrary("u1", { books, groups: [seriesGroup(books.slice(0, 3))] });
  service.saveLibrary("u1", { books: [{ Title: "Only", Attribution: "One" }] }, first.updatedAt);
  assert.equal(storedGlyph(db, "u1"), null);
  assert.deepEqual(keyRows(db, "u1").map((row) => row.key), ["ta:only|one"]);
  db.close();
});

test("addBook stores the keys of the book it appends and recomputes the glyph", () => {
  const { db, service } = setup();
  const books = shelf(10);
  service.saveLibrary("u1", { books, groups: [seriesGroup(books.slice(0, 3))] });
  assert.equal(storedGlyph(db, "u1"), "carto");

  service.addBook("u1", { title: "Stoner", author: "John Williams", isbn: "9780394729685", coverUrl: "https://covers.test/stoner.jpg", readStatus: 2 });

  assert.equal(storedGlyph(db, "u1"), null);
  assert.deepEqual(keyRows(db, "u1").filter((row) => row.book_ref === 10), [
    { key: "isbn:9780394729685", book_ref: 10, title: "Stoner", author: "John Williams", isbn: "9780394729685", cover: "https://covers.test/stoner.jpg" },
    { key: "ta:stoner|john williams", book_ref: 10, title: "Stoner", author: "John Williams", isbn: "9780394729685", cover: "https://covers.test/stoner.jpg" }
  ]);
  db.close();
});

test("addBook re-shelving a book recomputes the glyph", () => {
  const { db, service } = setup();
  const books = shelf(11);
  service.saveLibrary("u1", { books, groups: [seriesGroup(books.slice(0, 3))] });
  assert.equal(storedGlyph(db, "u1"), null);

  service.addBook("u1", { title: "Book 10", author: "Author 10", readStatus: 0 });

  assert.equal(storedGlyph(db, "u1"), "carto");
  assert.equal(keyRows(db, "u1").length, 11);
  db.close();
});

test("mergeBooks replaces the stored keys with those of the merged library", () => {
  const { db, service } = setupMerge();
  const saved = service.saveLibrary("u1", { books: [koboDune, goodreadsDune] });
  assert.deepEqual(keyRows(db, "u1").map((row) => [row.book_ref, row.key]), [[0, "ta:dune|frank herbert"], [1, "isbn:9780441013593"]]);

  service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], saved.updatedAt);

  assert.deepEqual(keyRows(db, "u1").map((row) => [row.book_ref, row.key]), [[0, "ta:dune|frank herbert"]]);
  db.close();
});

test("a save rejected for a stale version leaves the stored keys and glyph as they were", () => {
  const { db, service } = setup();
  const books = shelf(10);
  const first = service.saveLibrary("u1", { books: [{ Title: "First", Attribution: "Writer" }] });
  const second = service.saveLibrary("u1", { books, groups: [seriesGroup(books.slice(0, 3))] }, first.updatedAt);
  const before = keyRows(db, "u1");

  assert.throws(() => service.saveLibrary("u1", { books: [{ Title: "Stale", Attribution: "Writer" }] }, first.updatedAt), LibraryConflictError);
  assert.throws(() => service.saveLibrary("u1", { books: [] }), LibraryConflictError);

  assert.deepEqual(keyRows(db, "u1"), before);
  assert.equal(storedGlyph(db, "u1"), "carto");
  assert.equal(derivedSource(db, "u1"), second.updatedAt);
  db.close();
});

test("the document and its derived rows are written in one transaction", () => {
  const { db, repo } = setup();
  const first = repo.upsertDocument("u1", JSON.stringify({ books: [] }), { glyph: null, keys: [] })!;
  const row = { key: "ta:a|b", book_ref: 0, title: "A", author: "B", isbn: null, cover: null };

  assert.throws(() => repo.upsertDocument("u1", JSON.stringify({ books: ["changed"] }), { glyph: null, keys: [row, row] }, first.updated_at), /UNIQUE/);

  assert.equal(repo.getDocument("u1")?.data, JSON.stringify({ books: [] }));
  assert.deepEqual(keyRows(db, "u1"), []);
  assert.equal(derivedSource(db, "u1"), first.updated_at);
  assert.ok(repo.upsertDocument("u1", JSON.stringify({ books: ["next"] }), { glyph: null, keys: [row] }, first.updated_at));
  assert.equal(keyRows(db, "u1").length, 1);
  db.close();
});

test("deleting a user's data clears the document and its derived rows, and only theirs", () => {
  const { db, repo, service } = setup();
  const books = shelf(10);
  service.saveLibrary("gone", { books, groups: [seriesGroup(books.slice(0, 3))] });
  service.saveLibrary("kept", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }] });

  repo.deleteUserData("gone");

  assert.equal(repo.getDocument("gone"), undefined);
  assert.equal(storedGlyph(db, "gone"), undefined);
  assert.deepEqual(keyRows(db, "gone"), []);
  assert.equal(keyRows(db, "kept").length, 1);
  assert.equal(storedGlyph(db, "kept"), null);
  db.close();
});

test("the embedded-murals scan returns only documents that still hold murals, and parses no other", () => {
  const withMurals = JSON.stringify({ books: [{ Title: "Dune" }], murals: [{ id: "m1", name: "One" }, { id: "m2", name: "Two" }] });
  const withoutMurals = JSON.stringify({ books: [{ Title: "Emma" }] });
  rawDocument("scan-with", withMurals);
  rawDocument("scan-without", withoutMurals);
  const parse = mock.method(JSON, "parse");
  try {
    assert.deepEqual(readEmbeddedMurals(), [
      { userId: "scan-with", rawMural: { id: "m1", name: "One" } },
      { userId: "scan-with", rawMural: { id: "m2", name: "Two" } }
    ]);
    const parsed = parse.mock.calls.map((call) => call.arguments[0]);
    assert.ok(parsed.includes(withMurals));
    assert.ok(!parsed.includes(withoutMurals));
  } finally {
    parse.mock.restore();
  }
});

const dune = (extra: Book = {}): Book => ({ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ...extra });
const emma: Book = { Title: "Emma", Attribution: "Jane Austen" };

test("the backfill derives every document that has no derived row", () => {
  const books = shelf(10);
  rawDocument("backfill-settled", JSON.stringify({ books, groups: [seriesGroup(books.slice(0, 3))] }));
  rawDocument("backfill-odd", JSON.stringify({ books: [{ Title: "Dune", Attribution: { toString: 5 }, ISBN: "9780441013593", ReadStatus: 2 }] }));
  fileService.saveLibrary("backfill-saved", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }] });

  backfillLibraryDerived();

  assert.equal(storedGlyph(fileDb, "backfill-settled"), "carto");
  assert.equal(keyRows(fileDb, "backfill-settled").length, 10);
  assert.equal(keyRows(fileDb, "backfill-saved").length, 1);
  assert.deepEqual(keyRows(fileDb, "backfill-odd").map((row) => row.key), ["isbn:9780441013593"]);
  assert.equal(derivedSource(fileDb, "backfill-settled"), fileService.getLibrary("backfill-settled")?.updatedAt);
});

test("a backfill leaves rows that were derived from the current document alone", () => {
  fileService.saveLibrary("noop-user", { books: [dune()] });
  fileDb.prepare(`UPDATE library_derived SET glyph = 'star' WHERE user_id = 'noop-user'`).run();
  fileDb.prepare(`DELETE FROM library_match_keys WHERE user_id = 'noop-user' AND key LIKE 'ta:%'`).run();

  backfillLibraryDerived();
  backfillLibraryDerived();

  assert.equal(storedGlyph(fileDb, "noop-user"), "star");
  assert.deepEqual(keyRows(fileDb, "noop-user").map((row) => row.key), ["isbn:9780441013593"]);
});

test("the backfill re-derives a library whose document was replaced behind its rows", () => {
  fileService.saveLibrary("replaced-user", { books: [dune()] });
  rawDocument("replaced-user", JSON.stringify({ books: [emma] }), "2099-01-01T00:00:00.000Z");

  backfillLibraryDerived();

  assert.deepEqual(keyRows(fileDb, "replaced-user").map((row) => row.key), ["ta:emma|jane austen"]);
  assert.equal(derivedSource(fileDb, "replaced-user"), "2099-01-01T00:00:00.000Z");
});

test("the backfill deletes the derived rows of users who have no document", () => {
  fileDb.prepare(`INSERT INTO library_derived (user_id, glyph, source_updated_at) VALUES ('orphan', 'star', '2026-01-01T00:00:00.000Z')`).run();
  fileDb.prepare(`INSERT INTO library_match_keys (user_id, key, book_ref, title, author) VALUES ('orphan', 'ta:a|b', 0, 'A', 'B')`).run();
  fileService.saveLibrary("not-orphan", { books: [dune()] });

  backfillLibraryDerived();

  assert.equal(storedGlyph(fileDb, "orphan"), undefined);
  assert.deepEqual(keyRows(fileDb, "orphan"), []);
  assert.equal(keyRows(fileDb, "not-orphan").length, 2);
});

test("the backfill stores an unparseable document without keys, says so, and does not retry it while it is unchanged", () => {
  const logged = mock.method(console, "error", () => undefined);
  try {
    rawDocument("backfill-corrupt", "not json");

    backfillLibraryDerived();
    backfillLibraryDerived();

    assert.equal(storedGlyph(fileDb, "backfill-corrupt"), null);
    assert.deepEqual(keyRows(fileDb, "backfill-corrupt"), []);
    assert.equal(logged.mock.callCount(), 1);

    rawDocument("backfill-corrupt", JSON.stringify({ books: [{ Title: "Fixed", Attribution: "Writer" }] }), "2099-01-01T00:00:00.000Z");
    backfillLibraryDerived();

    assert.deepEqual(keyRows(fileDb, "backfill-corrupt").map((row) => row.key), ["ta:fixed|writer"]);
    assert.equal(logged.mock.callCount(), 1);
  } finally {
    logged.mock.restore();
  }
});

test("raising the derived version re-derives every library at the next backfill", () => {
  const logged = mock.method(console, "error", () => undefined);
  try {
    fileService.saveLibrary("bump-a", { books: [dune()] });
    fileService.saveLibrary("bump-b", { books: [emma] });
    fileDb.prepare(`UPDATE library_derived SET glyph = 'star' WHERE user_id IN ('bump-a', 'bump-b')`).run();
    backfillLibraryDerived();
    assert.equal(storedGlyph(fileDb, "bump-a"), "star");

    applyLibrarySchema(fileDb, LIBRARY_DERIVED_VERSION + 1);
    assert.equal(storedGlyph(fileDb, "bump-a"), undefined);
    backfillLibraryDerived();

    assert.equal(storedGlyph(fileDb, "bump-a"), null);
    assert.equal(storedGlyph(fileDb, "bump-b"), null);
    assert.deepEqual(keyRows(fileDb, "bump-a").map((row) => row.key), ["isbn:9780441013593", "ta:dune|frank herbert"]);
    assert.deepEqual(keyRows(fileDb, "bump-b").map((row) => row.key), ["ta:emma|jane austen"]);
  } finally {
    logged.mock.restore();
  }
});

test("opening a database that holds the old derived tables rebuilds them once, in the new shape", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE library_documents (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE library_derived (user_id TEXT PRIMARY KEY, glyph TEXT);
    CREATE TABLE library_match_keys (user_id TEXT NOT NULL, key TEXT NOT NULL, book_ref INTEGER NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, isbn TEXT, cover TEXT, PRIMARY KEY (user_id, key, book_ref)) WITHOUT ROWID;
    INSERT INTO library_derived (user_id, glyph) VALUES ('old', 'star');
    INSERT INTO library_match_keys (user_id, key, book_ref, title, author) VALUES ('old', 'ta:a|b', 0, 'A', 'B');
  `);

  applyLibrarySchema(db);

  const columns = (db.prepare(`PRAGMA table_info(library_derived)`).all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(columns.includes("source_updated_at"));
  assert.equal(userVersion(db), LIBRARY_DERIVED_VERSION);
  assert.equal(storedGlyph(db, "old"), undefined);
  assert.deepEqual(keyRows(db, "old"), []);
  const insertKey = (bookRef: number) => db.prepare(`INSERT INTO library_match_keys (user_id, key, book_ref, title, author) VALUES ('u', 'ta:a|b', ?, 'A', 'B')`).run(bookRef);
  insertKey(0);
  assert.throws(() => insertKey(1), /UNIQUE/);

  db.prepare(`INSERT INTO library_derived (user_id, glyph, source_updated_at) VALUES ('new', NULL, '2026-01-01T00:00:00.000Z')`).run();
  applyLibrarySchema(db);
  assert.equal(storedGlyph(db, "new"), null);
  assert.equal(keyRows(db, "u").length, 1);
  db.close();
});

test("saving a library with a book whose fields aren't text succeeds, and keys the book by what is", () => {
  const { db, service } = setup();
  const books = [{ Title: "Dune", Attribution: { toString: 5 }, ISBN: "9780441013593", ReadStatus: 2 }, { Title: "Emma", Attribution: "Jane Austen", ReadStatus: 2 }];
  service.saveLibrary("u1", { books });
  assert.deepEqual(service.getLibrary("u1")?.data, { books });
  assert.deepEqual(keyRows(db, "u1").map((row) => [row.book_ref, row.key]), [[0, "isbn:9780441013593"], [1, "ta:emma|jane austen"]]);
  db.close();
});

test("sharedBookCounts counts each of the viewer's books once, however many keys match", () => {
  fileService.saveLibrary("counts-viewer", { books: [dune(), emma] });
  fileService.saveLibrary("counts-reader", { books: [dune()] });
  assert.deepEqual(sharedBookCounts("counts-viewer", ["counts-reader"]), new Map([["counts-reader", 1]]));
});

test("sharedBookCounts counts a reader holding two copies of the viewer's book once", () => {
  fileService.saveLibrary("copies-viewer", { books: [dune()] });
  fileService.saveLibrary("copies-reader", { books: [dune({ ContentID: "kobo" }), { Title: "Dune", Attribution: "Frank Herbert" }] });
  assert.deepEqual(sharedBookCounts("copies-viewer", ["copies-reader"]), new Map([["copies-reader", 1]]));
});

test("sharedBookCounts gives readers who each hold thousands of copies of a book a count of 1, in under a second", () => {
  const library = { books: Array.from({ length: 5000 }, () => dune()) };
  fileService.saveLibrary("many-viewer", library);
  fileService.saveLibrary("many-reader", library);
  const started = performance.now();
  const counts = sharedBookCounts("many-viewer", ["many-reader"]);
  assert.ok(performance.now() - started < 1000);
  assert.deepEqual(counts, new Map([["many-reader", 1]]));
  assert.deepEqual(sharedBooks("many-viewer", "many-reader", 3), [{ title: "Dune", author: "Frank Herbert", coverUrl: null }]);
});

test("sharedBookCounts leaves out readers outside the list and readers who share nothing", () => {
  fileService.saveLibrary("scope-viewer", { books: [dune(), emma] });
  fileService.saveLibrary("scope-listed", { books: [dune(), emma] });
  fileService.saveLibrary("scope-strange", { books: [{ Title: "Other", Attribution: "Writer" }] });
  fileService.saveLibrary("scope-unlisted", { books: [dune()] });
  assert.deepEqual(sharedBookCounts("scope-viewer", ["scope-listed", "scope-strange", "scope-nobody"]), new Map([["scope-listed", 2]]));
  assert.deepEqual(sharedBookCounts("scope-viewer", []), new Map());
  assert.deepEqual(sharedBookCounts("scope-nobody", ["scope-listed"]), new Map());
});

test("sharedBookCounts matches an ISBN across editions, and a title to a copy that has no ISBN", () => {
  fileService.saveLibrary("match-viewer", { books: [dune({ ISBN: "9780441172719" }), emma] });
  fileService.saveLibrary("match-isbn", { books: [{ Title: "Dune (Deluxe Edition)", Attribution: "F. Herbert", ISBN: "978-0-441-17271-9" }] });
  fileService.saveLibrary("match-title", { books: [{ Title: " EMMA ", Attribution: "Jane  Austen", ISBN: "9780141439587" }] });
  fileService.saveLibrary("match-neither", { books: [{ Title: "Emma", Attribution: "Someone Else", ISBN: "9780000000002" }] });
  assert.deepEqual(sharedBookCounts("match-viewer", ["match-isbn", "match-title", "match-neither"]), new Map([["match-isbn", 1], ["match-title", 1]]));
});

test("sharedBooks lists the viewer's own matched books in library order, one per book, up to the limit", () => {
  const stoner = { Title: "Stoner", Attribution: "John Williams", ISBN: "9780394729685" };
  fileService.saveLibrary("list-viewer", { books: [dune(), emma, { Title: "Unshared", Attribution: "Nobody" }, stoner] });
  fileService.saveLibrary("list-reader", { books: [stoner, emma, dune()] });
  const entry = (book: Book) => ({ title: book.Title, author: book.Attribution, coverUrl: null });
  assert.deepEqual(sharedBooks("list-viewer", "list-reader", 10), [entry(dune()), entry(emma), entry(stoner)]);
  assert.deepEqual(sharedBooks("list-viewer", "list-reader", 2), [entry(dune()), entry(emma)]);
  assert.deepEqual(sharedBooks("list-viewer", "list-nobody", 10), []);
});

test("sharedBooks shows the viewer's cover and never one planted in the other reader's library", () => {
  fileService.saveLibrary("cover-viewer", { books: [dune({ _coverUrl: "https://own.example/cover.jpg" })] });
  fileService.saveLibrary("cover-spy", { books: [dune({ _coverUrl: "https://attacker.example/pixel" })] });
  assert.deepEqual(sharedBooks("cover-viewer", "cover-spy", 3), [{ title: "Dune", author: "Frank Herbert", coverUrl: "https://own.example/cover.jpg" }]);
});

test("sharedBooks falls back to the cached cover for a book with none of its own, never the other reader's", () => {
  fileService.saveLibrary("cache-viewer", { books: [{ Title: "Emma", Attribution: "Jane Austen", ISBN: "9780141439587" }] });
  fileService.saveLibrary("cache-spy", { books: [{ Title: "Emma", Attribution: "Jane Austen", ISBN: "9780141439587", _coverUrl: "https://attacker.example/pixel" }] });
  assert.equal(sharedBooks("cache-viewer", "cache-spy", 3)[0]?.coverUrl, null);

  const covers = new DatabaseSync(process.env.COVERS_DB_PATH!);
  covers.prepare(`INSERT INTO books (id, title, author, isbn, cover_image_id, cover_status, created_at) VALUES ('emma-book', '', '', '9780141439587', '0f2b6c3e-5d1a-4b7e-9c40-1a2b3c4d5e6f', 'good', ?)`).run(new Date().toISOString());
  covers.prepare(`INSERT INTO book_keys (key, book_id) VALUES ('isbn:9780141439587', 'emma-book')`).run();
  covers.close();

  const cached = peekCachedCoverUrl({ isbn: "9780141439587" });
  assert.ok(cached);
  assert.deepEqual(sharedBooks("cache-viewer", "cache-spy", 3), [{ title: "Emma", author: "Jane Austen", coverUrl: cached }]);
});
