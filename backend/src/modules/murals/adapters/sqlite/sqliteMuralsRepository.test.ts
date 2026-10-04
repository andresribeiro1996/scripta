import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createSqliteMuralsRepository } from "./sqliteMuralsRepository.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  return db;
}

test("rekeyBooks rewrites only the owner's murals and bumps updated_at only where blocks changed", () => {
  const db = freshDb();
  const insert = db.prepare("INSERT INTO murals (id, user_id, name, blocks, updated_at) VALUES (?, ?, 'm', ?, 't0')");
  insert.run("mine", "u1", JSON.stringify([{ id: "b", type: "spotlight", bookKey: "old" }]));
  insert.run("untouched", "u1", JSON.stringify([{ id: "b", type: "text", body: "hi" }]));
  insert.run("theirs", "u2", JSON.stringify([{ id: "b", type: "spotlight", bookKey: "old" }]));
  createSqliteMuralsRepository(db).rekeyBooks("u1", ["old"], "new");
  const row = (id: string) => db.prepare("SELECT blocks, updated_at FROM murals WHERE id = ?").get(id) as { blocks: string; updated_at: string };
  assert.deepEqual(JSON.parse(row("mine").blocks), [{ id: "b", type: "spotlight", bookKey: "new" }]);
  assert.notEqual(row("mine").updated_at, "t0");
  assert.equal(row("untouched").updated_at, "t0");
  assert.deepEqual(JSON.parse(row("theirs").blocks), [{ id: "b", type: "spotlight", bookKey: "old" }]);
});

test("a trigger that rolls the transaction back surfaces its own error and keeps every row", () => {
  const db = freshDb();
  db.prepare("INSERT INTO murals (id, user_id, name) VALUES ('m1', 'u1', 'm')").run();
  db.prepare("INSERT INTO mural_folders (id, user_id, name) VALUES ('f1', 'u1', 'f')").run();
  db.exec("CREATE TRIGGER boom BEFORE DELETE ON mural_folders BEGIN SELECT RAISE(ROLLBACK, 'trigger boom'); END");
  assert.throws(() => createSqliteMuralsRepository(db).deleteUserData("u1"), /trigger boom/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM murals").get() as { n: number }).n, 1);
  assert.equal(db.isTransaction, false);
});

const T0 = "2020-01-01T00:00:00.000Z";

function workRows(db: DatabaseSync, muralId: string) {
  const rows = db.prepare("SELECT key, work_id FROM mural_works WHERE mural_id = ? ORDER BY key").all(muralId) as Array<{ key: string; work_id: string | null }>;
  return rows.map((row) => ({ ...row }));
}

test("a blocks update rewrites the mural's works; a stale update writes none", () => {
  const db = freshDb();
  db.prepare("INSERT INTO murals (id, user_id, name, updated_at) VALUES ('m1', 'u1', 'm', ?)").run(T0);
  const repository = createSqliteMuralsRepository(db);

  const first = repository.update("m1", "u1", { blocks: "[]" }, T0, new Map([["k1", "w1"]]));
  assert.ok(first);
  assert.deepEqual(workRows(db, "m1"), [{ key: "k1", work_id: "w1" }]);

  assert.equal(repository.update("m1", "u1", { blocks: "[]" }, "stale", new Map([["k2", "w2"]])), undefined);
  assert.deepEqual(workRows(db, "m1"), [{ key: "k1", work_id: "w1" }]);

  repository.update("m1", "u1", { name: "renamed" });
  assert.deepEqual(workRows(db, "m1"), [{ key: "k1", work_id: "w1" }]);

  repository.update("m1", "u1", { blocks: "[]" }, undefined, new Map([["k3", null]]));
  assert.deepEqual(workRows(db, "m1"), [{ key: "k3", work_id: null }]);
});

test("deleting a mural or a user's data clears its works", () => {
  const db = freshDb();
  const insertMural = db.prepare("INSERT INTO murals (id, user_id, name) VALUES (?, ?, 'm')");
  const insertWork = db.prepare("INSERT INTO mural_works (mural_id, key, work_id) VALUES (?, ?, ?)");
  insertMural.run("m1", "u1");
  insertMural.run("m2", "u1");
  insertMural.run("m3", "u2");
  insertWork.run("m1", "k", "w");
  insertWork.run("m2", "k", "w");
  insertWork.run("m3", "k", "w");
  const repository = createSqliteMuralsRepository(db);

  assert.equal(repository.delete("m1", "u2"), false);
  assert.equal(workRows(db, "m1").length, 1);
  assert.equal(repository.delete("m1", "u1"), true);
  assert.equal(workRows(db, "m1").length, 0);

  repository.deleteUserData("u1");
  assert.equal(workRows(db, "m2").length, 0);
  assert.equal(workRows(db, "m3").length, 1);
});
