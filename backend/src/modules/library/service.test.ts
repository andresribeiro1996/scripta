import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

// service.js reaches config/env.ts through covers/index.js (peekCachedCoverUrl),
// and that module process.exit(1)s on an unsatisfied schema at import time. Set
// the required vars before the deferred imports below, exactly as
// import/parseImport.test.ts and the other env-reaching tests do — a static
// import would hoist above these assignments. Nothing here is ever opened: the
// test runs against :memory:.
const scratch = mkdtempSync(join(tmpdir(), "library-service-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.JWT_ACCESS_SECRET = "test-access-secret-at-least-32-characters";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-at-least-32-characters";

const { createSqliteLibraryRepository } = await import("./adapters/sqlite/sqliteLibraryRepository.js");
const { LibraryConflictError } = await import("./domain/errors.js");
const { createLibraryService } = await import("./service.js");

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE library_documents (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    share_token TEXT UNIQUE
  )`);
  return { db, service: createLibraryService(createSqliteLibraryRepository(db), () => "") };
}

test("library saves reject stale and missing versions without overwriting", () => {
  const { db, service } = setup();
  const first = service.saveLibrary("user-1", { books: [{ Title: "First" }] });
  const second = service.saveLibrary("user-1", { books: [{ Title: "Second" }] }, first.updatedAt);

  assert.notEqual(second.updatedAt, first.updatedAt);
  assert.throws(() => service.saveLibrary("user-1", { books: [] }, first.updatedAt), LibraryConflictError);
  assert.throws(() => service.saveLibrary("user-1", { books: [] }), LibraryConflictError);
  assert.deepEqual(service.getLibrary("user-1")?.data, { books: [{ Title: "Second" }] });
  db.close();
});
