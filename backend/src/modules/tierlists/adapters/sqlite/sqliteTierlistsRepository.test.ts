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

import { createSqliteTierlistsRepository } from "./sqliteTierlistsRepository.js";
import type { BallotRow, TierlistRow } from "../../domain/types.js";

function row(overrides: Partial<TierlistRow> & { id: string }): TierlistRow {
  return {
    owner_user_id: "u1",
    name: "List",
    data: JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#fff", bookKeys: [] }], pool: ["b1", "b2"] }),
    vote_code: null,
    vote_access: "anonymous",
    voting_open: 0,
    source_tierlist_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function ballot(overrides: Partial<BallotRow> & { id: string; tierlist_id: string }): BallotRow {
  return {
    voter_user_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("insertCommunityCopy stores the copy with its seeded ballot atomically", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insertCommunityCopy(
    row({ id: "c1", vote_code: "abc12345", voting_open: 1, source_tierlist_id: "t1" }),
    ballot({ id: "bal1", tierlist_id: "c1", voter_user_id: "u1" }),
    [
      { bookKey: "b1", tierId: "s" },
      { bookKey: "b2", tierId: "s" }
    ]
  );

  assert.equal(repo.getByVoteCode("abc12345")?.id, "c1");
  assert.equal(repo.ballotCount("c1"), 1);
  assert.deepEqual(repo.getPlacements("bal1"), [
    { bookKey: "b1", tierId: "s" },
    { bookKey: "b2", tierId: "s" }
  ]);
});

test("getByVoteCode returns undefined for an unknown code", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  assert.equal(repo.getByVoteCode("nope"), undefined);
});

test("histogram counts each book-tier pair across ballots", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insertCommunityCopy(row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "bal1", tierlist_id: "c1" }), [
    { bookKey: "b1", tierId: "s" }
  ]);
  repo.saveBallot(ballot({ id: "bal2", tierlist_id: "c1" }), [
    { bookKey: "b1", tierId: "s" },
    { bookKey: "b2", tierId: "a" }
  ]);

  const cells = repo.histogram("c1");
  assert.equal(cells.find((c) => c.bookKey === "b1" && c.tierId === "s")?.votes, 2);
  assert.equal(cells.find((c) => c.bookKey === "b2" && c.tierId === "a")?.votes, 1);
  assert.equal(repo.ballotCount("c1"), 2);
});

test("saveBallot replaces a ballot's placements rather than appending", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insertCommunityCopy(row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "bal1", tierlist_id: "c1" }), [
    { bookKey: "b1", tierId: "s" }
  ]);
  repo.saveBallot(ballot({ id: "bal1", tierlist_id: "c1" }), [{ bookKey: "b1", tierId: "a" }]);

  assert.deepEqual(repo.getPlacements("bal1"), [{ bookKey: "b1", tierId: "a" }]);
  assert.equal(repo.ballotCount("c1"), 1);
});

test("an account cannot hold two ballots on one tier list", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insertCommunityCopy(row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "bal1", tierlist_id: "c1", voter_user_id: "u9" }), []);
  assert.throws(() => repo.saveBallot(ballot({ id: "bal2", tierlist_id: "c1", voter_user_id: "u9" }), []));
  assert.equal(repo.getBallotByVoter("c1", "u9")?.id, "bal1");
});

test("listPublic returns only community copies, newest first", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insert(row({ id: "private1" }));
  repo.insertCommunityCopy(row({ id: "c1", vote_code: "aaa", created_at: "2026-01-01T00:00:00.000Z" }), ballot({ id: "b1", tierlist_id: "c1" }), []);
  repo.insertCommunityCopy(row({ id: "c2", vote_code: "bbb", created_at: "2026-02-01T00:00:00.000Z" }), ballot({ id: "b2", tierlist_id: "c2" }), []);

  assert.deepEqual(repo.listPublic(10, 0).map((t) => t.id), ["c2", "c1"]);
  assert.deepEqual(repo.listPublic(1, 1).map((t) => t.id), ["c1"]);
  assert.equal(repo.ballotCountsByTierlist().get("c1"), 1);
});

test("setVoting changes access and open state, ownership-checked", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insertCommunityCopy(row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "b1", tierlist_id: "c1" }), []);

  assert.equal(repo.setVoting("c1", "u2", { voting_open: 0 }), undefined);
  const updated = repo.setVoting("c1", "u1", { vote_access: "members", voting_open: 0 });
  assert.equal(updated?.vote_access, "members");
  assert.equal(updated?.voting_open, 0);
  assert.equal(repo.getOwned("c1", "u1")?.vote_access, "members");
});
