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
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.COVERS_STORAGE_PATH = join(scratch, "covers-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { createBooksService } = await import("./booksService.js");
const { SourceUnavailableError } = await import("./domain/errors.js");

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
    save: (id: string, extension: string, bytes: Buffer) => { files.set(`${id}.${extension}`, bytes); },
    read: (id: string, extension: string) => files.get(`${id}.${extension}`) ?? null
  };
  const enqueued: Array<{ bookId: string; front: boolean }> = [];
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
    fetchImage: async (candidate) => {
      const size = sizes.get(candidate.url);
      return size ? { full: Buffer.from(`full:${candidate.url}`), thumb: Buffer.from(`thumb:${candidate.url}`), width: size[0], height: size[1] } : null;
    },
    enqueue: (bookId, front = false) => { enqueued.push({ bookId, front }); },
    publicUrlFor: (id, size) => `https://api.test/covers/cached/${id}/${size}`,
    adminUserId: "",
    now: () => new Date(clock),
    ...overrides
  });
  const bookId = (key: string) => repo.findBookByKey(key)!.id;
  return { db, repo, files, sizes, enqueued, service, bookId, advance: (ms: number) => { clock += ms; } };
}

test("a new book answers pending and repeat requests reuse the same row", () => {
  const { service, enqueued, db } = harness();
  assert.deepEqual(service.resolveCover(orlando), { url: null, fullUrl: null, pending: true });
  assert.deepEqual(service.resolveCover(orlando), { url: null, fullUrl: null, pending: true });
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 1);
  assert.equal(enqueued.length, 2);
  assert.equal(enqueued[0]!.bookId, enqueued[1]!.bookId);
});

test("processing stores the first good cover; resolve serves thumb and full URLs", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
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

test("a complete miss is remembered for 30 days", async () => {
  const h = harness();
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.cover_status, "missing");
  h.enqueued.length = 0;
  assert.deepEqual(h.service.resolveCover(orlando), { url: null, fullUrl: null, pending: false });
  assert.equal(h.enqueued.length, 0);
  h.advance(30 * DAY);
  assert.equal(h.service.resolveCover(orlando).pending, true);
  assert.equal(h.enqueued.length, 1);
});

test("a low-res cover is served and upgraded only after 30 days", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/small"), openlibrary: emptySource } });
  h.sizes.set("https://a/small", [300, 460]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
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
  await h.service.processBook(id);
  const oldImage = h.repo.getBook(id)!.cover_image_id!;
  h.sizes.set("https://a/small", [900, 1400]);
  await h.service.processBook(id);
  const newImage = h.repo.getBook(id)!.cover_image_id!;
  assert.notEqual(newImage, oldImage);
  assert.ok(h.files.has(`${oldImage}.webp`));
  assert.equal(h.repo.getBook(id)!.cover_status, "good");
});

test("an unavailable source records no miss and backs off for 10 minutes", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
  const book = h.repo.findBookByKey("isbn:9780141184272")!;
  assert.equal(book.cover_status, null);
  assert.equal(book.cover_checked_at, null);
  h.enqueued.length = 0;
  assert.equal(h.service.resolveCover(orlando).pending, false);
  assert.equal(h.enqueued.length, 0);
  h.advance(10 * 60 * 1000);
  assert.equal(h.service.resolveCover(orlando).pending, true);
});

test("a low-res image found while a source was down is stored without advancing the check time", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: isbnSource("https://o/1") } });
  h.sizes.set("https://o/1", [320, 480]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
  const book = h.repo.findBookByKey("isbn:9780141184272")!;
  assert.notEqual(book.cover_image_id, null);
  assert.equal(book.cover_status, "low_res");
  assert.equal(book.cover_checked_at, null);
});

test("manual covers are never processed", async () => {
  const calls: string[] = [];
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1", calls), openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  h.repo.setCover(id, { imageId: "uploaded", status: "manual", checkedAt: "2026-10-01T00:00:00.000Z" });
  await h.service.processBook(id);
  assert.deepEqual(calls, []);
  assert.equal(h.repo.getBook(id)!.cover_image_id, "uploaded");
});

test("an EPUB urn:uuid ISBN falls back to the title key", () => {
  const h = harness();
  h.service.resolveCover({ isbn: "urn:uuid:ac11a7ae-d21e-42bb-8cfe-b85022867ac4", title: "The Stranger", author: "Albert Camus" });
  const book = h.repo.findBookByKey("ta:the stranger|albert camus");
  assert.ok(book);
  assert.equal(book.isbn, null);
});

test("a title that normalizes to nothing creates no book", () => {
  const h = harness();
  assert.deepEqual(h.service.resolveCover({ title: "?!" }), { url: null, fullUrl: null, pending: false });
  assert.equal((h.db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 0);
  assert.equal(h.enqueued.length, 0);
});

test("a migrated book with no title gets its title from the first lookup that has one", () => {
  const h = harness();
  h.repo.createBook({ title: "", author: "", isbn: "9780141184272" }, "isbn:9780141184272", "2026-01-01T00:00:00.000Z");
  h.service.resolveCover(orlando);
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.title, "Orlando");
});

test("getCoverFile serves the thumbnail and falls back to the full file", () => {
  const h = harness();
  h.files.set("legacy.webp", Buffer.from("legacy"));
  assert.equal(h.service.getCoverFile("legacy", "thumb")!.buffer.toString(), "legacy");
  assert.equal(h.service.getCoverFile("legacy", "file")!.mimeType, "image/webp");
  assert.equal(h.service.getCoverFile("unknown", "file"), null);
});
