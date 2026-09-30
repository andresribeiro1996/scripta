import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { bookKey, localDay } from "@scripta/shared";

// service.js reaches config/env.ts through covers/index.js (peekCachedCoverUrl),
// and that module process.exit(1)s on an unsatisfied schema at import time. Set
// the required vars before the deferred imports below, exactly as
// import/parseImport.test.ts and the other env-reaching tests do — a static
// import would hoist above these assignments. The LibraryService tests below
// run against :memory:; the readerGlyphFor tests further down are the
// exception — they open the real file at LIBRARY_DB_PATH, since that's the
// connection publicResolver.js's own module-scoped cache uses.
const scratch = join(tmpdir(), "library-service-test");
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { createSqliteLibraryRepository } = await import("./adapters/sqlite/sqliteLibraryRepository.js");
const { openLibraryDb } = await import("./adapters/sqlite/connection.js");
const { LibraryConflictError } = await import("./domain/errors.js");
const { createLibraryService } = await import("./service.js");
const { readerGlyphFor } = await import("./publicResolver.js");

type RecordedEvent = { userId: string; type: "book_added" | "book_finished"; refId: string; payload: Record<string, unknown> };

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE library_documents (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    share_token TEXT UNIQUE
  )`);
  const events: RecordedEvent[] = [];
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", (userId, batch) => {
    events.push(...batch.map((event) => ({ userId, ...event })));
  });
  return { db, service, events };
}

function setupCovers() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE library_documents (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    share_token TEXT UNIQUE
  )`);
  const batches: unknown[][] = [];
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", undefined, (lookups) => { batches.push(lookups); });
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

type Book = Record<string, unknown>;
const shelf = (count: number): Book[] => Array.from({ length: count }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2 }));
const seriesGroup = (books: Book[]) => ({ id: "g1", type: "series", name: "Discworld", bookKeys: books.map(bookKey) });

function seedLibraryDocument(userId: string, data: unknown) {
  const db = openLibraryDb();
  db.prepare(`INSERT OR REPLACE INTO library_documents (user_id, data, updated_at) VALUES (?, ?, ?)`).run(
    userId,
    typeof data === "string" ? data : JSON.stringify(data),
    new Date().toISOString()
  );
}

test("readerGlyphFor returns the settled identity for a library that clears the threshold", () => {
  const books = shelf(10);
  seedLibraryDocument("settled-user", { books, groups: [seriesGroup(books.slice(0, 3))] });
  assert.equal(readerGlyphFor("settled-user"), "carto");
});

test("readerGlyphFor returns null for a library that only leans toward an identity", () => {
  const books = shelf(11);
  seedLibraryDocument("leaning-user", { books, groups: [seriesGroup(books.slice(0, 3))] });
  assert.equal(readerGlyphFor("leaning-user"), null);
});

test("readerGlyphFor returns null for an Unwritten library, distinct from a missing document", () => {
  const books = shelf(3);
  seedLibraryDocument("unwritten-user", { books, groups: [] });
  assert.equal(readerGlyphFor("unwritten-user"), null);
});

test("readerGlyphFor returns null when the user has no library document", () => {
  assert.equal(readerGlyphFor("ghost-user"), null);
});

test("readerGlyphFor returns null for an unparseable library document", () => {
  seedLibraryDocument("corrupt-user", "not json");
  assert.equal(readerGlyphFor("corrupt-user"), null);
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

function setupMerge() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE library_documents (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    share_token TEXT UNIQUE
  )`);
  const rekeys: Array<[string, string[], string]> = [];
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", undefined, undefined, (userId, fromKeys, toKey) => {
    rekeys.push([userId, fromKeys, toKey]);
  });
  return { service, rekeys };
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
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE library_documents (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, share_token TEXT UNIQUE)`);
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", undefined, undefined, () => {
    throw new Error("murals db locked");
  });
  const saved = service.saveLibrary("u1", { books: [koboDune, goodreadsDune] });
  assert.throws(() => service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], saved.updatedAt), /murals db locked/);
  assert.equal((service.getLibrary("u1")!.data as { books: unknown[] }).books.length, 2);
});

test("addBook matches an ISBN-less copy by title and author", () => {
  const { service } = setup();
  service.saveLibrary("u1", { books: [koboDune] });
  const result = service.addBook("u1", { title: "Dune", author: "Frank Herbert", isbn: "9780441013593", readStatus: 2 });
  assert.equal(result.updated, true);
  assert.equal(booksOf(service, "u1").length, 1);
});
