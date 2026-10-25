import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import type { CoverPriority } from "./worker.js";

const scratch = mkdtempSync(join(tmpdir(), "books-service-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { createBooksService, storeCoverImage, COVER_ENQUEUE_BATCH } = await import("./booksService.js");
const { summaryHashOf } = await import("./domain/synopsis.js");
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
    save: async (id: string, extension: string, bytes: Buffer) => { files.set(`${id}.${extension}`, bytes); },
    read: async (id: string, extension: string) => files.get(`${id}.${extension}`) ?? null
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
      return size ? { full: Buffer.from(`full:${candidate.url}`), thumb: Buffer.from(`thumb:${candidate.url}`), width: size[0], height: size[1], color: null } : null;
    },
    enqueue: (bookId, priority = "normal") => { enqueued.push({ bookId, priority }); },
    publicUrlFor: (id, size) => `https://api.test/covers/cached/${id}/${size}`,
    adminUserId: "",
    warn: (details, message) => { warnings.push({ details, message }); },
    sharesArena: () => false,
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
      read: async () => null,
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
    blobs: { read: async () => null, save: async () => { throw new Error("R2 PUT failed: HTTP 403"); } }
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

test("a bnp summary has no source link", async () => {
  const h = harness({ catalog: recordingCatalog().catalog });
  h.service.resolveCover(dune);
  const id = h.bookId("isbn:9780441013593");
  h.repo.mergeDetails(id, { summary: "Resumo da Biblioteca Nacional.", pages: null, year: null, publisher: null, translator: null }, "bnp");
  const details = await h.service.getDetails(dune);
  assert.equal(h.repo.getBook(id)!.source_url, "https://openlibrary.org/works/OL1W");
  assert.deepEqual([details?.summarySource, details?.sourceUrl], ["bnp", ""]);
});

test("details of a hardcover summary", async () => {
  const h = harness({ catalog: recordingCatalog().catalog });
  h.service.resolveCover(dune);
  const id = h.bookId("isbn:9780441013593");
  h.repo.mergeDetails(id, { summary: "A long enough synopsis about sandworms and spice.", pages: null, year: null, publisher: null, translator: null }, "hardcover");
  const details = await h.service.getDetails(dune);
  assert.equal(h.repo.getBook(id)!.source_url, "https://openlibrary.org/works/OL1W");
  assert.deepEqual([details?.summarySource, details?.sourceUrl], ["hardcover", ""]);
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

test("an ISBN search answers from any book in the search index, seeded ones included", () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  h.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", createdBy: "seed" }, ["isbn:9780441013593"], "2026-10-01T00:00:00.000Z");
  assert.equal(h.service.search("978-0-441-01359-3")[0]!.title, "Dune");
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

const allende = "9789720044457";

function withBnp(outcome: (repo: ReturnType<typeof harness>["repo"]) => ReturnType<NonNullable<Deps["bnpLookup"]>>, overrides: Partial<Deps> = {}) {
  const asked: string[] = [];
  const h: ReturnType<typeof harness> = harness({ ...overrides, bnpLookup: async (isbn) => { asked.push(isbn); return outcome(h.repo); } });
  return { h, asked };
}

const saveBnpBook = (repo: ReturnType<typeof harness>["repo"], createdBy: "bnp" | "seed" = "bnp") =>
  repo.createBook({ title: "A casa dos espíritos", author: "Isabel Allende", isbn: allende, createdBy }, [`isbn:${allende}`], "2026-10-01T00:00:00.000Z");

test("a Portugal ISBN asks the BNP first and returns its book", async () => {
  const { calls, catalog } = recordingCatalog();
  const { h, asked } = withBnp(async (repo) => saveBnpBook(repo), { catalog });

  const results = await h.service.searchExternal("978-972-0-04445-7");

  assert.deepEqual(asked, [allende]);
  assert.deepEqual(calls, []);
  assert.deepEqual(results.map((result) => [result.title, result.isbn]), [["A casa dos espíritos", allende]]);
});

test("a BNP outage falls through to the catalog and warns", async () => {
  const { calls, catalog } = recordingCatalog();
  const { h, asked } = withBnp(async () => { throw new SourceUnavailableError("urn.porbase.org", "HTTP 503"); }, { catalog });

  const results = await h.service.searchExternal(allende);

  assert.deepEqual(asked, [allende]);
  assert.deepEqual(calls, [`search-isbn:${allende}`]);
  assert.equal(results[0]!.title, "Dune");
  assert.equal(h.warnings.length, 1);
  assert.equal(h.warnings[0]!.details.source, "urn.porbase.org");
});

test("a BNP miss falls through to the catalog", async () => {
  const { calls, catalog } = recordingCatalog();
  const { h, asked } = withBnp(async () => null, { catalog });

  const results = await h.service.searchExternal(allende);

  assert.deepEqual(asked, [allende]);
  assert.deepEqual(calls, [`search-isbn:${allende}`]);
  assert.equal(results[0]!.title, "Dune");
  assert.deepEqual(h.warnings, []);
});

test("a BNP failure other than an outage is not swallowed", async () => {
  const { calls, catalog } = recordingCatalog();
  const { h } = withBnp(async () => { throw new Error("disk full"); }, { catalog });

  await assert.rejects(h.service.searchExternal(allende), /disk full/);
  assert.deepEqual(calls, []);
});

test("a non-Portugal ISBN never asks the BNP", async () => {
  const { calls, catalog } = recordingCatalog();
  const { h, asked } = withBnp(async (repo) => saveBnpBook(repo), { catalog });

  await h.service.searchExternal("9780141439518");

  assert.deepEqual(asked, []);
  assert.deepEqual(calls, ["search-isbn:9780141439518"]);
});

test("a Portugal-prefixed ISBN with a wrong check digit never asks the BNP", async () => {
  const { calls, catalog } = recordingCatalog();
  const { h, asked } = withBnp(async (repo) => saveBnpBook(repo), { catalog });

  await h.service.searchExternal("9789720044458");
  await h.service.searchExternal("9720044458");

  assert.deepEqual(asked, []);
  assert.equal(calls.length, 2);
});

test("an ISBN already held from the BNP is returned without asking anyone", async () => {
  const { h, asked } = withBnp(async () => { throw new Error("BNP not expected"); });
  saveBnpBook(h.repo);

  const results = await h.service.searchExternal(allende);

  assert.deepEqual(asked, []);
  assert.deepEqual(results.map((result) => result.isbn), [allende]);
});

test("a Portugal ISBN held from another source still asks the BNP", async () => {
  const { calls, catalog } = recordingCatalog();
  const { h, asked } = withBnp(async (repo) => repo.findBookByKey(`isbn:${allende}`)!, { catalog });
  saveBnpBook(h.repo, "seed");

  await h.service.searchExternal(allende);

  assert.deepEqual(asked, [allende]);
  assert.deepEqual(calls, []);
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

test("a search hit fills the author of a saved book that has a title but no author", async () => {
  const hit = { result: { title: "Poemas", authors: ["Sophia de Mello Breyner Andresen"], year: null, isbn: "9789896414672", publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source: "openlibrary" as const };
  const h = harness({ catalog: recordingCatalog({ search: async () => [hit] }).catalog });
  const authorless = h.repo.createBook({ title: "Poemas", author: "", isbn: "9789896414672" }, ["isbn:9789896414672"], "2026-10-01T00:00:00.000Z");
  await h.service.searchExternal("poemas");
  assert.equal(h.repo.getBook(authorless.id)!.author, "Sophia de Mello Breyner Andresen");
});

test("a search hit that fills a saved book's author also claims its title key", async () => {
  const hit = { result: { title: "Poemas", authors: ["Sophia de Mello Breyner Andresen"], year: null, isbn: "9789896414672", publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source: "openlibrary" as const };
  const h = harness({ catalog: recordingCatalog({ search: async () => [hit] }).catalog });
  const authorless = h.repo.createBook({ title: "Poemas", author: "", isbn: "9789896414672" }, ["isbn:9789896414672"], "2026-10-01T00:00:00.000Z");
  await h.service.searchExternal("poemas");
  assert.equal(h.repo.findBookByKey("ta:poemas|sophia de mello breyner andresen|")?.id, authorless.id);
});

test("a search hit with mis-decoded text is saved repaired, under the keys made from the repaired text", async () => {
  const hit = { result: { title: "Entre a fÃ© e a crenÃ§a", authors: ["JosÃ© Silva"], year: null, isbn: "9780000000002", publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source: "isbndb" as const };
  const h = harness({ catalog: recordingCatalog({ search: async () => [hit] }).catalog });
  await h.service.searchExternal("fe");
  const row = h.repo.findBookByKey("isbn:9780000000002")!;
  assert.equal(row.title, "Entre a fé e a crença");
  assert.equal(row.author, "José Silva");
  assert.equal(row.title_key, "ta:entre a fe e a crenca|jose silva|");
  assert.equal(h.repo.findBookByKey("ta:entre a fe e a crenca|jose silva|")?.id, row.id);
});

test("a search hit with mis-decoded text fills a saved blank row with the repaired text", async () => {
  const hit = { result: { title: "Entre a fÃ© e a crenÃ§a", authors: ["JosÃ© Silva"], year: null, isbn: "9780000000002", publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source: "isbndb" as const };
  const h = harness({ catalog: recordingCatalog({ search: async () => [hit] }).catalog });
  const blank = h.repo.createBook({ title: "", author: "", isbn: "9780000000002" }, ["isbn:9780000000002"], "2026-10-01T00:00:00.000Z");
  await h.service.searchExternal("fe");
  const row = h.repo.getBook(blank.id)!;
  assert.equal(row.title, "Entre a fé e a crença");
  assert.equal(row.author, "José Silva");
  assert.equal(row.title_key, "ta:entre a fe e a crenca|jose silva|");
});

const YARROS = "Rebecca Yarros";

function fourthWingHit(isbn: string, source: "openlibrary" | "isbndb", workKey: string | null = null, olCoverId: number | null = null) {
  const coverUrl = olCoverId === null ? null : `https://covers.openlibrary.org/b/id/${olCoverId}-M.jpg`;
  return { result: { title: "Fourth Wing", authors: [YARROS], year: 2023, isbn, publisher: null, coverUrl, genres: [] }, olCoverId, workKey, source };
}

function searchingFor(hits: Array<ReturnType<typeof fourthWingHit>>, overrides: Partial<Deps> = {}) {
  return harness({ catalog: recordingCatalog({ search: async () => hits }).catalog, ...overrides });
}

function savedEdition(h: ReturnType<typeof harness>, isbn: string, title: string, author: string, workKey?: string) {
  return h.repo.createBook({ title, author, isbn, workKey }, [`isbn:${isbn}`], "2026-09-01T00:00:00.000Z");
}

function duplicateKeyedWorks(overrides: Partial<Deps> = {}) {
  const h = searchingFor([fourthWingHit("9780000000021", "openlibrary", "OL1W"), fourthWingHit("9780000000022", "openlibrary", "OL2W")], overrides);
  savedEdition(h, "9780000000023", "Fourth Wing", YARROS, "OL2W");
  savedEdition(h, "9780000000024", "Fourth Wing", YARROS, "OL2W");
  return h;
}

test("a saved ISBNdb edition joins the keyed work with its title key in the same search", async () => {
  const h = searchingFor([fourthWingHit("9780000000011", "isbndb")]);
  const keyed = savedEdition(h, "9780000000010", "Fourth Wing", YARROS, "OL1W");
  const [result] = await h.service.searchExternal("fourth wing");
  assert.equal(h.repo.findBookByKey("isbn:9780000000011")!.work_id, keyed.work_id);
  assert.equal(result!.workId, keyed.work_id);
});

test("a search that saves an edition merges two duplicate keyed works for its key", async () => {
  const h = duplicateKeyedWorks();
  const survivor = h.repo.findBookByKey("isbn:9780000000023")!.work_id;
  const results = await h.service.searchExternal("fourth wing");
  assert.deepEqual(results.map((result) => result.workId), [survivor, survivor]);
  assert.deepEqual(h.repo.activeMerges("ol-duplicate").map((merge) => merge.intoWork), [survivor]);
});

test("works sharing an arena stay apart when a search saves an edition", async () => {
  const h = duplicateKeyedWorks({ sharesArena: () => true });
  const results = await h.service.searchExternal("fourth wing");
  assert.equal(new Set(results.map((result) => result.workId)).size, 2);
  assert.deepEqual(h.repo.activeMerges("ol-duplicate"), []);
});

test("a search keeps two keyed works apart when its own hits name their title as a series", async () => {
  const bigNate = (isbn: string, workKey: string) => ({ result: { title: "Big Nate", authors: ["Lincoln Peirce"], year: 2010, isbn, publisher: null, coverUrl: null, genres: [] }, olCoverId: null, workKey, subjectSeries: [{ name: "Big Nate", position: null }], source: "openlibrary" as const });
  const h = harness({ catalog: recordingCatalog({ search: async () => [bigNate("9780000000141", "OL1W"), bigNate("9780000000142", "OL2W")] }).catalog });
  const results = await h.service.searchExternal("big nate");
  assert.equal(new Set(results.map((result) => result.workId)).size, 2);
  assert.deepEqual(h.repo.activeMerges("ol-duplicate"), []);
});

function crowdedFourthWing(overrides: Partial<Deps> = {}) {
  const h = searchingFor([fourthWingHit("9780000000081", "isbndb")], overrides);
  const novel = savedEdition(h, "9780000000082", "Fourth Wing", YARROS, "OL1W");
  const graphic = savedEdition(h, "9780000000083", "Fourth Wing: The Graphic Novel", YARROS, "OL2W");
  return { h, novel, graphic };
}

test("a search folds a keyless edition into the keyed work with its full title when a key has several", async () => {
  const { h, novel } = crowdedFourthWing();
  const [result] = await h.service.searchExternal("fourth wing");
  assert.equal(h.repo.findBookByKey("isbn:9780000000081")!.work_id, novel.work_id);
  assert.equal(result!.workId, novel.work_id);
});

test("a crowded fold whose works share an arena stays apart when a search saves an edition", async () => {
  const { h, novel } = crowdedFourthWing({ sharesArena: () => true });
  const [result] = await h.service.searchExternal("fourth wing");
  const keyless = h.repo.findBookByKey("isbn:9780000000081")!;
  assert.notEqual(keyless.work_id, novel.work_id);
  assert.equal(result!.workId, keyless.work_id);
  assert.deepEqual(h.repo.activeMerges("title-key"), []);
});

test("a search merges two duplicate keyed works and then folds the keyless edition it saved into the survivor", async () => {
  const h = searchingFor([
    fourthWingHit("9780000000091", "openlibrary", "OL1W"),
    fourthWingHit("9780000000092", "openlibrary", "OL2W"),
    fourthWingHit("9780000000093", "isbndb")
  ]);
  const first = savedEdition(h, "9780000000091", "Fourth Wing", YARROS, "OL1W");
  const second = savedEdition(h, "9780000000092", "Fourth Wing", YARROS, "OL2W");
  const results = await h.service.searchExternal("fourth wing");
  const survivor = results[0]!.workId;
  assert.ok([first.work_id, second.work_id].includes(survivor ?? null));
  assert.deepEqual(results.map((result) => result.workId), [survivor, survivor, survivor]);
  assert.deepEqual(h.repo.activeMerges("ol-duplicate").map((merge) => merge.intoWork), [survivor]);
  assert.deepEqual(h.repo.activeMerges("title-key").map((merge) => merge.intoWork), [survivor]);
});

test("a search leaves another key's groupable pair apart", async () => {
  const h = searchingFor([fourthWingHit("9780000000031", "openlibrary", "OL1W")]);
  const dune = savedEdition(h, "9780000000032", "Dune", "Frank Herbert", "OL9W");
  const duneKeyless = savedEdition(h, "9780000000033", "Dune", "Frank Herbert");
  const emma = savedEdition(h, "9780000000034", "Emma", "Jane Austen", "OL7W");
  savedEdition(h, "9780000000035", "Emma", "Jane Austen", "OL7W");
  const emmaOther = savedEdition(h, "9780000000036", "Emma", "Jane Austen", "OL8W");
  await h.service.searchExternal("fourth wing");
  assert.notEqual(h.repo.getBook(duneKeyless.id)!.work_id, dune.work_id);
  assert.notEqual(h.repo.getBook(emmaOther.id)!.work_id, emma.work_id);
  assert.deepEqual(h.repo.activeMerges("ol-duplicate"), []);
});

test("a search folds at most 50 works per request", async () => {
  const h = searchingFor([fourthWingHit("9780000000071", "isbndb")]);
  savedEdition(h, "9780000000072", "Fourth Wing", YARROS, "OL1W");
  for (let at = 0; at < 50; at++) savedEdition(h, `9780000002${String(at).padStart(3, "0")}`, "Fourth Wing", YARROS);
  await h.service.searchExternal("fourth wing");
  const keyless = h.db.prepare("SELECT COUNT(*) AS n FROM works WHERE ol_work_key IS NULL AND merged_into IS NULL").get() as { n: number };
  assert.equal(keyless.n, 1);
});

test("a saved edition without a cover is queued on the normal lane", async () => {
  const h = searchingFor([fourthWingHit("9780000000041", "isbndb")]);
  await h.service.searchExternal("fourth wing");
  assert.deepEqual(h.enqueued, [{ bookId: h.bookId("isbn:9780000000041"), priority: "normal" }]);
});

test("a saved edition that already has a cover is not queued", async () => {
  const h = searchingFor([fourthWingHit("9780000000051", "isbndb")]);
  const lowRes = savedEdition(h, "9780000000051", "Fourth Wing", YARROS, "OL1W");
  withCover(h, lowRes.id, "isbndb", 100, "low_res");
  h.advance(DAY);
  h.service.resolveCover({ isbn: "9780000000051", title: "Fourth Wing", author: YARROS });
  assert.equal(h.enqueued.length, 1);
  h.enqueued.length = 0;
  await h.service.searchExternal("fourth wing");
  assert.deepEqual(h.enqueued, []);
});

test("a work's covered result comes first among results with its workId", async () => {
  const h = searchingFor([fourthWingHit("9780000000061", "isbndb"), fourthWingHit("9780000000062", "openlibrary", "OL1W", 7)]);
  const results = await h.service.searchExternal("fourth wing");
  assert.deepEqual(results.map((result) => result.isbn), ["9780000000062", "9780000000061"]);
  assert.equal(results[0]!.workId, results[1]!.workId);
  assert.ok(results[0]!.workId);
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
  h.repo.insertImage({ id: "legacy", book_id: book.id, source: "openlibrary", source_url: null, width: 300, height: 460, byte_size: 1, color: "", created_at: "2026-01-01T00:00:00.000Z" });
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
  h.repo.insertImage({ id: imageId, book_id: id, source, source_url: `https://${source}/existing`, width, height: Math.round(width * 1.5), byte_size: 1, color: "", created_at: "2026-09-01T00:00:00.000Z" });
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

function bnpBook(h: ReturnType<typeof harness>, title: string, at: string) {
  return h.repo.createBook({ title, author: "X", isbn: null, createdBy: "bnp" }, [`ta:${title.toLowerCase()}|x|`], at);
}

function titleCatalog(seen: string[]): Catalog {
  return { fetchDetails: async (lookup) => { seen.push(lookup.title); return spiceAnswer; }, search: async () => [] };
}

test("the details backfill looks up held bnp books before the queue", async () => {
  const seen: string[] = [];
  const held: string[] = [];
  const h = harness({ backgroundCatalog: titleCatalog(seen), heldWorkIds: () => held });
  const [regular] = backfillBooks(h, 1);
  const bnp = bnpBook(h, "Bnp Held", "2026-10-02T00:00:00.000Z");
  held.push(bnp.work_id!);
  await h.service.backfillDetails(2);
  assert.deepEqual(seen, ["Bnp Held", "Book 0"]);
  assert.deepEqual([bnp.id, regular!].map((id) => h.repo.getBook(id)!.details_status), ["found", "found"]);
});

test("held bnp books fill the batch before the queue gets any of it", async () => {
  const seen: string[] = [];
  const held: string[] = [];
  const h = harness({ backgroundCatalog: titleCatalog(seen), heldWorkIds: () => held });
  const [regular] = backfillBooks(h, 1);
  held.push(bnpBook(h, "Bnp First", "2026-10-02T00:00:00.000Z").work_id!, bnpBook(h, "Bnp Second", "2026-10-03T00:00:00.000Z").work_id!);
  await h.service.backfillDetails(2);
  assert.deepEqual(seen, ["Bnp First", "Bnp Second"]);
  assert.equal(h.repo.getBook(regular!)!.details_status, null);
});

test("the details backfill never looks up a bnp book whose work nobody holds", async () => {
  const seen: string[] = [];
  const held: string[] = [];
  const h = harness({ backgroundCatalog: titleCatalog(seen), heldWorkIds: () => held });
  held.push(bnpBook(h, "Bnp Held", "2026-10-02T00:00:00.000Z").work_id!);
  const idle = bnpBook(h, "Bnp Idle", "2026-10-03T00:00:00.000Z");
  await h.service.backfillDetails(50);
  assert.deepEqual(seen, ["Bnp Held"]);
  const row = h.repo.getBook(idle.id)!;
  assert.deepEqual([row.details_status, row.details_checked_at], [null, null]);
});

test("a held work that was merged still counts", async () => {
  const seen: string[] = [];
  const held: string[] = [];
  const h = harness({ backgroundCatalog: titleCatalog(seen), heldWorkIds: () => held });
  const plain = h.repo.createBook({ title: "Plain", author: "X", isbn: null }, ["ta:plain|x|"], "2026-10-01T00:00:00.000Z");
  const bnp = bnpBook(h, "Bnp Merged", "2026-10-02T00:00:00.000Z");
  h.repo.mergeWorks(plain.work_id!, bnp.work_id!);
  held.push(plain.work_id!);
  await h.service.backfillDetails(50);
  assert.equal(seen[0], "Bnp Merged");
  assert.equal(h.repo.getBook(bnp.id)!.details_status, "found");
});

test("with nothing held, or no heldWorkIds, the batch is the regular queue", async () => {
  for (const heldWorkIds of [() => [], undefined]) {
    const seen: string[] = [];
    const h = harness({ backgroundCatalog: titleCatalog(seen), heldWorkIds });
    bnpBook(h, "Bnp Idle", "2026-10-02T00:00:00.000Z");
    backfillBooks(h, 2);
    await h.service.backfillDetails(50);
    assert.deepEqual(seen, ["Book 0", "Book 1"]);
  }
});

test("a held bnp book keeps its BNP synopsis when looked up", async () => {
  const held: string[] = [];
  const h = harness({ backgroundCatalog: { fetchDetails: async () => spiceAnswer, search: async () => [] }, heldWorkIds: () => held });
  const bnp = bnpBook(h, "Bnp Held", "2026-10-02T00:00:00.000Z");
  held.push(bnp.work_id!);
  h.repo.mergeDetails(bnp.id, { summary: "Sinopse da BNP.", pages: null, year: null, publisher: null, translator: null }, "bnp");
  await h.service.backfillDetails(50);
  const row = h.repo.getBook(bnp.id)!;
  assert.deepEqual([row.summary, row.summary_source, row.details_status], ["Sinopse da BNP.", "bnp", "found"]);
});

test("a failing held-works read propagates and looks nothing up", async () => {
  const seen: string[] = [];
  const h = harness({ backgroundCatalog: titleCatalog(seen), heldWorkIds: () => { throw new Error("library db locked"); } });
  backfillBooks(h, 1);
  await assert.rejects(h.service.backfillDetails(50), /library db locked/);
  assert.deepEqual(seen, []);
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

function editionRecords(answer: (isbn: string) => Promise<Awaited<ReturnType<Deps["editionRecords"]["fetchEditionRecord"]>>>, calls: string[] = []) {
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

test("storeCoverImage stores an empty colour when none was found and the colour when one was", async () => {
  const h = harness();
  const book = h.repo.createBook({ title: "", author: "", isbn: "9780141184272" }, ["isbn:9780141184272"], "2026-01-01T00:00:00.000Z");
  const image = { full: Buffer.alloc(1), thumb: Buffer.alloc(1), width: 900, height: 1400 };
  const at = "2026-01-01T00:00:00.000Z";
  const deps = { repo: h.repo, blobs: { save: async () => {} } };
  const plain = await storeCoverImage(deps, book.id, "apple", null, { ...image, color: null }, at);
  const tinted = await storeCoverImage(deps, book.id, "apple", null, { ...image, color: "#cc2222" }, at);
  assert.equal(h.repo.getImage(plain)!.color, "");
  assert.equal(h.repo.getImage(tinted)!.color, "#cc2222");
});

async function pendingColorHarness(overrides: Partial<Deps> = {}) {
  const h = harness(overrides);
  const book = h.repo.createBook({ title: "", author: "", isbn: "9780141184272" }, ["isbn:9780141184272"], "2026-01-01T00:00:00.000Z");
  const addImage = (id: string) => h.repo.insertImage({ id, book_id: book.id, source: "apple", source_url: null, width: 900, height: 1400, byte_size: 1, color: null, created_at: "2026-01-01T00:00:00.000Z" });
  const red = await sharp({ create: { width: 40, height: 60, channels: 3, background: "#cc2222" } }).webp().toBuffer();
  return { ...h, addImage, red };
}

test("fillCoverColors colours an image from its thumb, marks one with no thumb as having none, and does nothing the second time", async () => {
  const h = await pendingColorHarness();
  h.addImage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  h.addImage("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  h.files.set("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-thumb.webp", h.red);
  assert.equal(await h.service.fillCoverColors(10), 2);
  assert.match(h.repo.getImage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.color!, /^#[0-9a-f]{6}$/);
  assert.equal(h.repo.getImage("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!.color, "");
  assert.equal(await h.service.fillCoverColors(10), 0);
});

test("fillCoverColors marks a thumb with no usable colour as having none", async () => {
  const h = await pendingColorHarness();
  h.addImage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  h.files.set("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-thumb.webp", Buffer.from("not an image"));
  assert.equal(await h.service.fillCoverColors(10), 1);
  assert.equal(h.repo.getImage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.color, "");
});

test("fillCoverColors stops on a store error other than a missing object and leaves the row pending", async () => {
  const h = await pendingColorHarness({
    blobs: { save: async () => {}, read: async () => { throw new Error("R2 GET failed: HTTP 500"); } }
  });
  h.addImage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await assert.rejects(h.service.fillCoverColors(10), /HTTP 500/);
  assert.equal(h.repo.getImage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.color, null);
  assert.deepEqual(h.repo.listPendingColorImageIds(10), ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
});

test("fillCoverColors takes at most the limit", async () => {
  const h = await pendingColorHarness();
  h.addImage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  h.addImage("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  h.addImage("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  assert.equal(await h.service.fillCoverColors(2), 2);
  assert.equal(h.repo.listPendingColorImageIds(10).length, 1);
});

test("fillCoverColors gives an id that cannot be a stored object no colour and carries on to the next row", async () => {
  const h = await pendingColorHarness();
  h.addImage("legacy-123");
  h.addImage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  h.files.set("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-thumb.webp", h.red);
  assert.equal(await h.service.fillCoverColors(10), 2);
  assert.equal(h.repo.getImage("legacy-123")!.color, "");
  assert.match(h.repo.getImage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!.color!, /^#[0-9a-f]{6}$/);
});

test("a search by work returns one edition per work, with its canonical work id", () => {
  const h = harness();
  const at = "2026-10-01T00:00:00.000Z";
  const dune = h.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL893415W", createdBy: "seed" }, ["isbn:9780441013593"], at);
  h.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322", workKey: "OL893415W", createdBy: "seed" }, ["isbn:9780593099322"], at);
  const messiah = h.repo.createBook({ title: "Dune Messiah", author: "Frank Herbert", isbn: "9780593098233", createdBy: "seed" }, ["isbn:9780593098233"], at);
  assert.equal(h.service.search("dune").length, 3);
  assert.deepEqual(h.service.search("dune", { byWork: true }).map((result) => result.workId).sort(), [dune.work_id, messiah.work_id].sort());
  h.db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(dune.work_id, messiah.work_id);
  assert.deepEqual(h.service.search("dune", { byWork: true }).map((result) => result.workId), [dune.work_id]);
  assert.ok(h.service.search("dune").every((result) => result.workId === dune.work_id));
});

test("the inside search finds a book from the start of its last word", async () => {
  const { catalog } = recordingCatalog();
  const h = harness({ catalog });
  await h.service.searchExternal("dune");
  assert.deepEqual(h.service.search("dun").map((result) => result.title).sort(), ["Dune", "Dune Encyclopedia"]);
  assert.deepEqual(h.service.search("du"), []);
});

test("search hits saved from outside carry their canonical work id", async () => {
  const { catalog } = recordingCatalog();
  const h = harness({ catalog });
  const first = await h.service.searchExternal("dune");
  const dune = h.repo.findBookByKey("isbn:9780441013593")!;
  assert.equal(first[0]!.workId, dune.work_id);
  assert.equal(first[0]!.bookId, dune.id);
  assert.ok(first.every((result) => typeof result.workId === "string"));
  const target = h.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322", createdBy: "seed" }, ["isbn:9780593099322"], "2026-10-01T00:00:00.000Z");
  h.db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target.work_id, dune.work_id);
  const again = await h.service.searchExternal("dune");
  assert.equal(again[0]!.workId, target.work_id);
});

test("a finished details lookup reports the edition, from a request and from the backfill", async () => {
  const checked: Array<{ id: string; status: string | null }> = [];
  const quiet = { fetchDetails: async () => null, search: async () => [] };
  const h = harness({ catalog: quiet, backgroundCatalog: quiet, onDetailsChecked: (book) => { checked.push({ id: book.id, status: book.details_status }); } });
  await h.service.getDetails({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  assert.deepEqual(checked, [{ id: h.bookId("isbn:9780441013593"), status: "missing" }]);
  await h.service.getDetails({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  assert.equal(checked.length, 1);
  const emma = h.repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, ["ta:emma|jane austen|"], "2026-10-01T00:00:00.000Z");
  await h.service.backfillDetails(50);
  assert.deepEqual(checked[1], { id: emma.id, status: "missing" });
});

test("a hidden edition summary gives way to the work's summary, never to a hidden or wrong-language one", async () => {
  const h = harness();
  const meta = (summary: string) => ({ summary, rating: null, ratingCount: 0, sourceUrl: "", genres: [], pages: null, publisher: null, year: null, translator: null });
  const englishWork = "The whole story of a family across three generations, told with the help of letters and the memories of the people who were there.";
  const seeded = (isbn: string, workKey: string, summary: string) => {
    const book = h.repo.createBook({ title: `Book ${isbn}`, author: "Author", isbn, workKey }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
    h.repo.saveDetails(book.id, meta(summary), ["isbndb"], "isbndb", "2026-10-01T00:00:00.000Z");
    h.repo.setWorkSummary(book.id, englishWork);
    return { isbn, title: `Book ${isbn}`, author: "Author" };
  };
  const hide = (text: string) => h.repo.saveSynopsisJudgment(summaryHashOf(text)!, { model: "jev-1.13.0", usable: 0.1, kind: "praise", askedAt: "2026-10-02T00:00:00.000Z" });

  const english = seeded("9780441013593", "OL1W", "Praise for the book, in quotes.");
  assert.equal((await h.service.getDetails(english))?.summary, "Praise for the book, in quotes.");
  hide("Praise for the book, in quotes.");
  const fallback = await h.service.getDetails(english);
  assert.equal(fallback?.summary, englishWork);
  assert.equal(fallback?.summarySource, "openlibrary");

  const portuguese = seeded("9789720000031", "OL31W", "Elogios ao livro, entre aspas.");
  hide("Elogios ao livro, entre aspas.");
  const none = await h.service.getDetails(portuguese);
  assert.equal(none?.summary, null);
  assert.equal(none?.summarySource, null);

  hide(englishWork);
  assert.equal((await h.service.getDetails(english))?.summary, null);
});

test("a changed summary is shown until it is judged again", async () => {
  const h = harness();
  const orlando = { title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" };
  const book = h.repo.createBook(orlando, ["isbn:9780141184272"], "2026-10-01T00:00:00.000Z");
  h.repo.saveDetails(book.id, { summary: "Old praise.", rating: null, ratingCount: 0, sourceUrl: "", genres: [], pages: null, publisher: null, year: null, translator: null }, ["isbndb"], "isbndb", "2026-10-01T00:00:00.000Z");
  h.repo.saveSynopsisJudgment(summaryHashOf("Old praise.")!, { model: "manual", usable: 0, kind: "praise", askedAt: "2026-10-02T00:00:00.000Z" });
  assert.equal((await h.service.getDetails(orlando))?.summary, null);
  h.repo.mergeDetails(book.id, { summary: "A new publisher synopsis.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  assert.equal((await h.service.getDetails(orlando))?.summary, "A new publisher synopsis.");
});

test("a hidden summary takes its source link with it", async () => {
  const h = harness();
  const lookup = { title: "Os Anões", author: "Harold Pinter", isbn: "9789720000032" };
  const book = h.repo.createBook(lookup, ["isbn:9789720000032"], "2026-10-01T00:00:00.000Z");
  h.repo.saveDetails(book.id, { summary: "Elogios ao livro, entre aspas.", rating: null, ratingCount: 0, sourceUrl: "", genres: [], pages: null, publisher: null, year: null, translator: null }, ["isbndb"], "isbndb", "2026-10-01T00:00:00.000Z");
  assert.equal((await h.service.getDetails(lookup))?.sourceUrl, "https://isbndb.com/book/9789720000032");
  h.repo.saveSynopsisJudgment(summaryHashOf("Elogios ao livro, entre aspas.")!, { model: "jev-1.13.0", usable: 0.1, kind: "praise", askedAt: "2026-10-02T00:00:00.000Z" });
  const hidden = await h.service.getDetails(lookup);
  assert.equal(hidden?.summary, null);
  assert.equal(hidden?.sourceUrl, "");
});

const erosao = { title: "Dicionário da Erosão", author: "John Freeman" };
const erosaoKey = "ta:dicionario da erosao|john freeman|";
const erosaoIsbn = "9789896716844";
const siblingThumb = "https://api.test/covers/cached/sibling-cover/thumb";
const siblingFull = "https://api.test/covers/cached/sibling-cover/file";
const borrowed = { url: siblingThumb, fullUrl: siblingFull, pending: false, upgrading: true };

function erosaoEditions(h: ReturnType<typeof harness>, options: { siblingCover?: boolean; copyIsbn?: string | null } = {}) {
  const { siblingCover = true, copyIsbn = null } = options;
  const sibling = h.repo.createBook({ ...erosao, isbn: erosaoIsbn, workKey: "OL77W" }, [`isbn:${erosaoIsbn}`], "2026-09-01T00:00:00.000Z");
  if (siblingCover) h.repo.setCover(sibling.id, { imageId: "sibling-cover", status: "good", checkedAt: "2026-09-01T00:00:00.000Z" });
  const copy = h.repo.createBook({ ...erosao, isbn: copyIsbn, workKey: "OL77W" }, [copyIsbn ? `isbn:${copyIsbn}` : erosaoKey], "2026-09-02T00:00:00.000Z");
  return { sibling, copy };
}

test("an ISBN-less copy with no cover of its own shows the cover of a sibling edition", () => {
  const h = harness();
  const { copy } = erosaoEditions(h);
  h.repo.setCover(copy.id, { imageId: null, status: "missing", checkedAt: "2026-10-01T00:00:00.000Z" });
  assert.deepEqual(h.service.resolveCover(erosao), borrowed);
  assert.deepEqual(h.enqueued, []);
  const row = h.repo.getBook(copy.id)!;
  assert.deepEqual([row.cover_image_id, row.cover_status], [null, "missing"]);
});

test("an ISBN-less copy that has not been checked shows the sibling cover and still looks for its own", () => {
  const h = harness();
  const { copy } = erosaoEditions(h);
  assert.deepEqual(h.service.resolveCover(erosao), borrowed);
  assert.deepEqual(h.enqueued, [{ bookId: copy.id, priority: "normal" }]);
  assert.equal(h.repo.getBook(copy.id)!.cover_image_id, null);
});

test("an ISBN-less copy whose miss is over 30 days old shows the sibling cover and looks again", () => {
  const h = harness();
  const { copy } = erosaoEditions(h);
  h.repo.setCover(copy.id, { imageId: null, status: "missing", checkedAt: "2026-10-01T00:00:00.000Z" });
  h.advance(30 * DAY);
  assert.deepEqual(h.service.resolveCover(erosao, true), borrowed);
  assert.deepEqual(h.enqueued, [{ bookId: copy.id, priority: "front" }]);
});

test("an ISBN-less copy with its own cover keeps it", () => {
  const h = harness();
  const { copy } = erosaoEditions(h);
  h.repo.setCover(copy.id, { imageId: "own-cover", status: "good", checkedAt: "2026-10-01T00:00:00.000Z" });
  assert.deepEqual(h.service.resolveCover(erosao), { url: "https://api.test/covers/cached/own-cover/thumb", fullUrl: "https://api.test/covers/cached/own-cover/file", pending: false, upgrading: false });
});

test("a cover found later for the ISBN-less copy replaces the sibling cover", () => {
  const h = harness();
  const { copy } = erosaoEditions(h);
  assert.deepEqual(h.service.resolveCover(erosao), borrowed);
  h.repo.setCover(copy.id, { imageId: "own-cover", status: "good", checkedAt: "2026-10-01T00:00:00.000Z" });
  assert.equal(h.service.resolveCover(erosao).url, "https://api.test/covers/cached/own-cover/thumb");
});

test("an ISBN lookup with no cover does not borrow from a sibling edition", () => {
  const h = harness();
  const { copy } = erosaoEditions(h, { copyIsbn: "9780141184272" });
  const lookup = { ...erosao, isbn: "9780141184272" };
  assert.deepEqual(h.service.resolveCover(lookup), { url: null, fullUrl: null, pending: true, upgrading: false });
  assert.deepEqual(h.enqueued, [{ bookId: copy.id, priority: "normal" }]);
  h.repo.setCover(copy.id, { imageId: null, status: "missing", checkedAt: "2026-10-01T00:00:00.000Z" });
  assert.deepEqual(h.service.resolveCover(lookup), { url: null, fullUrl: null, pending: false, upgrading: false });
});

test("an ISBN-less copy in a work with no covered edition is unchanged", () => {
  const h = harness();
  const { copy } = erosaoEditions(h, { siblingCover: false });
  assert.deepEqual(h.service.resolveCover(erosao), { url: null, fullUrl: null, pending: true, upgrading: false });
  assert.deepEqual(h.enqueued, [{ bookId: copy.id, priority: "normal" }]);
  h.repo.setCover(copy.id, { imageId: null, status: "missing", checkedAt: "2026-10-01T00:00:00.000Z" });
  assert.deepEqual(h.service.resolveCover(erosao), { url: null, fullUrl: null, pending: false, upgrading: false });
});

test("an ISBN-less copy whose work was merged into another finds the covered edition there", () => {
  const h = harness();
  const sibling = h.repo.createBook({ ...erosao, isbn: erosaoIsbn, workKey: "OL77W" }, [`isbn:${erosaoIsbn}`], "2026-09-01T00:00:00.000Z");
  h.repo.setCover(sibling.id, { imageId: "sibling-cover", status: "good", checkedAt: "2026-09-01T00:00:00.000Z" });
  const copy = h.repo.createBook({ ...erosao, isbn: null }, [erosaoKey], "2026-09-02T00:00:00.000Z");
  assert.notEqual(copy.work_id, sibling.work_id);
  h.repo.mergeWorks(copy.work_id!, sibling.work_id!);
  h.repo.setCover(copy.id, { imageId: null, status: "missing", checkedAt: "2026-10-01T00:00:00.000Z" });
  assert.deepEqual(h.service.resolveCover(erosao), borrowed);
});

test("rejecting the cover an ISBN-less copy borrows blocks it for that copy and queues the copy first", () => {
  const h = harness();
  const { sibling, copy } = erosaoEditions(h);
  h.repo.insertImage({ id: "sibling-cover", book_id: sibling.id, source: "apple", source_url: "https://a/sibling", width: 900, height: 1400, byte_size: 1, color: "", created_at: "2026-09-01T00:00:00.000Z" });
  assert.deepEqual(h.service.resolveCover(erosao), borrowed);
  h.enqueued.length = 0;
  assert.deepEqual(h.service.rejectCover(erosao), { url: null, fullUrl: null, pending: true, upgrading: false });
  assert.deepEqual(h.enqueued, [{ bookId: copy.id, priority: "front" }]);
  assert.deepEqual([...h.repo.listRejectedUrls(copy.id)], ["https://a/sibling"]);
  assert.deepEqual([...h.repo.listRejectedUrls(sibling.id)], []);
  assert.deepEqual(h.service.resolveCover(erosao), { url: null, fullUrl: null, pending: true, upgrading: false });
  assert.equal(h.repo.getBook(sibling.id)!.cover_image_id, "sibling-cover");
});

test("enqueueCovers queues an ISBN-less copy without looking for a sibling cover", () => {
  const h = harness();
  const { copy } = erosaoEditions(h);
  const workCoverImageIds = h.repo.workCoverImageIds;
  let lookups = 0;
  h.repo.workCoverImageIds = (ids) => { lookups += 1; return workCoverImageIds(ids); };
  h.service.enqueueCovers([erosao]);
  assert.deepEqual(h.enqueued, [{ bookId: copy.id, priority: "normal" }]);
  assert.equal(lookups, 0);
  h.service.resolveCover(erosao);
  assert.equal(lookups, 1);
});

test("a lookup in flight when a borrowed cover is rejected does not store the rejected URL", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const slow: CoverSource = { byIsbn: async () => [], byTitle: async () => { await gate; return [{ source: "apple", url: "https://a/sibling" }]; } };
  const h = harness({ sources: { isbndb: null, apple: slow, openlibrary: emptySource } });
  h.sizes.set("https://a/sibling", [900, 1400]);
  const { sibling, copy } = erosaoEditions(h);
  h.repo.insertImage({ id: "sibling-cover", book_id: sibling.id, source: "apple", source_url: "https://a/sibling", width: 900, height: 1400, byte_size: 1, color: "", created_at: "2026-09-01T00:00:00.000Z" });
  const inFlight = h.service.processBook(copy.id, "background");
  h.service.rejectCover(erosao);
  release();
  await inFlight;
  const row = h.repo.getBook(copy.id)!;
  assert.deepEqual([row.cover_image_id, row.cover_status], [null, null]);
  assert.deepEqual(h.service.resolveCover(erosao), { url: null, fullUrl: null, pending: true, upgrading: false });
});

test("a cover rejected while its image is uploading is not installed", async () => {
  let release!: () => void;
  let uploading!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { uploading = resolve; });
  const source: CoverSource = { byIsbn: async () => [], byTitle: async () => [{ source: "apple", url: "https://a/sibling" }] };
  const h = harness({
    sources: { isbndb: null, apple: source, openlibrary: emptySource },
    blobs: { read: async () => null, save: async () => { uploading(); await gate; } }
  });
  h.sizes.set("https://a/sibling", [900, 1400]);
  const { sibling, copy } = erosaoEditions(h);
  h.repo.insertImage({ id: "sibling-cover", book_id: sibling.id, source: "apple", source_url: "https://a/sibling", width: 900, height: 1400, byte_size: 1, color: "", created_at: "2026-09-01T00:00:00.000Z" });
  const inFlight = h.service.processBook(copy.id, "background");
  await started;
  h.service.rejectCover(erosao);
  release();
  await inFlight;
  const row = h.repo.getBook(copy.id)!;
  assert.deepEqual([row.cover_image_id, row.cover_status], [null, null]);
  assert.deepEqual([...h.repo.listRejectedUrls(copy.id)], ["https://a/sibling"]);
  assert.deepEqual(h.service.resolveCover(erosao), { url: null, fullUrl: null, pending: true, upgrading: false });
});

test("rejecting a borrowed cover with no recorded URL records nothing and the copy keeps borrowing it", () => {
  const h = harness();
  const { sibling, copy } = erosaoEditions(h);
  h.repo.insertImage({ id: "sibling-cover", book_id: sibling.id, source: "upload", source_url: null, width: 900, height: 1400, byte_size: 1, color: "", created_at: "2026-09-01T00:00:00.000Z" });
  h.service.rejectCover(erosao);
  assert.equal(h.repo.listRejectedUrls(copy.id).size, 0);
  assert.deepEqual(h.service.resolveCover(erosao), borrowed);
});

test("a lookup with an ISBN the catalog lacks lands on the ISBN-less title record and borrows the sibling's cover", () => {
  const h = harness();
  const { copy } = erosaoEditions(h);
  assert.deepEqual(h.service.resolveCover({ ...erosao, isbn: "9780141184272" }), borrowed);
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.id, copy.id);
  assert.deepEqual(h.enqueued, [{ bookId: copy.id, priority: "normal" }]);
});

const MALAZAN = "Malazan Book of the Fallen";
const SERIES_AT = "2026-10-01T00:00:00.000Z";
const isbnOf = (n: number) => `97800000${String(n).padStart(5, "0")}`;
type Harness = ReturnType<typeof harness>;

function seeded(h: Harness, title: string, isbn: string, options: { author?: string; workKey?: string; at?: string; searchable?: boolean } = {}) {
  return h.repo.createBook({ title, author: options.author ?? "Steven Erikson", isbn, workKey: options.workKey, createdBy: options.searchable === false ? undefined : "seed" }, [`isbn:${isbn}`], options.at ?? SERIES_AT);
}

function malazanCatalog(h: Harness) {
  const deadhouse = seeded(h, "Deadhouse Gates (The Malazan Book of the Fallen, Book 2)", "9780765348791");
  const gardens = seeded(h, "Gardens of the Moon", "9780765348807");
  const memories = seeded(h, "Memories of Ice", "9780765348814");
  h.repo.addWorkSeries(gardens.work_id!, [{ name: MALAZAN, position: "1" }], "wikidata", SERIES_AT);
  h.repo.addWorkSeries(memories.work_id!, [{ name: MALAZAN, position: "3" }], "wikidata", SERIES_AT);
  h.repo.addWorkSeries(deadhouse.work_id!, [{ name: MALAZAN, position: "2" }], "wikidata", SERIES_AT);
  return { deadhouse, gardens, memories };
}

function classicsCatalog(h: Harness, members: number, searchable = true) {
  const books = Array.from({ length: members }, (_, i) => seeded(h, `Livro ${i}`, isbnOf(100 + i), { author: "Ana Lima", searchable }));
  books.forEach((book, i) => h.repo.addBookCollection(book.id, { name: "Clássicos", position: String(i + 1) }, "bnp", SERIES_AT));
  return books;
}

test("a series search leads with the series in reading order, and every result carries the series", () => {
  const h = harness();
  const { deadhouse } = malazanCatalog(h);
  const results = h.service.search("malazan");
  assert.deepEqual(results.map((result) => result.title), ["Gardens of the Moon", deadhouse.title, "Memories of Ice"]);
  assert.deepEqual(results.map((result) => result.series), [
    { name: MALAZAN, kind: "series", position: "1" },
    { name: MALAZAN, kind: "series", position: "2" },
    { name: MALAZAN, kind: "series", position: "3" }
  ]);
  assert.ok(results.every((result) => typeof result.workId === "string"));
  assert.equal(new Set(results.map((result) => result.isbn)).size, 3);
});

test("a series member the search did not find leads with its covered edition", () => {
  const h = harness();
  const old = seeded(h, "Livro", isbnOf(1), { author: "Ana Lima", workKey: "OL1W", at: SERIES_AT });
  const covered = h.repo.createBook({ title: "Livro", author: "Ana Lima", isbn: isbnOf(2), workKey: "OL1W", olCoverId: 9, createdBy: "seed" }, [`isbn:${isbnOf(2)}`], "2026-10-16T12:00:00.000Z");
  h.repo.addWorkSeries(old.work_id!, [{ name: MALAZAN, position: "1" }], "wikidata", SERIES_AT);
  assert.deepEqual(h.service.search("malazan", { byWork: true }).map((result) => result.title), [covered.title]);
});

test("a collection edition of a work already listed stays right after that work's editions", () => {
  const h = harness();
  const first = seeded(h, "Lobos", isbnOf(1), { author: "Ana Lima", workKey: "OL1W" });
  const second = seeded(h, "Outra Edição", isbnOf(2), { author: "Ana Lima", workKey: "OL1W" });
  seeded(h, "Lobos Beta", isbnOf(3), { author: "Rui Costa", workKey: "OL2W" });
  h.repo.addBookCollection(second.id, { name: "Lobos", position: null }, "bnp", SERIES_AT);
  assert.deepEqual(h.service.search("lobos").map((result) => result.title), [first.title, second.title, "Lobos Beta"]);
});

test("collection editions of works not yet listed are grouped by work", () => {
  const h = harness();
  const c1 = seeded(h, "Cão Um", isbnOf(1), { author: "Ana Lima", workKey: "OL1W" });
  const d1 = seeded(h, "Doce Um", isbnOf(2), { author: "Rui Costa", workKey: "OL2W" });
  const c2 = seeded(h, "Cão Dois", isbnOf(3), { author: "Ana Lima", workKey: "OL1W" });
  for (const book of [c1, d1, c2]) h.repo.addBookCollection(book.id, { name: "Bichos", position: null }, "bnp", SERIES_AT);
  assert.deepEqual(h.service.search("bichos").map((result) => result.title), [c1.title, c2.title, d1.title]);
});

test("a series name is searched together with its author", () => {
  const h = harness();
  const { deadhouse } = malazanCatalog(h);
  assert.deepEqual(h.service.search("malazan erikson").map((result) => result.title), [deadhouse.title, "Gardens of the Moon", "Memories of Ice"]);
  assert.deepEqual(h.service.search("malazan herbert"), []);
});

test("a series search by work gives one row per work", () => {
  const h = harness();
  const { deadhouse } = malazanCatalog(h);
  seeded(h, "Gardens of the Moon (reissue)", "9780765348999", { workKey: "OL1W" });
  const results = h.service.search("malazan", { byWork: true });
  assert.deepEqual(results.map((result) => result.title), ["Gardens of the Moon", deadhouse.title, "Memories of Ice"]);
  assert.equal(new Set(results.map((result) => result.workId)).size, 3);
  assert.ok(results.every((result) => result.series?.name === MALAZAN));
});

test("a series work shows one edition, the earliest created of those in the search index", () => {
  const h = harness();
  const hidden = seeded(h, "Gardens (hidden)", isbnOf(1), { workKey: "OL1W", at: "2026-10-01T00:00:00.000Z", searchable: false });
  seeded(h, "Gardens (later)", isbnOf(2), { workKey: "OL1W", at: "2026-10-03T00:00:00.000Z" });
  seeded(h, "Gardens (earlier)", isbnOf(3), { workKey: "OL1W", at: "2026-10-02T00:00:00.000Z" });
  h.repo.addWorkSeries(hidden.work_id!, [{ name: MALAZAN, position: "1" }], "wikidata", SERIES_AT);
  assert.deepEqual(h.service.search("malazan").map((result) => result.title), ["Gardens (earlier)"]);
  assert.deepEqual(h.service.search("malazan", { byWork: true }).map((result) => result.title), ["Gardens (earlier)"]);
});

test("a series work whose editions are not in the search index returns nothing", () => {
  const h = harness();
  const book = seeded(h, "Gardens of the Moon", isbnOf(1), { searchable: false });
  h.repo.addWorkSeries(book.work_id!, [{ name: MALAZAN, position: "1" }], "wikidata", SERIES_AT);
  assert.deepEqual(h.service.search("malazan"), []);
  assert.deepEqual(h.service.search("malazan", { byWork: true }), []);
});

test("a series written on a merged-away work finds the canonical work and its earliest edition in the search index", () => {
  const h = harness();
  const target = seeded(h, "Gardens of the Moon", isbnOf(1), { searchable: false });
  const alias = seeded(h, "Jardins da Lua", isbnOf(2));
  h.repo.addWorkSeries(alias.work_id!, [{ name: MALAZAN, position: "1" }], "wikidata", SERIES_AT);
  h.repo.mergeTranslation(alias.work_id!, target.work_id!, "manual", null, SERIES_AT);
  const [result, ...rest] = h.service.search("malazan");
  assert.deepEqual(rest, []);
  assert.equal(result!.title, "Jardins da Lua");
  assert.equal(result!.workId, target.work_id);
  assert.deepEqual(result!.series, { name: MALAZAN, kind: "series", position: "1" });
});

test("a title hit carries its work's series, else its edition's collection, else nothing", () => {
  const h = harness();
  const dune = seeded(h, "Dune", isbnOf(1), { author: "Frank Herbert" });
  const messiah = seeded(h, "Dune Messiah", isbnOf(2), { author: "Frank Herbert" });
  seeded(h, "Dune Encyclopedia", isbnOf(3), { author: "Willis McNelly" });
  h.repo.addWorkSeries(dune.work_id!, [{ name: "Dune Chronicles", position: "1" }], "wikidata", SERIES_AT);
  h.repo.addBookCollection(dune.id, { name: "Clássicos", position: "7" }, "bnp", SERIES_AT);
  h.repo.addBookCollection(messiah.id, { name: "Ficção Científica", position: null }, "bnp", SERIES_AT);
  const bySeries = new Map(h.service.search("dune").map((result) => [result.title, result.series]));
  assert.deepEqual(bySeries.get("Dune"), { name: "Dune Chronicles", kind: "series", position: "1" });
  assert.deepEqual(bySeries.get("Dune Messiah"), { name: "Ficção Científica", kind: "collection", position: null });
  assert.equal(bySeries.get("Dune Encyclopedia"), undefined);
  assert.ok(!("series" in h.service.search("dune").find((result) => result.title === "Dune Encyclopedia")!));
});

test("an ISBN search carries the series too", () => {
  const h = harness();
  const { gardens } = malazanCatalog(h);
  assert.deepEqual(h.service.search(gardens.isbn!)[0]!.series, { name: MALAZAN, kind: "series", position: "1" });
});

test("a collection search lists title hits first and fills the rest from the collection, capped at 12 editions", () => {
  const h = harness();
  const titleHits = [1, 2, 3].map((n) => seeded(h, `Clássicos do Mar ${n}`, isbnOf(n), { author: "Ana Lima" }));
  classicsCatalog(h, 200);
  h.repo.addBookCollection(titleHits[2]!.id, { name: "Clássicos", position: "999" }, "bnp", SERIES_AT);
  const results = h.service.search("clássicos");
  assert.equal(results.length, 12);
  assert.deepEqual(results.slice(0, 3).map((result) => result.title), titleHits.map((book) => book.title));
  assert.equal(new Set(results.map((result) => result.isbn)).size, 12);
  assert.deepEqual(results.slice(0, 3).map((result) => result.series), [undefined, undefined, { name: "Clássicos", kind: "collection", position: "999" }]);
  assert.ok(results.slice(3).every((result) => result.series?.kind === "collection" && result.series.name === "Clássicos"));
});

test("a collection search by work is capped at 20 works with the title hits first", () => {
  const h = harness();
  const titleHits = [1, 2, 3].map((n) => seeded(h, `Clássicos do Mar ${n}`, isbnOf(n), { author: "Ana Lima" }));
  classicsCatalog(h, 200);
  const results = h.service.search("clássicos", { byWork: true });
  assert.equal(results.length, 20);
  assert.deepEqual(results.slice(0, 3).map((result) => result.title), titleHits.map((book) => book.title));
  assert.equal(new Set(results.map((result) => result.workId)).size, 20);
});

test("a collection hit carries the collection even when its work has a story series", () => {
  const h = harness();
  const book = seeded(h, "Os Lobos", isbnOf(1), { author: "Ana Lima" });
  h.repo.addWorkSeries(book.work_id!, [{ name: "Saga dos Lobos", position: "2" }], "wikidata", SERIES_AT);
  h.repo.addBookCollection(book.id, { name: "Bang!", position: "248" }, "bnp", SERIES_AT);
  assert.deepEqual(h.service.search("bang")[0]!.series, { name: "Bang!", kind: "collection", position: "248" });
  assert.deepEqual(h.service.search("lobos")[0]!.series, { name: "Saga dos Lobos", kind: "series", position: "2" });
});

test("a collection hit carries the collection that matched, not the edition's earliest", () => {
  const h = harness();
  const book = seeded(h, "Os Lobos", isbnOf(1), { author: "Ana Lima" });
  h.repo.addBookCollection(book.id, { name: "Bang!", position: "248" }, "bnp", "2026-10-01T00:00:00.000Z");
  h.repo.addBookCollection(book.id, { name: "Clássicos", position: "7" }, "ol-edition", "2026-10-02T00:00:00.000Z");
  assert.deepEqual(h.service.search("clássicos")[0]!.series, { name: "Clássicos", kind: "collection", position: "7" });
  assert.deepEqual(h.service.search("clássicos", { byWork: true })[0]!.series, { name: "Clássicos", kind: "collection", position: "7" });
  assert.deepEqual(h.service.search("bang")[0]!.series, { name: "Bang!", kind: "collection", position: "248" });
  assert.deepEqual(h.service.search("lobos")[0]!.series, { name: "Bang!", kind: "collection", position: "248" });
});

test("two editions of a work in one collection are two rows, and one row by work", () => {
  const h = harness();
  const first = seeded(h, "Os Lobos", isbnOf(1), { author: "Ana Lima", workKey: "OL2W" });
  const second = seeded(h, "Os Lobos (nova edição)", isbnOf(2), { author: "Ana Lima", workKey: "OL2W" });
  h.repo.addBookCollection(first.id, { name: "Bang!", position: "248" }, "bnp", SERIES_AT);
  h.repo.addBookCollection(second.id, { name: "Bang!", position: "301" }, "bnp", SERIES_AT);
  assert.equal(h.service.search("bang").length, 2);
  assert.deepEqual(h.service.search("bang", { byWork: true }).map((result) => result.title), ["Os Lobos"]);
});

test("a result carries the id of the edition it shows, the collection-matched one included", () => {
  const h = harness();
  const english = seeded(h, "Dune", isbnOf(1), { author: "Frank Herbert", workKey: "OL3W" });
  const duna = seeded(h, "Duna", isbnOf(2), { author: "Frank Herbert", workKey: "OL3W" });
  h.repo.addBookCollection(duna.id, { name: "Clássicos Aleph", position: "3" }, "bnp", SERIES_AT);
  assert.equal(h.service.search("dune", { byWork: true })[0]!.bookId, english.id);
  const [byCollection] = h.service.search("aleph", { byWork: true });
  assert.equal(byCollection!.workId, duna.work_id);
  assert.equal(byCollection!.bookId, duna.id);
  assert.equal(h.service.search(duna.isbn!)[0]!.bookId, duna.id);
});

test("a book found by title, series and collection appears once, in its first group", () => {
  const h = harness();
  const book = seeded(h, "Bang! Fantasia", isbnOf(1), { author: "Ana Lima" });
  h.repo.addWorkSeries(book.work_id!, [{ name: "Bang Saga", position: "1" }], "wikidata", SERIES_AT);
  h.repo.addBookCollection(book.id, { name: "Bang!", position: "248" }, "bnp", SERIES_AT);
  const results = h.service.search("bang");
  assert.equal(results.length, 1);
  assert.deepEqual(results[0]!.series, { name: "Bang Saga", kind: "series", position: "1" });
  assert.equal(h.service.search("bang", { byWork: true }).length, 1);
});

test("collection members outside the search index never crowd out the ones inside it", () => {
  const h = harness();
  classicsCatalog(h, 200, false);
  const visible = [seeded(h, "Livro visível 1", isbnOf(1), { author: "Ana Lima" }), seeded(h, "Livro visível 2", isbnOf(2), { author: "Ana Lima" })];
  for (const book of visible) h.repo.addBookCollection(book.id, { name: "Clássicos", position: null }, "bnp", SERIES_AT);
  assert.deepEqual(h.service.search("clássicos").map((result) => result.title), ["Livro visível 1", "Livro visível 2"]);
  assert.deepEqual(h.service.search("clássicos", { byWork: true }).map((result) => result.title), ["Livro visível 1", "Livro visível 2"]);
});

test("a collection search by work reaches past a work's many editions to the next work", () => {
  const h = harness();
  const editions = Array.from({ length: 25 }, (_, n) => seeded(h, `Os Lobos ${n}`, isbnOf(n), { author: "Ana Lima", workKey: "OL2W" }));
  const other = seeded(h, "Outro Livro", isbnOf(100), { author: "Rui Costa" });
  for (const book of [...editions, other]) h.repo.addBookCollection(book.id, { name: "Bang!", position: null }, "bnp", SERIES_AT);
  assert.deepEqual(h.service.search("bang", { byWork: true }).map((result) => result.title), ["Os Lobos 0", "Outro Livro"]);
  assert.deepEqual(h.service.search("bang").map((result) => result.title), editions.slice(0, 12).map((book) => book.title));
});

test("series works without a searchable edition never crowd out one that has it", () => {
  for (const byWork of [false, true]) {
    const h = harness();
    for (let n = 0; n < 20; n += 1) h.repo.addWorkSeries(seeded(h, `Livro ${n}`, isbnOf(n), { author: `Escritor ${n}`, searchable: false }).work_id!, [{ name: MALAZAN, position: null }], "wikidata", SERIES_AT);
    h.repo.addWorkSeries(seeded(h, "Livro 20", isbnOf(20), { author: "Escritor 20" }).work_id!, [{ name: MALAZAN, position: null }], "wikidata", SERIES_AT);
    assert.deepEqual(h.service.search("malazan", { byWork }).map((result) => result.title), ["Livro 20"]);
  }
});

test("series works are read only until the room left is filled", () => {
  const h = harness();
  const titleHits = [1, 2].map((n) => seeded(h, `Malazan ${n}`, isbnOf(n), { author: `Autor ${n}` }));
  for (let n = 0; n < 30; n += 1) h.repo.addWorkSeries(seeded(h, `Livro ${n}`, isbnOf(100 + n), { author: `Escritor ${n}` }).work_id!, [{ name: "Contos de Malazan", position: null }], "wikidata", SERIES_AT);
  const editions = mock.method(h.repo, "editionsOf");
  const results = h.service.search("malazan");
  assert.equal(results.length, 12);
  assert.deepEqual(results.slice(0, 2).map((result) => result.title), titleHits.map((book) => book.title));
  assert.equal(editions.mock.calls.flatMap((call) => call.arguments[0]).length, 10);
});

function searchSpies(h: Harness) {
  return { series: mock.method(h.repo, "searchSeries"), collections: mock.method(h.repo, "searchCollectionBooks") };
}

test("the series index is searched once, and the collection index not at all, when title and author hits already fill the cap", () => {
  for (const [byWork, cap] of [[false, 12], [true, 20]] as const) {
    const h = harness();
    for (let n = 0; n < cap; n += 1) seeded(h, `Malazan ${n}`, isbnOf(n), { author: `Autor ${n}` });
    const spies = searchSpies(h);
    assert.equal(h.service.search("malazan", { byWork }).length, cap);
    assert.equal(spies.series.mock.callCount(), 1);
    assert.equal(spies.collections.mock.callCount(), 0);
  }
});

test("the collection index is not searched when title, author and series hits fill the cap", () => {
  for (const [byWork, cap] of [[false, 12], [true, 20]] as const) {
    const h = harness();
    for (let n = 0; n < 2; n += 1) seeded(h, `Malazan ${n}`, isbnOf(n), { author: `Autor ${n}` });
    for (let n = 0; n < cap - 2; n += 1) h.repo.addWorkSeries(seeded(h, `Livro ${n}`, isbnOf(100 + n), { author: `Escritor ${n}` }).work_id!, [{ name: MALAZAN, position: null }], "wikidata", SERIES_AT);
    const spies = searchSpies(h);
    const results = h.service.search("malazan", { byWork });
    assert.equal(results.length, cap);
    assert.equal(spies.series.mock.callCount(), 1);
    assert.equal(spies.collections.mock.callCount(), 0);
  }
});

test("both indexes are searched while the earlier groups leave room", () => {
  const h = harness();
  malazanCatalog(h);
  const spies = searchSpies(h);
  h.service.search("malazan");
  assert.equal(spies.series.mock.callCount(), 1);
  assert.equal(spies.collections.mock.callCount(), 1);
});

function workWith(h: Harness, title: string, author: string, editions: number, first: number, series?: { name: string; position: string | null }) {
  const [book] = Array.from({ length: editions }, (_, n) => seeded(h, title, isbnOf(first + n), { author, workKey: `OL${first}W` }));
  if (series) h.repo.addWorkSeries(book!.work_id!, [series], "wikidata", SERIES_AT);
  return book!.work_id!;
}

const workIdsFor = (h: Harness, query: string) => h.service.search(query, { byWork: true }).map((result) => result.workId);

test("harry potter lists Rowling's seven novels first, in reading order", () => {
  const h = harness();
  const titles = ["Philosopher's Stone", "Chamber of Secrets", "Prisoner of Azkaban", "Goblet of Fire", "Order of the Phoenix", "Half-Blood Prince", "Deathly Hallows"];
  const novels = titles.map((title, n) => ({ title: `Harry Potter and the ${title}`, n }));
  const ids = [...novels].reverse().map(({ title, n }) => [n, workWith(h, title, "J. K. Rowling", 3, 100 * (n + 1), { name: "Harry Potter", position: String(n + 1) })] as const);
  for (let n = 0; n < 4; n += 1) workWith(h, "Harry Potter", `Autor ${n}`, 1, 1000 + n);
  const results = workIdsFor(h, "harry potter");
  assert.deepEqual(results.slice(0, 7), [...ids].sort(([a], [b]) => a - b).map(([, id]) => id));
  assert.equal(results.length, 11);
});

test("lord of the rings lists the three volumes, then the omnibus, then the calendar", () => {
  const h = harness();
  const volumes = ["The Fellowship of the Ring", "The Two Towers", "The Return of the King"].map((title, n) => workWith(h, title, "J. R. R. Tolkien", 1, 100 * (n + 1), { name: "The Lord of the Rings", position: String(n + 1) }));
  const omnibus = workWith(h, "The Lord of the Rings", "J. R. R. Tolkien", 4, 1000);
  const calendar = workWith(h, "2024 The Lord of the Rings Wall Calendar", "Tolkien Estate", 1, 2000);
  assert.deepEqual(workIdsFor(h, "lord of the rings"), [...volumes, omnibus, calendar]);
});

test("dune lists Frank Herbert's Dune first", () => {
  const h = harness();
  const dune = workWith(h, "Dune", "Frank Herbert", 6, 100, { name: "Dune", position: "1" });
  const messiah = workWith(h, "Dune Messiah", "Frank Herbert", 1, 200, { name: "Dune", position: "2" });
  const other = workWith(h, "Dune", "Ana Lima", 1, 300);
  assert.deepEqual(workIdsFor(h, "dune"), [dune, messiah, other]);
});

test("a series that only starts with the query does not lead when a work's title is the query", () => {
  const h = harness();
  const dune = workWith(h, "Dune", "Frank Herbert", 1, 100);
  workWith(h, "Dune Messiah", "Frank Herbert", 1, 200, { name: "Dune Chronicles", position: "2" });
  workWith(h, "Children of Dune", "Frank Herbert", 1, 300, { name: "Dune Chronicles", position: "3" });
  assert.equal(workIdsFor(h, "dune")[0], dune);
});

test("a two-letter query never lets a series lead on a prefix of its name", () => {
  const h = harness();
  workWith(h, "It Ends with Us", "Colleen Hoover", 1, 100, { name: "It Ends with Us", position: "1" });
  workWith(h, "It Starts with Us", "Colleen Hoover", 1, 200, { name: "It Ends with Us", position: "2" });
  const night = workWith(h, "It Happened One Night", "Ana Lima", 5, 300);
  assert.equal(workIdsFor(h, "it")[0], night);
});

test("when two series match, only the exact one leads, and a work in both appears once", () => {
  const h = harness();
  const dune = workWith(h, "Dune", "Frank Herbert", 1, 100, { name: "Dune", position: "1" });
  const messiah = workWith(h, "Dune Messiah", "Frank Herbert", 1, 200, { name: "Dune", position: "2" });
  for (const [id, position] of [[dune, "1"], [messiah, "2"]] as const) h.repo.addWorkSeries(id, [{ name: "Dune Chronicles", position }], "wikidata", SERIES_AT);
  const children = workWith(h, "Children of Dune", "Frank Herbert", 1, 300, { name: "Dune Chronicles", position: "3" });
  const emperor = workWith(h, "God Emperor of Dune", "Frank Herbert", 1, 400, { name: "Dune Chronicles", position: "4" });
  const graphic = workWith(h, "Dune: The Graphic Novel", "Brian Herbert", 5, 500);
  const results = workIdsFor(h, "dune");
  assert.deepEqual(results.slice(0, 3), [dune, messiah, graphic]);
  assert.deepEqual(new Set(results), new Set([dune, messiah, graphic, children, emperor]));
  assert.equal(results.length, 5);
});

test("a leading series sorts decimal and Roman positions as numbers and puts unpositioned members last", () => {
  const h = harness();
  const [none, three, two, one, half] = ([null, "III", "2", "1", "1.5"] as const).map((position, n) => workWith(h, `Livro ${n}`, "Ana Lima", 1, 100 * (n + 1), { name: "Wayfarers", position }));
  assert.deepEqual(workIdsFor(h, "wayfarers"), [one, half, two, three, none]);
});

test("a search by edition keeps each work's editions together and returns at most 12", () => {
  const h = harness();
  const dune = workWith(h, "Dune", "Frank Herbert", 5, 100, { name: "Dune", position: "1" });
  const messiah = workWith(h, "Dune Messiah", "Frank Herbert", 5, 200, { name: "Dune", position: "2" });
  workWith(h, "Dune", "Ana Lima", 5, 300);
  const ids = h.service.search("dune").map((result) => result.workId);
  assert.equal(ids.length, 12);
  assert.deepEqual(ids.slice(0, 10), [...Array(5).fill(dune), ...Array(5).fill(messiah)]);
  const runs = ids.filter((id, n) => id !== ids[n - 1]);
  assert.equal(new Set(runs).size, runs.length);
});

test("a leading series member without a searchable edition is looked up once", () => {
  const h = harness();
  const hidden = seeded(h, "Livro escondido", isbnOf(1), { author: "Ana Lima", searchable: false });
  h.repo.addWorkSeries(hidden.work_id!, [{ name: "Wayfarers", position: "1" }], "wikidata", SERIES_AT);
  const editions = mock.method(h.repo, "editionsOf");
  assert.deepEqual(h.service.search("wayfarers", { byWork: true }), []);
  assert.deepEqual(editions.mock.calls.map((call) => call.arguments[0]), [[hidden.work_id]]);
});

test("a series member merged into another work appears once, as its canonical work", () => {
  const h = harness();
  const target = workWith(h, "Wayfarers: The Long Way", "Becky Chambers", 1, 100);
  const alias = workWith(h, "Wayfarers: O Longo Caminho", "Becky Chambers", 1, 200, { name: "Wayfarers", position: "1" });
  h.repo.addWorkSeries(target, [{ name: "Wayfarers", position: "1" }], "hardcover", SERIES_AT);
  h.repo.mergeTranslation(alias, target, "manual", null, SERIES_AT);
  assert.deepEqual(workIdsFor(h, "wayfarers"), [target]);
  assert.deepEqual(h.service.search("wayfarers").map((result) => result.workId), [target, target]);
});

test("search results saved from outside carry the series once the work has one", async () => {
  const { catalog } = recordingCatalog();
  const h = harness({ catalog });
  assert.ok(!("series" in (await h.service.searchExternal("dune"))[0]!));
  const saved = h.repo.findBookByKey("isbn:9780441013593")!;
  h.repo.addWorkSeries(saved.work_id!, [{ name: "Dune Chronicles", position: "1" }], "wikidata", SERIES_AT);
  const [dune, encyclopedia] = await h.service.searchExternal("dune");
  assert.deepEqual(dune!.series, { name: "Dune Chronicles", kind: "series", position: "1" });
  assert.ok(!("series" in encyclopedia!));
});

const MEMORIES = { name: MALAZAN, position: "3" };
const rowsOf = (h: Harness, table: "work_series" | "book_collections", owner: string) =>
  h.db.prepare(`SELECT name, position, source, created_at FROM ${table} WHERE ${table === "work_series" ? "work_id" : "book_id"} = ? ORDER BY name, source`).all(owner).map((row) => ({ ...row }));

test("an edition's Open Library series are stored as its ol-edition collections", async () => {
  const h = harness({ editionRecords: editionRecords(async () => ({ title: "Memories of Ice", workKey: "/works/OL5W", languages: [], series: [MEMORIES, { name: "Penguin classics", position: null }] })) });
  const [id] = lookupBooks(h, [{ isbn: "9789720000001" }]);
  await h.service.backfillWorkKeys(50);
  assert.deepEqual(rowsOf(h, "book_collections", id!), [
    { name: MALAZAN, position: "3", source: "ol-edition", created_at: SERIES_AT },
    { name: "Penguin classics", position: null, source: "ol-edition", created_at: SERIES_AT }
  ]);
  const work = h.repo.getBook(id!)!.work_id!;
  assert.deepEqual(rowsOf(h, "work_series", work), []);
});

test("an edition series that an Open Library subject on the same work also names becomes its story series, at the edition's position", async () => {
  const h = harness({ editionRecords: editionRecords(async () => ({ title: "Memories of Ice", workKey: "/works/OL5W", languages: [], series: [MEMORIES] })) });
  const keyed = seeded(h, "Memories of Ice", isbnOf(1), { workKey: "OL5W" });
  h.repo.addWorkSeries(keyed.work_id!, [{ name: MALAZAN, position: null }], "ol-subject", SERIES_AT);
  const [id] = lookupBooks(h, [{ isbn: "9789720000001" }]);
  await h.service.backfillWorkKeys(50);
  assert.equal(h.repo.getBook(id!)!.work_id, keyed.work_id);
  assert.deepEqual(h.repo.bestSeriesOf([keyed.work_id!]).get(keyed.work_id!), { name: MALAZAN, position: "3" });
});

test("a publisher collection from an edition record alone gives its work no story series", async () => {
  const h = harness({ editionRecords: editionRecords(async () => ({ title: "Orlando", workKey: "/works/OL6W", languages: [], series: [{ name: "Penguin classics", position: null }] })) });
  const [id] = lookupBooks(h, [{ isbn: "9789720000001" }]);
  await h.service.backfillWorkKeys(50);
  const work = h.repo.getBook(id!)!.work_id!;
  assert.equal(h.repo.bestSeriesOf([work]).size, 0);
  assert.deepEqual(h.repo.collectionsOf([id!]).get(id!), { name: "Penguin classics", position: null });
});

test("an edition record without series adds no collection, and the same series is not stored twice", async () => {
  let record: Awaited<ReturnType<Deps["editionRecords"]["fetchEditionRecord"]>> = { title: "Orlando", workKey: null, languages: [] };
  const h = harness({ editionRecords: editionRecords(async () => record) });
  const [id] = lookupBooks(h, [{ isbn: "9789720000001" }]);
  await h.service.backfillWorkKeys(50);
  assert.deepEqual(rowsOf(h, "book_collections", id!), []);
  record = { title: "Orlando", workKey: null, languages: [], series: [{ name: "Penguin classics", position: null }] };
  h.advance(31 * DAY);
  await h.service.backfillWorkKeys(50);
  h.advance(31 * DAY);
  await h.service.backfillWorkKeys(50);
  assert.equal(rowsOf(h, "book_collections", id!).length, 1);
});

test("details that carry series store the edition's as collections and the work's subjects as ol-subject series", async () => {
  const facts = { rating: null, ratingCount: 0, sourceUrl: "https://openlibrary.org/works/OL5W", genres: [], publisher: null, year: null, translator: null };
  const answers = [{ ...facts, summary: "Spice.", pages: null }, { ...facts, summary: null, pages: 300 }];
  for (const metadata of answers) {
    const details = { metadata, sources: ["openlibrary" as const], summarySource: null, workKey: "/works/OL5W", editionSeries: [MEMORIES, { name: "Penguin classics", position: null }], subjectSeries: [{ name: MALAZAN, position: null }] };
    const h = harness({ catalog: recordingCatalog({ fetchDetails: async () => details }).catalog });
    await h.service.getDetails(dune);
    const book = h.repo.findBookByKey("isbn:9780441013593")!;
    assert.deepEqual(rowsOf(h, "book_collections", book.id).map(({ name, source }) => [name, source]), [[MALAZAN, "ol-edition"], ["Penguin classics", "ol-edition"]]);
    assert.deepEqual(rowsOf(h, "work_series", book.work_id!), [{ name: MALAZAN, position: null, source: "ol-subject", created_at: SERIES_AT }]);
    assert.deepEqual(h.repo.bestSeriesOf([book.work_id!]).get(book.work_id!), { name: MALAZAN, position: "3" });
  }
});

test("details without series store none", async () => {
  const h = harness({ catalog: recordingCatalog().catalog });
  await h.service.getDetails(dune);
  const book = h.repo.findBookByKey("isbn:9780441013593")!;
  assert.deepEqual(rowsOf(h, "book_collections", book.id), []);
  assert.deepEqual(rowsOf(h, "work_series", book.work_id!), []);
});

test("search hits with series subjects store them on the saved book's work and show them at once", async () => {
  const hit = { result: { title: "Dune", authors: ["Frank Herbert"], year: 1965, isbn: "9780441013593", publisher: null, coverUrl: null, genres: [] }, olCoverId: null, workKey: "/works/OL9W", subjectSeries: [{ name: "Dune Chronicles", position: null }], source: "openlibrary" as const };
  const plain = { result: { title: "Dune Messiah", authors: ["Frank Herbert"], year: 1969, isbn: null, publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source: "openlibrary" as const };
  const h = harness({ catalog: recordingCatalog({ search: async () => [hit, plain] }).catalog });
  const [dune, messiah] = await h.service.searchExternal("dune");
  const book = h.repo.findBookByKey("isbn:9780441013593")!;
  assert.equal(book.ol_work_key, "OL9W");
  assert.deepEqual(rowsOf(h, "work_series", book.work_id!), [{ name: "Dune Chronicles", position: null, source: "ol-subject", created_at: SERIES_AT }]);
  assert.deepEqual(dune!.series, { name: "Dune Chronicles", kind: "series", position: null });
  assert.ok(!("series" in messiah!));
  await h.service.searchExternal("dune");
  assert.equal(rowsOf(h, "work_series", book.work_id!).length, 1);
});

test("a book's edition and subject series are written in one transaction, and none is opened when there are none", async () => {
  const withSeries = { title: "Memories of Ice", workKey: null, languages: [], series: [MEMORIES, { name: "Penguin classics", position: null }] };
  const h = harness({ editionRecords: editionRecords(async (isbn) => (isbn === "9789720000001" ? withSeries : { title: "Orlando", workKey: null, languages: [] })) });
  const [first, second] = lookupBooks(h, [{ isbn: "9789720000001" }, { isbn: "9789720000002" }]);
  const inside: boolean[] = [];
  const addCollection = h.repo.addBookCollection.bind(h.repo);
  h.repo.addBookCollection = (...args) => { inside.push(h.db.isTransaction); return addCollection(...args); };
  let opened = 0;
  const transaction = h.repo.transaction.bind(h.repo);
  h.repo.transaction = (write) => { opened += 1; return transaction(write); };
  await h.service.backfillWorkKeys(50);
  assert.deepEqual(inside, [true, true]);
  assert.equal(opened, 1);
  assert.equal(rowsOf(h, "book_collections", first!).length, 2);
  assert.equal(rowsOf(h, "book_collections", second!).length, 0);
});

test("subject series are written in the same transaction as the edition's", async () => {
  const facts = { rating: null, ratingCount: 0, sourceUrl: "https://openlibrary.org/works/OL5W", genres: [], publisher: null, year: null, translator: null, summary: "Spice.", pages: null };
  const details = { metadata: facts, sources: ["openlibrary" as const], summarySource: null, editionSeries: [MEMORIES], subjectSeries: [{ name: MALAZAN, position: null }] };
  const h = harness({ catalog: recordingCatalog({ fetchDetails: async () => details }).catalog });
  const inside: boolean[] = [];
  const addWork = h.repo.addWorkSeries.bind(h.repo);
  h.repo.addWorkSeries = (...args) => { inside.push(h.db.isTransaction); return addWork(...args); };
  await h.service.getDetails(dune);
  assert.deepEqual(inside, [true]);
});

const KOBO_ID = "0b8a2a3c-6f1e-4c54-9d0e-1a2b3c4d5e6f";
const KOBO_URL = `https://cdn.kobo.com/book-images/${KOBO_ID}/1200/1800/False/image.jpg`;
const YESTERDAY = "2026-09-30T00:00:00.000Z";
const withId = (lookup: typeof orlando, imageId: string = KOBO_ID) => ({ ...lookup, imageId });
const noSources: Deps["sources"] = { isbndb: null, apple: emptySource, openlibrary: emptySource };

function checkedAs(h: ReturnType<typeof harness>, id: string, status: "missing" | "low_res" | "manual", checkedAt: string) {
  const imageId = status === "missing" ? null : withCover(h, id, "openlibrary", status === "low_res" ? 300 : 900, "low_res");
  h.repo.setCover(id, { imageId, status, checkedAt });
}

test("an upgrade lookup that Kobo answers at 400px or more asks Apple nothing and leaves the Apple stamp unset", async () => {
  const calls: string[] = [];
  const { h, id } = prepare(orlando, { isbndb: null, apple: recordingSource(calls, "apple"), openlibrary: emptySource }, [[KOBO_URL, 900]]);
  h.repo.setKoboImageId(id, KOBO_ID);
  h.repo.setUpgradeWanted(id, YESTERDAY);
  await h.service.processBook(id, "upgrade");
  const book = h.repo.getBook(id)!;
  assert.equal(book.cover_status, "good");
  assert.equal(h.repo.getImage(book.cover_image_id!)!.source, "kobo");
  assert.equal(h.repo.getImage(book.cover_image_id!)!.source_url, KOBO_URL);
  assert.deepEqual(calls, []);
  assert.equal(book.apple_checked_at, null);
  assert.equal(book.cover_upgrade_wanted_at, null);
});

test("an upgrade lookup whose Kobo image is under 400px still asks Apple and stamps it", async () => {
  const calls: string[] = [];
  const { h, id } = prepare(orlando, { isbndb: null, apple: recordingSource(calls, "apple"), openlibrary: emptySource }, [[KOBO_URL, 300]]);
  h.repo.setKoboImageId(id, KOBO_ID);
  await h.service.processBook(id, "upgrade");
  assert.deepEqual(calls, ["apple:isbn", "apple:title"]);
  assert.equal(h.repo.getBook(id)!.apple_checked_at, "2026-10-01T00:00:00.000Z");
  assert.equal(h.repo.getBook(id)!.cover_status, "low_res");
});

test("enqueueCovers records a new book's Kobo id and queues it once on the normal lane", () => {
  const h = harness({ sources: noSources });
  h.service.enqueueCovers([withId(orlando)]);
  const book = h.repo.findBookByKey("isbn:9780141184272")!;
  assert.equal(book.kobo_image_id, KOBO_ID);
  assert.deepEqual(h.enqueued, [{ bookId: book.id, priority: "normal" }]);
});

test("enqueueCovers sends a not-due missing or low_res book with a new id to the upgrade lane only", () => {
  for (const status of ["missing", "low_res"] as const) {
    const { h, id } = prepare(orlando, noSources);
    checkedAs(h, id, status, YESTERDAY);
    h.service.enqueueCovers([withId(orlando)]);
    assert.equal(h.repo.getBook(id)!.kobo_image_id, KOBO_ID);
    assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, "2026-10-01T00:00:00.000Z");
    assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
  }
});

test("enqueueCovers does not queue a not-due book again for an id it already holds", () => {
  const { h, id } = prepare(orlando, noSources);
  checkedAs(h, id, "missing", YESTERDAY);
  h.repo.setKoboImageId(id, KOBO_ID);
  h.service.enqueueCovers([withId(orlando)]);
  assert.deepEqual(h.enqueued, []);
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, null);
});

test("recordKoboImageIds marks a due missing book for upgrade and queues the upgrade lane only", () => {
  const { h, id } = prepare(orlando, noSources);
  checkedAs(h, id, "missing", "2026-08-22T00:00:00.000Z");
  h.service.recordKoboImageIds([withId(orlando)]);
  assert.equal(h.repo.getBook(id)!.kobo_image_id, KOBO_ID);
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, "2026-10-01T00:00:00.000Z");
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
});

test("a background lookup that misses while the daily job records a Kobo id marks the book for upgrade", async () => {
  let recordId = () => {};
  const apple: CoverSource = { byIsbn: async () => { recordId(); return []; }, byTitle: async () => [] };
  const { h, id } = prepare(orlando, { isbndb: null, apple, openlibrary: emptySource });
  recordId = () => h.service.recordKoboImageIds([withId(orlando)]);
  await h.service.processBook(id, "background");
  const book = h.repo.getBook(id)!;
  assert.equal(book.kobo_image_id, KOBO_ID);
  assert.equal(book.cover_status, "missing");
  assert.equal(book.cover_upgrade_wanted_at, "2026-10-01T00:00:00.000Z");
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
});

test("recordKoboImageIds stores the id of a book with no cover status and queues nothing", () => {
  const { h, id } = prepare(orlando, noSources);
  h.service.recordKoboImageIds([withId(orlando)]);
  assert.equal(h.repo.getBook(id)!.kobo_image_id, KOBO_ID);
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, null);
  assert.deepEqual(h.enqueued, []);
});

test("recordKoboImageIds stores the id of a good Apple cover and a manual cover without marking or queuing them", () => {
  const dune = { isbn: "9780441013593", title: "Dune", author: "Frank Herbert" };
  const { h, id } = prepare(orlando, noSources);
  h.service.resolveCover(dune);
  const duneId = h.bookId("isbn:9780441013593");
  h.enqueued.length = 0;
  withCover(h, id, "apple", 900);
  checkedAs(h, duneId, "manual", YESTERDAY);
  h.service.recordKoboImageIds([withId(orlando), withId(dune, "11111111-2222-4333-8444-555555555555")]);
  assert.equal(h.repo.getBook(id)!.kobo_image_id, KOBO_ID);
  assert.equal(h.repo.getBook(duneId)!.kobo_image_id, "11111111-2222-4333-8444-555555555555");
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, null);
  assert.equal(h.repo.getBook(duneId)!.cover_upgrade_wanted_at, null);
  assert.equal(h.repo.getBook(duneId)!.cover_status, "manual");
  assert.deepEqual(h.enqueued, []);
});

test("recordKoboImageIds marks a good ISBNdb cover on a Portuguese ISBN for upgrade and leaves an English one", () => {
  const { h, id } = prepare(PORTUGUESE, noSources);
  withCover(h, id, "isbndb", 900);
  const english = prepare(orlando, noSources);
  withCover(english.h, english.id, "isbndb", 900);
  h.service.recordKoboImageIds([withId(PORTUGUESE)]);
  english.h.service.recordKoboImageIds([withId(orlando)]);
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, "2026-10-01T00:00:00.000Z");
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
  assert.equal(english.h.repo.getBook(english.id)!.cover_upgrade_wanted_at, null);
  assert.deepEqual(english.h.enqueued, []);
});

test("recordKoboImageIds never creates a catalog row", () => {
  const h = harness({ sources: noSources });
  h.service.recordKoboImageIds([withId(orlando), withId({ isbn: "", title: "Dune", author: "Frank Herbert" })]);
  assert.equal(h.repo.findBookByKey("isbn:9780141184272"), undefined);
  assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 0);
  assert.deepEqual(h.enqueued, []);
});

test("an id that is not a UUID is not stored", () => {
  const { h, id } = prepare(orlando, noSources);
  checkedAs(h, id, "missing", YESTERDAY);
  h.service.recordKoboImageIds([withId(orlando, "file____mnt_onboard_x.epub")]);
  h.service.enqueueCovers([withId(orlando, "file____mnt_onboard_x.epub")]);
  assert.equal(h.repo.getBook(id)!.kobo_image_id, null);
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, null);
  assert.deepEqual(h.enqueued, []);
});

test("the first Kobo id wins and a second, different one stores and queues nothing", () => {
  const other = "11111111-2222-4333-8444-555555555555";
  const { h, id } = prepare(orlando, noSources);
  checkedAs(h, id, "missing", YESTERDAY);
  h.service.enqueueCovers([withId(orlando)]);
  assert.deepEqual(h.enqueued, [{ bookId: id, priority: "upgrade" }]);
  h.enqueued.length = 0;
  h.service.enqueueCovers([withId(orlando, other)]);
  h.service.recordKoboImageIds([withId(orlando, other)]);
  assert.equal(h.repo.getBook(id)!.kobo_image_id, KOBO_ID);
  assert.deepEqual(h.enqueued, []);
});

test("recordKoboImageIds queues nothing and keeps no id or mark when a later write fails and the pass rolls back", () => {
  const dune = { isbn: "9780441013593", title: "Dune", author: "Frank Herbert" };
  const { h, id } = prepare(orlando, noSources);
  h.service.resolveCover(dune);
  const duneId = h.bookId("isbn:9780441013593");
  h.enqueued.length = 0;
  checkedAs(h, id, "missing", "2026-08-22T00:00:00.000Z");
  checkedAs(h, duneId, "missing", "2026-08-22T00:00:00.000Z");
  const setKoboImageId = h.repo.setKoboImageId.bind(h.repo);
  let calls = 0;
  h.repo.setKoboImageId = (bookId, imageId) => {
    calls += 1;
    if (calls === 2) throw new Error("disk full");
    return setKoboImageId(bookId, imageId);
  };
  assert.throws(() => h.service.recordKoboImageIds([withId(orlando), withId(dune)]), /disk full/);
  assert.equal(h.repo.getBook(id)!.kobo_image_id, null);
  assert.equal(h.repo.getBook(id)!.cover_upgrade_wanted_at, null);
  assert.deepEqual(h.enqueued, []);
});

test("recordKoboImageIds queues its upgrades only after the pass has committed", () => {
  const inside: boolean[] = [];
  const h: ReturnType<typeof harness> = harness({ sources: noSources, enqueue: () => { inside.push(h.db.isTransaction); } });
  h.service.resolveCover(orlando);
  checkedAs(h, h.bookId("isbn:9780141184272"), "missing", "2026-08-22T00:00:00.000Z");
  inside.length = 0;
  h.service.recordKoboImageIds([withId(orlando)]);
  assert.deepEqual(inside, [false]);
});

test("recordKoboImageIds ignores a junk id before touching the catalog's keys", () => {
  const h = harness({ sources: noSources });
  h.service.resolveCover({ title: "Orlando", author: "Virginia Woolf" });
  const keys = () => h.db.prepare("SELECT key, book_id FROM book_keys ORDER BY key").all();
  const before = keys();
  h.service.recordKoboImageIds([withId(orlando, "file____mnt_onboard_x.epub"), withId(orlando, "")]);
  assert.deepEqual(keys(), before);
  h.service.recordKoboImageIds([withId(orlando)]);
  assert.ok(keys().some((row) => (row as { key: string }).key === "isbn:9780141184272"));
});

test("a BNP book from before 2002 is looked up by ISBN only, in every lane", async () => {
  const lookups = async (book: { year: number | null; createdBy: "bnp" | "seed" }, lane: CoverPriority) => {
    const calls: string[] = [];
    const h = harness({ sources: { isbndb: recordingSource(calls, "isbndb"), apple: recordingSource(calls, "apple"), openlibrary: recordingSource(calls, "openlibrary") } });
    const row = h.repo.createBook({ title: "Hannibal", author: "Thomas Harris", isbn: "9789724610788", year: book.year, createdBy: book.createdBy }, ["isbn:9789724610788"], "2026-10-01T00:00:00.000Z");
    await h.service.processBook(row.id, lane);
    return calls.some((call) => call.endsWith(":title"));
  };
  assert.equal(await lookups({ year: 1999, createdBy: "bnp" }, "background"), false);
  assert.equal(await lookups({ year: 1999, createdBy: "bnp" }, "upgrade"), false);
  assert.equal(await lookups({ year: 1999, createdBy: "bnp" }, "normal"), false);
  assert.equal(await lookups({ year: 2005, createdBy: "bnp" }, "background"), true);
  assert.equal(await lookups({ year: null, createdBy: "bnp" }, "background"), true);
  assert.equal(await lookups({ year: 1999, createdBy: "seed" }, "background"), true);
});
