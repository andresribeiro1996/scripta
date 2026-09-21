import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

// service.js reaches config/env.ts through covers/index.js (peekCachedCoverUrl),
// and that module process.exit(1)s on an unsatisfied schema at import time. Set
// the required vars before the deferred imports below, exactly as
// import/parseImport.test.ts and the other env-reaching tests do — a static
// import would hoist above these assignments. Nothing here is ever opened: the
// test runs against :memory:.
const scratch = join(tmpdir(), "library-service-test");
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { createSqliteLibraryRepository } = await import("./adapters/sqlite/sqliteLibraryRepository.js");
const { LibraryConflictError } = await import("./domain/errors.js");
const { createLibraryService } = await import("./service.js");

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

test("addBook matches by trimmed ISBN and updates status in place", () => {
  const { db, service, events } = setup();
  service.saveLibrary("user-1", {
    books: [{ ContentID: "k1", Title: "Stoner", Attribution: "John Williams", ISBN: " 9780394729685 ", ReadStatus: 1, ___PercentRead: 40, DateLastRead: null }],
    groups: [{ name: "g" }]
  });
  events.length = 0;

  const result = service.addBook("user-1", { title: "Stoner", author: "John Williams", isbn: "9780394729685", readStatus: 2 });

  assert.deepEqual(result, { key: "k1", updated: true });
  const books = booksOf(service, "user-1");
  assert.equal(books.length, 1);
  assert.equal(books[0]?.ReadStatus, 2);
  assert.equal(books[0]?.___PercentRead, 100);
  assert.equal(books[0]?.DateLastRead, new Date().toISOString().slice(0, 10));
  assert.deepEqual((service.getLibrary("user-1")?.data as { groups?: unknown }).groups, [{ name: "g" }]);
  assert.deepEqual(events.map(({ type, refId }) => ({ type, refId })), [{ type: "book_finished", refId: "k1" }]);
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
