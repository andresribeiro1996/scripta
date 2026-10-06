import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "community-migration-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.NODE_ENV = "test";

const { applyHomeMuralMigration } = await import("./migration.js");
const { inTransaction } = await import("./adapters/sqlite/connection.js");

function communityDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8"));
  return db;
}

function getRow(db: DatabaseSync, userId: string) {
  const row = db.prepare("SELECT user_id, published, mural_id FROM profiles WHERE user_id = ?").get(userId) as
    | { user_id: string; published: number; mural_id: string | null }
    | undefined;
  return row && { ...row };
}

test("home mural becomes the profile mural, published untouched", () => {
  const db = communityDb();
  applyHomeMuralMigration([{ userId: "u1", muralId: "m1" }], db);
  assert.deepEqual(getRow(db, "u1"), { user_id: "u1", published: 0, mural_id: "m1" });
});

test("an already-published profile keeps its chosen mural", () => {
  const db = communityDb();
  db.prepare("INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at) VALUES ('u1', 1, 'chosen', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')").run();
  applyHomeMuralMigration([{ userId: "u1", muralId: "home-mural" }], db);
  assert.equal(getRow(db, "u1")?.mural_id, "chosen");
  assert.equal(getRow(db, "u1")?.published, 1);
});

test("unpublished user with a chosen mural keeps it, published stays 0", () => {
  const db = communityDb();
  db.prepare("INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at) VALUES ('u1', 0, 'old', NULL, '2026-09-01T00:00:00.000Z')").run();
  applyHomeMuralMigration([{ userId: "u1", muralId: "home-mural" }], db);
  assert.equal(getRow(db, "u1")?.mural_id, "old");
});

test("re-running is a no-op (idempotent upsert)", () => {
  const db = communityDb();
  applyHomeMuralMigration([{ userId: "u1", muralId: "m1" }], db);
  applyHomeMuralMigration([{ userId: "u1", muralId: "m2" }], db);
  assert.equal(getRow(db, "u1")?.mural_id, "m1");
});

test("a trigger that rolls the transaction back surfaces its own error and keeps every row", () => {
  const db = communityDb();
  db.prepare("INSERT INTO profiles (user_id, published, mural_id, updated_at) VALUES ('u1', 0, NULL, 't')").run();
  db.exec("CREATE TRIGGER boom BEFORE UPDATE ON profiles BEGIN SELECT RAISE(ROLLBACK, 'trigger boom'); END");
  assert.throws(
    () => inTransaction(db, () => {
      db.prepare("INSERT INTO profiles (user_id, published, mural_id, updated_at) VALUES ('u2', 0, NULL, 't')").run();
      db.prepare("UPDATE profiles SET mural_id = 'm' WHERE user_id = 'u1'").run();
    }),
    /trigger boom/
  );
  assert.equal(getRow(db, "u2"), undefined);
  assert.equal(db.isTransaction, false);
});
