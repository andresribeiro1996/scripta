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
