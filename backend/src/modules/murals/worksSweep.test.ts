import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "murals-works-sweep-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.MURALS_DB_PATH = join(scratch, "murals.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { createMuralsWorksStep } = await import("./worksSweep.js");
const { createSqliteMuralsRepository } = await import("./adapters/sqlite/sqliteMuralsRepository.js");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8"));
  return db;
}

function insertMural(db: DatabaseSync, id: string, owner: string, blocks: unknown): void {
  db.prepare("INSERT INTO murals (id, user_id, name, blocks, updated_at) VALUES (?, ?, 'm', ?, 't0')").run(id, owner, JSON.stringify(blocks));
}

function worksOf(db: DatabaseSync, id: string): Array<{ key: string; work_id: string | null }> {
  return (db.prepare("SELECT key, work_id FROM mural_works WHERE mural_id = ? ORDER BY key").all(id) as Array<{ key: string; work_id: string | null }>).map((row) => ({ ...row }));
}

function blocksOf(db: DatabaseSync, id: string): unknown {
  return JSON.parse((db.prepare("SELECT blocks FROM murals WHERE id = ?").get(id) as { blocks: string }).blocks);
}

const resolveAll = (_owner: string, entries: Array<{ key: string }>) => new Map(entries.map((entry) => [entry.key, { workId: `w-${entry.key}`, title: null }]));

test("the mural step resolves the keys its blocks reference", () => {
  const db = freshDb();
  insertMural(db, "m1", "u1", [
    { id: "a", type: "spotlight", bookKey: "k1" },
    { id: "b", type: "shelf", bookKeys: ["k1", "k2"] },
    { id: "c", type: "quote", mode: "rediscover", bookKey: "" }
  ]);
  const calls: Array<[string, string[]]> = [];
  const step = createMuralsWorksStep(db, (owner, entries) => {
    calls.push([owner, entries.map((entry) => entry.key)]);
    return new Map(entries.map((entry) => [entry.key, { workId: entry.key === "k1" ? "w1" : null, title: null }]));
  });
  const batch = step(0, 250);
  assert.equal(batch.visited, 1);
  assert.equal(batch.resolved, 1);
  assert.deepEqual(calls, [["u1", ["k1", "k2"]]]);
  assert.deepEqual(worksOf(db, "m1"), [{ key: "k1", work_id: "w1" }, { key: "k2", work_id: null }]);
});

test("rekeying moves a mural's works rows to the kept copy", () => {
  const db = freshDb();
  insertMural(db, "m2", "u1", [{ id: "a", type: "spotlight", bookKey: "k-old" }]);
  db.prepare("INSERT INTO mural_works (mural_id, key, work_id) VALUES ('m2', 'k-old', 'w-old')").run();
  createSqliteMuralsRepository(db).rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  assert.deepEqual(blocksOf(db, "m2"), [{ id: "a", type: "spotlight", bookKey: "k-keep" }]);
  assert.deepEqual(worksOf(db, "m2"), [{ key: "k-keep", work_id: "w-keep" }]);
});

test("a resolved work survives a null re-resolve and keys off the mural are dropped", () => {
  const db = freshDb();
  insertMural(db, "m3", "u1", [{ id: "a", type: "shelf", bookKeys: ["a", "b"] }]);
  db.prepare("INSERT INTO mural_works (mural_id, key, work_id) VALUES ('m3', 'a', 'w-a'), ('m3', 'b', NULL), ('m3', 'gone', 'w-gone')").run();
  const step = createMuralsWorksStep(db, (_owner, entries) => new Map(entries.map((entry) => [entry.key, { workId: null, title: null }])));
  step(0, 250);
  assert.deepEqual(worksOf(db, "m3"), [{ key: "a", work_id: "w-a" }, { key: "b", work_id: null }]);
});

test("a mural with no works rows stays pending after a rekey and ends with rows for all its keys", () => {
  const db = freshDb();
  insertMural(db, "m4", "u1", [{ id: "a", type: "shelf", bookKeys: ["k-old", "k-keep", "other"] }]);
  createSqliteMuralsRepository(db).rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  assert.deepEqual(worksOf(db, "m4"), []);
  const step = createMuralsWorksStep(db, resolveAll);
  assert.equal(step(0, 250).visited, 1);
  assert.deepEqual(worksOf(db, "m4"), [{ key: "k-keep", work_id: "w-k-keep" }, { key: "other", work_id: "w-other" }]);
});

test("rekeying with no resolved work keeps the work already stored for the kept copy", () => {
  const db = freshDb();
  insertMural(db, "m5", "u1", [{ id: "a", type: "shelf", bookKeys: ["k-old", "k-keep"] }]);
  db.prepare("INSERT INTO mural_works (mural_id, key, work_id) VALUES ('m5', 'k-old', 'w-old'), ('m5', 'k-keep', 'w-keep')").run();
  createSqliteMuralsRepository(db).rekeyBooks("u1", ["k-old"], "k-keep", null);
  assert.deepEqual(worksOf(db, "m5"), [{ key: "k-keep", work_id: "w-keep" }]);
});

test("a mural whose stored blocks are not an array is visited without throwing", () => {
  const db = freshDb();
  insertMural(db, "m6", "u1", []);
  db.prepare("UPDATE murals SET blocks = 'null' WHERE id = 'm6'").run();
  const step = createMuralsWorksStep(db, resolveAll);
  assert.equal(step(0, 250).visited, 1);
  assert.deepEqual(worksOf(db, "m6"), []);
});
