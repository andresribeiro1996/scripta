import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "reset-publisher-covers-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { resetPublisherCovers } = await import("./resetPublisherCovers.js");

const ORIGIN = "https://www.edicoesafrontamento.pt";
const SINCE = "2026-10-13T20:30:00.000Z";
const NOW = new Date("2026-10-14T12:00:00.000Z");

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const deleted: string[] = [];
  const deps = { db, deleteBlob: async (key: string) => void deleted.push(key), now: () => NOW };
  let n = 0;
  const book = (status: string | null) => {
    const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    db.prepare("INSERT INTO books (id, title, author, isbn, cover_status, created_at) VALUES (?, ?, '', ?, ?, ?)").run(id, `Book ${n}`, `97897236${String(n).padStart(5, "0")}`, status, "2026-10-01T00:00:00.000Z");
    return id;
  };
  const image = (bookId: string, source: string, origin: string | null, createdAt: string, sourceUrl = `https://img.test/${++n}.jpg`) => {
    const id = `10000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    db.prepare("INSERT INTO cover_images (id, book_id, source, source_url, origin, width, height, byte_size, color, created_at) VALUES (?, ?, ?, ?, ?, 500, 750, 1, '', ?)").run(id, bookId, source, sourceUrl, origin, createdAt);
    return id;
  };
  const point = (bookId: string, imageId: string | null, status: string) => db.prepare("UPDATE books SET cover_image_id = ?, cover_status = ? WHERE id = ?").run(imageId, status, bookId);
  const row = (bookId: string) => ({ ...(db.prepare("SELECT cover_image_id, cover_status, cover_checked_at FROM books WHERE id = ?").get(bookId) as { cover_image_id: string | null; cover_status: string | null; cover_checked_at: string | null }) });
  const imageExists = (id: string) => db.prepare("SELECT 1 FROM cover_images WHERE id = ?").get(id) !== undefined;
  return { db, deps, deleted, book, image, point, row, imageExists };
}

test("a publisher cover over a low-res one is reset to the low-res cover and its files deleted", async () => {
  const h = setup();
  const id = h.book("low_res");
  const lowRes = h.image(id, "apple", null, "2026-10-05T00:00:00.000Z");
  const bad = h.image(id, "publisher", ORIGIN, "2026-10-14T01:00:00.000Z");
  h.point(id, bad, "manual");
  const report = await resetPublisherCovers(h.deps, { origin: ORIGIN, since: SINCE, apply: true });
  assert.deepEqual(report, { matched: 1, restoredLowRes: 1, markedMissing: 0, skipped: 0 });
  assert.deepEqual(h.row(id), { cover_image_id: lowRes, cover_status: "low_res", cover_checked_at: NOW.toISOString() });
  assert.equal(h.imageExists(bad), false);
  assert.deepEqual(h.deleted.sort(), [`covers/${bad}-thumb.webp`, `covers/${bad}.webp`]);
});

test("a publisher cover on a book that had none is reset to missing", async () => {
  const h = setup();
  const id = h.book("missing");
  const bad = h.image(id, "publisher", ORIGIN, "2026-10-14T01:00:00.000Z");
  h.point(id, bad, "manual");
  const report = await resetPublisherCovers(h.deps, { origin: ORIGIN, since: SINCE, apply: true });
  assert.deepEqual(report, { matched: 1, restoredLowRes: 0, markedMissing: 1, skipped: 0 });
  assert.deepEqual(h.row(id), { cover_image_id: null, cover_status: "missing", cover_checked_at: NOW.toISOString() });
});

test("an older image the user rejected is never restored", async () => {
  const h = setup();
  const id = h.book("missing");
  h.image(id, "apple", null, "2026-10-05T00:00:00.000Z", "https://img.test/rejected.jpg");
  h.db.prepare("INSERT INTO cover_rejections (book_id, source_url, created_at) VALUES (?, ?, ?)").run(id, "https://img.test/rejected.jpg", "2026-10-06T00:00:00.000Z");
  const bad = h.image(id, "publisher", ORIGIN, "2026-10-14T01:00:00.000Z");
  h.point(id, bad, "manual");
  await resetPublisherCovers(h.deps, { origin: ORIGIN, since: SINCE, apply: true });
  assert.equal(h.row(id).cover_image_id, null);
  assert.equal(h.row(id).cover_status, "missing");
});

test("covers from another publisher, an earlier run, or another source are left alone", async () => {
  const h = setup();
  const other = h.book("missing");
  h.point(other, h.image(other, "publisher", "https://www.exclamacao.pt", "2026-10-14T01:00:00.000Z"), "manual");
  const earlier = h.book("missing");
  h.point(earlier, h.image(earlier, "publisher", ORIGIN, "2026-10-03T01:00:00.000Z"), "manual");
  const upload = h.book("missing");
  h.point(upload, h.image(upload, "upload", ORIGIN, "2026-10-14T01:00:00.000Z"), "manual");
  const before = [other, earlier, upload].map(h.row);
  const report = await resetPublisherCovers(h.deps, { origin: ORIGIN, since: SINCE, apply: true });
  assert.deepEqual(report, { matched: 0, restoredLowRes: 0, markedMissing: 0, skipped: 0 });
  assert.deepEqual([other, earlier, upload].map(h.row), before);
  assert.deepEqual(h.deleted, []);
});

test("a dry run counts the books and writes nothing", async () => {
  const h = setup();
  const id = h.book("missing");
  const bad = h.image(id, "publisher", ORIGIN, "2026-10-14T01:00:00.000Z");
  h.point(id, bad, "manual");
  const report = await resetPublisherCovers(h.deps, { origin: ORIGIN, since: SINCE, apply: false });
  assert.deepEqual(report, { matched: 1, restoredLowRes: 0, markedMissing: 1, skipped: 0 });
  assert.equal(h.row(id).cover_image_id, bad);
  assert.equal(h.imageExists(bad), true);
  assert.deepEqual(h.deleted, []);
});

test("a book whose cover changed after the reset started is skipped and keeps its cover", async () => {
  const h = setup();
  const first = h.book("missing");
  const firstBad = h.image(first, "publisher", ORIGIN, "2026-10-14T01:00:00.000Z");
  h.point(first, firstBad, "manual");
  const second = h.book("missing");
  const secondBad = h.image(second, "publisher", ORIGIN, "2026-10-14T01:00:01.000Z");
  h.point(second, secondBad, "manual");
  const upload = h.image(second, "upload", null, "2026-10-14T12:00:00.000Z");
  const deps = { ...h.deps, deleteBlob: async (key: string) => { if (key === `covers/${firstBad}.webp`) h.point(second, upload, "manual"); await h.deps.deleteBlob(key); } };
  const report = await resetPublisherCovers(deps, { origin: ORIGIN, since: SINCE, apply: true });
  assert.equal(report.skipped, 1);
  assert.equal(h.row(second).cover_image_id, upload);
  assert.equal(h.imageExists(secondBad), true);
});
