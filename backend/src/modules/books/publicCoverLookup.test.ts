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
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { lookupIdentity } = await import("./domain/normalize.js");
const { coverUrlFor, peekCachedCoverUrl, peekCachedCoverUrls, useBooksRepository } = await import("./publicCoverLookup.js");

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

const repo = createSqliteBooksRepository(db);
const SIBLING_COVER = "55555555-5555-4555-8555-555555555555";
const OWN_COVER = "66666666-6666-4666-8666-666666666666";
const setCover = (id: string, imageId: string | null) => db.prepare(`UPDATE books SET cover_image_id = ? WHERE id = ?`).run(imageId, id);

let siblings = 0;
function editions(title: string, workKey: string, options: { siblingCover: boolean; copyIsbn?: string }) {
  const author = "John Freeman";
  const siblingIsbn = `97898967168${String(siblings++).padStart(2, "0")}`;
  const sibling = repo.createBook({ title, author, isbn: siblingIsbn, workKey }, [`isbn:${siblingIsbn}`], "2026-09-01T00:00:00.000Z");
  if (options.siblingCover) setCover(sibling.id, SIBLING_COVER);
  const copyIsbn = options.copyIsbn ?? null;
  const copy = repo.createBook({ title, author, isbn: copyIsbn, workKey }, [copyIsbn ? `isbn:${copyIsbn}` : titleKey(title, author)], "2026-09-02T00:00:00.000Z");
  return { sibling, copy, lookup: { isbn: copyIsbn, title, author } };
}

test("the public peeks give an ISBN-less copy with no cover the cover of a sibling edition", () => {
  const { lookup } = editions("Dicionario da Erosao", "OL81W", { siblingCover: true });
  const sibling = coverUrlFor(SIBLING_COVER, "thumb");
  assert.equal(peekCachedCoverUrl(lookup), sibling);
  assert.deepEqual(peekCachedCoverUrls([lookup]), [sibling]);
});

test("the public peeks keep an ISBN-less copy's own cover over a sibling's", () => {
  const { copy, lookup } = editions("Erosion Atlas", "OL82W", { siblingCover: true });
  setCover(copy.id, OWN_COVER);
  assert.equal(peekCachedCoverUrl(lookup), coverUrlFor(OWN_COVER, "thumb"));
  assert.deepEqual(peekCachedCoverUrls([lookup]), [coverUrlFor(OWN_COVER, "thumb")]);
});

test("the public peeks give an ISBN lookup with no cover nothing from a sibling edition", () => {
  const { lookup } = editions("Erosion Notes", "OL83W", { siblingCover: true, copyIsbn: "9780141184272" });
  assert.equal(peekCachedCoverUrl(lookup), null);
  assert.deepEqual(peekCachedCoverUrls([lookup]), [null]);
});

test("the public peeks give an ISBN-less copy in a work with no covered edition nothing", () => {
  const { lookup } = editions("Erosion Maps", "OL84W", { siblingCover: false });
  assert.equal(peekCachedCoverUrl(lookup), null);
  assert.deepEqual(peekCachedCoverUrls([lookup]), [null]);
});

test("the public peeks do not lend a cover the copy has rejected", () => {
  const { sibling, copy, lookup } = editions("Erosion Charts", "OL85W", { siblingCover: true });
  db.prepare(`INSERT INTO cover_images (id, book_id, source, source_url, width, height, byte_size, color, created_at) VALUES (?, ?, 'apple', 'https://a/sibling', 900, 1400, 1, '', '2026-09-01T00:00:00.000Z')`).run(SIBLING_COVER, sibling.id);
  assert.equal(peekCachedCoverUrl(lookup), coverUrlFor(SIBLING_COVER, "thumb"));
  repo.addRejection(copy.id, "https://a/sibling", "2026-10-01T00:00:00.000Z");
  assert.equal(peekCachedCoverUrl(lookup), null);
  assert.deepEqual(peekCachedCoverUrls([lookup]), [null]);
});

test("peekCachedCoverUrls asks for the sibling covers of all its rows at once", () => {
  const first = editions("Erosion Tables", "OL86W", { siblingCover: true }).lookup;
  const second = editions("Erosion Tools", "OL87W", { siblingCover: true }).lookup;
  const asked: string[][] = [];
  useBooksRepository({ ...repo, workCoverImageIds: (ids) => { asked.push(ids); return repo.workCoverImageIds(ids); } });
  const covers = peekCachedCoverUrls([first, second, { title: "Not Cached", author: "Nobody" }]);
  useBooksRepository(repo);
  assert.deepEqual(covers, [coverUrlFor(SIBLING_COVER, "thumb"), coverUrlFor(SIBLING_COVER, "thumb"), null]);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.length, 2);
});
