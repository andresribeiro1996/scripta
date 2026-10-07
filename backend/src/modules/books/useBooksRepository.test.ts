import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-use-repo-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { booksRepository, useBooksRepository, peekCachedCoverUrls } = await import("./publicCoverLookup.js");
const { resolveWorks, canonicalWorks, getWorkPage } = await import("./works.js");

test("registering a repository closes the lazy fallback it replaces", () => {
  const lazy = booksRepository();
  assert.equal(lazy.getBook("missing"), undefined);
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const next = createSqliteBooksRepository(db);
  useBooksRepository(next);
  assert.throws(() => lazy.getBook("missing"));
  assert.equal(booksRepository(), next);
});

test("the public reads go through the repository registered with useBooksRepository", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const real = createSqliteBooksRepository(db);
  const calls: string[] = [];
  const recording = new Proxy(real, {
    get(target, name: string) {
      calls.push(name);
      return target[name as keyof typeof target];
    }
  });
  useBooksRepository(recording);

  const [workId] = resolveWorks([{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  assert.ok(workId);
  assert.ok(calls.includes("transaction"));

  calls.length = 0;
  assert.equal(canonicalWorks([workId]).get(workId), workId);
  assert.deepEqual(calls, ["canonicalWorkIds"]);

  calls.length = 0;
  assert.equal(getWorkPage(workId)?.id, workId);
  assert.deepEqual(calls, ["workPageRows"]);

  calls.length = 0;
  assert.deepEqual(peekCachedCoverUrls([{ isbn: "9780441013593" }]), [null]);
  assert.deepEqual(calls, ["findBooksByKeys"]);
});
