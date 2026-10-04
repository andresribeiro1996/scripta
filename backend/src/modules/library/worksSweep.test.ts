import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "library-works-sweep-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyLibrarySchema } = await import("./adapters/sqlite/connection.js");
const { createLibraryWorksStep, startWorksSweep } = await import("./worksSweep.js");

function libraryDb() {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const insert = db.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, row_hash, work_id) VALUES (?, ?, ?, ?, ?, ?, 'h', ?)");
  return { db, insert };
}

test("the library step fills NULL work ids and skips rows with no identity", () => {
  const { db, insert } = libraryDb();
  insert.run("u1", 0, "ta:dune|frank herbert", "Dune", "Frank Herbert", null, null);
  insert.run("u1", 1, "ta:|", null, null, null, null);
  insert.run("u2", 0, "isbn:9780441013593", "Dune", "Frank Herbert", "9780441013593", "w-kept");
  const step = createLibraryWorksStep(db, (lookups) => lookups.map((lookup) => `w-${lookup.title}`));
  const batch = step(0, 250);
  assert.equal(batch.visited, 1);
  assert.equal(batch.resolved, 1);
  const works = db.prepare("SELECT work_id FROM library_books ORDER BY user_id, position").all() as Array<{ work_id: string | null }>;
  assert.deepEqual(works.map((row) => row.work_id), ["w-Dune", null, "w-kept"]);
});

test("the library step pages by rowid so unresolvable rows can't loop", () => {
  const { db, insert } = libraryDb();
  for (let i = 0; i < 3; i++) insert.run("u1", i, `ta:book ${i}|a`, `Book ${i}`, "A", null, null);
  const step = createLibraryWorksStep(db, (lookups) => lookups.map(() => null));
  const first = step(0, 2);
  const second = step(first.lastRowid, 2);
  assert.equal(first.visited, 2);
  assert.equal(second.visited, 1);
  assert.equal(step(second.lastRowid, 2).visited, 0);
});

test("a front insert during a catalog outage is refilled by the next sweep", () => {
  const { db, insert } = libraryDb();
  insert.run("u1", 0, "ta:new|a", "New", "A", null, null);
  insert.run("u1", 1, "ta:dune|frank herbert", "Dune", "Frank Herbert", null, null);
  createLibraryWorksStep(db, (lookups) => lookups.map((lookup) => `w-${lookup.title}`))(0, 250);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM library_books WHERE work_id IS NULL").get() as { n: number }).n, 0);
});

test("startWorksSweep runs every step to the end and logs what it resolved", async () => {
  const seen: Array<[string, number]> = [];
  const infos: object[] = [];
  const pages = (name: string, total: number) => (after: number, limit: number) => {
    seen.push([name, after]);
    const visited = Math.max(0, Math.min(limit, total - after));
    return { lastRowid: after + visited, visited, resolved: visited };
  };
  const stop = startWorksSweep([pages("a", 3), pages("b", 1)], { info: (details) => infos.push(details), error: () => undefined }, 60_000, 2);
  await new Promise((resolve) => setTimeout(resolve, 50));
  stop();
  assert.deepEqual(seen, [["a", 0], ["a", 2], ["b", 0]]);
  assert.deepEqual(infos, [{ resolved: 4 }]);
});

test("a failing step is logged and does not stop the next tick", async () => {
  const errors: object[] = [];
  let calls = 0;
  const step = () => {
    calls++;
    throw new Error("boom");
  };
  const stop = startWorksSweep([step], { info: () => undefined, error: (details) => errors.push(details) }, 10, 2);
  await new Promise((resolve) => setTimeout(resolve, 80));
  stop();
  assert.ok(calls >= 2);
  assert.equal(errors.length, calls);
});
