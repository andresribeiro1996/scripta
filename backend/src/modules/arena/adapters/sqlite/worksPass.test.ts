import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrateArenaToWorks } from "./worksPass.js";

const E1_SCHEMA = `
  CREATE TABLE tournaments (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT, bracket_size INTEGER NOT NULL, round_duration_minutes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'seeding', current_round INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
  CREATE TABLE tournament_slots (tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, slot_index INTEGER NOT NULL, book_key TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, cover_url TEXT, work_id TEXT, PRIMARY KEY (tournament_id, slot_index));
  CREATE TABLE duels (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, round_number INTEGER NOT NULL, duel_index INTEGER NOT NULL,
    book_a_key TEXT NOT NULL, book_a_title TEXT NOT NULL, book_a_author TEXT NOT NULL, book_a_cover TEXT, book_a_work_id TEXT,
    book_b_key TEXT NOT NULL, book_b_title TEXT NOT NULL, book_b_author TEXT NOT NULL, book_b_cover TEXT, book_b_work_id TEXT,
    winner_key TEXT, winner_work_id TEXT, status TEXT NOT NULL DEFAULT 'active', opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, settled_at TEXT);
  CREATE TABLE votes (id TEXT PRIMARY KEY, duel_id TEXT NOT NULL REFERENCES duels(id) ON DELETE CASCADE, voter_token TEXT NOT NULL, voter_user_id TEXT, book_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '', UNIQUE (duel_id, voter_token));
  CREATE INDEX idx_votes_duel_book ON votes(duel_id, book_key);
`;

function e1Db() {
  const db = new DatabaseSync(":memory:");
  db.exec(E1_SCHEMA);
  db.exec(`
    INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes, status) VALUES ('t1', 'u1', 'T', 2, 60, 'active');
    INSERT INTO tournament_slots VALUES ('t1', 0, 'isbn:1', 'Dune', 'Herbert', NULL, 'w-dune'), ('t1', 1, 'ta:dune|herbert', 'Dune again', 'Herbert', NULL, 'w-dune');
    INSERT INTO duels VALUES ('d1', 't1', 1, 0, 'isbn:1', 'Dune', 'Herbert', NULL, 'w-dune', 'ta:dune|herbert', 'Dune again', 'Herbert', NULL, 'w-dune', 'ta:dune|herbert', 'w-dune', 'settled', 'x', 'y', 'z');
    INSERT INTO votes (id, duel_id, voter_token, book_key) VALUES ('v1', 'd1', 'a', 'isbn:1'), ('v2', 'd1', 'b', 'ta:dune|herbert'), ('v3', 'd1', 'c', 'ta:dune|herbert'), ('v4', 'd1', 'd', 'isbn:gone');
  `);
  return db;
}

const columnNames = (db: DatabaseSync, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

test("the pass drops arena keys, keeps every slot, and moves votes and winners to sides", () => {
  const db = e1Db();
  migrateArenaToWorks(db);
  assert.deepEqual(columnNames(db, "tournament_slots"), ["tournament_id", "slot_index", "work_id", "title", "author", "cover_url"]);
  assert.equal(columnNames(db, "duels").some((c) => c.endsWith("_key") || c === "winner_work_id"), false);
  assert.deepEqual(db.prepare("SELECT slot_index, work_id, title FROM tournament_slots ORDER BY slot_index").all().map((r) => ({ ...r })), [
    { slot_index: 0, work_id: "w-dune", title: "Dune" },
    { slot_index: 1, work_id: "w-dune", title: "Dune again" }
  ]);
  assert.equal((db.prepare("SELECT winner_side FROM duels WHERE id = 'd1'").get() as { winner_side: string }).winner_side, "b");
  assert.deepEqual(db.prepare("SELECT side, COUNT(*) AS n FROM votes GROUP BY side ORDER BY side").all().map((r) => ({ ...r })), [{ side: "a", n: 1 }, { side: "b", n: 2 }]);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
  assert.equal((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
});

test("deleting a tournament after the pass still cascades to its duels and votes", () => {
  const db = e1Db();
  migrateArenaToWorks(db);
  db.prepare("DELETE FROM tournaments WHERE id = 't1'").run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM votes").get() as { n: number }).n, 0);
});

test("a second run, and a fresh database, are no-ops", () => {
  const db = e1Db();
  migrateArenaToWorks(db);
  migrateArenaToWorks(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM votes").get() as { n: number }).n, 3);
  const fresh = new DatabaseSync(":memory:");
  migrateArenaToWorks(fresh);
  assert.equal((fresh.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 0);
});

test("a pass that would leave broken foreign keys rolls back", () => {
  const db = e1Db();
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("INSERT INTO duels VALUES ('d2', 'gone', 1, 1, 'isbn:1', 'Dune', 'Herbert', NULL, 'w-dune', 'ta:dune|herbert', 'Dune again', 'Herbert', NULL, 'w-dune', NULL, NULL, 'active', 'x', 'y', NULL)");
  db.exec("PRAGMA foreign_keys = ON");
  assert.throws(() => migrateArenaToWorks(db), /broken foreign keys/);
  assert.equal(columnNames(db, "tournament_slots").includes("book_key"), true);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 0);
});
