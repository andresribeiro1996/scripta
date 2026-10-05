import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "tierlists-works-sweep-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.TIERLISTS_DB_PATH = join(scratch, "tierlists.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyTierlistsMigrations } = await import("./adapters/sqlite/connection.js");
const { createTierlistsWorksStep } = await import("./worksSweep.js");
const { createSqliteTierlistsRepository } = await import("./adapters/sqlite/sqliteTierlistsRepository.js");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  return db;
}

function insertList(db: DatabaseSync, id: string, owner: string, origin: string, pool: string[], publicBooks: unknown[] | null): void {
  db.prepare(
    "INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, data, vote_code, public_books, created_at, updated_at) VALUES (?, ?, ?, 'n', ?, ?, ?, 't0', 't0')"
  ).run(id, owner, origin, JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: [] }], pool }), publicBooks ? "CODE" + id : null, publicBooks ? JSON.stringify(publicBooks) : null);
}

function worksOf(db: DatabaseSync, id: string): Array<{ key: string; work_id: string | null }> {
  return (db.prepare("SELECT key, work_id FROM tierlist_works WHERE tierlist_id = ? ORDER BY key").all(id) as Array<{ key: string; work_id: string | null }>).map((row) => ({ ...row }));
}

test("the step resolves a list from its creator's library, then fills its placements", () => {
  const db = freshDb();
  insertList(db, "t1", "u1", "u1", ["a", "b"], null);
  db.prepare("INSERT INTO tierlist_ballots (id, tierlist_id, voter_user_id, created_at, updated_at) VALUES ('b1', 't1', 'u2', 't0', 't0')").run();
  db.prepare("INSERT INTO tierlist_ballot_placements (ballot_id, tierlist_id, book_key, tier_id, work_id) VALUES ('b1', 't1', 'a', 's', NULL)").run();
  const calls: Array<[string, string[]]> = [];
  const step = createTierlistsWorksStep(db, (owner, entries) => {
    calls.push([owner, entries.map((entry) => entry.key)]);
    return new Map(entries.map((entry) => [entry.key, { workId: entry.key === "a" ? "w-a" : null, title: null }]));
  });
  const batch = step(0, 250);
  assert.equal(batch.visited, 1);
  assert.equal(batch.resolved, 1);
  assert.deepEqual(calls, [["u1", ["a", "b"]]]);
  assert.deepEqual(worksOf(db, "t1"), [{ key: "a", work_id: "w-a" }, { key: "b", work_id: null }]);
  const placement = db.prepare("SELECT work_id FROM tierlist_ballot_placements WHERE ballot_id = 'b1'").get() as { work_id: string | null };
  assert.equal(placement.work_id, "w-a");
});

test("a promoted list whose creator is gone resolves from its public_books snapshot", () => {
  const db = freshDb();
  const book = (title: string, author: string) => ({ title, author, isbn: null, imageId: null, coverUrl: null, readStatus: null });
  insertList(db, "t2", "__app__", "gone", ["k1", "k2"], [book("Dune", "Frank Herbert"), book("Orlando", "Virginia Woolf")]);
  const seen: Array<[string, string, string | null]> = [];
  const step = createTierlistsWorksStep(db, (owner, entries) => {
    for (const entry of entries) seen.push([owner, entry.key, entry.title ?? null]);
    return new Map(entries.map((entry) => [entry.key, { workId: `w-${entry.title}`, title: entry.title ?? null }]));
  });
  step(0, 250);
  assert.deepEqual(seen, [["gone", "k1", "Dune"], ["gone", "k2", "Orlando"]]);
  assert.deepEqual(worksOf(db, "t2"), [{ key: "k1", work_id: "w-Dune" }, { key: "k2", work_id: "w-Orlando" }]);
});

test("lists whose rows are all resolved are not visited again", () => {
  const db = freshDb();
  insertList(db, "t1", "u1", "u1", ["a", "b"], null);
  const step = createTierlistsWorksStep(db, (_owner, entries) => new Map(entries.map((entry) => [entry.key, { workId: `w-${entry.key}`, title: null }])));
  assert.equal(step(0, 250).visited, 1);
  assert.equal(step(0, 250).visited, 0);
});

test("a snapshot shorter than the pool is ignored, so no key gets another key's work", () => {
  const db = freshDb();
  const book = (title: string) => ({ title, author: "x", isbn: null, imageId: null, coverUrl: null, readStatus: null });
  insertList(db, "t3", "__app__", "gone", ["a", "b", "c"], [book("A"), book("C")]);
  const step = createTierlistsWorksStep(db, (_owner, entries) => new Map(entries.map((entry) => [entry.key, { workId: entry.title ? `w-${entry.title}` : null, title: entry.title ?? null }])));
  step(0, 250);
  assert.deepEqual(worksOf(db, "t3"), [{ key: "a", work_id: null }, { key: "b", work_id: null }, { key: "c", work_id: null }]);
});

test("a stored null snapshot does not throw", () => {
  const db = freshDb();
  insertList(db, "t4", "u1", "u1", ["a"], null);
  db.prepare("UPDATE tierlists SET public_books = 'null' WHERE id = 't4'").run();
  const step = createTierlistsWorksStep(db, (_owner, entries) => new Map(entries.map((entry) => [entry.key, { workId: null, title: null }])));
  assert.equal(step(0, 250).visited, 1);
});

test("a re-sweep never replaces a stored work with NULL and drops keys off the board", () => {
  const db = freshDb();
  insertList(db, "t5", "u1", "u1", ["a", "b"], null);
  db.prepare("INSERT INTO tierlist_works (tierlist_id, key, work_id) VALUES ('t5', 'a', 'w-a'), ('t5', 'b', NULL), ('t5', 'gone', 'w-gone')").run();
  const step = createTierlistsWorksStep(db, (_owner, entries) => new Map(entries.map((entry) => [entry.key, { workId: null, title: null }])));
  step(0, 250);
  assert.deepEqual(worksOf(db, "t5"), [{ key: "a", work_id: "w-a" }, { key: "b", work_id: null }]);
});

test("a list with no works rows stays pending after a rekey and ends with rows for all its keys", () => {
  const db = freshDb();
  insertList(db, "t6", "u1", "u1", ["k-old", "k-keep", "other"], null);
  createSqliteTierlistsRepository(db).rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  assert.deepEqual(worksOf(db, "t6"), []);
  const step = createTierlistsWorksStep(db, (_owner, entries) => new Map(entries.map((entry) => [entry.key, { workId: `w-${entry.key}`, title: null }])));
  assert.equal(step(0, 250).visited, 1);
  assert.deepEqual(worksOf(db, "t6"), [{ key: "k-keep", work_id: "w-k-keep" }, { key: "other", work_id: "w-other" }]);
});

test("a list whose stored data is not an object is visited without throwing", () => {
  const db = freshDb();
  insertList(db, "t7", "u1", "u1", [], null);
  db.prepare("UPDATE tierlists SET data = 'null' WHERE id = 't7'").run();
  const step = createTierlistsWorksStep(db, (_owner, entries) => new Map(entries.map((entry) => [entry.key, { workId: null, title: null }])));
  assert.equal(step(0, 250).visited, 1);
});
