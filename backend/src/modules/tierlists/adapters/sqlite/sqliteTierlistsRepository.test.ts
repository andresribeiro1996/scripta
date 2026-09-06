// Adapter-level tests against a real in-memory SQLite database — the SQL
// itself (migrations, the partial unique index, the histogram GROUP BY)
// is exactly what service.test.ts's in-memory fake cannot check.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { applyTierlistsMigrations } from "./connection.js";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  return db;
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

test("a fresh database has the voting columns and ballot tables", () => {
  const db = freshDb();
  const cols = columnNames(db, "tierlists");
  for (const col of ["vote_code", "vote_access", "voting_open", "source_tierlist_id"]) {
    assert.ok(cols.includes(col), `tierlists is missing ${col}`);
  }
  assert.ok(columnNames(db, "tierlist_ballots").includes("voter_user_id"));
  assert.ok(columnNames(db, "tierlist_ballot_placements").includes("tier_id"));
});

test("migrating a pre-voting database adds the columns without losing rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tierlists (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO tierlists VALUES ('t1','u1','Old','{}','2026-01-01','2026-01-01')`).run();

  applyTierlistsMigrations(db);

  const cols = columnNames(db, "tierlists");
  assert.ok(cols.includes("vote_code"));
  const row = db.prepare(`SELECT name, vote_access, voting_open, vote_code FROM tierlists WHERE id = 't1'`).get() as {
    name: string;
    vote_access: string;
    voting_open: number;
    vote_code: string | null;
  };
  assert.equal(row.name, "Old");
  assert.equal(row.vote_access, "anonymous");
  assert.equal(row.voting_open, 0);
  assert.equal(row.vote_code, null);
});

test("applyTierlistsMigrations is idempotent", () => {
  const db = freshDb();
  applyTierlistsMigrations(db);
  applyTierlistsMigrations(db);
  assert.ok(columnNames(db, "tierlists").includes("vote_code"));
});

test("vote_code is unique but many rows may leave it NULL", () => {
  const db = freshDb();
  const insert = db.prepare(
    `INSERT INTO tierlists (id, owner_user_id, name, data, created_at, updated_at, vote_code)
     VALUES (?, 'u1', 'n', '{}', '2026-01-01', '2026-01-01', ?)`
  );
  insert.run("a", null);
  insert.run("b", null);
  insert.run("c", "code1");
  assert.throws(() => insert.run("d", "code1"));
});
