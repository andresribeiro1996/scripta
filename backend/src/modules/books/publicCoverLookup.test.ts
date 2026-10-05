import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-public-cover-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { openBooksDb } = await import("./adapters/sqlite/connection.js");
const { lookupIdentity } = await import("./domain/normalize.js");
const { peekCachedCoverUrl, peekCachedCoverUrls, peekWorkId, resolveWorkId } = await import("./publicCoverLookup.js");

const db = openBooksDb();
function cacheBook(id: string, imageId: string | null, keys: string[]) {
  db.prepare(`INSERT INTO books (id, title, author, cover_image_id, created_at) VALUES (?, '', '', ?, '2026-01-01T00:00:00.000Z')`).run(id, imageId);
  for (const key of keys) db.prepare(`INSERT INTO book_keys (key, book_id) VALUES (?, ?)`).run(key, id);
}
const titleKey = (title: string, author: string) => lookupIdentity({ title, author })!.titleKey!;

cacheBook("by-isbn", "11111111-1111-4111-8111-111111111111", ["isbn:9783333333333"]);
cacheBook("by-title", "22222222-2222-4222-8222-222222222222", [titleKey("Only Title", "Some Author")]);
cacheBook("isbn-no-cover", null, ["isbn:9784444444444"]);
cacheBook("behind-isbn", "33333333-3333-4333-8333-333333333333", [titleKey("Hidden Cover", "Some Author")]);
cacheBook("isbn-and-title", "44444444-4444-4444-8444-444444444444", ["isbn:9785555555555", titleKey("Both Keys", "Some Author")]);

test("peekCachedCoverUrls agrees with peekCachedCoverUrl called one by one", () => {
  const lookups = [
    { isbn: "9783333333333", title: "Whatever", author: "Anyone" },
    { isbn: "978-3-333-33333-3", title: null, author: null },
    { isbn: null, title: "Only Title", author: "Some Author" },
    { isbn: "9784444444444", title: "Hidden Cover", author: "Some Author" },
    { isbn: "9786666666666", title: "Hidden Cover", author: "Some Author" },
    { isbn: "9785555555555", title: "Both Keys", author: "Some Author" },
    { isbn: null, title: "Both Keys", author: "Some Author" },
    { isbn: null, title: "Not Cached", author: "Nobody" },
    { isbn: null, title: null, author: null },
    { isbn: "not an isbn", title: " ", author: "" },
    { title: "Only Title", author: "Some Author" }
  ];
  const batch = peekCachedCoverUrls(lookups);
  assert.deepEqual(batch, lookups.map(peekCachedCoverUrl));
  assert.equal(batch[3], null);
  assert.notEqual(batch[4], null);
  assert.equal(batch[7], null);
  assert.equal(batch[8], null);
});

test("peekCachedCoverUrls gives nothing for no lookups and null for lookups with no key", () => {
  assert.deepEqual(peekCachedCoverUrls([]), []);
  assert.deepEqual(peekCachedCoverUrls([{}, { isbn: "bad" }]), [null, null]);
});

test("peekWorkId finds an edition's live work without creating anything, and resolveWorkId follows merged_into", () => {
  db.prepare(`INSERT INTO works (id, ol_work_key, title, author, merged_into, created_at) VALUES ('w-live', 'OL1W', 'Dune', 'Frank Herbert', NULL, '2026-01-01T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO works (id, ol_work_key, title, author, merged_into, created_at) VALUES ('w-merged', NULL, 'Dune', 'Frank Herbert', 'w-live', '2026-01-01T00:00:00.000Z')`).run();
  cacheBook("in-work", null, ["isbn:9787777777777"]);
  db.prepare("UPDATE books SET work_id = 'w-live' WHERE id = 'in-work'").run();
  const books = (db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n;
  assert.equal(peekWorkId({ isbn: "9787777777777" }), "w-live");
  assert.equal(peekWorkId({ isbn: "9784444444444" }), null);
  assert.equal(peekWorkId({ title: "Never Seen", author: "Nobody" }), null);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, books);
  assert.equal(resolveWorkId("w-merged"), "w-live");
  assert.equal(resolveWorkId("w-live"), "w-live");
  assert.equal(resolveWorkId("no-such-work"), null);
});
