import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

const scratch = mkdtempSync(join(tmpdir(), "library-holders-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyLibrarySchema } = await import("./adapters/sqlite/connection.js");
const { createWorkHolders } = await import("./workHolders.js");

function seeded() {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const row = db.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, read_status, cover_url, row_hash, work_id) VALUES (?, ?, ?, 'T', 'A', ?, ?, ?, 'h', ?)");
  row.run("ana", 0, "isbn:111", "111", 2, "https://c/ana.webp", "w-old");
  row.run("ana", 1, "ta:t|a", null, 1, null, "w-new");
  row.run("bo", 0, "isbn:222", "222", null, null, "w-new");
  row.run("cy", 0, "isbn:333", "333", 1, null, "w-other");
  db.prepare("INSERT INTO library_documents (user_id, data) VALUES (?, ?)").run("ana", JSON.stringify({ books: [
    { Title: "T", Attribution: "A", ISBN: "111", Rating: 4, highlights: [{ BookmarkID: "h1", Text: "x" }, { BookmarkID: "note:1", Type: "review", Text: "y" }] },
    { Title: "T", Attribution: "A" }
  ] }));
  return db;
}

test("holders are one per user, from the first copy, across merged ids", () => {
  const { holdersOfWorks } = createWorkHolders(seeded());
  assert.deepEqual(holdersOfWorks(["w-new", "w-old"]), [{ userId: "ana", readStatus: 2 }, { userId: "bo", readStatus: 0 }]);
  assert.deepEqual(holdersOfWorks([]), []);
});

test("the viewer's copy carries feeling and highlights without notes", () => {
  const { copyOfWork } = createWorkHolders(seeded());
  assert.deepEqual(copyOfWork("ana", ["w-new", "w-old"]), { bookKey: "isbn:111", readStatus: 2, rating: 4, highlightCount: 1, isbn: "111", coverUrl: "https://c/ana.webp" });
  assert.equal(copyOfWork("cy", ["w-new"]), undefined);
});
