import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import { applyLibraryChange, bookKey, localDay, type LibraryChange, type LibraryData } from "@scripta/shared";

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
const { LibraryChangeNotFoundError, LibraryConflictError, LibraryTooLargeError, NoLibraryDocumentError } = await import("./domain/errors.js");
const { backfillLibraryDerived, readEmbeddedMurals } = await import("./migration.js");
const { LIBRARY_DERIVED_VERSION, LIBRARY_MATCH_BOOK_CAP, LIBRARY_PUT_HEADROOM_BYTES } = await import("./domain/constants.js");
const { createLibraryService, deriveGlyph, deriveLibraryData, deriveLibraryRows } = await import("./service.js");
const { readerGlyphFor, resolvePublicLibrary, sharedBookCounts, sharedBooks } = await import("./publicResolver.js");
const { peekCachedCoverUrl } = await import("../books/index.js");

const emptyRows = deriveLibraryRows({ books: [] }, () => undefined);
const keepRows = { books: [], counts: { finished: 0, inProgress: 0 }, meta: "keep" as const, readerCard: "keep" as const };

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  return db;
}

type RecordedEvent = { userId: string; type: "book_added" | "book_finished"; refId: string; payload: Record<string, unknown> };

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const PUBLIC_VIEW_BUDGET_MS = 1000;

function setup(maxDocumentBytes = MAX_DOCUMENT_BYTES) {
  const db = memoryDb();
  const repo = createSqliteLibraryRepository(db);
  const events: RecordedEvent[] = [];
  const service = createLibraryService(repo, () => "", maxDocumentBytes, (userId, batch) => {
    events.push(...batch.map((event) => ({ userId, ...event })));
  }, undefined, undefined, undefined, () => []);
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
      payload: { title: "New Book", author: "Auth B", isbn: "9781111111111", coverUrl: "https://c/x.jpg", status: 0, workId: null }
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
const fileService = createLibraryService(createSqliteLibraryRepository(fileDb), () => "", MAX_DOCUMENT_BYTES, undefined, undefined, undefined, undefined, () => []);

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

type WorkLookup = { isbn: string | null; title: string | null; author: string | null };

function setupWorks(resolve: (lookups: WorkLookup[]) => Array<string | null>) {
  const db = memoryDb();
  const calls: number[] = [];
  const errors: string[] = [];
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", MAX_DOCUMENT_BYTES, undefined, undefined, undefined, (_error, message) => { errors.push(message); }, (lookups) => {
    calls.push(lookups.length);
    return resolve(lookups);
  });
  const workOf = (position: number) => (db.prepare("SELECT work_id FROM library_books WHERE user_id = 'u1' AND position = ?").get(position) as { work_id: string | null }).work_id;
  return { db, service, calls, errors, workOf };
}

const fakeWorks = (lookups: WorkLookup[]) => lookups.map((lookup) => `w-${lookup.title}`);
const herbertDune = { Title: "Dune", Attribution: "Frank Herbert" };
const woolfOrlando = { Title: "Orlando", Attribution: "Virginia Woolf" };

test("saving a library resolves each book's work", () => {
  const { service, workOf } = setupWorks(fakeWorks);
  service.saveLibrary("u1", { books: [herbertDune, woolfOrlando] });
  assert.equal(workOf(0), "w-Dune");
  assert.equal(workOf(1), "w-Orlando");
});

test("an unchanged save resolves nothing", () => {
  const { service, calls } = setupWorks(fakeWorks);
  const first = service.saveLibrary("u1", { books: [herbertDune] });
  service.saveLibrary("u1", { books: [herbertDune] }, first.updatedAt);
  assert.deepEqual(calls, [1]);
});

test("a single-book change resolves only that book", () => {
  const { service, calls, workOf } = setupWorks(fakeWorks);
  service.saveLibrary("u1", { books: [herbertDune, woolfOrlando] });
  service.applyChange("u1", { kind: "book", bookKey: bookKey(woolfOrlando), readStatus: 1 });
  assert.deepEqual(calls, [2, 1]);
  assert.equal(workOf(1), "w-Orlando");
});

test("a catalog failure still saves the library and logs", () => {
  const { service, errors, workOf } = setupWorks(() => { throw new Error("catalog down"); });
  service.saveLibrary("u1", { books: [herbertDune] });
  assert.equal(workOf(0), null);
  assert.ok(errors.some((message) => message.startsWith("work resolve failed")));
});

test("adding a book resolves its work", () => {
  const { service, workOf } = setupWorks(fakeWorks);
  service.addBook("u1", { title: "Dune", author: "Frank Herbert", readStatus: 1 });
  assert.equal(workOf(0), "w-Dune");
});

test("re-shelving a matched book resolves only that book", () => {
  const { service, calls } = setupWorks(fakeWorks);
  service.saveLibrary("u1", { books: [herbertDune, woolfOrlando] });
  service.addBook("u1", { title: "Dune", author: "Frank Herbert", readStatus: 2 });
  assert.deepEqual(calls, [2, 1]);
});

test("merging books resolves the merged book", () => {
  const { service, calls, workOf } = setupWorks(fakeWorks);
  const saved = service.saveLibrary("u1", { books: [koboDune, goodreadsDune] });
  service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], saved.updatedAt);
  assert.deepEqual(calls, [2, 1]);
  assert.equal(workOf(0), "w-Dune");
});

const koboDune = { ContentID: "k1", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1 };
const goodreadsDune = { ContentID: "g1", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 };

test("mergeBooks rewrites references, then saves the merged library", () => {
  const { service, rekeys } = setupMerge();
  const saved = service.saveLibrary("u1", { books: [koboDune, goodreadsDune], groups: [{ id: "g", type: "collection", name: "c", bookKeys: [bookKey(goodreadsDune)], createdAt: "t", updatedAt: "t" }] });
  const merged = service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], saved.updatedAt);
  assert.deepEqual(rekeys, [["u1", [bookKey(goodreadsDune)], bookKey(koboDune)]]);
  const data = JSON.parse(merged.data) as { books: Array<Record<string, unknown>>; groups: Array<{ bookKeys: string[] }> };
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
  const first = repo.upsertDocument("u1", JSON.stringify({ books: [] }), { glyph: null, keys: [] }, emptyRows)!;
  const row = { key: "ta:a|b", book_ref: 0, title: "A", author: "B", isbn: null, cover: null };

  assert.throws(() => repo.upsertDocument("u1", JSON.stringify({ books: ["changed"] }), { glyph: null, keys: [row, row] }, emptyRows, first.updated_at), /UNIQUE/);

  assert.equal(repo.getDocument("u1")?.data, JSON.stringify({ books: [] }));
  assert.deepEqual(keyRows(db, "u1"), []);
  assert.equal(derivedSource(db, "u1"), first.updated_at);
  assert.ok(repo.upsertDocument("u1", JSON.stringify({ books: ["next"] }), { glyph: null, keys: [row] }, emptyRows, first.updated_at));
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

test("the backfill stores the rows before the derived marker, so a failed rows write leaves the account stale for the next boot", () => {
  fileService.saveLibrary("crash-user", { books: [dune()] });
  fileDb.prepare(`DELETE FROM library_derived WHERE user_id = 'crash-user'`).run();
  const staleIds = () => createSqliteLibraryRepository(fileDb).listStaleUserIds();
  assert.ok(staleIds().includes("crash-user"));
  fileDb.exec(`CREATE TRIGGER crash_summary_write BEFORE INSERT ON library_summary WHEN NEW.user_id = 'crash-user' BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
  try {
    assert.throws(() => backfillLibraryDerived(), /disk full/);
  } finally {
    fileDb.exec(`DROP TRIGGER crash_summary_write`);
  }

  assert.equal(storedGlyph(fileDb, "crash-user"), undefined);
  assert.ok(staleIds().includes("crash-user"));

  backfillLibraryDerived();

  assert.equal(storedGlyph(fileDb, "crash-user"), null);
  assert.equal(staleIds().includes("crash-user"), false);
});

test("raising the derived version re-derives every library at the next backfill", () => {
  const logged = mock.method(console, "error", () => undefined);
  try {
    fileService.saveLibrary("bump-a", { books: [dune()] });
    fileService.saveLibrary("bump-b", { books: [emma] });
    fileDb.prepare(`UPDATE library_derived SET glyph = 'star' WHERE user_id IN ('bump-a', 'bump-b')`).run();
    const { streak, dial, facts, ...oldShape } = JSON.parse(rowsInDb(fileDb, "bump-a").summary.reader_card as string);
    assert.ok(dial && facts);
    fileDb.prepare(`UPDATE library_summary SET reader_card = ? WHERE user_id = 'bump-a'`).run(JSON.stringify(oldShape));
    backfillLibraryDerived();
    assert.equal(storedGlyph(fileDb, "bump-a"), "star");
    assert.equal("dial" in JSON.parse(rowsInDb(fileDb, "bump-a").summary.reader_card as string), false);

    applyLibrarySchema(fileDb, LIBRARY_DERIVED_VERSION + 1);
    assert.equal(storedGlyph(fileDb, "bump-a"), undefined);
    backfillLibraryDerived();

    assert.equal(storedGlyph(fileDb, "bump-a"), null);
    assert.equal(storedGlyph(fileDb, "bump-b"), null);
    assert.deepEqual(keyRows(fileDb, "bump-a").map((row) => row.key), ["isbn:9780441013593", "ta:dune|frank herbert"]);
    assert.deepEqual(keyRows(fileDb, "bump-b").map((row) => row.key), ["ta:emma|jane austen"]);
    const rebuilt = JSON.parse(rowsInDb(fileDb, "bump-a").summary.reader_card as string);
    assert.deepEqual(rebuilt.dial, { segments: [] });
    assert.equal(rebuilt.facts.finished, 0);
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

const STAMP = "2026-01-01T00:00:00.000Z";
const owned = (i: number, extra: Book = {}): Book => ({ ContentID: `k${i}`, Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, ...extra });
const groupOf = (id: string, type: string, bookKeys: string[] = []) => ({ id, type, name: `Group ${id}`, bookKeys, createdAt: STAMP, updatedAt: STAMP });

function changeLibrary() {
  const books = [...Array.from({ length: 10 }, (_, i) => owned(i, i === 5 ? { Rating: 3 } : {})), owned(10, { ReadStatus: 1 })];
  return { books, groups: [groupOf("saga", "series", books.slice(0, 3).map(bookKey)), groupOf("shelf", "collection")] };
}

const keyOf = (i: number) => bookKey(owned(i));

function normalized(data: unknown, previous: unknown) {
  const known = new Set(((previous as { groups?: Array<{ id: string }> }).groups ?? []).map((group) => group.id));
  const doc = data as { groups?: Array<Record<string, unknown>> };
  return { ...doc, groups: doc.groups?.map((group) => ({ ...group, id: known.has(String(group.id)) ? group.id : "new", createdAt: "t", updatedAt: "t" })) };
}

const neuromancer = { ContentID: "manual:n", Title: "Neuromancer", Attribution: "William Gibson", ISBN: "9780441569595", Series: "Sprawl", ReadStatus: 0 };

test("applyChange stores what applyLibraryChange makes of the stored document, for each kind of change", () => {
  const changes: LibraryChange[] = [
    { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true },
    { kind: "membership", groupId: "saga", bookKey: keyOf(0), member: false },
    { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" },
    { kind: "book", bookKey: keyOf(3), rating: 4 },
    { kind: "add", book: neuromancer }
  ];
  for (const change of changes) {
    const { db, service } = setup();
    const saved = service.saveLibrary("u1", changeLibrary());
    const previous = service.getLibrary("u1")!.data as LibraryData;

    const answer = service.applyChange("u1", change);

    const stored = service.getLibrary("u1")!;
    assert.deepEqual(answer, { updatedAt: stored.updatedAt, baseUpdatedAt: saved.updatedAt });
    assert.notEqual(answer.updatedAt, saved.updatedAt);
    const expected = applyLibraryChange(previous, change);
    assert.ok("data" in expected && expected.changed);
    assert.deepEqual(normalized(stored.data, previous), normalized(JSON.parse(JSON.stringify(expected.data)), previous));
    db.close();
  }
});

test("a membership or book change that alters nothing, or is sent twice, writes once", () => {
  const { db, repo, service } = setup();
  const saved = service.saveLibrary("u1", changeLibrary());
  const updates = mock.method(repo, "updateDocumentData");
  const upserts = mock.method(repo, "upsertDocument");
  const noOps: LibraryChange[] = [
    { kind: "membership", groupId: "saga", bookKey: keyOf(0), member: true },
    { kind: "membership", groupId: "shelf", bookKey: keyOf(0), member: false },
    { kind: "book", bookKey: keyOf(0), readStatus: 2, day: "2026-10-02" },
    { kind: "book", bookKey: keyOf(5), rating: 3 }
  ];
  for (const change of noOps) {
    assert.deepEqual(service.applyChange("u1", change), { updatedAt: saved.updatedAt, baseUpdatedAt: saved.updatedAt });
  }
  assert.equal(updates.mock.callCount(), 0);
  assert.equal(service.getLibrary("u1")?.updatedAt, saved.updatedAt);

  const tick: LibraryChange = { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true };
  const first = service.applyChange("u1", tick);
  const again = service.applyChange("u1", tick);
  assert.deepEqual(again, { updatedAt: first.updatedAt, baseUpdatedAt: first.updatedAt });
  assert.equal(updates.mock.callCount(), 1);
  assert.equal(upserts.mock.callCount(), 0);
  db.close();
});

test("membership and book changes leave the match keys alone, and an add rebuilds them", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", changeLibrary());
  db.prepare(`DELETE FROM library_match_keys WHERE user_id = 'u1' AND key = ?`).run("ta:book 7|author 7");
  const before = keyRows(db, "u1");
  assert.equal(before.length, 10);

  service.applyChange("u1", { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true });
  service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" });
  service.applyChange("u1", { kind: "book", bookKey: keyOf(3), rating: 5 });
  assert.deepEqual(keyRows(db, "u1"), before);

  service.applyChange("u1", { kind: "add", book: neuromancer });
  const after = keyRows(db, "u1");
  assert.equal(after.length, 13);
  assert.deepEqual(after.filter((row) => row.book_ref === 7).map((row) => row.key), ["ta:book 7|author 7"]);
  assert.deepEqual(after.filter((row) => row.book_ref === 11).map((row) => row.key), ["isbn:9780441569595", "ta:neuromancer|william gibson"]);
  db.close();
});

test("a membership change recomputes the glyph in a series group and keeps it in a collection, and the derived version moves with the document", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", changeLibrary());
  assert.equal(storedGlyph(db, "u1"), "carto");
  const tamper = () => db.prepare(`UPDATE library_derived SET glyph = 'star' WHERE user_id = 'u1'`).run();

  tamper();
  const kept = service.applyChange("u1", { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true });
  assert.equal(storedGlyph(db, "u1"), "star");
  assert.equal(derivedSource(db, "u1"), kept.updatedAt);

  const leaving = service.applyChange("u1", { kind: "membership", groupId: "saga", bookKey: keyOf(0), member: false });
  assert.equal(storedGlyph(db, "u1"), null);
  assert.equal(derivedSource(db, "u1"), leaving.updatedAt);

  tamper();
  const joining = service.applyChange("u1", { kind: "membership", groupId: "saga", bookKey: keyOf(3), member: true });
  assert.equal(storedGlyph(db, "u1"), "carto");
  assert.equal(derivedSource(db, "u1"), joining.updatedAt);
  db.close();
});

test("a status moving to or from Finished recomputes the glyph, and any other change to a book keeps it", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", changeLibrary());
  const tamper = () => db.prepare(`UPDATE library_derived SET glyph = 'star' WHERE user_id = 'u1'`).run();

  tamper();
  service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 0 });
  service.applyChange("u1", { kind: "book", bookKey: keyOf(3), rating: 4 });
  assert.equal(storedGlyph(db, "u1"), "star");

  const reaching = service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" });
  assert.equal(storedGlyph(db, "u1"), null);
  assert.equal(derivedSource(db, "u1"), reaching.updatedAt);

  tamper();
  const leaving = service.applyChange("u1", { kind: "book", bookKey: keyOf(5), readStatus: 1 });
  assert.equal(storedGlyph(db, "u1"), "carto");
  assert.equal(derivedSource(db, "u1"), leaving.updatedAt);
  db.close();
});

test("after a change the boot backfill re-derives nothing", () => {
  fileService.saveLibrary("change-fresh", changeLibrary());
  fileService.applyChange("change-fresh", { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true });
  fileService.applyChange("change-fresh", { kind: "membership", groupId: "saga", bookKey: keyOf(0), member: false });
  fileService.applyChange("change-fresh", { kind: "book", bookKey: keyOf(3), rating: 5 });
  assert.ok(!createSqliteLibraryRepository(fileDb).listStaleUserIds().includes("change-fresh"));
  fileDb.prepare(`UPDATE library_derived SET glyph = 'star' WHERE user_id = 'change-fresh'`).run();
  fileDb.prepare(`DELETE FROM library_match_keys WHERE user_id = 'change-fresh' AND key LIKE 'ta:book 1|%'`).run();
  const keys = keyRows(fileDb, "change-fresh");

  backfillLibraryDerived();
  backfillLibraryDerived();

  assert.equal(storedGlyph(fileDb, "change-fresh"), "star");
  assert.deepEqual(keyRows(fileDb, "change-fresh"), keys);
  assert.equal(derivedSource(fileDb, "change-fresh"), fileService.getLibrary("change-fresh")?.updatedAt);
});

test("a change to a library whose derived rows were already stale leaves them stale for the backfill", () => {
  fileService.saveLibrary("change-stale", changeLibrary());
  fileDb.prepare(`UPDATE library_derived SET glyph = 'star', source_updated_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'change-stale'`).run();
  const keys = keyRows(fileDb, "change-stale");

  fileService.applyChange("change-stale", { kind: "membership", groupId: "saga", bookKey: keyOf(0), member: false });
  fileService.applyChange("change-stale", { kind: "book", bookKey: keyOf(3), rating: 4 });

  assert.equal(derivedSource(fileDb, "change-stale"), "2000-01-01T00:00:00.000Z");
  assert.equal(storedGlyph(fileDb, "change-stale"), "star");
  assert.deepEqual(keyRows(fileDb, "change-stale"), keys);

  backfillLibraryDerived();

  assert.equal(derivedSource(fileDb, "change-stale"), fileService.getLibrary("change-stale")?.updatedAt);
  assert.equal(storedGlyph(fileDb, "change-stale"), null);
});

test("applyChange emits book_finished for a status that reaches Finished and nothing for any other change", () => {
  const { db, service, events } = setup();
  service.saveLibrary("u1", changeLibrary());
  events.length = 0;

  service.applyChange("u1", { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true });
  service.applyChange("u1", { kind: "book", bookKey: keyOf(3), rating: 4 });
  service.applyChange("u1", { kind: "book", bookKey: keyOf(5), readStatus: 1 });
  service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 0 });
  service.applyChange("u1", { kind: "book", bookKey: keyOf(0), readStatus: 2, day: "2026-10-02" });
  assert.deepEqual(events, []);

  service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" });
  assert.deepEqual(events, [
    { userId: "u1", type: "book_finished", refId: "k10", payload: { title: "Book 10", author: "Author 10", isbn: null, coverUrl: null, status: 2, workId: null } }
  ]);
  db.close();
});

test("applyChange parses the stored document once, whatever it emits", () => {
  const { db, service, events } = setup();
  service.saveLibrary("u1", changeLibrary());
  const parse = mock.method(JSON, "parse");
  try {
    service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" });
    assert.equal(events.length, 1);
    assert.equal(parse.mock.callCount(), 1);
    service.applyChange("u1", { kind: "add", book: neuromancer });
    assert.equal(events.length, 2);
    assert.equal(parse.mock.callCount(), 2);
  } finally {
    parse.mock.restore();
  }
  db.close();
});

test("applyChange emits book_added for an add, the first add of a new account included", () => {
  const { db, service, events } = setup();

  const first = service.applyChange("u1", { kind: "add", book: neuromancer });
  assert.equal(first.baseUpdatedAt, null);
  assert.deepEqual(events.map(({ type, refId }) => ({ type, refId })), [{ type: "book_added", refId: "manual:n" }]);
  assert.equal(events[0]?.payload.title, "Neuromancer");
  events.length = 0;

  service.applyChange("u1", { kind: "add", book: { ContentID: "manual:e", Title: "Emma", Attribution: "Jane Austen", ReadStatus: 0 } });
  assert.deepEqual(events.map(({ type, refId }) => ({ type, refId })), [{ type: "book_added", refId: "manual:e" }]);
  db.close();
});

test("a status change that finishes many books at once emits at most 10 events, the first ones in document order", () => {
  const { db, service, events } = setup();
  const twins = Array.from({ length: 12 }, (_, i) => ({ ContentID: `t${i}`, Title: "Twin", Attribution: "Same Author", ReadStatus: 0 }));
  service.saveLibrary("u1", { books: twins });
  events.length = 0;

  service.applyChange("u1", { kind: "book", bookKey: bookKey(twins[0]!), readStatus: 2, day: "2026-10-02" });

  assert.deepEqual(events.map((event) => event.refId), twins.slice(0, 10).map((book) => book.ContentID));
  db.close();
});

test("a failing event emitter does not fail a change that was written", () => {
  const db = memoryDb();
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", MAX_DOCUMENT_BYTES, () => {
    throw new Error("community db locked");
  });
  service.saveLibrary("u1", changeLibrary());

  const answer = service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" });

  assert.equal(service.getLibrary("u1")?.updatedAt, answer.updatedAt);
  assert.equal((booksOf(service, "u1")[10] as Book).ReadStatus, 2);
  db.close();
});

test("a failing event emitter is logged and the change still saves", () => {
  const db = memoryDb();
  const logged: unknown[] = [];
  const failure = new Error("community db locked");
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", MAX_DOCUMENT_BYTES, () => {
    throw failure;
  }, undefined, undefined, (error) => { logged.push(error); });
  service.saveLibrary("u1", changeLibrary());

  const answer = service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" });

  assert.equal(service.getLibrary("u1")?.updatedAt, answer.updatedAt);
  assert.deepEqual(logged, [failure]);
  db.close();
});

test("applyChange answers a missing library, group or book with a typed error and writes nothing", () => {
  const { db, service, events } = setup();
  const tick: LibraryChange = { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true };
  assert.throws(() => service.applyChange("nobody", tick), NoLibraryDocumentError);
  assert.throws(() => service.applyChange("nobody", { kind: "book", bookKey: keyOf(3), rating: 4 }), NoLibraryDocumentError);
  assert.equal(service.getLibrary("nobody"), null);

  const saved = service.saveLibrary("u1", changeLibrary());
  const rejectedAs = (reason: "no-group" | "no-book") => (error: unknown) => error instanceof LibraryChangeNotFoundError && error.reason === reason;
  const unknownGroup: LibraryChange = { kind: "membership", groupId: "gone", bookKey: keyOf(3), member: true };
  const unknownBookInGroup: LibraryChange = { kind: "membership", groupId: "shelf", bookKey: "ta:nobody|", member: true };
  const unknownBook: LibraryChange = { kind: "book", bookKey: "ta:nobody|", readStatus: 2, day: "2026-10-02" };
  assert.throws(() => service.applyChange("u1", unknownGroup), rejectedAs("no-group"));
  assert.throws(() => service.applyChange("u1", unknownBookInGroup), rejectedAs("no-book"));
  assert.throws(() => service.applyChange("u1", unknownBook), rejectedAs("no-book"));

  assert.equal(service.getLibrary("u1")?.updatedAt, saved.updatedAt);
  assert.deepEqual(events, []);
  db.close();
});

test("a key with no book can still be taken out of a group", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", { books: [owned(0)], groups: [groupOf("shelf", "collection", ["ta:removed|"])] });

  service.applyChange("u1", { kind: "membership", groupId: "shelf", bookKey: "ta:removed|", member: false });

  assert.deepEqual((service.getLibrary("u1")?.data as { groups: Array<{ bookKeys: string[] }> }).groups[0]?.bookKeys, []);
  db.close();
});

test("a first add creates the library, answering with no base version", () => {
  const { db, service } = setup();
  const answer = service.applyChange("u1", { kind: "add", book: neuromancer });
  assert.equal(answer.baseUpdatedAt, null);
  assert.equal(service.getLibrary("u1")?.updatedAt, answer.updatedAt);
  assert.deepEqual(booksOf(service, "u1").map((book) => book.Title), ["Neuromancer"]);
  assert.equal(storedGlyph(db, "u1"), null);
  assert.deepEqual(keyRows(db, "u1").map((row) => row.key), ["isbn:9780441569595", "ta:neuromancer|william gibson"]);
  db.close();
});

test("applyChange refuses a stored document it cannot read and leaves it alone", () => {
  const { db, repo, service } = setup();
  ["not json", "[]", "{}", '{"books":5}', "null"].forEach((stored, i) => {
    const userId = `unreadable-${i}`;
    repo.upsertDocument(userId, stored, { glyph: null, keys: [] }, emptyRows);
    assert.throws(() => service.applyChange(userId, { kind: "add", book: neuromancer }), /unreadable/);
    assert.throws(() => service.applyChange(userId, { kind: "book", bookKey: keyOf(3), rating: 4 }), /unreadable/);
    assert.equal(repo.getDocument(userId)?.data, stored);
  });
  db.close();
});

test("applyChange refuses a change that grows the document past the limit minus the PUT headroom, but not one that changes nothing", () => {
  const base = changeLibrary();
  const { db, service, events } = setup(Buffer.byteLength(JSON.stringify(base)) + LIBRARY_PUT_HEADROOM_BYTES);
  const saved = service.saveLibrary("u1", base);

  assert.throws(() => service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" }), LibraryTooLargeError);
  assert.throws(() => service.applyChange("u1", { kind: "add", book: neuromancer }), LibraryTooLargeError);
  assert.deepEqual(service.getLibrary("u1")?.data, base);
  assert.equal(service.getLibrary("u1")?.updatedAt, saved.updatedAt);
  assert.deepEqual(events, []);

  assert.deepEqual(service.applyChange("u1", { kind: "book", bookKey: keyOf(0), readStatus: 2, day: "2026-10-02" }), { updatedAt: saved.updatedAt, baseUpdatedAt: saved.updatedAt });
  db.close();
});

test("a change whose write loses to another version is a conflict, and emits nothing", () => {
  const { db, repo, events } = setup();
  const losing = createLibraryService({ ...repo, updateDocumentData: () => undefined, upsertDocument: () => undefined }, () => "", MAX_DOCUMENT_BYTES, (userId, batch) => {
    events.push(...batch.map((event) => ({ userId, ...event })));
  });
  const real = createLibraryService(repo, () => "", MAX_DOCUMENT_BYTES);
  real.saveLibrary("u1", changeLibrary());

  assert.throws(() => losing.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" }), LibraryConflictError);
  assert.throws(() => losing.applyChange("u1", { kind: "add", book: neuromancer }), LibraryConflictError);
  assert.throws(() => losing.applyChange("u2", { kind: "add", book: neuromancer }), LibraryConflictError);
  assert.deepEqual(events, []);
  db.close();
});

test("applyChange passes malformed stored groups through untouched", () => {
  const { db, service } = setup();
  const odd: unknown[] = [
    null,
    7,
    "group",
    { id: "shelf", type: "collection", bookKeys: [] },
    { id: "shelf", type: "series", name: "Bad keys", bookKeys: "ta:book 3|author 3" },
    { id: "shelf", type: "series", name: 5, bookKeys: [] },
    { id: "shelf", type: "series", name: "No keys" },
    { id: "shelf", type: "series", name: "Null keys", bookKeys: null },
    { id: "shelf", type: "series", bookKeys: [keyOf(0), keyOf(1), keyOf(2)] }
  ];
  const library = { books: changeLibrary().books, groups: [...odd, groupOf("shelf", "collection")] };
  service.saveLibrary("u1", library);
  const groupsOf = () => (service.getLibrary("u1")!.data as { groups: unknown[] }).groups;

  service.applyChange("u1", { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true });
  service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" });
  service.applyChange("u1", { kind: "add", book: neuromancer });

  assert.deepEqual(groupsOf().slice(0, odd.length), odd);
  assert.deepEqual((groupsOf()[odd.length] as { bookKeys: string[] }).bookKeys, [keyOf(3)]);
  assert.equal(groupsOf().length, odd.length + 2);
  assert.equal(storedGlyph(db, "u1"), null);
  assert.throws(() => service.applyChange("u1", { kind: "membership", groupId: "gone", bookKey: keyOf(3), member: true }), LibraryChangeNotFoundError);
  db.close();
});

test("applyChange passes non-record entries in books through untouched", () => {
  const { db, service } = setup();
  const junk: unknown[] = [null, 7, "book"];
  service.saveLibrary("u1", { books: [...junk, ...changeLibrary().books], groups: [groupOf("shelf", "collection")] });
  const storedBooks = () => (service.getLibrary("u1")!.data as { books: unknown[] }).books;

  service.applyChange("u1", { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true });
  service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" });
  assert.deepEqual(storedBooks().slice(0, junk.length), junk);
  service.applyChange("u1", { kind: "add", book: neuromancer });
  assert.equal(storedBooks().filter((book) => book === null || typeof book !== "object").length, junk.length);
  assert.ok(storedBooks().some((book) => (book as { Title?: string } | null)?.Title === neuromancer.Title));
  db.close();
});

test("applyChange passes a groups that is not an array through untouched", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", { books: changeLibrary().books, groups: "shelf" });
  const storedGroups = () => (service.getLibrary("u1")!.data as { groups: unknown }).groups;

  assert.throws(() => service.applyChange("u1", { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true }), LibraryChangeNotFoundError);
  service.applyChange("u1", { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" });
  service.applyChange("u1", { kind: "add", book: neuromancer });
  assert.equal(storedGroups(), "shelf");
  db.close();
});

test("deriveGlyph gives the glyph deriveLibraryData stores, for a library of any shape", () => {
  const settled = changeLibrary();
  const leaning = { books: shelf(11), groups: [seriesGroup(shelf(11).slice(0, 3))] };
  const unkeyed = { id: "g2", type: "series", name: "No keys" };
  const nameless = { id: "g3", type: "series", bookKeys: shelf(10).map(bookKey) };
  const odd = { books: [null, 7, ...shelf(10)], groups: [null, { name: 5 }, unkeyed, nameless, seriesGroup(shelf(10).slice(0, 3))] };
  const unnamed = { books: shelf(10), groups: [nameless] };
  const numbered = { books: shelf(10).map((book) => ({ ...book, Attribution: 7 })) };
  const libraries: unknown[] = [settled, leaning, odd, unnamed, numbered, { books: shelf(3), groups: [] }, { books: [] }, { books: "none" }, {}, [], null, "text", 7];
  for (const library of libraries) assert.equal(deriveGlyph(library), deriveLibraryData(library).glyph);
  assert.equal(deriveGlyph(settled), "carto");
  assert.equal(deriveGlyph(leaning), null);
  assert.equal(deriveGlyph(odd), "carto");
  assert.equal(deriveGlyph(unnamed), null);
  assert.equal(deriveGlyph(numbered), null);
});

const derivedRow = (db: DatabaseSync, userId: string) => {
  const row = db.prepare(`SELECT glyph, source_updated_at FROM library_derived WHERE user_id = ?`).get(userId) as { glyph: string | null; source_updated_at: string } | undefined;
  return row && { ...row };
};

test("updateDocumentData stores the data under a new version after the one it was given", () => {
  const { db, repo } = setup();
  const first = repo.upsertDocument("u1", JSON.stringify({ books: [] }), { glyph: null, keys: [] }, emptyRows)!;

  const second = repo.updateDocumentData("u1", JSON.stringify({ books: ["next"] }), first.updated_at, "keep", keepRows)!;
  assert.ok(second > first.updated_at);
  assert.deepEqual({ ...repo.getDocument("u1") }, { user_id: "u1", data: JSON.stringify({ books: ["next"] }), updated_at: second, share_token: null });

  const future = "2099-01-01T00:00:00.000Z";
  db.prepare(`UPDATE library_documents SET updated_at = ? WHERE user_id = 'u1'`).run(future);
  assert.equal(repo.updateDocumentData("u1", JSON.stringify({ books: [] }), future, "keep", keepRows), "2099-01-01T00:00:00.001Z");
  db.close();
});

test("updateDocumentData with the wrong version, or no document, changes nothing", () => {
  const { db, repo } = setup();
  const row = { key: "ta:a|b", book_ref: 0, title: "A", author: "B", isbn: null, cover: null };
  const first = repo.upsertDocument("u1", JSON.stringify({ books: [] }), { glyph: "star", keys: [row] }, emptyRows)!;
  const second = repo.updateDocumentData("u1", JSON.stringify({ books: ["second"] }), first.updated_at, "keep", keepRows)!;

  assert.equal(repo.updateDocumentData("u1", JSON.stringify({ books: ["stale"] }), first.updated_at, null, keepRows), undefined);
  assert.equal(repo.updateDocumentData("u1", JSON.stringify({ books: ["none"] }), "2000-01-01T00:00:00.000Z", "keep", keepRows), undefined);
  assert.equal(repo.updateDocumentData("nobody", JSON.stringify({ books: [] }), second, null, keepRows), undefined);

  assert.equal(repo.getDocument("u1")?.data, JSON.stringify({ books: ["second"] }));
  assert.equal(repo.getDocument("u1")?.updated_at, second);
  assert.deepEqual(derivedRow(db, "u1"), { glyph: "star", source_updated_at: second });
  assert.equal(repo.getDocument("nobody"), undefined);
  assert.equal(derivedRow(db, "nobody"), undefined);
  db.close();
});

test("updateDocumentData with a glyph writes it where the derived row was current, and leaves a stale or missing row alone", () => {
  const { db, repo } = setup();
  const first = repo.upsertDocument("u1", JSON.stringify({ books: [] }), { glyph: "star", keys: [] }, emptyRows)!;

  const second = repo.updateDocumentData("u1", JSON.stringify({ books: [1] }), first.updated_at, "carto", keepRows)!;
  assert.deepEqual(derivedRow(db, "u1"), { glyph: "carto", source_updated_at: second });
  const third = repo.updateDocumentData("u1", JSON.stringify({ books: [2] }), second, null, keepRows)!;
  assert.deepEqual(derivedRow(db, "u1"), { glyph: null, source_updated_at: third });

  db.prepare(`UPDATE library_derived SET glyph = 'star', source_updated_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'u1'`).run();
  repo.updateDocumentData("u1", JSON.stringify({ books: [3] }), third, "carto", keepRows);
  assert.deepEqual(derivedRow(db, "u1"), { glyph: "star", source_updated_at: "2000-01-01T00:00:00.000Z" });

  db.prepare(`DELETE FROM library_derived WHERE user_id = 'u1'`).run();
  repo.updateDocumentData("u1", JSON.stringify({ books: [4] }), repo.getDocument("u1")!.updated_at, "carto", keepRows);
  assert.equal(derivedRow(db, "u1"), undefined);
  db.close();
});

test("updateDocumentData with keep moves the derived version only where it was current, and never touches the glyph", () => {
  const { db, repo } = setup();
  const first = repo.upsertDocument("u1", JSON.stringify({ books: [] }), { glyph: "star", keys: [] }, emptyRows)!;

  const second = repo.updateDocumentData("u1", JSON.stringify({ books: [1] }), first.updated_at, "keep", keepRows)!;
  assert.deepEqual(derivedRow(db, "u1"), { glyph: "star", source_updated_at: second });

  db.prepare(`UPDATE library_derived SET source_updated_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'u1'`).run();
  repo.updateDocumentData("u1", JSON.stringify({ books: [2] }), second, "keep", keepRows);
  assert.deepEqual(derivedRow(db, "u1"), { glyph: "star", source_updated_at: "2000-01-01T00:00:00.000Z" });
  db.close();
});

test("updateDocumentData never touches the match keys or the share token", () => {
  const { db, repo } = setup();
  const keys = [
    { key: "ta:a|b", book_ref: 0, title: "A", author: "B", isbn: null, cover: null },
    { key: "isbn:9780441013593", book_ref: 1, title: "C", author: "D", isbn: "9780441013593", cover: "https://covers.test/c.jpg" }
  ];
  const first = repo.upsertDocument("u1", JSON.stringify({ books: [] }), { glyph: null, keys }, emptyRows)!;
  repo.setShareToken("u1", "token-1");
  const before = keyRows(db, "u1");

  const second = repo.updateDocumentData("u1", JSON.stringify({ books: ["changed"] }), first.updated_at, "carto", keepRows)!;
  repo.updateDocumentData("u1", JSON.stringify({ books: ["again"] }), second, "keep", keepRows);

  assert.deepEqual(keyRows(db, "u1"), before);
  assert.equal(repo.getDocument("u1")?.share_token, "token-1");
  db.close();
});

test("a row rewrite with no work id keeps the stored one for the same book", () => {
  const { db, service } = setup();
  const saved = service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" }] });
  db.prepare("UPDATE library_books SET work_id = 'w-dune' WHERE user_id = 'u1'").run();
  service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 }] }, saved.updatedAt);
  assert.equal((db.prepare("SELECT work_id FROM library_books WHERE user_id = 'u1'").get() as { work_id: string | null }).work_id, "w-dune");
});

test("a different book at the same position does not inherit the work id", () => {
  const { db, service } = setup();
  const saved = service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" }] });
  db.prepare("UPDATE library_books SET work_id = 'w-dune' WHERE user_id = 'u1'").run();
  service.saveLibrary("u1", { books: [{ Title: "Orlando", Attribution: "Virginia Woolf" }] }, saved.updatedAt);
  assert.equal((db.prepare("SELECT work_id FROM library_books WHERE user_id = 'u1'").get() as { work_id: string | null }).work_id, null);
});

test("an existing database gains library_books.work_id", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE library_books (user_id TEXT NOT NULL, position INTEGER NOT NULL, book_key TEXT NOT NULL, title TEXT, author TEXT, isbn TEXT, image_id TEXT, read_status REAL, series_number REAL, sort_order REAL, cover_url TEXT, finished_year INTEGER, row_hash TEXT NOT NULL, PRIMARY KEY (user_id, position))");
  applyLibrarySchema(db);
  const columns = (db.prepare("PRAGMA table_info(library_books)").all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(columns.includes("work_id"));
});

const rowsInDb = (db: DatabaseSync, userId: string) => ({
  books: (db.prepare(`SELECT position, book_key, title, author, isbn, image_id, read_status, series_number, sort_order, cover_url, finished_year, work_id, row_hash FROM library_books WHERE user_id = ? ORDER BY position`).all(userId) as Array<Record<string, unknown>>).map((row) => ({ ...row })),
  highlights: (db.prepare(`SELECT position, highlight_id, text, annotation FROM library_highlights WHERE user_id = ? ORDER BY position, highlight_id`).all(userId) as Array<Record<string, unknown>>).map((row) => ({ ...row })),
  summary: { ...(db.prepare(`SELECT meta, reader_card, shelf_theme, total_books, finished_count, in_progress_count, total_highlights, source_updated_at FROM library_summary WHERE user_id = ?`).get(userId) as Record<string, unknown> | undefined) }
});

function rowsOfStored(db: DatabaseSync, userId: string) {
  const stored = db.prepare(`SELECT data, updated_at FROM library_documents WHERE user_id = ?`).get(userId) as { data: string; updated_at: string };
  const derived = deriveLibraryRows(JSON.parse(stored.data), () => undefined);
  return {
    books: derived.books.map((rows) => ({ ...rows.book })),
    highlights: derived.books.flatMap((rows) => rows.highlights.map((highlight) => ({ position: rows.book.position, ...highlight }))).sort((a, b) => a.position - b.position || (a.highlight_id < b.highlight_id ? -1 : 1)),
    summary: { ...derived.summary, source_updated_at: stored.updated_at }
  };
}

function trackRowWrites(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE row_writes (kind TEXT, position INTEGER);
    CREATE TRIGGER track_books AFTER INSERT ON library_books BEGIN INSERT INTO row_writes VALUES ('book', NEW.position); END;
    CREATE TRIGGER track_book_updates AFTER UPDATE ON library_books BEGIN INSERT INTO row_writes VALUES ('book', NEW.position); END;
    CREATE TRIGGER track_highlights AFTER INSERT ON library_highlights BEGIN INSERT INTO row_writes VALUES ('highlight', NEW.position); END;
  `);
  return () => {
    const writes = (db.prepare(`SELECT kind, position FROM row_writes ORDER BY kind, position`).all() as Array<{ kind: string; position: number }>).map((row) => `${row.kind}:${row.position}`);
    db.exec(`DELETE FROM row_writes`);
    return writes;
  };
}

const marked = (title: string, ids: unknown[]): Book => ({ Title: title, Attribution: "Writer", highlights: ids.map((id, i) => ({ BookmarkID: id, Text: `${title} ${i}` })) });

test("rows match the stored document after a save, an edit, a reorder, a deletion and a merge, and an edit writes only its own rows", () => {
  const { db, service } = setup();
  const takeWrites = trackRowWrites(db);
  const a = marked("Alpha", ["a1", "a2"]);
  const b = marked("Beta", ["b1"]);
  const c = marked("Gamma", ["c1", "c2", "c3"]);
  let saved = service.saveLibrary("u1", { name: "Mine", books: [a, b, c] });
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));
  assert.equal(rowsInDb(db, "u1").books.length, 3);
  takeWrites();

  saved = service.saveLibrary("u1", { name: "Mine", books: [a, { ...b, ReadStatus: 2 }, c] }, saved.updatedAt);
  assert.deepEqual(takeWrites(), ["book:1", "highlight:1"]);
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));

  saved = service.saveLibrary("u1", { name: "Mine", books: [c, a, { ...b, ReadStatus: 2 }] }, saved.updatedAt);
  assert.deepEqual(takeWrites(), ["book:0", "book:1", "book:2", "highlight:0", "highlight:0", "highlight:0", "highlight:1", "highlight:1", "highlight:2"]);
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));

  saved = service.saveLibrary("u1", { name: "Mine", books: [c, a] }, saved.updatedAt);
  assert.deepEqual(takeWrites(), []);
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));
  assert.equal(rowsInDb(db, "u1").books.length, 2);
  assert.ok(!rowsInDb(db, "u1").highlights.some((highlight) => highlight.position === 2));

  const twin = { ...a, ISBN: "9780441013593" };
  saved = service.saveLibrary("u1", { books: [dune(), twin, { Title: "Other", Attribution: "Writer" }] }, saved.updatedAt);
  takeWrites();
  const merged = service.mergeBooks("u1", bookKey(dune()), [bookKey(twin)], saved.updatedAt);
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));
  assert.equal(rowsInDb(db, "u1").summary.source_updated_at, merged.updatedAt);
  db.close();
});

test("an unchanged save writes no book or highlight rows but still moves the summary to the new version", () => {
  const { db, service } = setup();
  const takeWrites = trackRowWrites(db);
  const books = [marked("Alpha", ["a1"]), marked("Beta", ["b1"])];
  const first = service.saveLibrary("u1", { books });
  takeWrites();
  const second = service.saveLibrary("u1", { books }, first.updatedAt);

  assert.deepEqual(takeWrites(), []);
  assert.equal(rowsInDb(db, "u1").summary.source_updated_at, second.updatedAt);
  db.close();
});

test("addBook and an applyChange add keep the rows in step", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", { books: [dune({ ContentID: "k1", ReadStatus: 0 })] });
  service.addBook("u1", { title: "Emma", author: "Jane Austen", readStatus: 1 });
  service.addBook("u1", { title: "Dune", author: "Frank Herbert", isbn: "9780441013593", readStatus: 2, day: "2024-03-02" });
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));
  service.applyChange("u1", { kind: "add", book: { ...emma, Title: "Persuasion", ISBN: "" } });
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));
  assert.equal(rowsInDb(db, "u1").books.length, 3);
  db.close();
});

test("duplicate and missing BookmarkIDs do not fail a save, the first duplicate wins and a missing id is the string undefined", () => {
  const { db, service } = setup();
  const book = {
    Title: "Alpha",
    Attribution: "Writer",
    highlights: [{ BookmarkID: "h1", Text: "first" }, { BookmarkID: "h1", Text: "second" }, { Text: "no id" }, "not an object", { BookmarkID: 7, Text: 5, Annotation: "note" }]
  };
  service.saveLibrary("u1", { books: [book] });

  assert.deepEqual(rowsInDb(db, "u1").highlights, [
    { position: 0, highlight_id: "7", text: null, annotation: "note" },
    { position: 0, highlight_id: "h1", text: "first", annotation: null },
    { position: 0, highlight_id: "undefined", text: "no id", annotation: null }
  ]);
  assert.equal(rowsInDb(db, "u1").summary.total_highlights, 5);
  db.close();
});

test("typed columns hold a value only when its type matches, as numbers, and a position skips a non-object entry", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", {
    books: [
      { Title: "Alpha", Attribution: "Writer", ReadStatus: "2", SeriesNumber: "1", _order: 2 ** 60, ISBN: 9780441013593, ImageId: "img", _coverUrl: "" },
      "not an object",
      { Title: 5, ReadStatus: 2, DateLastRead: "2021-06-01T12:00:00Z", _coverUrl: "https://c/x.jpg" }
    ]
  });

  const { books } = rowsInDb(db, "u1");
  assert.deepEqual(books.map((row) => row.position), [0, 2]);
  assert.deepEqual([books[0]!.read_status, books[0]!.series_number, books[0]!.isbn, books[0]!.image_id, books[0]!.cover_url, books[0]!.finished_year], [null, null, null, "img", "", null]);
  assert.equal(books[0]!.sort_order, 2 ** 60);
  assert.equal(books[0]!.book_key, "isbn:9780441013593");
  assert.deepEqual([books[1]!.title, books[1]!.read_status, books[1]!.cover_url, books[1]!.finished_year], [null, 2, "https://c/x.jpg", 2021]);
  assert.deepEqual({ ...rowsInDb(db, "u1").summary, meta: undefined, source_updated_at: undefined, reader_card: undefined, shelf_theme: undefined }, { meta: undefined, reader_card: undefined, shelf_theme: undefined, total_books: 2, finished_count: 1, in_progress_count: 0, total_highlights: 0, source_updated_at: undefined });
  db.close();
});

test("the summary keeps the document's own fields in meta", () => {
  const { db, service } = setup();
  const groups = [seriesGroup([dune()])];
  service.saveLibrary("u1", { source: "kobo", schema_version: 2, book_count: 9, name: "Mine", groups, style: { accent: "red" }, books: [dune(), "x"], murals: [{ id: "m" }] });

  assert.deepEqual(JSON.parse(rowsInDb(db, "u1").summary.meta as string), { source: "kobo", schema_version: 2, book_count: 9, name: "Mine", groups, style: { accent: "red" } });
  db.close();
});

test("a document written without touching the new tables is rebuilt by the next startup", () => {
  const books = [dune({ ReadStatus: 2, highlights: [{ BookmarkID: "h", Text: "quote" }] }), emma];
  fileService.saveLibrary("rolled-back", { books });
  rawDocument("rolled-back", JSON.stringify({ name: "Edited elsewhere", books: [emma] }), "2099-02-01T00:00:00.000Z");
  const repo = createSqliteLibraryRepository(fileDb);
  assert.ok(repo.listStaleUserIds().includes("rolled-back"));
  repo.setDerived("rolled-back", deriveLibraryData({ books: [emma] }), "2099-02-01T00:00:00.000Z");
  assert.equal(derivedSource(fileDb, "rolled-back"), "2099-02-01T00:00:00.000Z");
  assert.notEqual(rowsInDb(fileDb, "rolled-back").summary.source_updated_at, "2099-02-01T00:00:00.000Z");
  assert.ok(repo.listStaleUserIds().includes("rolled-back"));

  backfillLibraryDerived();

  assert.deepEqual(rowsInDb(fileDb, "rolled-back"), rowsOfStored(fileDb, "rolled-back"));
  assert.deepEqual(rowsInDb(fileDb, "rolled-back").books.map((row) => row.title), ["Emma"]);
  assert.deepEqual(rowsInDb(fileDb, "rolled-back").highlights, []);
  assert.ok(!repo.listStaleUserIds().includes("rolled-back"));
});

test("an unreadable document's rebuild leaves a NULL meta and no rows", () => {
  const logged = mock.method(console, "error", () => undefined);
  try {
    fileService.saveLibrary("unreadable-rows", { books: [dune({ highlights: [{ BookmarkID: "h", Text: "quote" }] })] });
    assert.equal(rowsInDb(fileDb, "unreadable-rows").books.length, 1);
    rawDocument("unreadable-rows", "not json", "2099-03-01T00:00:00.000Z");
    rawDocument("shapeless-rows", JSON.stringify({ name: "no books" }));

    backfillLibraryDerived();

    for (const userId of ["unreadable-rows", "shapeless-rows"]) {
      const rows = rowsInDb(fileDb, userId);
      assert.equal(rows.summary.meta, null);
      assert.equal(rows.summary.total_books, 0);
      assert.deepEqual([rows.books, rows.highlights], [[], []]);
    }
    assert.equal(rowsInDb(fileDb, "unreadable-rows").summary.source_updated_at, "2099-03-01T00:00:00.000Z");
  } finally {
    logged.mock.restore();
  }
});

test("deleting an account or cleaning up orphans clears every row table, with or without a derived row", () => {
  const { db, repo, service } = setup();
  const keep = marked("Keep", ["k"]);
  service.saveLibrary("gone", { books: [marked("Gone", ["g"])] });
  service.saveLibrary("orphaned", { books: [marked("Orphan", ["o"])] });
  service.saveLibrary("kept", { books: [keep] });

  repo.deleteUserData("gone");
  db.prepare(`DELETE FROM library_documents WHERE user_id = 'orphaned'`).run();
  db.prepare(`DELETE FROM library_derived WHERE user_id = 'orphaned'`).run();
  repo.deleteOrphanedDerived();

  for (const userId of ["gone", "orphaned"]) {
    assert.deepEqual(rowsInDb(db, userId), { books: [], highlights: [], summary: {} });
  }
  assert.deepEqual(rowsInDb(db, "kept"), rowsOfStored(db, "kept"));
  assert.equal(rowsInDb(db, "kept").books.length, 1);
  db.close();
});

test("a document with a value that cannot be turned into text saves, and boot rebuilds it, without a row for the bad book", () => {
  const logged = mock.method(console, "error", () => undefined);
  try {
    const odd = { Title: "Dune", Attribution: { toString: 5 }, ISBN: "9780441013593", ReadStatus: 2 };
    const badMark = { Title: "Marked", Attribution: "Writer", highlights: [{ BookmarkID: { toString: 5 }, Text: "lost" }, { BookmarkID: "ok", Text: "kept" }] };
    const noKey = { Title: "Odd", Attribution: { toString: 5 } };
    const doc = { books: [odd, noKey, badMark, emma] };
    const { db, service } = setup();
    service.saveLibrary("u1", doc);
    db.close();
    rawDocument("rows-odd", JSON.stringify(doc));
    rawDocument("rows-odd-card", JSON.stringify({ books: [...shelf(10), odd] }));

    backfillLibraryDerived();

    const rows = rowsInDb(fileDb, "rows-odd");
    assert.deepEqual(rows.books.map((row) => row.position), [0, 2, 3]);
    assert.deepEqual(rows.highlights.map((row) => row.highlight_id), ["ok"]);
    const card = rowsInDb(fileDb, "rows-odd-card");
    assert.equal(card.books.length, 11);
    assert.equal(card.summary.reader_card, null);
    assert.ok(card.summary.shelf_theme);
    assert.ok(logged.mock.callCount() >= 4);
  } finally {
    logged.mock.restore();
  }
});

function tenMiBFixture(): string {
  const filler = "x".repeat(140);
  const books = Array.from({ length: 5000 }, (_, i) => ({
    Title: `Book ${i} ${filler}`,
    Attribution: `Author ${i % 400}`,
    ReadStatus: i % 3,
    highlights: Array.from({ length: 10 }, (_, j) => ({ BookmarkID: `${i}-${j}`, Text: `Quote ${j}`, Annotation: j % 2 ? "note" : "" }))
  }));
  return JSON.stringify({ books }).padEnd(10 * 1024 * 1024 - 1024, " ");
}

test("rebuilding the 10 MiB fixture rewrites every row and logs the rebuild", () => {
  rawDocument("fixture", tenMiBFixture());
  const log = mock.method(console, "log");
  try {
    backfillLibraryDerived();
    assert.equal(rowsInDb(fileDb, "fixture").books.length, 5000);
    assert.equal(rowsInDb(fileDb, "fixture").highlights.length, 50000);
    assert.ok(log.mock.calls.some((call) => /rebuilt \d+ accounts in \d+ ms/.test(String(call.arguments[0]))));
  } finally {
    log.mock.restore();
    createSqliteLibraryRepository(fileDb).deleteUserData("fixture");
  }
});

test("a public library view of the 10 MiB fixture never parses the document and stays under its budget", () => {
  rawDocument("fixture-public", tenMiBFixture());
  backfillLibraryDerived();
  const token = fileService.share("fixture-public").shareToken!;
  const parsed = mock.method(JSON, "parse");
  try {
    const started = performance.now();
    const shared = fileService.getPublicByToken(token);
    const profile = resolvePublicLibrary("fixture-public");
    const elapsed = performance.now() - started;
    assert.equal((shared!.data as { books: unknown[] }).books.length, 5000);
    assert.equal((profile!.books as unknown[]).length, 5000);
    assert.ok(parsed.mock.calls.every((call) => String(call.arguments[0]).length < 100_000), "no call parses the document");
    assert.ok(elapsed < PUBLIC_VIEW_BUDGET_MS, `both views took ${Math.round(elapsed)} ms`);
  } finally {
    parsed.mock.restore();
    createSqliteLibraryRepository(fileDb).deleteUserData("fixture-public");
  }
});

test("a small save on a document with odd fields succeeds and keeps the rows equal to those derived from it", () => {
  const odd = { Title: 42, Attribution: "Numeric Title Author", ISBN: 9780141439587, ReadStatus: 1, highlights: [{ BookmarkID: 7, Text: 5 }, "not a highlight"] };
  const books = [...changeLibrary().books, odd, null, "not a book"];
  const { db, service } = setup();
  service.saveLibrary("u1", { books, groups: changeLibrary().groups });
  service.applyChange("u1", { kind: "book", bookKey: keyOf(3), rating: 4 });
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));
  service.applyChange("u1", { kind: "book", bookKey: keyOf(5), readStatus: 2, day: "2026-10-02" });
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));
  service.applyChange("u1", { kind: "membership", groupId: "shelf", bookKey: bookKey(odd), member: true });
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));
  assert.equal(rowsInDb(db, "u1").books.length, 12);
  db.close();
});

test("after each kind of small save the rows equal those derived from the stored document", () => {
  const settled = shelf(10);
  const cases: Array<{ doc: unknown; change: LibraryChange }> = [
    { doc: { books: settled, groups: [seriesGroup(settled.slice(0, 3))] }, change: { kind: "membership", groupId: "g1", bookKey: bookKey(settled[5]!), member: true } },
    { doc: changeLibrary(), change: { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true } },
    { doc: changeLibrary(), change: { kind: "book", bookKey: keyOf(10), readStatus: 2, day: "2026-10-02" } },
    { doc: changeLibrary(), change: { kind: "book", bookKey: keyOf(5), readStatus: 1 } },
    { doc: changeLibrary(), change: { kind: "book", bookKey: keyOf(3), rating: 4 } },
    { doc: changeLibrary(), change: { kind: "add", book: neuromancer } }
  ];
  for (const { doc, change } of cases) {
    const { db, service } = setup();
    service.saveLibrary("u1", doc);
    service.applyChange("u1", change);
    assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"), JSON.stringify(change));
    db.close();
  }
});

test("a book change rewrites only that book's row and none of its highlights", () => {
  const { db, service } = setup();
  const takeWrites = trackRowWrites(db);
  service.saveLibrary("u1", { books: [marked("Alpha", ["a1"]), marked("Beta", ["b1"]), marked("Gamma", ["g1"])] });
  takeWrites();
  service.applyChange("u1", { kind: "book", bookKey: bookKey(marked("Beta", [])), readStatus: 2, day: "2026-10-02" });
  assert.deepEqual(takeWrites(), ["book:1"]);
  assert.deepEqual(rowsInDb(db, "u1"), rowsOfStored(db, "u1"));
  db.close();
});

test("a small save on an account whose summary was stale leaves it stale, and the startup step rebuilds it", () => {
  fileService.saveLibrary("small-stale", changeLibrary());
  fileDb.prepare(`UPDATE library_summary SET source_updated_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'small-stale'`).run();
  const before = rowsInDb(fileDb, "small-stale");

  fileService.applyChange("small-stale", { kind: "book", bookKey: keyOf(3), rating: 4 });
  fileService.applyChange("small-stale", { kind: "membership", groupId: "shelf", bookKey: keyOf(3), member: true });

  assert.deepEqual(rowsInDb(fileDb, "small-stale"), before);
  assert.ok(createSqliteLibraryRepository(fileDb).listStaleUserIds().includes("small-stale"));

  backfillLibraryDerived();

  assert.deepEqual(rowsInDb(fileDb, "small-stale"), rowsOfStored(fileDb, "small-stale"));
  assert.ok(!createSqliteLibraryRepository(fileDb).listStaleUserIds().includes("small-stale"));
});

test("a small save on an account whose rows are at an older version leaves it stale, and the startup step rebuilds every row", () => {
  const userId = "small-old-version";
  const hashes = () => (fileDb.prepare(`SELECT row_hash FROM library_books WHERE user_id = ? ORDER BY position`).all(userId) as Array<{ row_hash: string }>).map((row) => row.row_hash);
  const document = fileDb.prepare(`SELECT updated_at FROM library_documents WHERE user_id = ?`);
  fileService.saveLibrary(userId, { books: [marked("Alpha", ["a1"]), marked("Beta", ["b1"])] });
  const { updated_at } = document.get(userId) as { updated_at: string };
  const data = JSON.parse((fileDb.prepare(`SELECT data FROM library_documents WHERE user_id = ?`).get(userId) as { data: string }).data);
  createSqliteLibraryRepository(fileDb, 0).setRows(userId, deriveLibraryRows(data, () => undefined, 0), updated_at);
  const old = hashes();

  fileService.applyChange(userId, { kind: "book", bookKey: bookKey(marked("Beta", [])), readStatus: 2, day: "2026-10-02" });

  assert.ok(createSqliteLibraryRepository(fileDb).listStaleUserIds().includes(userId));
  assert.equal((fileDb.prepare(`SELECT rows_version FROM library_summary WHERE user_id = ?`).get(userId) as { rows_version: number }).rows_version, 0);
  assert.deepEqual(hashes(), old);

  backfillLibraryDerived();

  assert.ok(!createSqliteLibraryRepository(fileDb).listStaleUserIds().includes(userId));
  assert.ok(hashes().every((hash, position) => hash !== old[position]));
  assert.deepEqual(rowsInDb(fileDb, userId), rowsOfStored(fileDb, userId));
});

test("the startup row rebuild keeps the work ids of books whose key is unchanged", () => {
  const userId = "rv-work";
  fileService.saveLibrary(userId, { books: [marked("Alpha", ["a1"]), marked("Beta", ["b1"])] });
  const row = fileDb.prepare(`SELECT data, updated_at FROM library_documents WHERE user_id = ?`).get(userId) as { data: string; updated_at: string };
  createSqliteLibraryRepository(fileDb, 0).setRows(userId, deriveLibraryRows(JSON.parse(row.data), () => undefined, 0), row.updated_at);
  fileDb.prepare(`UPDATE library_books SET work_id = 'w-' || position WHERE user_id = ?`).run(userId);
  const workIds = () => (fileDb.prepare(`SELECT work_id FROM library_books WHERE user_id = ? ORDER BY position`).all(userId) as Array<{ work_id: string | null }>).map((book) => book.work_id);
  assert.deepEqual(workIds(), ["w-0", "w-1"]);

  backfillLibraryDerived();

  assert.ok(!createSqliteLibraryRepository(fileDb).listStaleUserIds().includes(userId));
  assert.deepEqual(workIds(), ["w-0", "w-1"]);
});

test("raising the rows version rebuilds every account and rewrites every book row, and the same version rebuilds nothing", () => {
  const users = ["rv-a", "rv-b"];
  const hashes = (userId: string) => (fileDb.prepare(`SELECT row_hash FROM library_books WHERE user_id = ? ORDER BY position`).all(userId) as Array<{ row_hash: string }>).map((row) => row.row_hash);
  const version = (userId: string) => (fileDb.prepare(`SELECT rows_version FROM library_summary WHERE user_id = ?`).get(userId) as { rows_version: number }).rows_version;
  const staleUsers = (rowsVersion: number) => createSqliteLibraryRepository(fileDb, rowsVersion).listStaleUserIds().filter((userId) => users.includes(userId));
  const settled = (rowsVersion: number) => {
    for (const userId of users) {
      const row = fileDb.prepare(`SELECT updated_at FROM library_documents WHERE user_id = ?`).get(userId) as { updated_at: string };
      createSqliteLibraryRepository(fileDb, rowsVersion).setRows(userId, deriveLibraryRows(JSON.parse((fileDb.prepare(`SELECT data FROM library_documents WHERE user_id = ?`).get(userId) as { data: string }).data), () => undefined, rowsVersion), row.updated_at);
    }
  };
  const highlightTexts = (userId: string) => (fileDb.prepare(`SELECT text FROM library_highlights WHERE user_id = ? ORDER BY position, highlight_id`).all(userId) as Array<{ text: string }>).map((row) => row.text);
  for (const userId of users) fileService.saveLibrary(userId, { books: [marked("Alpha", ["a1"]), marked("Beta", ["b1"])] });
  settled(0);
  const old = users.map(hashes);
  for (const userId of users) fileDb.prepare(`UPDATE library_highlights SET text = 'old' WHERE user_id = ?`).run(userId);
  assert.deepEqual(users.map(version), [0, 0]);

  backfillLibraryDerived();

  assert.deepEqual(users.map(version), [1, 1]);
  users.forEach((userId, index) => {
    const rebuilt = hashes(userId);
    assert.equal(rebuilt.length, 2);
    assert.ok(rebuilt.every((hash, position) => hash !== old[index]![position]));
  });
  assert.deepEqual(staleUsers(1), []);
  for (const userId of users) assert.deepEqual(highlightTexts(userId), ["Alpha 0", "Beta 0"]);
  const settledHashes = users.map(hashes);

  backfillLibraryDerived();
  assert.deepEqual(users.map(hashes), settledHashes);

  assert.deepEqual(staleUsers(2), users);
  backfillLibraryDerived(2);
  assert.deepEqual(users.map(version), [2, 2]);
  users.forEach((userId, index) => assert.ok(hashes(userId).every((hash, position) => hash !== settledHashes[index]![position])));
  assert.deepEqual(staleUsers(2), []);
});

const titleWorks = (lookups: Array<{ title?: string | null }>) => lookups.map((lookup) => `w-${lookup.title}`);

test("every library document answer carries each copy's canonical work", () => {
  const service = createLibraryService(createSqliteLibraryRepository(memoryDb()), () => "", 10_000_000, undefined, undefined, undefined, undefined, titleWorks, (ids) => new Map(ids.map((id) => [id, id === "w-Dune" ? "w-dune" : id])));
  const saved = service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }, { Title: "Orlando", Attribution: "Virginia Woolf" }] });
  const works = { "ta:dune|frank herbert": "w-dune", "ta:orlando|virginia woolf": "w-Orlando" };
  assert.deepEqual(saved.works, works);
  assert.deepEqual(service.getLibraryText("u1")!.works, works);
  assert.deepEqual(service.getLibrary("u1")!.works, works);
  assert.deepEqual(service.share("u1").works, works);
});

function setupWithWorks() {
  const events: RecordedEvent[] = [];
  const service = createLibraryService(createSqliteLibraryRepository(memoryDb()), () => "", MAX_DOCUMENT_BYTES, (userId, batch) => {
    events.push(...batch.map((event) => ({ userId, ...event })));
  }, undefined, undefined, undefined, titleWorks, (ids) => new Map(ids.map((id) => [id, id === "w-Merged" ? "w-canon" : id])));
  return { service, events };
}

test("saveLibrary stamps the new and finished books' events with the work the save just wrote", () => {
  const { service, events } = setupWithWorks();
  const first = service.saveLibrary("u1", { books: [{ ContentID: "k1", Title: "Reading", Attribution: "A", ReadStatus: 1 }] });
  events.length = 0;

  const added = { ContentID: "k2", Title: "Merged", Attribution: "B", ReadStatus: 0 };
  service.saveLibrary("u1", { books: [{ ContentID: "k1", Title: "Reading", Attribution: "A", ReadStatus: 2 }, added] }, first.updatedAt);

  const works = service.getLibrary("u1")!.works;
  assert.deepEqual(events.map((event) => [event.type, event.refId, event.payload.workId]), [
    ["book_finished", "k1", works[bookKey({ ContentID: "k1", Title: "Reading", Attribution: "A" })]],
    ["book_added", "k2", "w-canon"]
  ]);
  assert.equal(events[0]?.payload.workId, "w-Reading");
});

test("saveLibrary reads the user's works once per save", () => {
  const repo = createSqliteLibraryRepository(memoryDb());
  let reads = 0;
  const service = createLibraryService({ ...repo, workIds: (userId) => { reads++; return repo.workIds(userId); } }, () => "", MAX_DOCUMENT_BYTES, () => {}, undefined, undefined, undefined, titleWorks, (ids) => new Map(ids.map((id) => [id, id])));
  const first = service.saveLibrary("u1", { books: [{ ContentID: "k1", Title: "Reading", Attribution: "A", ReadStatus: 1 }] });
  reads = 0;

  const saved = service.saveLibrary("u1", { books: [{ ContentID: "k1", Title: "Reading", Attribution: "A", ReadStatus: 2 }] }, first.updatedAt);

  assert.equal(reads, 1);
  assert.deepEqual(Object.values(saved.works), ["w-Reading"]);
});

test("a direct add and a re-shelved match carry the work id too", () => {
  const { service, events } = setupWithWorks();
  service.addBook("u1", { title: "Dune", author: "Frank Herbert", readStatus: 0 });
  assert.deepEqual(Object.values(service.getLibrary("u1")!.works), ["w-Dune"]);
  assert.equal(events[0]?.payload.workId, "w-Dune");
  events.length = 0;

  service.addBook("u1", { title: "Dune", author: "Frank Herbert", readStatus: 2 });
  assert.deepEqual(events.map((event) => [event.type, event.payload.workId]), [["book_finished", "w-Dune"]]);
});

test("applyChange stamps an added book's event with its work", () => {
  const { service, events } = setupWithWorks();
  service.applyChange("u1", { kind: "add", book: { ContentID: "manual:n", Title: "Neuromancer", Attribution: "William Gibson", ReadStatus: 0 } });
  assert.equal(events[0]?.payload.workId, "w-Neuromancer");
});

test("a catalog outage still answers the library with stored work ids and logs it", () => {
  const logged: string[] = [];
  const service = createLibraryService(createSqliteLibraryRepository(memoryDb()), () => "", 10_000_000, undefined, undefined, undefined, (_error, message) => logged.push(message), titleWorks, () => {
    throw new Error("catalog down");
  });
  service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }] });
  assert.deepEqual(service.getLibrary("u1")!.works, { "ta:dune|frank herbert": "w-Dune" });
  assert.ok(logged.some((message) => message.includes("work canonical lookup failed for u1")));
});

test("a saved library's reader card carries the streak, the dial and the facts", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", changeLibrary());
  const card = JSON.parse(rowsInDb(db, "u1").summary.reader_card as string);
  assert.equal(card.facts.finished, 10);
  assert.equal(card.facts.series, 1);
  assert.ok(Array.isArray(card.dial.segments));
  assert.ok("streak" in card);
  assert.equal("leaders" in card, false);
});

test("finishing or unfinishing a book recomputes the stored facts", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", changeLibrary());
  service.applyChange("u1", { kind: "book", bookKey: keyOf(3), readStatus: 0 });
  assert.equal(JSON.parse(rowsInDb(db, "u1").summary.reader_card as string).facts.finished, 9);
});
