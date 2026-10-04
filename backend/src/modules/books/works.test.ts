import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-works-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { resolveWorksWith, canonicalWorksWith } = await import("./works.js");

function freshRepo() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

test("resolveWorks creates an edition and returns its work, then finds it again", () => {
  const { repo, db } = freshRepo();
  const [first] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  const [again] = resolveWorksWith(repo, [{ isbn: "0441013597", title: "Dune", author: "Frank Herbert" }]);
  assert.ok(first);
  assert.equal(again, first);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 1);
});

test("resolveWorks returns null for a lookup with neither ISBN nor title", () => {
  const { repo } = freshRepo();
  assert.deepEqual(resolveWorksWith(repo, [{ isbn: null, title: "", author: "Someone" }]), [null]);
});

test("resolveWorks and canonicalWorks follow merged_into", () => {
  const { repo, db } = freshRepo();
  const [lone] = resolveWorksWith(repo, [{ title: "Hábitos Atômicos", author: "James Clear" }]);
  assert.ok(lone);
  const keyed = repo.createBook({ title: "Atomic Habits", author: "James Clear", isbn: "9780735211292", workKey: "OL17930368W" }, ["isbn:9780735211292"], "2026-10-04T00:00:00.000Z");
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(keyed.work_id, lone);
  assert.deepEqual(resolveWorksWith(repo, [{ title: "Hábitos Atômicos", author: "James Clear" }]), [keyed.work_id]);
  assert.equal(canonicalWorksWith(repo, [lone]).get(lone), keyed.work_id);
  assert.equal(canonicalWorksWith(repo, [keyed.work_id!]).get(keyed.work_id!), keyed.work_id);
});

test("resolveWorks resolves 2,000 new books in one transaction quickly", () => {
  const { repo } = freshRepo();
  const lookups = Array.from({ length: 2000 }, (_, i) => ({ title: `Book ${i}`, author: `Author ${i}` }));
  const started = performance.now();
  const ids = resolveWorksWith(repo, lookups);
  assert.equal(ids.filter(Boolean).length, 2000);
  assert.ok(performance.now() - started < 3000, `took ${performance.now() - started} ms`);
});
