// Adapter-level tests against a real in-memory SQLite database — the SQL
// itself (the voter_user_id migration, the listVotedByUser join) is
// exactly what service.test.ts's in-memory fake cannot check.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDir = mkdtempSync(join(tmpdir(), "arena-repo-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH ??= join(scratchDir, "gallery-files");

const { applyArenaMigrations } = await import("./connection.js");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  return db;
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

test("a fresh database has the voter_user_id column and its partial index", () => {
  const db = freshDb();
  assert.ok(columnNames(db, "votes").includes("voter_user_id"));
  const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='votes'`).all() as unknown as Array<{ name: string }>;
  assert.ok(indexes.some((i) => i.name === "idx_votes_voter_user"));
  assert.ok(indexes.some((i) => i.name === "idx_votes_duel_user"), "the one-vote-per-account unique index must exist");
});

test("migrating a pre-existing votes table adds the column without losing rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tournaments (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL,
      bracket_size INTEGER NOT NULL, round_duration_minutes INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'seeding', current_round INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE duels (
      id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL, duel_index INTEGER NOT NULL,
      book_a_key TEXT NOT NULL, book_a_title TEXT NOT NULL, book_a_author TEXT NOT NULL, book_a_cover TEXT,
      book_b_key TEXT NOT NULL, book_b_title TEXT NOT NULL, book_b_author TEXT NOT NULL, book_b_cover TEXT,
      winner_key TEXT, status TEXT NOT NULL DEFAULT 'active', opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, settled_at TEXT
    );
    CREATE TABLE votes (
      id TEXT PRIMARY KEY,
      duel_id TEXT NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
      voter_token TEXT NOT NULL,
      book_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (duel_id, voter_token)
    );
    INSERT INTO tournaments VALUES ('t1','u1','Old',2,60,'completed',1,'2026-01-01','2026-01-01');
    INSERT INTO duels VALUES ('d1','t1',1,0,'a','A','x',NULL,'b','B','y',NULL,'a','settled','2026-01-01','2026-01-02','2026-01-02');
    INSERT INTO votes VALUES ('v1','d1','tok', 'a', '2026-01-01');
  `);

  applyArenaMigrations(db);

  assert.ok(columnNames(db, "votes").includes("voter_user_id"));
  const row = db.prepare(`SELECT voter_token, voter_user_id, book_key FROM votes WHERE id = 'v1'`).get() as {
    voter_token: string;
    voter_user_id: string | null;
    book_key: string;
  };
  assert.equal(row.voter_token, "tok");
  assert.equal(row.voter_user_id, null);
  assert.equal(row.book_key, "a");
});

test("applyArenaMigrations is idempotent", () => {
  const db = freshDb();
  applyArenaMigrations(db);
  applyArenaMigrations(db);
  assert.ok(columnNames(db, "votes").includes("voter_user_id"));
});

const { createSqliteArenaRepository } = await import("./sqliteArenaRepository.js");
import type { DuelRow, TournamentRow, VoteRow } from "../../domain/types.js";

function seedTournament(db: DatabaseSync, id: string, owner: string, name: string) {
  db.prepare(
    `INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes, status, current_round, created_at, updated_at)
     VALUES (?, ?, ?, 2, 60, 'completed', 1, '2026-01-01', '2026-01-01')`
  ).run(id, owner, name);
  db.prepare(
    `INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_key, book_a_title, book_a_author, book_a_cover,
       book_b_key, book_b_title, book_b_author, book_b_cover, winner_key, status, opens_at, closes_at, settled_at)
     VALUES (?, ?, 1, 0, 'a', 'A', 'x', NULL, 'b', 'B', 'y', NULL, 'a', 'settled', '2026-01-01', '2026-01-02', '2026-01-02')`
  ).run(`duel-${id}`, id);
}

function vote(id: string, duelId: string, token: string, user: string | null, createdAt: string): VoteRow {
  return { id, duel_id: duelId, voter_token: token, voter_user_id: user, book_key: "a", created_at: createdAt };
}

test("listVotedByUser returns others' tournaments with a stamped vote, latest vote first", () => {
  const db = freshDb();
  seedTournament(db, "t1", "u1", "Old vote");
  seedTournament(db, "t2", "u1", "New vote");
  seedTournament(db, "t3", "voter-1", "Own");
  const repo = createSqliteArenaRepository(db);
  const duelOf = (tournamentId: string): DuelRow["id"] => `duel-${tournamentId}`;

  repo.insertVote(vote("v1", duelOf("t1"), "tok-1", "voter-1", "2026-01-01T00:00:00.000Z"));
  repo.insertVote(vote("v2", duelOf("t2"), "tok-1", "voter-1", "2026-02-01T00:00:00.000Z"));
  repo.insertVote(vote("v3", duelOf("t3"), "tok-1", "voter-1", "2026-03-01T00:00:00.000Z"));
  // Anonymous votes never match the account filter.
  repo.insertVote(vote("v4", duelOf("t1"), "tok-2", null, "2026-04-01T00:00:00.000Z"));

  assert.deepEqual(repo.listVotedByUser("voter-1").map((t: TournamentRow) => t.name), ["New vote", "Old vote"]);
  assert.deepEqual(repo.listVotedByUser("nobody"), []);
});

test("linkVotesToUser claims only the token's unclaimed votes and never steals claimed ones", () => {
  const db = freshDb();
  seedTournament(db, "t1", "u1", "One");
  seedTournament(db, "t2", "u1", "Two");
  const repo = createSqliteArenaRepository(db);

  repo.insertVote(vote("v1", "duel-t1", "tok-1", null, "2026-01-01T00:00:00.000Z"));
  repo.insertVote(vote("v2", "duel-t2", "tok-1", "voter-2", "2026-01-02T00:00:00.000Z"));
  repo.linkVotesToUser("tok-1", "voter-1");

  const claimed = (db.prepare(`SELECT id, voter_user_id FROM votes ORDER BY id`).all() as unknown as Array<{ id: string; voter_user_id: string | null }>).map(
    (row) => ({ ...row }) // node:sqlite rows have null prototypes
  );
  assert.deepEqual(claimed, [
    { id: "v1", voter_user_id: "voter-1" },
    { id: "v2", voter_user_id: "voter-2" }
  ]);
});

test("a signed-in voter's second token cannot vote a duel the account already voted", () => {
  const db = freshDb();
  seedTournament(db, "t1", "u1", "One");
  const repo = createSqliteArenaRepository(db);

  assert.equal(repo.insertVote(vote("v1", "duel-t1", "token-a", "voter-1", "2026-01-01T00:00:00.000Z")), true);
  assert.equal(repo.insertVote(vote("v2", "duel-t1", "token-b", "voter-1", "2026-01-02T00:00:00.000Z")), false);
  // Anonymous tokens are still one-vote-per-token, nothing stricter.
  assert.equal(repo.insertVote(vote("v3", "duel-t1", "token-c", null, "2026-01-03T00:00:00.000Z")), true);
  // A different account on the same fresh token votes normally.
  assert.equal(repo.insertVote(vote("v4", "duel-t1", "token-b", "voter-2", "2026-01-04T00:00:00.000Z")), true);
});

test("linkVotesToUser leaves a duel's anonymous vote alone when the account already voted it", () => {
  const db = freshDb();
  seedTournament(db, "t1", "u1", "One");
  seedTournament(db, "t2", "u1", "Two");
  const repo = createSqliteArenaRepository(db);

  // token-b's old anonymous vote on duel-t1, and the account's own vote
  // on the same duel from another device — the backfill must skip the
  // collision rather than violate idx_votes_duel_user.
  repo.insertVote(vote("v1", "duel-t1", "token-b", null, "2026-01-01T00:00:00.000Z"));
  repo.insertVote(vote("v2", "duel-t1", "token-a", "voter-1", "2026-01-02T00:00:00.000Z"));
  repo.insertVote(vote("v3", "duel-t2", "token-b", null, "2026-01-03T00:00:00.000Z"));
  repo.linkVotesToUser("token-b", "voter-1");

  const rows = db.prepare(`SELECT id, voter_user_id FROM votes ORDER BY id`).all() as unknown as Array<{ id: string; voter_user_id: string | null }>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: "v1", voter_user_id: null },
    { id: "v2", voter_user_id: "voter-1" },
    { id: "v3", voter_user_id: "voter-1" }
  ]);
});

test("hasVoted matches the account on any token, or the token alone when anonymous", () => {
  const db = freshDb();
  seedTournament(db, "t1", "u1", "One");
  const repo = createSqliteArenaRepository(db);
  repo.insertVote(vote("v1", "duel-t1", "token-a", "voter-1", "2026-01-01T00:00:00.000Z"));

  assert.equal(repo.hasVoted("duel-t1", "token-a", null), true);
  assert.equal(repo.hasVoted("duel-t1", "token-b", "voter-1"), true);
  assert.equal(repo.hasVoted("duel-t1", "token-b", null), false);
  assert.equal(repo.hasVoted("duel-t1", null, "voter-1"), true);
  assert.equal(repo.hasVoted("duel-t1", null, null), false);
});

test("the boot migration dedupes pre-existing multi-votes before creating idx_votes_duel_user", () => {
  const db = freshDb();
  seedTournament(db, "t1", "u1", "One");
  db.exec(`DROP INDEX idx_votes_duel_user`);
  db.exec(`
    INSERT INTO votes (id, duel_id, voter_token, voter_user_id, book_key, created_at) VALUES
      ('keep',   'duel-t1', 'token-a', 'voter-1', 'a', '2026-01-01T00:00:00.000Z'),
      ('first',  'duel-t1', 'token-b', 'voter-1', 'b', '2026-01-02T00:00:00.000Z'),
      ('second', 'duel-t1', 'token-c', 'voter-1', 'a', '2026-01-03T00:00:00.000Z'),
      ('anon',   'duel-t1', 'token-d', NULL,      'a', '2026-01-04T00:00:00.000Z')
  `);

  applyArenaMigrations(db);

  const ids = (db.prepare(`SELECT id FROM votes ORDER BY id`).all() as unknown as Array<{ id: string }>).map((r) => r.id);
  assert.deepEqual(ids, ["anon", "keep"]);
  const index = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_votes_duel_user'`).get() as unknown as { name: string } | undefined;
  assert.ok(index, "the unique index is recreated");
});
