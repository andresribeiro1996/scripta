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

test("a complete miss is remembered for 30 days", async () => {
  const h = harness();
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"), "background");
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
  assert.deepEqual(h.service.resolveCover(orlando), { url: null, fullUrl: null, pending: true });
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
  assert.deepEqual(h.service.resolveCover({ title: "?!" }), { url: null, fullUrl: null, pending: false });
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
  await assert.rejects(h.service.processBook(id, "background"), /HTTP 403/);
  assert.equal((h.db.prepare(`SELECT COUNT(*) AS n FROM cover_images`).get() as { n: number }).n, 0);
  assert.equal(h.repo.getBook(id)!.cover_image_id, null);
  await assert.rejects(h.service.uploadCover(orlando, await sharp({ create: { width: 600, height: 900, channels: 3, background: "#224466" } }).jpeg().toBuffer()), /HTTP 403/);
  assert.equal((h.db.prepare(`SELECT COUNT(*) AS n FROM cover_images`).get() as { n: number }).n, 0);
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
  await h.service.processBook(id, "background");
  h.enqueued.length = 0;

  assert.deepEqual(h.service.rejectCover(orlando), { url: null, fullUrl: null, pending: true });
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
