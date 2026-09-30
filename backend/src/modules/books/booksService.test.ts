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
    fetchImage: async (candidate) => {
      const size = sizes.get(candidate.url);
      return size ? { full: Buffer.from(`full:${candidate.url}`), thumb: Buffer.from(`thumb:${candidate.url}`), width: size[0], height: size[1] } : null;
    },
    enqueue: (bookId, front = false) => { enqueued.push({ bookId, front }); },
    publicUrlFor: (id, size) => `https://api.test/covers/cached/${id}/${size}`,
    adminUserId: "",
    warn: (details, message) => { warnings.push({ details, message }); },
    now: () => new Date(clock),
    ...overrides
  });
  const bookId = (key: string) => repo.findBookByKey(key)!.id;
  return { db, repo, files, sizes, enqueued, warnings, service, bookId, advance: (ms: number) => { clock += ms; } };
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
  assert.equal(h.warnings.length, 1);
  assert.equal(h.warnings[0]!.details.source, "apple");
  assert.equal(h.warnings[0]!.message, "cover source unavailable");
  h.enqueued.length = 0;
  assert.deepEqual(h.service.resolveCover(orlando), { url: null, fullUrl: null, pending: true });
  assert.equal(h.enqueued.length, 0);
  h.advance(10 * 60 * 1000);
  assert.equal(h.service.resolveCover(orlando).pending, true);
  assert.equal(h.enqueued.length, 1);
});

test("resolve queues at the back unless asked to jump the queue", () => {
  const { service, enqueued } = harness();
  service.resolveCover(orlando);
  service.resolveCover(orlando, true);
  assert.deepEqual(enqueued.map((entry) => entry.front), [false, true]);
});

test("enqueueCovers queues each unresolved book at the back and skips resolved ones", async () => {
  const dune = { title: "Dune", author: "Frank Herbert" };
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
  h.enqueued.length = 0;
  h.service.enqueueCovers([orlando, dune, { title: "" }]);
  assert.deepEqual(h.enqueued, [{ bookId: h.bookId("ta:dune|frank herbert"), front: false }]);
});

test("enqueueCovers skips a book in backoff", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
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
  await h.service.processBook(id);
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
  await assert.rejects(h.service.processBook(id), /disk full/);
  h.enqueued.length = 0;
  assert.deepEqual(h.service.resolveCover(orlando), { url: null, fullUrl: null, pending: true });
  assert.equal(h.enqueued.length, 0);
  h.advance(10 * 60 * 1000);
  assert.equal(h.service.resolveCover(orlando).pending, true);
  assert.equal(h.enqueued.length, 1);
});

test("enqueueUnchecked queues never-checked books at the back, oldest first, and skips checked ones", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
  h.advance(1000);
  h.service.resolveCover({ title: "Dune", author: "Frank Herbert" });
  h.advance(1000);
  h.service.resolveCover({ title: "Emma", author: "Jane Austen" });
  h.enqueued.length = 0;
  h.service.enqueueUnchecked();
  assert.deepEqual(h.enqueued, [
    { bookId: h.bookId("ta:dune|frank herbert"), front: false },
    { bookId: h.bookId("ta:emma|jane austen"), front: false }
  ]);
});

test("enqueueUnchecked skips a book in backoff", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
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

type Catalog = Deps["catalog"];

function recordingCatalog(overrides: Partial<Catalog> = {}) {
  const calls: string[] = [];
  const catalog: Catalog = {
    fetchDetails: async (lookup) => {
      calls.push(`details:${lookup.isbn ?? lookup.title}`);
      return { metadata: { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"] }, sources: ["openlibrary"] };
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
  assert.deepEqual(await h.service.getDetails(dune), { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"] });
  assert.deepEqual(calls, ["details:9780441013593"]);
  assert.equal(h.repo.findBookByKey("isbn:9780441013593")!.data_sources, '["openlibrary"]');
});

test("details fetched from ISBNdb are tagged with it", async () => {
  const { catalog } = recordingCatalog({
    fetchDetails: async () => ({ metadata: { summary: "Spice.", rating: null, ratingCount: 0, sourceUrl: "https://isbndb.com/book/9780441013593", genres: [] }, sources: ["isbndb"] })
  });
  const h = harness({ catalog });
  await h.service.getDetails(dune);
  const row = h.repo.findBookByKey("isbn:9780441013593")!;
  assert.equal(row.data_sources, '["isbndb"]');
  assert.equal(row.source_url, "https://isbndb.com/book/9780441013593");
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

test("a details failure propagates and records nothing", async () => {
  const h = harness({ catalog: recordingCatalog({ fetchDetails: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); } }).catalog });
  await assert.rejects(h.service.getDetails(dune), SourceUnavailableError);
  assert.equal(h.repo.findBookByKey("isbn:9780441013593")!.details_status, null);
});

test("an ISBN search is answered from a saved book without calling Open Library", () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  h.service.resolveCover(dune);
  const results = h.service.search("978-0-441-01359-3");
  assert.equal(results[0]!.title, "Dune");
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
  assert.ok(h.repo.findBookByKey("ta:dune encyclopedia|willis e mcnelly"));

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
  await h.service.processBook(h.bookId("isbn:9780441013593"));
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

const { default: sharp } = await import("sharp");
const { BookNotFoundError, FileTooLargeError, InvalidImageError } = await import("./domain/errors.js");

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
  await h.service.processBook(id);
  h.enqueued.length = 0;

  assert.deepEqual(h.service.rejectCover(orlando), { url: null, fullUrl: null, pending: true });
  assert.deepEqual(h.enqueued, [{ bookId: id, front: true }]);
  assert.equal(h.repo.getBook(id)!.cover_image_id, null);
  assert.deepEqual([...h.repo.listRejectedUrls(id)], ["https://a/1"]);

  await h.service.processBook(id);
  assert.equal(h.repo.getBook(id)!.cover_status, "missing");
});

test("rejecting a migrated cover with no recorded URL just clears it", () => {
  const h = harness();
  const book = h.repo.createBook({ title: "", author: "", isbn: "9780141184272" }, "isbn:9780141184272", "2026-01-01T00:00:00.000Z");
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
  await h.service.processBook(id);
  assert.deepEqual(calls, []);
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
  const running = h.service.processBook(id);
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
  await h.service.processBook(id);
  assert.equal(h.repo.getBook(id)!.cover_status, "low_res");

  h.sizes.set("https://a/wrong", [350, 520]);
  gate = new Promise((resolve) => { release = resolve; });
  const running = h.service.processBook(id);
  h.service.rejectCover(orlando);
  release();
  await running;

  const rejected = h.repo.getBook(id)!;
  assert.equal(rejected.cover_image_id, null);
  assert.equal(rejected.cover_status, null);
  assert.deepEqual([...h.repo.listRejectedUrls(id)], ["https://a/wrong"]);

  gate = Promise.resolve();
  await h.service.processBook(id);
  const rerun = h.repo.getBook(id)!;
  assert.equal(rerun.cover_image_id, null);
  assert.equal(rerun.cover_status, "missing");
});
