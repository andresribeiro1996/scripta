import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import Fastify from "fastify";

const scratch = mkdtempSync(join(tmpdir(), "library-import-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.JWT_ACCESS_SECRET = "test-access-secret-at-least-32-characters";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-at-least-32-characters";
process.env.IMPORT_MAX_UPLOAD_BYTES = "32768";
process.env.IMPORT_PARSE_TIMEOUT_MS = "1000";
process.env.LIBRARY_BODY_LIMIT_BYTES = "32768";
process.env.NODE_ENV = "test";

const { parseImport, InvalidImportError, ImportBusyError } = await import("./parseImport.js");
const { buildLibraryRoutes, rejectOversizedImport, sweepStaleImportDirs } = await import("../routes.js");
const { LibraryConflictError } = await import("../domain/errors.js");
const { signAccessToken } = await import("../../auth/tokens.js");

after(async () => rm(scratch, { recursive: true, force: true }));

function koboDb(name: string, bookmarkCount = 1): string {
  const path = join(scratch, name);
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE content (
      ContentID TEXT, Title TEXT, Attribution TEXT, ContentType TEXT, BookID TEXT,
      IsDownloaded TEXT, ___FileSize INTEGER
    );
    CREATE TABLE Bookmark (
      BookmarkID TEXT, VolumeID TEXT, Text TEXT, Annotation TEXT, Type TEXT,
      DateCreated TEXT, DateModified TEXT, ChapterProgress REAL
    );
    INSERT INTO content VALUES ('book-1', 'Stoner', 'John Williams', '6', NULL, 'true', 123);
  `);
  const insert = db.prepare("INSERT INTO Bookmark VALUES (?, 'book-1', ?, '', 'highlight', NULL, NULL, 0.5)");
  for (let i = 0; i < bookmarkCount; i += 1) insert.run(`mark-${i}`, `Passage ${i}`);
  db.close();
  return path;
}

function multipart(bytes: Buffer, filename = "library.dat") {
  const boundary = "----scripta-test-boundary";
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
  };
}

async function testApp() {
  let stored: unknown = null;
  let storedAt = "2026-01-01T00:00:00.000Z";
  const service = {
    getLibrary: () => stored ? { data: stored, updatedAt: storedAt, shareToken: null, shareUrl: null } : null,
    saveLibrary: (_userId: string, data: unknown, expectedUpdatedAt?: string) => {
      if (stored && expectedUpdatedAt !== storedAt) throw new LibraryConflictError();
      stored = data;
      storedAt = new Date(Date.parse(storedAt) + 1).toISOString();
      return { data, updatedAt: storedAt, shareToken: null, shareUrl: null };
    },
    share: () => { throw new Error("not used"); },
    unshare: () => undefined,
    getPublicByToken: () => null
  };
  const app = Fastify();
  app.get("/health", async () => ({ status: "ok" }));
  await app.register(buildLibraryRoutes(service));
  await app.ready();
  const token = signAccessToken({ id: "user-1", email: "test@example.com", username: "tester", avatar_id: null });
  return { app, authorization: `Bearer ${token}` };
}

test("PUT library rejects a stale version with the current document", async () => {
  const { app, authorization } = await testApp();
  const first = await app.inject({ method: "PUT", url: "/library", headers: { authorization }, payload: { data: { books: [{ Title: "First" }] } } });
  const stale = await app.inject({
    method: "PUT",
    url: "/library",
    headers: { authorization },
    payload: { data: { books: [] }, updatedAt: "2026-01-01T00:00:00.000Z" }
  });

  assert.equal(first.statusCode, 200);
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(stale.json().current.data, { books: [{ Title: "First" }] });
  await app.close();
});

test("Kobo SQLite returns books and highlights", async () => {
  const preview = await parseImport(koboDb("happy.sqlite"), 1000, 32768);
  assert.equal(preview.data.book_count, 1);
  assert.equal(preview.data.books[0]?.Title, "Stoner");
  assert.equal((preview.data.books[0]?.highlights as unknown[]).length, 1);
});

test("Goodreads CSV uses the shared parser", async () => {
  const path = join(scratch, "goodreads.csv");
  await writeFile(path, "Book Id,Title,Author,Exclusive Shelf,ISBN,ISBN13,My Rating,My Review\n1,Stoner,John Williams,read,=\"0394729684\",,5,Excellent\n");
  const preview = await parseImport(path, 1000, 32768);
  assert.equal(preview.data.source, "goodreads-export (browser)");
  assert.equal(preview.data.books[0]?.ReadStatus, 2);
});

test("StoryGraph CSV uses the shared parser", async () => {
  const path = join(scratch, "storygraph.csv");
  await writeFile(path, "Title,Authors,Read Status,ISBN/UID,Star Rating,Review\nStoner,John Williams,read,9780394729685,5,Excellent\n");
  const preview = await parseImport(path, 1000, 32768);
  assert.equal(preview.data.source, "storygraph-export (browser)");
  assert.equal(preview.data.books[0]?.ISBN, "9780394729685");
});

test("library JSON only requires a books array", async () => {
  const path = join(scratch, "library.json");
  await writeFile(path, JSON.stringify({ books: [{ Title: "Stoner" }], custom: true }));
  const preview = await parseImport(path, 1000, 32768);
  assert.equal(preview.data.custom, true);
});

test("non-SQLite rows and results are capped", async () => {
  const tooManyRows = join(scratch, "too-many-rows.json");
  await writeFile(tooManyRows, JSON.stringify({ books: Array.from({ length: 100_001 }, () => null) }));
  await assert.rejects(parseImport(tooManyRows, 1000, 32 * 1024 * 1024), /too many rows/);

  const tooLarge = join(scratch, "too-large.csv");
  await writeFile(tooLarge, `Book Id,Title,Author,Exclusive Shelf\n1,${"x".repeat(1000)},Author,read\n`);
  await assert.rejects(parseImport(tooLarge, 1000, 256), /result is too large/);
});

test("malformed files are rejected", async () => {
  const path = join(scratch, "bad.dat");
  await writeFile(path, "not an export");
  await assert.rejects(parseImport(path, 1000, 32768), InvalidImportError);
});

test("oversized multipart uploads return a client-usable 413", async () => {
  const { app, authorization } = await testApp();
  const upload = multipart(Buffer.alloc(32769));
  const response = await app.inject({ method: "POST", url: "/library/import/preview", headers: { ...upload.headers, authorization }, payload: upload.payload });
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().code, "IMPORT_TOO_LARGE");
  await app.close();
});

test("multipart truncation replies 413 before destroying the request", () => {
  const events: string[] = [];
  rejectOversizedImport(
    { raw: { destroy: () => { events.push("destroy"); } } },
    { code: (statusCode) => ({ send: (body) => { events.push(`send:${statusCode}:${String((body as { code: string }).code)}`); } }) }
  );
  assert.deepEqual(events, ["send:413:IMPORT_TOO_LARGE", "destroy"]);
});

test("startup sweep removes only stale import directories", async () => {
  const stale = mkdtempSync(join(tmpdir(), "scripta-import-stale-"));
  const fresh = mkdtempSync(join(tmpdir(), "scripta-import-fresh-"));
  await utimes(stale, new Date(0), new Date(0));
  await sweepStaleImportDirs();
  assert.equal(readdirSync(tmpdir()).includes(stale.split("/").at(-1)!), false);
  assert.equal(readdirSync(tmpdir()).includes(fresh.split("/").at(-1)!), true);
  await rm(fresh, { recursive: true, force: true });
});

test("temporary uploads are removed after parser failure", async () => {
  const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("scripta-import-")));
  const { app, authorization } = await testApp();
  const upload = multipart(Buffer.from("not an export"));
  const response = await app.inject({ method: "POST", url: "/library/import/preview", headers: { ...upload.headers, authorization }, payload: upload.payload });
  assert.equal(response.statusCode, 422);
  const after = readdirSync(tmpdir()).filter((name) => name.startsWith("scripta-import-") && !before.has(name));
  assert.deepEqual(after, []);
  await app.close();
});

test("timed-out parser is SIGKILLed before its temporary upload is removed", async () => {
  const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("scripta-import-")));
  process.env.IMPORT_PARSE_TEST_DELAY_MS = "10000";
  const started = Date.now();
  try {
    const { app, authorization } = await testApp();
    const upload = multipart(Buffer.from("not an export"));
    const response = await app.inject({ method: "POST", url: "/library/import/preview", headers: { ...upload.headers, authorization }, payload: upload.payload });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error, "The import file took too long to parse.");
    assert.ok(Date.now() - started < 3000);
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith("scripta-import-") && !before.has(name));
    assert.deepEqual(after, []);
    await app.close();
  } finally {
    delete process.env.IMPORT_PARSE_TEST_DELAY_MS;
  }
});

test("the parser delay hook is ignored outside test mode", async () => {
  const path = join(scratch, "production-delay.json");
  await writeFile(path, JSON.stringify({ books: [] }));
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  process.env.IMPORT_PARSE_TEST_DELAY_MS = "10000";
  try {
    await assert.doesNotReject(parseImport(path, 1000, 32768));
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    delete process.env.IMPORT_PARSE_TEST_DELAY_MS;
  }
});

test("content as a recursive view is rejected and the server remains responsive", async () => {
  const path = join(scratch, "view.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE VIEW content AS WITH RECURSIVE rows(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM rows) SELECT n AS ContentID, '6' AS ContentType FROM rows;
    CREATE TABLE Bookmark (VolumeID TEXT);
  `);
  db.close();
  const { app, authorization } = await testApp();
  const upload = multipart(await readFile(path));
  const response = await app.inject({ method: "POST", url: "/library/import/preview", headers: { ...upload.headers, authorization }, payload: upload.payload });
  assert.equal(response.statusCode, 422);
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  await app.close();
});

test("Bookmark rows are capped", async () => {
  const path = join(scratch, "many-bookmarks.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE content (ContentID TEXT, ContentType TEXT);
    CREATE TABLE Bookmark (BookmarkID TEXT, VolumeID TEXT);
    INSERT INTO content VALUES ('book-1', '6');
    WITH RECURSIVE rows(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM rows WHERE n <= 100000)
      INSERT INTO Bookmark SELECT n, 'book-1' FROM rows;
  `);
  db.close();
  await assert.rejects(parseImport(path, 1000, 32 * 1024 * 1024), /too many rows/);
});

test("preview then PUT preserves highlights", async () => {
  const { app, authorization } = await testApp();
  const upload = multipart(await readFile(koboDb("round-trip.sqlite")));
  const previewResponse = await app.inject({ method: "POST", url: "/library/import/preview", headers: { ...upload.headers, authorization }, payload: upload.payload });
  assert.equal(previewResponse.statusCode, 200);
  const preview = previewResponse.json();
  const put = await app.inject({ method: "PUT", url: "/library", headers: { authorization }, payload: { data: preview.data } });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().data.books[0].highlights[0].Text, "Passage 0");
  await app.close();
});

test("PUT library returns a distinct oversized-body error", async () => {
  const { app, authorization } = await testApp();
  const response = await app.inject({
    method: "PUT",
    url: "/library",
    headers: { authorization, "content-type": "application/json" },
    payload: JSON.stringify({ data: { books: [], padding: "x".repeat(32768) } })
  });
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().code, "LIBRARY_BODY_TOO_LARGE");
  await app.close();
});

test("import error sanitization: only allowlisted messages pass through", async () => {
  const { sanitizeImportError } = await import("./parseImport.js");
  assert.equal(sanitizeImportError("/var/private/secret-path is not a table"), "Couldn't parse that import file.");
  assert.equal(sanitizeImportError("Unexpected token < at position 0 of /tmp/upload"), "Couldn't parse that import file.");
  assert.equal(sanitizeImportError(undefined), "Couldn't parse that import file.");
  assert.equal(sanitizeImportError("The import contains too many rows."), "The import contains too many rows.");
  assert.equal(sanitizeImportError("`Bookmark` must be a real SQLite table."), "`Bookmark` must be a real SQLite table.");
  assert.equal(sanitizeImportError("`content` must be a real SQLite table."), "`content` must be a real SQLite table.");
});

test("concurrent imports beyond the cap are rejected busy, and the slot frees after", async () => {
  const { ImportBusyError } = await import("./parseImport.js");
  const slow = mkdtempSync(join(tmpdir(), "scripta-import-slow-"));
  const path = join(slow, "upload");
  await writeFile(path, Buffer.from("not a database at all"));
  const first = parseImport(path, 10_000, 32 * 1024 * 1024).catch(() => "settled");
  const second = parseImport(path, 10_000, 32 * 1024 * 1024).catch(() => "settled");
  const third = parseImport(path, 10_000, 32 * 1024 * 1024);
  await assert.rejects(third, (error: Error) => error instanceof ImportBusyError);
  await Promise.all([first, second]);
  const after = parseImport(path, 2000, 32 * 1024 * 1024);
  await assert.rejects(after, (error: Error) => !(error instanceof ImportBusyError));
});

test("a successful parse releases its concurrency slot", async () => {
  const path = koboDb("slot-success.sqlite");
  const preview = await parseImport(path, 5000, 32 * 1024 * 1024);
  assert.ok(preview.data.books.length > 0);
  const again = parseImport(path, 5000, 32 * 1024 * 1024);
  await assert.doesNotReject(again, (error: Error) => error instanceof ImportBusyError);
});

test("a timed-out parse releases its concurrency slot", async () => {
  const path = koboDb("slot-timeout.sqlite");
  await assert.rejects(parseImport(path, 1, 32 * 1024 * 1024), (error: Error) => error instanceof InvalidImportError);
  const after = await parseImport(path, 5000, 32 * 1024 * 1024);
  assert.ok(after.data.books.length > 0);
});
