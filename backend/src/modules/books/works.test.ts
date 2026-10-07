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
const { resolveWorksWith, canonicalWorksWith, getWorkPageWith } = await import("./works.js");

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

test("resolveWorks gives an existing edition without a work its work", () => {
  const { repo, db } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], "2026-10-04T00:00:00.000Z");
  db.prepare("UPDATE books SET work_id = NULL WHERE id = ?").run(book.id);
  const [id] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  assert.ok(id);
  assert.equal((db.prepare("SELECT work_id FROM books WHERE id = ?").get(book.id) as { work_id: string }).work_id, id);
});

test("resolveWorks resolves 2,000 new books in one transaction quickly", () => {
  const { repo } = freshRepo();
  const lookups = Array.from({ length: 2000 }, (_, i) => ({ title: `Book ${i}`, author: `Author ${i}` }));
  const started = performance.now();
  const ids = resolveWorksWith(repo, lookups);
  assert.equal(ids.filter(Boolean).length, 2000);
  assert.ok(performance.now() - started < 3000, `took ${performance.now() - started} ms`);
});

test("a work page lists the canonical work, its editions and every alias, and an old id resolves to it", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const [kept] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  const [gone] = resolveWorksWith(repo, [{ isbn: null, title: "Duna", author: "Frank Herbert" }]);
  db.prepare("UPDATE books SET summary = 'Spice.', language = 'en', year = 1965 WHERE work_id = ?").run(kept!);
  repo.mergeWorks(gone!, kept!);
  const page = getWorkPageWith(repo, (imageId) => `cover:${imageId}`, gone!);
  assert.equal(page!.id, kept);
  assert.deepEqual(new Set(page!.aliasIds), new Set([kept, gone]));
  assert.equal(page!.editions.length, 2);
  assert.equal(page!.editions.find((e) => e.isbn === "9780441013593")!.summary, "Spice.");
  assert.equal(getWorkPageWith(repo, () => "x", "not-a-work"), undefined);
});

test("a work page answers works.summary, from the canonical work even through a merged-away id", () => {
  const { db, repo } = freshRepo();
  const [kept] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  const [gone] = resolveWorksWith(repo, [{ isbn: null, title: "Duna", author: "Frank Herbert" }]);
  assert.equal(getWorkPageWith(repo, () => "x", kept!)!.summary, null);
  db.prepare("UPDATE works SET summary = ? WHERE id = ?").run("Spice.", kept!);
  repo.mergeWorks(gone!, kept!);
  assert.equal(getWorkPageWith(repo, () => "x", kept!)!.summary, "Spice.");
  assert.equal(getWorkPageWith(repo, () => "x", gone!)!.summary, "Spice.");
  db.prepare("UPDATE works SET summary = '  ' WHERE id = ?").run(kept!);
  assert.equal(getWorkPageWith(repo, () => "x", kept!)!.summary, null);
});

test("a keyless work with no summary or cover answers nulls", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const [id] = resolveWorksWith(repo, [{ isbn: null, title: "Quiet Book", author: "Nobody" }]);
  const page = getWorkPageWith(repo, () => "never", id!)!;
  assert.deepEqual(page.editions.map((e) => [e.summary, e.coverUrl]), [[null, null]]);
});
