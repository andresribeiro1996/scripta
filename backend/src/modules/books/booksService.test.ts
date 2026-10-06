import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-service-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { createBooksService, COVER_ENQUEUE_BATCH } = await import("./booksService.js");
const { default: sharp } = await import("sharp");
const { BookNotFoundError, FileTooLargeError, InvalidImageError, SourcePausedError, SourceUnavailableError } = await import("./domain/errors.js");
const { createCoverWorker } = await import("./worker.js");
const { createCompositeCatalog } = await import("./adapters/catalog/compositeCatalog.js");
const { createThrottle } = await import("./adapters/http/http.js");
const { createOpenLibraryCatalog } = await import("./adapters/openlibrary/openLibraryCatalog.js");

type Deps = Parameters<typeof createBooksService>[0];
type CoverSource = Deps["sources"]["apple"];

const DAY = 24 * 60 * 60 * 1000;
const orlando = { isbn: "9780141184272", title: "Orlando", author: "Virginia Woolf" };
const emptySource: CoverSource = { byIsbn: async () => [], byTitle: async () => [] };

function isbnSource(url: string, calls?: string[]): CoverSource {
  return {
    byIsbn: async (isbn) => {
      calls?.push(isbn);
      return [{ source: "apple", url }];
    },
    byTitle: async () => []
  };
}

function harness(overrides: Partial<Deps> = {}) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const files = new Map<string, Buffer>();
  const blobs = {
    save: async (id: string, extension: string, bytes: Buffer) => { files.set(`${id}.${extension}`, bytes); }
  };
  const enqueued: Array<{ bookId: string; priority: string }> = [];
  const warnings: Array<{ details: Record<string, unknown>; message: string }> = [];
  let clock = Date.parse("2026-10-01T00:00:00.000Z");
  const sizes = new Map<string, [number, number]>();
  const service = createBooksService({
    repo,
    blobs,
    sources: { isbndb: null, apple: emptySource, openlibrary: emptySource },
    catalog: {
      fetchDetails: async () => { throw new Error("catalog not expected"); },
      search: async () => { throw new Error("catalog not expected"); }
    },
    backgroundCatalog: {
      fetchDetails: async () => { throw new Error("catalog not expected"); },
      search: async () => { throw new Error("catalog not expected"); }
    },
    editionRecords: { fetchEditionRecord: async () => { throw new Error("edition records not expected"); } },
    fetchImage: async (candidate) => {
      const size = sizes.get(candidate.url);
      return size ? { full: Buffer.from(`full:${candidate.url}`), thumb: Buffer.from(`thumb:${candidate.url}`), width: size[0], height: size[1] } : null;
    },
    enqueue: (bookId, priority = "normal") => { enqueued.push({ bookId, priority }); },
    publicUrlFor: (id, size) => `https://api.test/covers/cached/${id}/${size}`,
    adminUserId: "",
    warn: (details, message) => { warnings.push({ details, message }); },
    now: () => new Date(clock),
    ...overrides
  });
  const bookId = (key: string) => repo.findBookByKey(key)!.id;
  return { db, repo, files, sizes, enqueued, warnings, service, bookId, advance: (ms: number) => { clock += ms; } };
}

test("an ISBN-10 and its ISBN-13 resolve to one edition", () => {
  const { service, db } = harness();
  service.resolveCover({ isbn: "0441013597", title: "Dune", author: "Frank Herbert" });
  service.resolveCover({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 1);
  const keys = (db.prepare("SELECT key FROM book_keys ORDER BY key").all() as Array<{ key: string }>).map((row) => row.key);
  assert.ok(keys.includes("isbn:9780441013593"));
  assert.ok(keys.includes("isbn:0441013597"));
});

test("a lookup finds an edition stored only under its ISBN-10 key", () => {
  const { service, db, repo } = harness();
  const legacy = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597" }, ["isbn:0441013597"], "2026-01-01T00:00:00.000Z");
  service.resolveCover({ isbn: "0441013597", title: "Dune", author: "Frank Herbert" });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 1);
  assert.equal(repo.findBookByKey("isbn:9780441013593")?.id, legacy.id);
});

test("looking up an existing edition by its canonical key writes no keys", () => {
  const { service, repo } = harness();
  service.resolveCover({ isbn: "0441013597", title: "Dune", author: "Frank Herbert" });
  const addKey = repo.addKey;
  let writes = 0;
  repo.addKey = (...args) => { writes += 1; addKey(...args); };
  service.resolveCover({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  service.resolveCover({ isbn: "0441013597", title: "Dune", author: "Frank Herbert" });
  assert.equal(writes, 0);
});

test("repo.transaction nests inside an open transaction", () => {
  const { repo } = harness();
  const book = repo.transaction(() => repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: null }, ["ta:orlando|woolf|"], "2026-01-01T00:00:00.000Z"));
  assert.ok(repo.getBook(book.id));
});

test("a new book answers pending and repeat requests reuse the same row", () => {
  const { service, enqueued, db } = harness();
  assert.deepEqual(service.resolveCover(orlando), { url: null, fullUrl: null, pending: true, upgrading: false });
  assert.deepEqual(service.resolveCover(orlando), { url: null, fullUrl: null, pending: true, upgrading: false });
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 1);
  assert.equal(enqueued.length, 2);
  assert.equal(enqueued[0]!.bookId, enqueued[1]!.bookId);
});

test("processing stores the first good cover; resolve serves thumb and full URLs", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  const cover = h.service.resolveCover(orlando);
  assert.equal(cover.pending, false);
  const imageId = h.repo.findBookByKey("isbn:9780141184272")!.cover_image_id!;
  assert.equal(cover.url, `https://api.test/covers/cached/${imageId}/thumb`);
  assert.equal(cover.fullUrl, `https://api.test/covers/cached/${imageId}/file`);
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.cover_status, "good");
  assert.ok(h.files.has(`${imageId}.webp`));
  assert.ok(h.files.has(`${imageId}-thumb.webp`));
  assert.equal(h.repo.getImage(imageId)!.source_url, "https://a/1");
});

test("a cover set while the worker uploaded is not overwritten", async () => {
  let rivalSet = false;
  const h: ReturnType<typeof harness> = harness({
    sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource },
    blobs: {
      save: async () => {
        if (rivalSet) return;
        rivalSet = true;
        h.repo.setCover(h.bookId("isbn:9780141184272"), { imageId: "uploaded", status: "manual", checkedAt: "2026-10-01T00:00:00.000Z" });
      }
    }
  });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  const row = h.repo.findBookByKey("isbn:9780141184272")!;
  assert.equal(row.cover_image_id, "uploaded");
  assert.equal(row.cover_status, "manual");
  assert.equal(row.cover_upgrade_wanted_at, null);
});

test("a complete miss is remembered for 30 days", async () => {
  const h = harness();
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.cover_status, "missing");
  h.enqueued.length = 0;
  assert.deepEqual(h.service.resolveCover(orlando), { url: null, fullUrl: null, pending: false, upgrading: false });
  assert.equal(h.enqueued.length, 0);
  h.advance(30 * DAY);
  assert.equal(h.service.resolveCover(orlando).pending, true);
  assert.equal(h.enqueued.length, 1);
});

test("a low-res cover is served and upgraded only after 30 days", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/small"), openlibrary: emptySource } });
  h.sizes.set("https://a/small", [300, 460]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.cover_status, "low_res");
  h.enqueued.length = 0;
  assert.notEqual(h.service.resolveCover(orlando).url, null);
  assert.equal(h.enqueued.length, 0);
  h.advance(30 * DAY);
  assert.notEqual(h.service.resolveCover(orlando).url, null);
  assert.equal(h.enqueued.length, 1);
});

test("a better image replaces the pointer and keeps the old file", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/small"), openlibrary: emptySource } });
  h.sizes.set("https://a/small", [300, 460]);
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await h.service.processBook(id, "background");
  const oldImage = h.repo.getBook(id)!.cover_image_id!;
  h.sizes.set("https://a/small", [900, 1400]);
  h.advance(30 * DAY);
  await h.service.processBook(id, "background");
  const newImage = h.repo.getBook(id)!.cover_image_id!;
  assert.notEqual(newImage, oldImage);
  assert.ok(h.files.has(`${oldImage}.webp`));
  assert.equal(h.repo.getBook(id)!.cover_status, "good");
});

test("an unavailable source records no miss and backs off for 10 minutes", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  const book = h.repo.findBookByKey("isbn:9780141184272")!;
  assert.equal(book.cover_status, null);
  assert.equal(book.cover_checked_at, null);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.warnings[0]!.details.source, "apple");
  assert.equal(h.warnings[0]!.message, "cover source unavailable");
  h.enqueued.length = 0;
  assert.deepEqual(h.service.resolveCover(orlando), { url: null, fullUrl: null, pending: true, upgrading: false });
  assert.equal(h.enqueued.length, 0);
  h.advance(10 * 60 * 1000);
  assert.equal(h.service.resolveCover(orlando).pending, true);
  assert.equal(h.enqueued.length, 1);
});

test("a paused source backs the book off until the pause ends and is not warned about per book", async () => {
  const HOUR = 60 * 60 * 1000;
  const retryAt = Date.parse("2026-10-01T00:00:00.000Z") + 5 * HOUR;
  const paused: CoverSource = { byIsbn: async () => { throw new SourcePausedError("isbndb", "paused", { retryAt }); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: paused, apple: emptySource, openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  assert.equal(h.warnings.length, 0);
  h.enqueued.length = 0;
  h.advance(5 * HOUR - 1);
  h.service.resolveCover(orlando);
  assert.equal(h.enqueued.length, 0);
  h.advance(1);
  h.service.resolveCover(orlando);
  assert.equal(h.enqueued.length, 1);
});

test("a plain 503 keeps the 10-minute backoff and is still warned about", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 503", { status: 503 }); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  assert.equal(h.warnings.length, 1);
  h.enqueued.length = 0;
  h.advance(10 * 60 * 1000 - 1);
  h.service.resolveCover(orlando);
  assert.equal(h.enqueued.length, 0);
  h.advance(1);
  h.service.resolveCover(orlando);
  assert.equal(h.enqueued.length, 1);
});

function recordingSource(calls: string[], name: string, behaviour: () => Promise<[]> = async () => []): CoverSource {
  return {
    byIsbn: async () => { calls.push(`${name}:isbn`); return behaviour(); },
    byTitle: async () => { calls.push(`${name}:title`); return behaviour(); }
  };
}

function pausedIsbndb(retryAt: number, calls: string[]) {
  return recordingSource(calls, "isbndb", async () => { throw new SourcePausedError("isbndb", "paused", { retryAt }); });
}

test("a background lookup stamps Apple's answer even when ISBNdb is paused, and the retry skips Apple", async () => {
  const HOUR = 60 * 60 * 1000;
  const calls: string[] = [];
  const h = harness({ sources: { isbndb: pausedIsbndb(Date.parse("2026-10-01T00:00:00.000Z") + 5 * HOUR, calls), apple: recordingSource(calls, "apple"), openlibrary: recordingSource(calls, "openlibrary") } });
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await h.service.processBook(id, "background");
  assert.deepEqual(calls, ["apple:isbn", "isbndb:isbn", "openlibrary:isbn", "apple:title", "isbndb:title", "openlibrary:title"]);
  const row = h.repo.getBook(id)!;
  assert.equal(row.apple_checked_at, "2026-10-01T00:00:00.000Z");
  assert.equal(row.cover_status, null);
  h.advance(5 * HOUR);
  calls.length = 0;
  await h.service.processBook(id, "background");
  assert.deepEqual(calls, ["isbndb:isbn", "openlibrary:isbn", "isbndb:title", "openlibrary:title"]);
});

test("a low-res Apple cover stays unchecked while ISBNdb is paused, and a wider ISBNdb cover replaces it later", async () => {
  const HOUR = 60 * 60 * 1000;
  const calls: string[] = [];
  let paused = true;
  const isbndb: CoverSource = {
    byIsbn: async () => {
      calls.push("isbndb:isbn");
      if (paused) throw new SourcePausedError("isbndb", "paused", { retryAt: Date.parse("2026-10-01T00:00:00.000Z") + 5 * HOUR });
      return [{ source: "isbndb", url: "https://i/wide" }];
    },
    byTitle: async () => []
  };
  const h = harness({ sources: { isbndb, apple: { ...isbnSource("https://a/small", calls), byTitle: async () => [] }, openlibrary: emptySource } });
  h.sizes.set("https://a/small", [300, 460]);
  h.sizes.set("https://i/wide", [900, 1400]);
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await h.service.processBook(id, "background");
  let row = h.repo.getBook(id)!;
  assert.equal(row.apple_checked_at, "2026-10-01T00:00:00.000Z");
  assert.deepEqual([row.cover_status, row.cover_checked_at], ["low_res", null]);
  assert.notEqual(row.cover_image_id, null);
  assert.deepEqual(h.repo.listUncheckedCoverIds(null, 100).ids, [id]);
  const small = row.cover_image_id;
  h.advance(5 * HOUR);
  paused = false;
  calls.length = 0;
  await h.service.processBook(id, "background");
  assert.deepEqual(calls, ["isbndb:isbn"]);
  row = h.repo.getBook(id)!;
  assert.notEqual(row.cover_image_id, small);
  assert.equal(row.cover_status, "good");
  assert.notEqual(row.cover_checked_at, null);
  assert.deepEqual(h.repo.listUncheckedCoverIds(null, 100).ids, []);
});

test("an Apple failure does not stamp the book", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 503", { status: 503 }); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await h.service.processBook(id, "background");
  assert.equal(h.repo.getBook(id)!.apple_checked_at, null);
});

test("the background lane asks Apple again once its answer is 30 days old", async () => {
  const calls: string[] = [];
  const h = harness({ sources: { isbndb: null, apple: recordingSource(calls, "apple"), openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  h.repo.setAppleChecked(id, "2026-10-01T00:00:00.000Z");
  h.advance(30 * DAY - 1);
  await h.service.processBook(id, "background");
  assert.deepEqual(calls, []);
  h.advance(1);
  await h.service.processBook(id, "background");
  assert.deepEqual(calls, ["apple:isbn", "apple:title"]);
  assert.equal(h.repo.getBook(id)!.apple_checked_at, "2026-10-31T00:00:00.000Z");
});

test("the upgrade lane asks Apple even for a stamped book; front and normal never do", async () => {
  const calls: string[] = [];
  const h = harness({ sources: { isbndb: null, apple: recordingSource(calls, "apple"), openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  h.repo.setAppleChecked(id, "2026-10-01T00:00:00.000Z");
  await h.service.processBook(id, "upgrade");
  assert.deepEqual(calls, ["apple:isbn", "apple:title"]);
  calls.length = 0;
  await h.service.processBook(id, "front");
  await h.service.processBook(id, "normal");
  assert.deepEqual(calls, []);
});

test("resolve queues at the back unless asked to jump the queue", () => {
  const { service, enqueued } = harness();
  service.resolveCover(orlando);
  service.resolveCover(orlando, true);
  assert.deepEqual(enqueued.map((entry) => entry.priority), ["normal", "front"]);
});

test("enqueueCovers queues each unresolved book at the back and skips resolved ones", async () => {
  const dune = { title: "Dune", author: "Frank Herbert" };
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  h.enqueued.length = 0;
  h.service.enqueueCovers([orlando, dune, { title: "" }]);
  assert.deepEqual(h.enqueued, [{ bookId: h.bookId("ta:dune|frank herbert|"), priority: "normal" }]);
});

test("enqueueCovers skips a book in backoff", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  h.enqueued.length = 0;
  h.service.enqueueCovers([orlando]);
  assert.equal(h.enqueued.length, 0);
});

test("a low-res image found while a source was down is stored without advancing the check time", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: isbnSource("https://o/1") } });
  h.sizes.set("https://o/1", [320, 480]);
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await h.service.processBook(id, "background");
  const book = h.repo.findBookByKey("isbn:9780141184272")!;
  assert.notEqual(book.cover_image_id, null);
  assert.equal(book.cover_status, "low_res");
  assert.equal(book.cover_checked_at, null);

  h.enqueued.length = 0;
  h.service.resolveCover(orlando);
  assert.equal(h.enqueued.length, 0);
  h.advance(10 * 60 * 1000);
  h.service.resolveCover(orlando);
  assert.equal(h.enqueued.length, 1);
});

test("an unexpected error during processing sets a 10-minute backoff and rethrows", async () => {
  const h = harness({
    sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource },
    fetchImage: async () => { throw new Error("disk full"); }
  });
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await assert.rejects(h.service.processBook(id, "background"), /disk full/);
  h.enqueued.length = 0;
  assert.deepEqual(h.service.resolveCover(orlando), { url: null, fullUrl: null, pending: true, upgrading: false });
  assert.equal(h.enqueued.length, 0);
  h.advance(10 * 60 * 1000);
  assert.equal(h.service.resolveCover(orlando).pending, true);
  assert.equal(h.enqueued.length, 1);
});

test("enqueueUnchecked queues never-checked books on the background lane, oldest first, and skips checked ones", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  h.advance(1000);
  h.service.resolveCover({ title: "Dune", author: "Frank Herbert" });
  h.advance(1000);
  h.service.resolveCover({ title: "Emma", author: "Jane Austen" });
  h.enqueued.length = 0;
  h.service.enqueueUnchecked();
  assert.deepEqual(h.enqueued, [
    { bookId: h.bookId("ta:dune|frank herbert|"), priority: "background" },
    { bookId: h.bookId("ta:emma|jane austen|"), priority: "background" }
  ]);
});

test("enqueueUnchecked skips a book in backoff", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
  h.enqueued.length = 0;
  h.service.enqueueUnchecked();
  assert.equal(h.enqueued.length, 0);
  h.advance(10 * 60 * 1000);
  h.service.enqueueUnchecked();
  assert.equal(h.enqueued.length, 1);
});

test("manual covers are never processed", async () => {
  const calls: string[] = [];
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1", calls), openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  h.repo.setCover(id, { imageId: "uploaded", status: "manual", checkedAt: "2026-10-01T00:00:00.000Z" });
  await h.service.processBook(id, "background");
  assert.deepEqual(calls, []);
  assert.equal(h.repo.getBook(id)!.cover_image_id, "uploaded");
});

test("an EPUB urn:uuid ISBN falls back to the title key", () => {
  const h = harness();
  h.service.resolveCover({ isbn: "urn:uuid:ac11a7ae-d21e-42bb-8cfe-b85022867ac4", title: "The Stranger", author: "Albert Camus" });
  const book = h.repo.findBookByKey("ta:the stranger|albert camus|");
  assert.ok(book);
  assert.equal(book.isbn, null);
});

test("a title that normalizes to nothing creates no book", () => {
  const h = harness();
  assert.deepEqual(h.service.resolveCover({ title: "?!" }), { url: null, fullUrl: null, pending: false, upgrading: false });
  assert.equal((h.db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 0);
  assert.equal(h.enqueued.length, 0);
});

test("a migrated book with no title gets its title from the first lookup that has one", () => {
  const h = harness();
  h.repo.createBook({ title: "", author: "", isbn: "9780141184272" }, ["isbn:9780141184272"], "2026-01-01T00:00:00.000Z");
  h.service.resolveCover(orlando);
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.title, "Orlando");
});

test("a cover whose blob save rejects stores no image row and no cover pointer", async () => {
  const h = harness({
    sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource },
    blobs: { save: async () => { throw new Error("R2 PUT failed: HTTP 403"); } }
  });
  h.sizes.set("https://a/1", [600, 900]);
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await assert.rejects(h.service.processBook(id, "background"), (e) => {
    assert.match(String(e), /HTTP 403/);
    return true;
  });
  assert.equal((h.db.prepare(`SELECT COUNT(*) AS n FROM cover_images`).get() as { n: number }).n, 0);
  assert.equal(h.repo.getBook(id)!.cover_image_id, null);
  const photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#224466" } }).jpeg().toBuffer();
  await assert.rejects(h.service.uploadCover(orlando, photo), (e) => {
    assert.match(String(e), /HTTP 403/);
    return true;
  });
  assert.equal((h.db.prepare(`SELECT COUNT(*) AS n FROM cover_images`).get() as { n: number }).n, 0);
});

type Catalog = Deps["catalog"];

function recordingCatalog(overrides: Partial<Catalog> = {}) {
  const calls: string[] = [];
  const catalog: Catalog = {
    fetchDetails: async (lookup) => {
      calls.push(`details:${lookup.isbn ?? lookup.title}`);
      return { metadata: { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"], pages: 544, publisher: "Ace", year: 1965, translator: null }, sources: ["openlibrary"], summarySource: "openlibrary" };
    },
    search: async (query) => {
      calls.push("isbn" in query ? `search-isbn:${query.isbn}` : `search:${query.text}`);
      return [
        { result: { title: "Dune", authors: ["Frank Herbert"], year: 1965, isbn: "9780441013593", publisher: "Ace", coverUrl: "https://covers.openlibrary.org/b/id/7-M.jpg", genres: [] }, olCoverId: 7, source: "openlibrary" },
        { result: { title: "Dune Encyclopedia", authors: ["Willis E. McNelly"], year: 1984, isbn: null, publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source: "openlibrary" }
      ];
    },
    ...overrides
  };
  return { calls, catalog };
}

const dune = { isbn: "9780441013593", title: "Dune", author: "Frank Herbert" };

test("details are fetched once and then served from the database", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  assert.equal((await h.service.getDetails(dune))?.summary, "Spice.");
  assert.deepEqual(await h.service.getDetails(dune), { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"], pages: 544, publisher: "Ace", year: 1965, translator: null, summarySource: "openlibrary" });
  assert.deepEqual(calls, ["details:9780441013593"]);
  assert.equal(h.repo.findBookByKey("isbn:9780441013593")!.data_sources, '["openlibrary"]');
});

test("details fetched from ISBNdb are tagged with it", async () => {
  const { catalog } = recordingCatalog({
    fetchDetails: async () => ({ metadata: { summary: "Spice.", rating: null, ratingCount: 0, sourceUrl: "https://isbndb.com/book/9780441013593", genres: [], pages: null, publisher: null, year: null, translator: null }, sources: ["isbndb"], summarySource: "isbndb" })
  });
  const h = harness({ catalog });
  await h.service.getDetails(dune);
  const row = h.repo.findBookByKey("isbn:9780441013593")!;
  assert.equal(row.data_sources, '["isbndb"]');
  assert.equal(row.source_url, "https://isbndb.com/book/9780441013593");
});

test("a first lookup returns the merged row and keeps a publisher synopsis", async () => {
  const h = harness({ catalog: recordingCatalog().catalog });
  h.service.resolveCover(dune);
  const id = h.bookId("isbn:9780441013593");
  h.repo.mergeDetails(id, { summary: "Sinopse da editora.", pages: 500, year: null, publisher: "Antígona", translator: "Maria" }, "publisher");
  assert.deepEqual(await h.service.getDetails(dune), {
    summary: "Sinopse da editora.",
    rating: 4.2,
    ratingCount: 10,
    sourceUrl: "",
    genres: ["Science Fiction"],
    pages: 500,
    publisher: "Antígona",
    year: 1965,
    translator: "Maria",
    summarySource: "publisher"
  });
  assert.equal(h.repo.getBook(id)!.summary_source, "publisher");
  assert.equal(h.repo.getBook(id)!.data_sources, '["openlibrary"]');
});

test("a publisher synopsis links to the publisher's page and other synopses to their own source", async () => {
  const h = harness({ catalog: recordingCatalog().catalog });
  h.service.resolveCover(dune);
  const id = h.bookId("isbn:9780441013593");
  h.repo.mergeDetails(id, { summary: "Sinopse da editora.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  h.repo.setPublisherUrl(id, "https://antigona.pt/products/dune");
  const publisher = await h.service.getDetails(dune);
  assert.deepEqual([publisher?.summarySource, publisher?.sourceUrl], ["publisher", "https://antigona.pt/products/dune"]);

  const other = harness({ catalog: recordingCatalog().catalog });
  const details = await other.service.getDetails(dune);
  assert.deepEqual([details?.summarySource, details?.sourceUrl], ["openlibrary", "https://openlibrary.org/works/OL1W"]);
});

test("an ISBNdb synopsis links to ISBNdb even when Open Library supplied the rating", async () => {
  const olRating = { metadata: { summary: null, rating: 3.8, ratingCount: 42, sourceUrl: "https://openlibrary.org/works/OL5W", genres: ["Science Fiction" as const], pages: null, publisher: null, year: null, translator: null }, sources: ["openlibrary" as const], summarySource: null };
  const primary: Catalog = { fetchDetails: async () => olRating, search: async () => [] };
  const secondary: Catalog = {
    fetchDetails: async () => ({ metadata: { summary: "Spice.", rating: null, ratingCount: 0, sourceUrl: "https://isbndb.com/book/9780441013593", genres: [], pages: null, publisher: null, year: null, translator: null }, sources: ["isbndb"], summarySource: "isbndb" }),
    search: async () => []
  };
  const h = harness({ catalog: createCompositeCatalog(primary, secondary) });
  const details = await h.service.getDetails(dune);
  assert.deepEqual([details?.rating, details?.summarySource, details?.sourceUrl], [3.8, "isbndb", "https://isbndb.com/book/9780441013593"]);
  assert.equal(h.repo.findBookByKey("isbn:9780441013593")!.source_url, "https://openlibrary.org/works/OL5W");
});

test("a details miss is remembered for 30 days", async () => {
  const { calls, catalog } = recordingCatalog({ fetchDetails: async () => { calls.push("details"); return null; } });
  const h = harness({ catalog });
  assert.equal(await h.service.getDetails(dune), null);
  assert.equal(await h.service.getDetails(dune), null);
  assert.equal(calls.length, 1);
  h.advance(30 * DAY);
  await h.service.getDetails(dune);
  assert.equal(calls.length, 2);
});

test("a book with a publisher synopsis still returns it when the catalog finds nothing", async () => {
  const { catalog } = recordingCatalog({ fetchDetails: async () => null });
  const h = harness({ catalog });
  h.service.resolveCover(dune);
  const id = h.bookId("isbn:9780441013593");
  h.repo.mergeDetails(id, { summary: "Sinopse da editora.", pages: 500, year: 2001, publisher: "Antígona", translator: "Maria" }, "publisher");
  const expected = { summary: "Sinopse da editora.", rating: null, ratingCount: 0, sourceUrl: "", genres: [], pages: 500, publisher: "Antígona", year: 2001, translator: "Maria", summarySource: "publisher" };
  assert.deepEqual(await h.service.getDetails(dune), expected);
  assert.equal(h.repo.getBook(id)!.details_status, "missing");
  assert.deepEqual(await h.service.getDetails(dune), expected);
});

test("a facts-only answer stores its facts and leaves the book missing, so a later answer still lands", async () => {
  let answer: Awaited<ReturnType<Catalog["fetchDetails"]>> = { metadata: { summary: null, rating: null, ratingCount: 0, sourceUrl: "https://isbndb.com/book/9780441013593", genres: [], pages: null, publisher: "Ace", year: 2005, translator: null }, sources: ["isbndb"], summarySource: null };
  const { catalog } = recordingCatalog({ fetchDetails: async () => answer });
  const h = harness({ catalog });
  assert.equal(await h.service.getDetails(dune), null);
  const row = h.repo.findBookByKey("isbn:9780441013593")!;
  assert.deepEqual([row.publisher, row.year, row.details_status, row.data_sources, row.summary], ["Ace", 2005, "missing", "[]", null]);

  h.advance(30 * DAY);
  answer = { metadata: { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"], pages: 544, publisher: "Other", year: 1965, translator: null }, sources: ["openlibrary"], summarySource: "openlibrary" };
  const details = await h.service.getDetails(dune);
  assert.deepEqual([details?.summary, details?.pages, details?.publisher, details?.year], ["Spice.", 544, "Ace", 2005]);
  assert.equal(h.repo.getBook(row.id)!.details_status, "found");
});

test("an Open Library answer with only a rating is stored as found with its rating and work key", async () => {
  const metadata = { summary: null, rating: 3.8, ratingCount: 42, sourceUrl: "https://openlibrary.org/works/OL5W", genres: [], pages: null, publisher: null, year: null, translator: null };
  const h = harness({ catalog: recordingCatalog({ fetchDetails: async () => ({ metadata, sources: ["openlibrary"], summarySource: null, workKey: "/works/OL5W" }) }).catalog });
  assert.deepEqual(await h.service.getDetails(dune), { ...metadata, summarySource: null });
  const row = h.repo.findBookByKey("isbn:9780441013593")!;
  assert.deepEqual([row.details_status, row.rating, row.rating_count, row.source_url, row.ol_work_key, row.data_sources], ["found", 3.8, 42, "https://openlibrary.org/works/OL5W", "OL5W", '["openlibrary"]']);
});

test("a facts-only answer still stores the work key it carries", async () => {
  const metadata = { summary: null, rating: null, ratingCount: 0, sourceUrl: "https://openlibrary.org/works/OL6W", genres: [], pages: 300, publisher: null, year: null, translator: null };
  const h = harness({ catalog: recordingCatalog({ fetchDetails: async () => ({ metadata, sources: ["openlibrary"], summarySource: null, workKey: "/works/OL6W" }) }).catalog });
  assert.equal(await h.service.getDetails(dune), null);
  const row = h.repo.findBookByKey("isbn:9780441013593")!;
  assert.deepEqual([row.details_status, row.pages, row.ol_work_key, row.source_url], ["missing", 300, "OL6W", null]);
});

test("a stored synopsis is returned when every source is unavailable, other rows still throw", async () => {
  const h = harness({ catalog: recordingCatalog({ fetchDetails: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); } }).catalog });
  h.service.resolveCover(dune);
  await assert.rejects(h.service.getDetails(dune), SourceUnavailableError);
  h.repo.mergeDetails(h.bookId("isbn:9780441013593"), { summary: "Sinopse da editora.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  assert.equal((await h.service.getDetails(dune))?.summary, "Sinopse da editora.");
  assert.equal(h.repo.findBookByKey("isbn:9780441013593")!.details_status, null);
});

test("a details failure propagates and records nothing", async () => {
  const h = harness({ catalog: recordingCatalog({ fetchDetails: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); } }).catalog });
  await assert.rejects(h.service.getDetails(dune), SourceUnavailableError);
  assert.equal(h.repo.findBookByKey("isbn:9780441013593")!.details_status, null);
});

test("an ISBN search is answered from a saved book that has external details, without calling Open Library", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  await h.service.searchExternal("978-0-441-01359-3");
  calls.length = 0;
  const results = h.service.search("978-0-441-01359-3");
  assert.equal(results[0]!.title, "Dune");
  assert.deepEqual(calls, []);
});

test("an ISBN search ignores a saved row with no external details so the outside search can fill it in", () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  h.service.resolveCover(dune);
  assert.equal(h.repo.findBookByKey("isbn:9780441013593")!.data_sources, "[]");
  assert.deepEqual(h.service.search("978-0-441-01359-3"), []);
  assert.deepEqual(calls, []);
});

test("an unknown ISBN searched inside finds nothing and never calls Open Library", () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  assert.deepEqual(h.service.search("9780441013593"), []);
  assert.deepEqual(calls, []);
});

test("an outside ISBN search goes to Open Library and saves the results", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  await h.service.searchExternal("978-0-441-01359-3");
  assert.deepEqual(calls, ["search-isbn:9780441013593"]);
  assert.ok(h.repo.findBookByKey("isbn:9780441013593"));
  assert.equal(h.service.search("9780441013593")[0]!.title, "Dune");
});

test("an inside text search only returns saved matches and never calls Open Library", () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  assert.deepEqual(h.service.search("dune"), []);
  assert.deepEqual(calls, []);
});

test("an outside text search saves every result so the inside search finds them next time", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  const fromOpenLibrary = await h.service.searchExternal("dune");
  assert.deepEqual(calls, ["search:dune"]);
  assert.equal(fromOpenLibrary.length, 2);
  assert.equal(fromOpenLibrary[0]!.coverUrl, "https://covers.openlibrary.org/b/id/7-M.jpg");
  assert.ok(h.repo.findBookByKey("ta:dune encyclopedia|willis e mcnelly|"));

  const saved = h.service.search("Dune");
  assert.equal(calls.length, 1);
  assert.deepEqual(saved.map((result) => result.title).sort(), ["Dune", "Dune Encyclopedia"]);
  const book = saved.find((result) => result.title === "Dune")!;
  assert.deepEqual(book.authors, ["Frank Herbert"]);
  assert.equal(book.year, 1965);
  assert.equal(book.coverUrl, "https://covers.openlibrary.org/b/id/7-M.jpg");
});

test("a partial saved match no longer hides the outside search", async () => {
  const messiah = { result: { title: "Dune Messiah", authors: ["Frank Herbert"], year: 1969, isbn: null, publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source: "openlibrary" as const };
  const dune = { result: { title: "Dune", authors: ["Frank Herbert"], year: 1965, isbn: "9780441013593", publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source: "openlibrary" as const };
  const { calls, catalog } = recordingCatalog({ search: async (query) => {
    calls.push("isbn" in query ? `search-isbn:${query.isbn}` : `search:${query.text}`);
    return "text" in query && query.text === "messiah" ? [messiah] : [messiah, dune];
  } });
  const h = harness({ catalog });
  await h.service.searchExternal("messiah");
  assert.deepEqual(h.service.search("dune").map((result) => result.title), ["Dune Messiah"]);
  const outside = await h.service.searchExternal("dune");
  assert.deepEqual(outside.map((result) => result.title), ["Dune Messiah", "Dune"]);
  assert.deepEqual(calls, ["search:messiah", "search:dune"]);
});

test("a saved search hit is tagged with its source, and an existing row is left alone", async () => {
  const bookHit = (source: "openlibrary" | "isbndb") => ({ result: { title: "Dune", authors: ["Frank Herbert"], year: 1965, isbn: "9780441013593", publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source });
  const fromIsbndb = harness({ catalog: recordingCatalog({ search: async () => [bookHit("isbndb")] }).catalog });
  await fromIsbndb.service.searchExternal("dune");
  assert.equal(fromIsbndb.repo.findBookByKey("isbn:9780441013593")!.data_sources, '["isbndb"]');

  const existing = harness({ catalog: recordingCatalog({ search: async () => [bookHit("isbndb")] }).catalog });
  existing.service.resolveCover(dune);
  await existing.service.searchExternal("dune");
  assert.equal(existing.repo.findBookByKey("isbn:9780441013593")!.data_sources, "[]");
});

test("a saved book's own cover is used in search results", async () => {
  const { catalog } = recordingCatalog();
  const h = harness({ catalog, sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(dune);
  await h.service.processBook(h.bookId("isbn:9780441013593"), "background");
  await h.service.searchExternal("dune herbert");
  const [result] = h.service.search("dune herbert");
  assert.match(result!.coverUrl!, /\/covers\/cached\/.+\/thumb$/);
});

test("search strips FTS syntax and ignores punctuation-only queries", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  await h.service.searchExternal("dune");
  assert.equal(h.service.search('"Dune" -herbert* (').length, 1);
  assert.deepEqual(h.service.search("***"), []);
  assert.deepEqual(h.service.search("   "), []);
  assert.deepEqual(await h.service.searchExternal("***"), []);
  assert.deepEqual(await h.service.searchExternal("   "), []);
  assert.equal(calls.length, 1);
});

test("search never returns a book that only came from an account's library", async () => {
  const { calls, catalog } = recordingCatalog({ search: async (query) => {
    calls.push("isbn" in query ? `search-isbn:${query.isbn}` : `search:${query.text}`);
    return [];
  } });
  const h = harness({ catalog });
  h.service.resolveCover({ title: "My Private Manuscript", author: "" });
  assert.deepEqual(h.service.search("manuscript"), []);
  assert.deepEqual(await h.service.searchExternal("manuscript"), []);
  assert.deepEqual(h.service.search("manuscript"), []);
  assert.deepEqual(calls, ["search:manuscript"]);
});

test("nobody is admin when ADMIN_USER_ID is blank", () => {
  assert.equal(harness().service.isAdmin(""), false);
  assert.equal(harness().service.isAdmin("u1"), false);
  const h = harness({ adminUserId: "u1" });
  assert.equal(h.service.isAdmin("u1"), true);
  assert.equal(h.service.isAdmin("u2"), false);
});

test("rejecting a cover blocks its URL, clears the pointer and queues the book first", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await h.service.processBook(id, "background");
  h.enqueued.length = 0;

  assert.deepEqual(h.service.rejectCover(orlando), { url: null, fullUrl: null, pending: true, upgrading: false });
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "front" }]);
  assert.equal(h.repo.getBook(id)!.cover_image_id, null);
  assert.deepEqual([...h.repo.listRejectedUrls(id)], ["https://a/1"]);

  await h.service.processBook(id, "background");
  assert.equal(h.repo.getBook(id)!.cover_status, "missing");
});

test("rejecting a migrated cover with no recorded URL just clears it", () => {
  const h = harness();
  const book = h.repo.createBook({ title: "", author: "", isbn: "9780141184272" }, ["isbn:9780141184272"], "2026-01-01T00:00:00.000Z");
  h.repo.insertImage({ id: "legacy", book_id: book.id, source: "openlibrary", source_url: null, width: 300, height: 460, byte_size: 1, created_at: "2026-01-01T00:00:00.000Z" });
  h.repo.setCover(book.id, { imageId: "legacy", status: "low_res", checkedAt: "1970-01-01T00:00:00.000Z" });
  h.service.rejectCover(orlando);
  assert.equal(h.repo.getBook(book.id)!.cover_image_id, null);
  assert.equal(h.repo.listRejectedUrls(book.id).size, 0);
});

test("rejecting an unknown book fails", () => {
  assert.throws(() => harness().service.rejectCover(orlando), BookNotFoundError);
});

test("an uploaded cover becomes manual and the worker leaves it alone", async () => {
  const calls: string[] = [];
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1", calls), openlibrary: emptySource } });
  const photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#224466" } }).jpeg().toBuffer();
  const cover = await h.service.uploadCover(orlando, photo);
  const id = h.bookId("isbn:9780141184272");
  const book = h.repo.getBook(id)!;
  assert.equal(book.cover_status, "manual");
  assert.equal(cover.url, `https://api.test/covers/cached/${book.cover_image_id}/thumb`);
  assert.equal(h.repo.getImage(book.cover_image_id!)!.source, "upload");
  await h.service.processBook(id, "background");
  assert.deepEqual(calls, []);
});

test("an upload clears a pending upgrade so the tick stops requeueing the book", async () => {
  const h = harness();
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  h.repo.setUpgradeWanted(id, "2026-01-01T00:00:00.000Z");
  const photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#224466" } }).jpeg().toBuffer();
  const cover = await h.service.uploadCover(orlando, photo);
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, null);
  assert.equal(cover.upgrading, false);
  assert.deepEqual(h.repo.listUpgradeWantedIds(null, 100).ids, []);
});

test("uploads that are too large or not images are refused", async () => {
  const h = harness();
  await assert.rejects(h.service.uploadCover(orlando, Buffer.alloc(20 * 1024 * 1024 + 1)), FileTooLargeError);
  await assert.rejects(h.service.uploadCover(orlando, Buffer.from("not an image")), InvalidImageError);
  await assert.rejects(h.service.uploadCover({ title: "?!" }, Buffer.from("x")), BookNotFoundError);
});

test("a lookup running while the admin uploads does not overwrite the upload", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const slow: CoverSource = { byIsbn: async () => { await gate; return [{ source: "apple", url: "https://a/1" }]; }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: slow, openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  const running = h.service.processBook(id, "background");
  const photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#224466" } }).jpeg().toBuffer();
  await h.service.uploadCover(orlando, photo);
  release();
  await running;
  assert.equal(h.repo.getBook(id)!.cover_status, "manual");
});

test("an admin reject during an in-flight lookup is not undone by that lookup", async () => {
  let gate: Promise<void> = Promise.resolve();
  let release: () => void = () => {};
  const slow: CoverSource = { byIsbn: async () => { await gate; return [{ source: "apple", url: "https://a/wrong" }]; }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: slow, openlibrary: emptySource } });
  h.sizes.set("https://a/wrong", [300, 460]);
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await h.service.processBook(id, "background");
  assert.equal(h.repo.getBook(id)!.cover_status, "low_res");

  h.sizes.set("https://a/wrong", [350, 520]);
  gate = new Promise((resolve) => { release = resolve; });
  const running = h.service.processBook(id, "background");
  h.service.rejectCover(orlando);
  release();
  await running;

  const rejected = h.repo.getBook(id)!;
  assert.equal(rejected.cover_image_id, null);
  assert.equal(rejected.cover_status, null);
  assert.deepEqual([...h.repo.listRejectedUrls(id)], ["https://a/wrong"]);

  gate = Promise.resolve();
  await h.service.processBook(id, "background");
  const rerun = h.repo.getBook(id)!;
  assert.equal(rerun.cover_image_id, null);
  assert.equal(rerun.cover_status, "missing");
});

test("an edition with a different ISBN gets its own catalog book instead of the title-matched one", () => {
  const { service, repo } = harness();
  service.resolveCover({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  const first = repo.findBookByKey("isbn:9780441013593")!;
  service.resolveCover({ isbn: "9780593099322", title: "Dune: Deluxe Edition", author: "Frank Herbert" });
  const deluxe = repo.findBookByKey("isbn:9780593099322")!;
  assert.ok(deluxe);
  assert.notEqual(deluxe.id, first.id);
  service.resolveCover({ title: "Complete Works: Volume 1", author: "A Poet" });
  service.resolveCover({ title: "Complete Works: Volume 2", author: "A Poet" });
  assert.notEqual(repo.findBookByKey("ta:complete works|a poet|1")?.id, repo.findBookByKey("ta:complete works|a poet|2")?.id);
});

test("an ISBN lookup adopts a title-matched catalog book that has no ISBN of its own", () => {
  const { service, repo } = harness();
  service.resolveCover({ title: "Dune", author: "Frank Herbert" });
  const first = repo.findBookByKey("ta:dune|frank herbert|")!;
  assert.ok(first);
  service.resolveCover({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  assert.equal(repo.findBookByKey("isbn:9780441013593")?.id, first.id);
});

type SourceName = "isbndb" | "apple" | "openlibrary";
const PORTUGUESE = { isbn: "9789722518888", title: "Orlando", author: "Virginia Woolf" };

function recording(name: SourceName, calls: string[], url?: string): CoverSource {
  return {
    byIsbn: async () => {
      calls.push(name);
      return url ? [{ source: name, url }] : [];
    },
    byTitle: async () => []
  };
}

function unavailable(name: SourceName, calls: string[]): CoverSource {
  return {
    byIsbn: async () => {
      calls.push(name);
      throw new SourceUnavailableError(name, "HTTP 429");
    },
    byTitle: async () => []
  };
}

function withCover(h: ReturnType<typeof harness>, id: string, source: SourceName, width: number, status: "good" | "low_res" = "good") {
  const imageId = `existing-${source}-${width}`;
  h.repo.insertImage({ id: imageId, book_id: id, source, source_url: `https://${source}/existing`, width, height: Math.round(width * 1.5), byte_size: 1, created_at: "2026-09-01T00:00:00.000Z" });
  h.repo.setCover(id, { imageId, status, checkedAt: "2026-09-01T00:00:00.000Z" });
  return imageId;
}

function prepare(lookup: typeof orlando, sources: Deps["sources"], sizes: Array<[string, number]> = []) {
  const h = harness({ sources });
  for (const [url, width] of sizes) h.sizes.set(url, [width, Math.round(width * 1.5)]);
  h.service.resolveCover(lookup);
  h.enqueued.length = 0;
  return { h, id: h.bookId(`isbn:${lookup.isbn}`) };
}

test("a fast lookup asks ISBNdb and Open Library and never Apple", async () => {
  const calls: string[] = [];
  const { h, id } = prepare(orlando, {
    isbndb: recording("isbndb", calls, "https://i/1"),
    apple: recording("apple", calls, "https://a/1"),
    openlibrary: recording("openlibrary", calls, "https://o/1")
  }, [["https://i/1", 300], ["https://a/1", 900], ["https://o/1", 900]]);
  await h.service.processBook(id, "front");
  assert.deepEqual(calls, ["isbndb", "openlibrary"]);
  const book = h.repo.getBook(id)!;
  assert.equal(book.cover_status, "good");
  assert.equal(h.repo.getImage(book.cover_image_id!)!.source, "openlibrary");
  assert.deepEqual(h.enqueued, []);
});

test("a good ISBNdb cover on an English ISBN finishes without an upgrade", async () => {
  const calls: string[] = [];
  const { h, id } = prepare(orlando, { isbndb: recording("isbndb", calls, "https://i/1"), apple: recording("apple", calls), openlibrary: emptySource }, [["https://i/1", 900]]);
  await h.service.processBook(id, "normal");
  assert.equal(h.repo.getBook(id)!.cover_status, "good");
  assert.deepEqual(calls, ["isbndb"]);
  assert.deepEqual(h.enqueued, []);
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, null);
});

test("a good ISBNdb cover on a Portuguese ISBN queues an Apple upgrade", async () => {
  const { h, id } = prepare(PORTUGUESE, { isbndb: recording("isbndb", [], "https://i/1"), apple: emptySource, openlibrary: emptySource }, [["https://i/1", 900]]);
  await h.service.processBook(id, "normal");
  assert.equal(h.repo.getBook(id)!.cover_status, "good");
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
});

test("a good Open Library cover on a Portuguese ISBN queues no upgrade", async () => {
  const { h, id } = prepare(PORTUGUESE, { isbndb: null, apple: emptySource, openlibrary: recording("openlibrary", [], "https://o/1") }, [["https://o/1", 900]]);
  await h.service.processBook(id, "normal");
  assert.deepEqual(h.enqueued, []);
});

test("a cover with an upgrade pending is served as upgrading, and a settled one is not", async () => {
  const { h, id } = prepare(orlando, { isbndb: recording("isbndb", [], "https://i/1"), apple: emptySource, openlibrary: emptySource }, [["https://i/1", 300]]);
  await h.service.processBook(id, "normal");
  assert.equal(h.service.resolveCover(orlando).upgrading, true);
  await h.service.processBook(id, "upgrade");
  const settled = h.service.resolveCover(orlando);
  assert.equal(settled.url === null, false);
  assert.equal(settled.upgrading, false);
});

test("a fast lookup that ends missing queues an upgrade", async () => {
  const { h, id } = prepare(orlando, { isbndb: emptySource, apple: emptySource, openlibrary: emptySource });
  await h.service.processBook(id, "front");
  assert.equal(h.repo.getBook(id)!.cover_status, "missing");
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
});

test("a fast lookup that ends low_res queues an upgrade", async () => {
  const { h, id } = prepare(orlando, { isbndb: recording("isbndb", [], "https://i/1"), apple: emptySource, openlibrary: emptySource }, [["https://i/1", 300]]);
  await h.service.processBook(id, "normal");
  assert.equal(h.repo.getBook(id)!.cover_status, "low_res");
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
});

test("without an ISBNdb key the fast lane uses Open Library and a low_res result queues an upgrade", async () => {
  const calls: string[] = [];
  const { h, id } = prepare(orlando, { isbndb: null, apple: recording("apple", calls, "https://a/1"), openlibrary: recording("openlibrary", calls, "https://o/1") }, [["https://o/1", 300], ["https://a/1", 900]]);
  await h.service.processBook(id, "normal");
  assert.deepEqual(calls, ["openlibrary"]);
  assert.equal(h.repo.getBook(id)!.cover_status, "low_res");
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
});

test("a fast lookup that could not complete backs off and queues no upgrade", async () => {
  const { h, id } = prepare(orlando, { isbndb: unavailable("isbndb", []), apple: emptySource, openlibrary: emptySource });
  await h.service.processBook(id, "normal");
  assert.equal(h.repo.getBook(id)!.cover_status, null);
  assert.deepEqual(h.enqueued, []);
});

test("a background lookup asks Apple first and runs the full chain", async () => {
  const calls: string[] = [];
  const { h, id } = prepare(orlando, {
    isbndb: recording("isbndb", calls, "https://i/1"),
    apple: recording("apple", calls, "https://a/1"),
    openlibrary: recording("openlibrary", calls)
  }, [["https://a/1", 300], ["https://i/1", 300]]);
  await h.service.processBook(id, "background");
  assert.deepEqual(calls, ["apple", "isbndb", "openlibrary"]);
  assert.deepEqual(h.enqueued, []);
});

test("an upgrade lookup asks only Apple and fills a missing cover", async () => {
  const calls: string[] = [];
  const { h, id } = prepare(orlando, {
    isbndb: recording("isbndb", calls, "https://i/1"),
    apple: recording("apple", calls, "https://a/1"),
    openlibrary: recording("openlibrary", calls, "https://o/1")
  }, [["https://a/1", 350]]);
  await h.service.processBook(id, "upgrade");
  assert.deepEqual(calls, ["apple"]);
  const book = h.repo.getBook(id)!;
  assert.equal(book.cover_status, "low_res");
  assert.equal(h.repo.getImage(book.cover_image_id!)!.source, "apple");
  assert.deepEqual(h.enqueued, []);
});

test("an upgrade replaces a narrower cover and records the check", async () => {
  const { h, id } = prepare(orlando, { isbndb: null, apple: recording("apple", [], "https://a/1"), openlibrary: emptySource }, [["https://a/1", 900]]);
  const old = withCover(h, id, "openlibrary", 300, "low_res");
  await h.service.processBook(id, "upgrade");
  const book = h.repo.getBook(id)!;
  assert.notEqual(book.cover_image_id, old);
  assert.equal(h.repo.getImage(book.cover_image_id!)!.source, "apple");
  assert.equal(book.cover_status, "good");
  assert.equal(book.cover_checked_at, "2026-10-01T00:00:00.000Z");
  assert.ok(h.files.has(`${book.cover_image_id}.webp`));
  assert.deepEqual(h.enqueued, []);
});

test("an upgrade sets low_res when Apple's cover is better but still narrow", async () => {
  const { h, id } = prepare(orlando, { isbndb: null, apple: recording("apple", [], "https://a/1"), openlibrary: emptySource }, [["https://a/1", 350]]);
  withCover(h, id, "openlibrary", 300, "low_res");
  await h.service.processBook(id, "upgrade");
  assert.equal(h.repo.getBook(id)!.cover_status, "low_res");
  assert.equal(h.repo.getImage(h.repo.getBook(id)!.cover_image_id!)!.width, 350);
});

test("an upgrade replaces a Portuguese ISBNdb cover with a narrower good Apple cover", async () => {
  const { h, id } = prepare(PORTUGUESE, { isbndb: null, apple: recording("apple", [], "https://a/1"), openlibrary: emptySource }, [["https://a/1", 500]]);
  const old = withCover(h, id, "isbndb", 800);
  await h.service.processBook(id, "upgrade");
  const book = h.repo.getBook(id)!;
  assert.notEqual(book.cover_image_id, old);
  assert.equal(h.repo.getImage(book.cover_image_id!)!.source, "apple");
  assert.equal(book.cover_status, "good");
  assert.deepEqual(h.enqueued, []);
});

test("an upgrade does not replace a Portuguese ISBNdb cover with a low-res Apple cover", async () => {
  const { h, id } = prepare(PORTUGUESE, { isbndb: null, apple: recording("apple", [], "https://a/1"), openlibrary: emptySource }, [["https://a/1", 300]]);
  const old = withCover(h, id, "isbndb", 800);
  await h.service.processBook(id, "upgrade");
  assert.equal(h.repo.getBook(id)!.cover_image_id, old);
});

test("an upgrade keeps an English ISBNdb cover that is wider than Apple's", async () => {
  const { h, id } = prepare(orlando, { isbndb: null, apple: recording("apple", [], "https://a/1"), openlibrary: emptySource }, [["https://a/1", 500]]);
  const old = withCover(h, id, "isbndb", 800);
  await h.service.processBook(id, "upgrade");
  const book = h.repo.getBook(id)!;
  assert.equal(book.cover_image_id, old);
  assert.equal(book.cover_status, "good");
  assert.equal(book.cover_checked_at, "2026-10-01T00:00:00.000Z");
  assert.deepEqual(h.enqueued, []);
});

test("an upgrade that finds nothing queues nothing and keeps the cover", async () => {
  const { h, id } = prepare(orlando, { isbndb: null, apple: emptySource, openlibrary: emptySource });
  const old = withCover(h, id, "openlibrary", 300, "low_res");
  await h.service.processBook(id, "upgrade");
  const book = h.repo.getBook(id)!;
  assert.equal(book.cover_image_id, old);
  assert.equal(book.cover_status, "low_res");
  assert.deepEqual(h.enqueued, []);
});

test("an upgrade whose Apple lookup is unavailable backs off and queues nothing", async () => {
  const { h, id } = prepare(orlando, { isbndb: null, apple: unavailable("apple", []), openlibrary: emptySource });
  await h.service.processBook(id, "upgrade");
  assert.equal(h.repo.getBook(id)!.cover_status, null);
  assert.deepEqual(h.enqueued, []);
  h.service.enqueueCovers([orlando]);
  assert.deepEqual(h.enqueued, []);
});

test("a fast lookup that ends low_res leads the real worker to a second, Apple-only lookup on the upgrade lane", async () => {
  const calls: string[] = [];
  const lanes: string[] = [];
  const h = harness({
    sources: { isbndb: recording("isbndb", calls, "https://i/1"), apple: recording("apple", calls, "https://a/1"), openlibrary: emptySource },
    enqueue: (bookId, priority) => worker.enqueue(bookId, priority)
  });
  const worker = createCoverWorker((bookId, lane) => { lanes.push(lane); return h.service.processBook(bookId, lane); }, (error) => { throw error; });
  h.sizes.set("https://i/1", [300, 450]);
  h.sizes.set("https://a/1", [900, 1350]);
  h.service.resolveCover(orlando);
  await worker.idle();
  assert.deepEqual(lanes, ["normal", "upgrade"]);
  assert.deepEqual(calls, ["isbndb", "apple"]);
  const book = h.repo.getBook(h.bookId("isbn:9780141184272"))!;
  assert.equal(book.cover_status, "good");
  assert.equal(h.repo.getImage(book.cover_image_id!)!.source, "apple");
  assert.equal(book.cover_upgrade_wanted_at, null);
});

test("a fast lookup that wants an upgrade records it", async () => {
  const { h, id } = prepare(orlando, { isbndb: recording("isbndb", [], "https://i/1"), apple: emptySource, openlibrary: emptySource }, [["https://i/1", 300]]);
  await h.service.processBook(id, "normal");
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, "2026-10-01T00:00:00.000Z");
});

test("a completed upgrade clears the wanted mark whether or not it replaced the cover", async () => {
  const { h, id } = prepare(orlando, { isbndb: null, apple: emptySource, openlibrary: emptySource });
  withCover(h, id, "openlibrary", 300, "low_res");
  h.repo.setUpgradeWanted(id, "2026-10-01T00:00:00.000Z");
  await h.service.processBook(id, "upgrade");
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, null);
});

test("an unavailable upgrade keeps the wanted mark", async () => {
  const { h, id } = prepare(orlando, { isbndb: null, apple: unavailable("apple", []), openlibrary: emptySource });
  withCover(h, id, "openlibrary", 300, "low_res");
  h.repo.setUpgradeWanted(id, "2026-10-01T00:00:00.000Z");
  await h.service.processBook(id, "upgrade");
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, "2026-10-01T00:00:00.000Z");
});

test("enqueueUnchecked queues books that still want an upgrade on the upgrade lane and respects backoff", async () => {
  const { h, id } = prepare(orlando, { isbndb: null, apple: unavailable("apple", []), openlibrary: emptySource });
  withCover(h, id, "openlibrary", 300, "low_res");
  h.repo.setUpgradeWanted(id, "2026-10-01T00:00:00.000Z");
  h.service.enqueueUnchecked();
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
  h.enqueued.length = 0;
  await h.service.processBook(id, "upgrade");
  h.service.enqueueUnchecked();
  assert.deepEqual(h.enqueued, []);
  h.advance(10 * 60 * 1000);
  h.service.enqueueUnchecked();
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
});

test("details store the catalog's work key, fill-only", async () => {
  const details = (workKey: string) => async () => ({ metadata: { summary: "Spice.", rating: null, ratingCount: 0, sourceUrl: "https://openlibrary.org/works/OL1W", genres: [], pages: null, publisher: null, year: null, translator: null }, sources: ["openlibrary" as const], summarySource: "openlibrary" as const, workKey });
  const h = harness({ catalog: recordingCatalog({ fetchDetails: details("/works/OL1W") }).catalog });
  await h.service.getDetails(dune);
  assert.equal(h.repo.findBookByKey("isbn:9780441013593")!.ol_work_key, "OL1W");

  const keep = harness({ catalog: recordingCatalog({ fetchDetails: details("/works/OL2W") }).catalog });
  keep.service.resolveCover(dune);
  keep.repo.setWorkKey(keep.bookId("isbn:9780441013593"), "OL9W");
  await keep.service.getDetails(dune);
  assert.equal(keep.repo.findBookByKey("isbn:9780441013593")!.ol_work_key, "OL9W");
});

test("an outside search stores the work key on created and existing rows", async () => {
  const hit = (workKey: string | null) => ({ result: { title: "Dune", authors: ["Frank Herbert"], year: 1965, isbn: "9780441013593", publisher: null, coverUrl: null, genres: [] }, olCoverId: null, workKey, source: "openlibrary" as const });
  const created = harness({ catalog: recordingCatalog({ search: async () => [hit("/works/OL1W")] }).catalog });
  await created.service.searchExternal("dune");
  assert.equal(created.repo.findBookByKey("isbn:9780441013593")!.ol_work_key, "OL1W");

  const existing = harness({ catalog: recordingCatalog({ search: async () => [hit("/works/OL1W")] }).catalog });
  existing.service.resolveCover(dune);
  assert.equal(existing.repo.findBookByKey("isbn:9780441013593")!.ol_work_key, null);
  await existing.service.searchExternal("dune");
  assert.equal(existing.repo.findBookByKey("isbn:9780441013593")!.ol_work_key, "OL1W");

  const none = harness({ catalog: recordingCatalog({ search: async () => [hit(null)] }).catalog });
  await none.service.searchExternal("dune");
  assert.equal(none.repo.findBookByKey("isbn:9780441013593")!.ol_work_key, null);
});

test("an outside search puts new hits with one work key in one work, leaving no throwaway work behind", async () => {
  const hit = (isbn: string, title: string) => ({ result: { title, authors: ["Frank Herbert"], year: null, isbn, publisher: null, coverUrl: null, genres: [] }, olCoverId: null, workKey: "/works/OL1W", source: "openlibrary" as const });
  const h = harness({ catalog: recordingCatalog({ search: async () => [hit("9780441013593", "Dune"), hit("9789722046114", "Duna")] }).catalog });
  await h.service.searchExternal("dune");
  const english = h.repo.findBookByKey("isbn:9780441013593")!;
  const portuguese = h.repo.findBookByKey("isbn:9789722046114")!;
  assert.equal(portuguese.work_id, english.work_id);
  assert.deepEqual(h.db.prepare("SELECT ol_work_key, title, merged_into FROM works").all().map((work) => ({ ...work })), [{ ol_work_key: "OL1W", title: "Dune", merged_into: null }]);
});

function backfillBooks(h: ReturnType<typeof harness>, count: number) {
  for (let index = 0; index < count; index++) {
    h.service.resolveCover({ isbn: null, title: `Book ${index}`, author: "Author" });
    h.advance(1000);
  }
  return h.repo.listUncheckedDetailIds(count);
}

const spiceAnswer = { metadata: { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction" as const], pages: 544, publisher: "Ace", year: 1965, translator: null }, sources: ["openlibrary" as const], summarySource: "openlibrary" as const };

test("the details backfill takes the oldest unchecked books up to the limit, one lookup at a time", async () => {
  const seen: string[] = [];
  let active = 0;
  let overlap = 0;
  const catalog: Catalog = {
    fetchDetails: async (lookup) => {
      seen.push(lookup.title);
      overlap = Math.max(overlap, ++active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return spiceAnswer;
    },
    search: async () => []
  };
  const h = harness({ backgroundCatalog: catalog });
  const ids = backfillBooks(h, 3);
  await h.service.backfillDetails(2);
  assert.deepEqual(seen, ["Book 0", "Book 1"]);
  assert.equal(overlap, 1);
  assert.deepEqual(ids.map((id) => h.repo.getBook(id)!.details_status), ["found", "found", null]);
  assert.equal(h.repo.getBook(ids[0]!)!.summary, "Spice.");
  assert.equal(h.repo.getBook(ids[0]!)!.data_sources, '["openlibrary"]');
});

test("the details backfill saves through the merge rules and leaves a publisher synopsis alone", async () => {
  const h = harness({ backgroundCatalog: { fetchDetails: async () => spiceAnswer, search: async () => [] } });
  const [id] = backfillBooks(h, 1);
  h.repo.mergeDetails(id!, { summary: "Sinopse da editora.", pages: 500, year: null, publisher: null, translator: "Maria" }, "publisher");
  await h.service.backfillDetails(50);
  const row = h.repo.getBook(id!)!;
  assert.deepEqual([row.summary, row.summary_source, row.pages, row.year, row.publisher, row.translator, row.details_status], ["Sinopse da editora.", "publisher", 500, 1965, "Ace", "Maria", "found"]);
});

test("the details backfill never uses the catalog that serves users", async () => {
  const h = harness({ backgroundCatalog: { fetchDetails: async () => spiceAnswer, search: async () => [] } });
  const [id] = backfillBooks(h, 1);
  await h.service.backfillDetails(50);
  assert.equal(h.repo.getBook(id!)!.details_status, "found");
});

test("an unavailable source leaves the book unchecked, is retried later and does not stop the batch", async () => {
  const outcomes = new Map<string, Error | null>([
    ["Book 0", new SourceUnavailableError("openlibrary", "HTTP 503")],
    ["Book 1", null]
  ]);
  const catalog: Catalog = {
    fetchDetails: async (lookup) => {
      const failure = outcomes.get(lookup.title);
      if (failure) throw failure;
      return spiceAnswer;
    },
    search: async () => []
  };
  const h = harness({ backgroundCatalog: catalog });
  const ids = backfillBooks(h, 2);
  assert.equal(await h.service.backfillDetails(50), null);
  assert.deepEqual(ids.map((id) => h.repo.getBook(id)!.details_status), [null, "found"]);
  assert.deepEqual(h.warnings, [{ details: { bookId: ids[0], source: "openlibrary", error: "openlibrary unavailable: HTTP 503" }, message: "details source unavailable" }]);
  outcomes.set("Book 0", null);
  await h.service.backfillDetails(50);
  assert.deepEqual(ids.map((id) => h.repo.getBook(id)!.details_status), ["found", "found"]);
});

test("a paused source ends the batch at once, stamps nothing and reports when to resume", async () => {
  const seen: string[] = [];
  const catalog: Catalog = {
    fetchDetails: async (lookup) => {
      seen.push(lookup.title);
      if (lookup.title === "Book 1") throw new SourcePausedError("isbndb", "paused", { retryAt: 123_456 });
      return spiceAnswer;
    },
    search: async () => []
  };
  const h = harness({ backgroundCatalog: catalog });
  const ids = backfillBooks(h, 4);
  assert.equal(await h.service.backfillDetails(50), 123_456);
  assert.deepEqual(seen, ["Book 0", "Book 1"]);
  assert.deepEqual(ids.map((id) => h.repo.getBook(id)!.details_status), ["found", null, null, null]);
  assert.deepEqual(ids.map((id) => h.repo.getBook(id)!.details_checked_at === null), [false, true, true, true]);
  assert.deepEqual(h.warnings, []);
});

test("a bug in a details lookup propagates instead of being skipped", async () => {
  const h = harness({ backgroundCatalog: { fetchDetails: async () => { throw new TypeError("boom"); }, search: async () => [] } });
  backfillBooks(h, 1);
  await assert.rejects(h.service.backfillDetails(50), TypeError);
});

test("the details backfill skips books already checked, found or missing", async () => {
  const seen: string[] = [];
  const h = harness({ backgroundCatalog: { fetchDetails: async (lookup) => { seen.push(lookup.title); return null; }, search: async () => [] } });
  const [found, missing, fresh] = backfillBooks(h, 3);
  h.repo.saveDetails(found!, spiceAnswer.metadata, ["openlibrary"], "openlibrary", "2026-10-01T00:00:00.000Z");
  h.repo.markDetailsMissing(missing!, "2026-10-01T00:00:00.000Z");
  await h.service.backfillDetails(50);
  assert.deepEqual(seen, ["Book 2"]);
  assert.equal(h.repo.getBook(fresh!)!.details_status, "missing");
  await h.service.backfillDetails(50);
  assert.deepEqual(seen, ["Book 2"]);
});

test("an aborted details backfill starts no further lookups", async () => {
  const seen: string[] = [];
  const controller = new AbortController();
  const h = harness({ backgroundCatalog: { fetchDetails: async (lookup) => { seen.push(lookup.title); controller.abort(); return null; }, search: async () => [] } });
  backfillBooks(h, 3);
  await h.service.backfillDetails(50, controller.signal);
  assert.deepEqual(seen, ["Book 0"]);
});

test("a user's details request jumps ahead of the backfill's queued lookups", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(new URL(String(input)).searchParams.get("isbn") ?? String(input));
    return Response.json({ docs: [] });
  }) as typeof fetch;
  try {
    const throttle = createThrottle(0);
    let release!: () => void;
    const held = throttle(() => new Promise<void>((resolve) => { release = resolve; }), { urgent: true });
    const h = harness({
      catalog: createOpenLibraryCatalog(throttle),
      backgroundCatalog: createOpenLibraryCatalog(throttle, false)
    });
    h.service.resolveCover(orlando);
    const backfill = h.service.backfillDetails(50);
    await new Promise((resolve) => setImmediate(resolve));
    const user = h.service.getDetails(dune);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(requested, []);
    release();
    await Promise.all([held, backfill, user]);
    assert.deepEqual(requested, ["9780441013593", "9780141184272"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failing books move behind untried ones, so a second batch reaches a good newer book", async () => {
  const catalog: Catalog = {
    fetchDetails: async (lookup) => {
      if (lookup.title === "Good") return spiceAnswer;
      throw new SourceUnavailableError("openlibrary", "HTTP 503");
    },
    search: async () => []
  };
  const h = harness({ backgroundCatalog: catalog });
  const failing = backfillBooks(h, 50);
  h.service.resolveCover({ isbn: null, title: "Good", author: "Author" });
  const good = h.repo.listUncheckedDetailIds(51)[50]!;
  h.advance(1000);
  await h.service.backfillDetails(50);
  assert.equal(h.repo.getBook(good)!.details_status, null);
  assert.ok(failing.every((id) => h.repo.getBook(id)!.details_checked_at !== null && h.repo.getBook(id)!.details_status === null));
  await h.service.backfillDetails(50);
  assert.equal(h.repo.getBook(good)!.details_status, "found");
});

test("an attempted but unchecked book is still looked up by a user's request", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog, backgroundCatalog: { fetchDetails: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); }, search: async () => [] } });
  h.service.resolveCover(dune);
  await h.service.backfillDetails(50);
  assert.equal((await h.service.getDetails(dune))?.summary, "Spice.");
  assert.deepEqual(calls, ["details:9780441013593"]);
});

test("a strict background catalog leaves a book unchanged when ISBNdb is paused after a partial Open Library answer", async () => {
  const partial = { metadata: { summary: null, rating: 4, ratingCount: 9, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction" as const], pages: 300, publisher: null, year: null, translator: null }, sources: ["openlibrary" as const], summarySource: null };
  const primary: Catalog = { fetchDetails: async () => partial, search: async () => [] };
  const secondary: Catalog = { fetchDetails: async () => { throw new SourcePausedError("isbndb", "paused", { retryAt: 1 }); }, search: async () => [] };
  const h = harness({ backgroundCatalog: createCompositeCatalog(primary, secondary, true) });
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await h.service.backfillDetails(50);
  const row = h.repo.getBook(id)!;
  assert.deepEqual([row.details_status, row.rating, row.genres, row.pages, row.summary, row.data_sources, row.details_checked_at], [null, null, "[]", null, null, "[]", null]);
});

function lookupBooks(h: ReturnType<typeof harness>, specs: Array<{ isbn: string; createdBy?: "seed" | "publisher"; checked?: boolean }>) {
  return specs.map(({ isbn, createdBy, checked = true }, index) => {
    const book = h.repo.createBook({ title: `Book ${index}`, author: "Someone", isbn, createdBy }, [`isbn:${isbn}`], `2026-09-0${index + 1}T00:00:00.000Z`);
    if (checked) h.repo.markDetailsMissing(book.id, "2026-09-30T00:00:00.000Z");
    return book.id;
  });
}

function editionRecords(answer: (isbn: string) => Promise<{ title: string; workKey: string | null; languages: string[] } | null>, calls: string[] = []) {
  return { fetchEditionRecord: async (isbn: string) => { calls.push(isbn); return answer(isbn); } };
}

test("the work key lookup asks for user editions first, then seed ones, and never for publisher, keyed or unchecked editions", async () => {
  const calls: string[] = [];
  const h = harness({ editionRecords: editionRecords(async () => null, calls) });
  const [publisher, seed, user] = lookupBooks(h, [{ isbn: "9789720000001", createdBy: "publisher" }, { isbn: "9789720000002", createdBy: "seed" }, { isbn: "9789720000003" }]);
  lookupBooks(h, [{ isbn: "9789720000004", checked: false }]);
  h.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], "2026-09-01T00:00:00.000Z");
  h.repo.markDetailsMissing(h.bookId("isbn:9780441013593"), "2026-09-30T00:00:00.000Z");
  assert.equal(await h.service.backfillWorkKeys(50), null);
  assert.deepEqual(calls, ["9789720000003", "9789720000002"]);
  assert.deepEqual([publisher, seed, user].map((id) => h.repo.getBook(id!)!.work_checked_at), [null, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
});

test("a work key found by ISBN keys the edition, joins the keyed work and replaces its language", async () => {
  const h = harness({ editionRecords: editionRecords(async () => ({ title: "Os Maias", workKey: "/works/OL846513W", languages: ["/languages/por"] })) });
  const keyed = h.repo.createBook({ title: "The Maias", author: "Eça de Queirós", isbn: "9780141394459", workKey: "OL846513W" }, ["isbn:9780141394459"], "2026-09-01T00:00:00.000Z");
  const [id] = lookupBooks(h, [{ isbn: "9789725681367" }]);
  h.repo.setLanguage(id!, "en");
  await h.service.backfillWorkKeys(50);
  const book = h.repo.getBook(id!)!;
  assert.deepEqual([book.ol_work_key, book.work_id, book.language], ["OL846513W", keyed.work_id, "pt-PT"]);
});

test("a miss is stamped and asked again only after 30 days", async () => {
  const calls: string[] = [];
  const h = harness({ editionRecords: editionRecords(async () => null, calls) });
  lookupBooks(h, [{ isbn: "9789722541701" }]);
  await h.service.backfillWorkKeys(50);
  await h.service.backfillWorkKeys(50);
  assert.deepEqual(calls, ["9789722541701"]);
  h.advance(31 * DAY);
  await h.service.backfillWorkKeys(50);
  assert.deepEqual(calls, ["9789722541701", "9789722541701"]);
});

test("a record without a work changes nothing but the stamp", async () => {
  const h = harness({ editionRecords: editionRecords(async () => ({ title: "X", workKey: null, languages: ["/languages/por"] })) });
  const [id] = lookupBooks(h, [{ isbn: "9789722541701" }]);
  await h.service.backfillWorkKeys(50);
  const book = h.repo.getBook(id!)!;
  assert.deepEqual([book.ol_work_key, book.language, book.work_checked_at], [null, null, "2026-10-01T00:00:00.000Z"]);
});

test("a rate limit ends the batch unstamped and returns when to resume", async () => {
  const calls: string[] = [];
  const h = harness({ editionRecords: editionRecords(async () => { throw new SourceUnavailableError("openlibrary", "HTTP 429", { status: 429, retryAt: 123_456 }); }, calls) });
  const ids = lookupBooks(h, [{ isbn: "9789720000001" }, { isbn: "9789720000002" }]);
  assert.equal(await h.service.backfillWorkKeys(50), 123_456);
  assert.equal(calls.length, 1);
  assert.deepEqual(ids.map((id) => h.repo.getBook(id)!.work_checked_at), [null, null]);
});

test("a rate limit without a retry time still ends the batch unstamped", async () => {
  const calls: string[] = [];
  const h = harness({ editionRecords: editionRecords(async () => { throw new SourceUnavailableError("openlibrary", "HTTP 429", { status: 429 }); }, calls) });
  const ids = lookupBooks(h, [{ isbn: "9789720000001" }, { isbn: "9789720000002" }]);
  assert.equal(await h.service.backfillWorkKeys(50), Date.parse("2026-10-01T00:00:00.000Z") + 10 * 60 * 1000);
  assert.equal(calls.length, 1);
  assert.deepEqual(ids.map((id) => h.repo.getBook(id)!.work_checked_at), [null, null]);
  assert.deepEqual(h.warnings, []);
});

test("an outage without a retry time is warned about, stamped, and does not stop the batch", async () => {
  const h = harness({
    editionRecords: editionRecords(async (isbn) => {
      if (isbn === "9789720000001") throw new SourceUnavailableError("openlibrary", "HTTP 503", { status: 503 });
      return null;
    })
  });
  const ids = lookupBooks(h, [{ isbn: "9789720000001" }, { isbn: "9789720000002" }]);
  assert.equal(await h.service.backfillWorkKeys(50), null);
  assert.deepEqual(ids.map((id) => h.repo.getBook(id)!.work_checked_at), ["2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
  assert.deepEqual(h.warnings, [{ details: { bookId: ids[0], source: "openlibrary", error: "openlibrary unavailable: HTTP 503" }, message: "work key source unavailable" }]);
});

test("a bug in a work key lookup propagates", async () => {
  const h = harness({ editionRecords: editionRecords(async () => { throw new TypeError("boom"); }) });
  lookupBooks(h, [{ isbn: "9789720000001" }]);
  await assert.rejects(h.service.backfillWorkKeys(50), TypeError);
});

test("an aborted work key lookup starts no further requests", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  const h = harness({ editionRecords: editionRecords(async () => { controller.abort(); return null; }, calls) });
  lookupBooks(h, [{ isbn: "9789720000001" }, { isbn: "9789720000002" }]);
  await h.service.backfillWorkKeys(50, controller.signal);
  assert.equal(calls.length, 1);
});

test("enqueueUnchecked queues one batch per call, continues where it stopped, and wraps after a short page", () => {
  const h = harness();
  const at = "2026-09-01T00:00:00.000Z";
  const ids = Array.from({ length: COVER_ENQUEUE_BATCH + 1 }, (_, i) => h.repo.createBook({ title: `Book ${i}`, author: "Author", isbn: null }, [`ta:book ${i}|author|`], at).id);
  const queued = () => h.enqueued.splice(0).filter((entry) => entry.priority === "background").map((entry) => entry.bookId);

  h.service.enqueueUnchecked();
  assert.deepEqual(queued(), ids.slice(0, COVER_ENQUEUE_BATCH));

  h.service.enqueueUnchecked();
  assert.deepEqual(queued(), [ids[COVER_ENQUEUE_BATCH]]);

  h.service.enqueueUnchecked();
  assert.deepEqual(queued(), ids.slice(0, COVER_ENQUEUE_BATCH));
});

test("enqueueUpgrade queues one batch per call, continues where it stopped, and wraps after a short page", () => {
  const h = harness();
  const created = "2026-09-01T00:00:00.000Z";
  const ids = Array.from({ length: COVER_ENQUEUE_BATCH + 1 }, (_, i) => {
    const id = h.repo.createBook({ title: `Book ${i}`, author: "Author", isbn: null }, [`ta:book ${i}|author|`], created).id;
    h.repo.setCover(id, { imageId: null, status: "missing", checkedAt: created });
    h.repo.setUpgradeWanted(id, created);
    return id;
  });
  const queued = () => h.enqueued.splice(0).filter((entry) => entry.priority === "upgrade").map((entry) => entry.bookId);

  h.service.enqueueUnchecked();
  assert.deepEqual(queued(), ids.slice(0, COVER_ENQUEUE_BATCH));

  h.service.enqueueUnchecked();
  assert.deepEqual(queued(), [ids[COVER_ENQUEUE_BATCH]]);

  h.service.enqueueUnchecked();
  assert.deepEqual(queued(), ids.slice(0, COVER_ENQUEUE_BATCH));
});

test("enqueueUnchecked reaches the books behind a full page of books in backoff", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); } };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: emptySource } });
  const at = "2026-09-01T00:00:00.000Z";
  const ids = Array.from({ length: COVER_ENQUEUE_BATCH + 1 }, (_, i) => h.repo.createBook({ title: `Book ${i}`, author: "Author", isbn: null }, [`ta:book ${i}|author|`], at).id);
  for (const id of ids.slice(0, COVER_ENQUEUE_BATCH)) await h.service.processBook(id, "background");
  h.enqueued.length = 0;

  h.service.enqueueUnchecked();
  assert.deepEqual(h.enqueued, []);

  h.service.enqueueUnchecked();
  assert.deepEqual(h.enqueued, [{ bookId: ids[COVER_ENQUEUE_BATCH], priority: "background" }]);
});

const ENGLISH_WORK = "The story of a boy who leaves his village and the war that is waiting for him in the north.";
const workSummaryCatalog = () => recordingCatalog({
  fetchDetails: async () => ({ metadata: { summary: null, rating: 4, ratingCount: 3, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"], pages: null, publisher: null, year: null, translator: null }, sources: ["openlibrary"], summarySource: null, workKey: "/works/OL1W", workSummary: ENGLISH_WORK })
}).catalog;
const spiceCatalog = (workSummary: string) => recordingCatalog({
  fetchDetails: async () => ({ metadata: { summary: "Edition text.", rating: 4, ratingCount: 3, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"], pages: null, publisher: null, year: null, translator: null }, sources: ["openlibrary"], summarySource: "openlibrary", workKey: "/works/OL1W", workSummary })
}).catalog;

test("an edition without its own summary reads the work's, linked to Open Library", async () => {
  const h = harness({ catalog: workSummaryCatalog() });
  const details = await h.service.getDetails(dune);
  assert.deepEqual([details?.summary, details?.summarySource, details?.sourceUrl], [ENGLISH_WORK, "openlibrary", "https://openlibrary.org/works/OL1W"]);
  assert.equal(h.repo.findBookByKey("isbn:9780441013593")!.summary, null);
});

test("the work's summary is not shown on an edition in another language", async () => {
  const h = harness({ catalog: workSummaryCatalog() });
  const pt = { isbn: "9789722000000", title: "Duna", author: "Frank Herbert" };
  assert.equal((await h.service.getDetails(pt))?.summary, null);
  assert.equal((await h.service.getDetails(dune))?.summary, ENGLISH_WORK);
});

test("an edition's own summary wins over the work's and the work keeps the first writer", async () => {
  const h = harness({ catalog: spiceCatalog(ENGLISH_WORK) });
  assert.equal((await h.service.getDetails(dune))?.summary, "Edition text.");
  const other = { isbn: "9780441172719", title: "Dune", author: "Frank Herbert" };
  const second = harness({ catalog: spiceCatalog("Later work text.") });
  second.repo.setWorkSummary(second.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: other.isbn, workKey: "OL1W" }, ["isbn:" + other.isbn], "2026-10-01T00:00:00.000Z").id, "Earlier work text.");
  await second.service.getDetails(other);
  assert.equal(second.repo.getWorkSummary(second.bookId("isbn:" + other.isbn))?.summary, "Earlier work text.");
});

test("a publisher summary overrides the work's", async () => {
  const h = harness({ catalog: workSummaryCatalog() });
  await h.service.getDetails(dune);
  const id = h.bookId("isbn:9780441013593");
  h.repo.mergeDetails(id, { summary: "Sinopse da editora.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  h.repo.setPublisherUrl(id, "https://antigona.pt/products/dune");
  const details = await h.service.getDetails(dune);
  assert.deepEqual([details?.summary, details?.summarySource, details?.sourceUrl], ["Sinopse da editora.", "publisher", "https://antigona.pt/products/dune"]);
});
