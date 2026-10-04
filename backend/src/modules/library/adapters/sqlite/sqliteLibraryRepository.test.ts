import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratchDir = mkdtempSync(join(tmpdir(), "library-repo-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");

const { applyLibrarySchema } = await import("./connection.js");
const { createSqliteLibraryRepository } = await import("./sqliteLibraryRepository.js");
const { deriveLibraryRows } = await import("../../service.js");

test("a trigger that rolls the transaction back surfaces its own error and keeps every row", () => {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const repo = createSqliteLibraryRepository(db);
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON library_match_keys BEGIN SELECT RAISE(ROLLBACK, 'trigger boom'); END");
  const derived = { glyph: null, keys: [{ key: "k", book_ref: 0, title: "T", author: "A", isbn: null, cover: null }] };
  assert.throws(() => repo.upsertDocument("u1", "{}", derived, deriveLibraryRows({ books: [] }, () => undefined)), /trigger boom/);
  assert.equal(repo.getDocument("u1"), undefined);
  assert.equal(db.isTransaction, false);
});
