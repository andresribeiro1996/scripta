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

test("arena tables gain work id columns on an existing database", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE tournaments (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT, status TEXT, created_at TEXT)");
  db.exec("CREATE TABLE tournament_slots (tournament_id TEXT NOT NULL, slot_index INTEGER NOT NULL, book_key TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, cover_url TEXT, PRIMARY KEY (tournament_id, slot_index))");
  db.exec("CREATE TABLE duels (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL, round_number INTEGER NOT NULL, duel_index INTEGER NOT NULL, book_a_key TEXT NOT NULL, book_a_title TEXT NOT NULL, book_a_author TEXT NOT NULL, book_a_cover TEXT, book_b_key TEXT NOT NULL, book_b_title TEXT NOT NULL, book_b_author TEXT NOT NULL, book_b_cover TEXT, winner_key TEXT, status TEXT NOT NULL DEFAULT 'active', opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, settled_at TEXT)");
  applyArenaMigrations(db);
  assert.ok(columnNames(db, "tournament_slots").includes("work_id"));
  for (const column of ["book_a_work_id", "book_b_work_id", "winner_work_id"]) assert.ok(columnNames(db, "duels").includes(column));
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

test("settling a duel records the winner's work", () => {
  const db = freshDb();
  seedTournament(db, "t1", "u1", "Work winner");
  db.prepare(`UPDATE duels SET book_a_work_id = 'w-a', book_b_work_id = 'w-b', winner_key = NULL, status = 'active' WHERE id = 'duel-t1'`).run();
  const repo = createSqliteArenaRepository(db);
  repo.updateDuelSettlement("duel-t1", "settled", "b", "2026-10-04T00:00:00.000Z");
  assert.equal((db.prepare("SELECT winner_work_id FROM duels WHERE id = ?").get("duel-t1") as { winner_work_id: string | null }).winner_work_id, "w-b");
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


test("deleteUserData removes the user's tournaments and unlinks their votes on anyone else's", () => {
  const db = freshDb();
  const repo = createSqliteArenaRepository(db);
  const duel = (id: string, tournament: string) =>
    db.prepare(`INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_key, book_a_title, book_a_author, book_b_key, book_b_title, book_b_author, opens_at, closes_at)
      VALUES (?, ?, 1, 0, 'a', 'A', 'x', 'b', 'B', 'y', '2026-01-01', '2026-01-02')`).run(id, tournament);
  db.prepare(`INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes) VALUES ('mine', 'leaver', 'Mine', 4, 60), ('theirs', 'stayer', 'Theirs', 4, 60)`).run();
  duel("d-mine", "mine");
  duel("d-theirs", "theirs");
  db.prepare(`INSERT INTO votes (id, duel_id, voter_token, voter_user_id, book_key) VALUES ('v1', 'd-mine', 't1', 'stayer', 'a'), ('v2', 'd-theirs', 't2', 'leaver', 'b')`).run();
  repo.deleteUserData("leaver");
  assert.deepEqual(db.prepare(`SELECT id FROM tournaments`).all().map((r) => r.id), ["theirs"]);
  assert.deepEqual(db.prepare(`SELECT id, voter_user_id FROM votes`).all().map((r) => ({ ...r })), [{ id: "v2", voter_user_id: null }]);
});

test("participation counts each voter once per started tournament, at their first vote", () => {
  const db = freshDb();
  seedTournament(db, "t1", "u1", "Bracket");
  seedTournament(db, "t2", "u1", "Draft");
  seedTournament(db, "t3", "u9", "Theirs");
  const repo = createSqliteArenaRepository(db);
  repo.updateTournamentStatus("t2", "seeding", 0);
  db.prepare(
    `INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_key, book_a_title, book_a_author, book_b_key, book_b_title, book_b_author, opens_at, closes_at)
     VALUES ('duel-t1-b', 't1', 1, 1, 'c', 'C', 'x', 'd', 'D', 'y', '2026-01-01', '2026-01-02')`
  ).run();

  repo.insertVote(vote("v1", "duel-t1", "tok-2a", "u2", "2026-01-02T00:00:00.000Z"));
  repo.insertVote(vote("v2", "duel-t1", "tok-3", "u3", "2026-01-03T00:00:00.000Z"));
  repo.insertVote(vote("v3", "duel-t1", "tok-anon", null, "2026-01-04T00:00:00.000Z"));
  repo.insertVote(vote("v4", "duel-t1-b", "tok-anon-2", null, "2026-01-05T00:00:00.000Z"));
  repo.insertVote(vote("v5", "duel-t1-b", "tok-2b", "u2", "2026-01-06T00:00:00.000Z"));
  repo.insertVote(vote("v6", "duel-t1-b", "tok-anon", null, "2026-01-07T00:00:00.000Z"));
  repo.insertVote(vote("v7", "duel-t1", "tok-1", "u1", "2026-01-08T00:00:00.000Z"));
  repo.insertVote(vote("v8", "duel-t2", "tok-2a", "u2", "2026-01-09T00:00:00.000Z"));
  repo.insertVote(vote("v9", "duel-t3", "tok-2a", "u2", "2026-01-10T00:00:00.000Z"));

  assert.deepEqual(repo.listParticipation("u1", "2026-01-01T00:00:00.000Z").map((r) => ({ ...r })), [
    { id: "t1", name: "Bracket", participants: 4, latest_at: "2026-01-05T00:00:00.000Z" }
  ]);
  assert.deepEqual(repo.listRecentVoters("t1", "u1", 10).map((r) => ({ ...r })), [
    { user_id: "u3", at: "2026-01-03T00:00:00.000Z" },
    { user_id: "u2", at: "2026-01-02T00:00:00.000Z" }
  ]);
  assert.deepEqual(repo.listRecentVoters("t1", "u1", 1).map((r) => r.user_id), ["u3"]);
});

test("participation lists only the tournaments with a vote since the marker, counts every participant, and keeps one listed by a repeat vote", () => {
  const db = freshDb();
  seedTournament(db, "quiet", "u1", "Quiet");
  seedTournament(db, "busy", "u1", "Busy");
  seedTournament(db, "revisited", "u1", "Revisited");
  db.prepare(
    `INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_key, book_a_title, book_a_author, book_b_key, book_b_title, book_b_author, opens_at, closes_at)
     VALUES ('duel-revisited-b', 'revisited', 2, 0, 'c', 'C', 'x', 'd', 'D', 'y', '2026-01-01', '2026-01-02')`
  ).run();
  const repo = createSqliteArenaRepository(db);
  repo.insertVote(vote("v1", "duel-quiet", "tok-1", "u2", "2026-01-02T00:00:00.000Z"));
  repo.insertVote(vote("v2", "duel-busy", "tok-1", "u2", "2026-01-02T00:00:00.000Z"));
  repo.insertVote(vote("v3", "duel-busy", "tok-3", "u3", "2026-02-10T00:00:00.000Z"));
  repo.insertVote(vote("v4", "duel-revisited", "tok-1", "u2", "2026-01-03T00:00:00.000Z"));
  repo.insertVote(vote("v5", "duel-revisited-b", "tok-1", "u2", "2026-02-12T00:00:00.000Z"));
  const listed = (since: string) => repo.listParticipation("u1", since).map((r) => [r.id, r.participants, r.latest_at]).sort();

  assert.deepEqual(listed("2026-01-01T00:00:00.000Z"), [["busy", 2, "2026-02-10T00:00:00.000Z"], ["quiet", 1, "2026-01-02T00:00:00.000Z"], ["revisited", 1, "2026-01-03T00:00:00.000Z"]]);
  assert.deepEqual(listed("2026-02-01T00:00:00.000Z"), [["busy", 2, "2026-02-10T00:00:00.000Z"], ["revisited", 1, "2026-01-03T00:00:00.000Z"]]);
  assert.deepEqual(listed("2026-02-12T00:00:00.000Z"), [["revisited", 1, "2026-01-03T00:00:00.000Z"]]);
  assert.deepEqual(listed("2026-02-12T00:00:00.001Z"), []);
});

test("rekeyBooks rewrites seeding slots only and drops a slot that would duplicate the survivor", () => {
  const db = freshDb();
  const tournament = db.prepare("INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes, status) VALUES (?, ?, 'n', 8, 60, ?)");
  tournament.run("seeding", "u1", "seeding");
  tournament.run("both", "u1", "seeding");
  tournament.run("active", "u1", "active");
  const slot = db.prepare("INSERT INTO tournament_slots (tournament_id, slot_index, book_key, title, author) VALUES (?, ?, ?, 't', 'a')");
  slot.run("seeding", 0, "old");
  slot.run("both", 0, "new");
  slot.run("both", 1, "old");
  slot.run("active", 0, "old");
  createSqliteArenaRepository(db).rekeyBooks("u1", ["old"], "new", null);
  const keys = (id: string) => (db.prepare("SELECT book_key FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id) as Array<{ book_key: string }>).map((row) => row.book_key);
  assert.deepEqual(keys("seeding"), ["new"]);
  assert.deepEqual(keys("both"), ["new"]);
  assert.deepEqual(keys("active"), ["old"]);
});

test("rekeying a seeding tournament moves the slot to the kept copy's work", () => {
  const db = freshDb();
  db.prepare("INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes, status) VALUES ('t1', 'u1', 'n', 2, 60, 'seeding')").run();
  db.prepare("INSERT INTO tournament_slots (tournament_id, slot_index, book_key, title, author, work_id) VALUES ('t1', 0, 'k-old', 't', 'a', 'w-old')").run();
  createSqliteArenaRepository(db).rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  const slot = db.prepare("SELECT book_key, work_id FROM tournament_slots WHERE tournament_id = 't1'").get();
  assert.deepEqual({ ...slot }, { book_key: "k-keep", work_id: "w-keep" });
});

function tournament(overrides: Partial<TournamentRow> & { id: string }): TournamentRow {
  return {
    owner_user_id: "u1",
    name: "Bracket",
    bracket_size: 8,
    round_duration_minutes: 60,
    status: "seeding",
    current_round: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function nameKey(db: DatabaseSync, id: string): string | null {
  return (db.prepare(`SELECT name_key FROM tournaments WHERE id = ?`).get(id) as { name_key: string | null }).name_key;
}

test("creating and renaming a tournament keep name_key in step, and starting leaves it alone", () => {
  const db = freshDb();
  const repo = createSqliteArenaRepository(db);
  repo.insertTournament(tournament({ id: "t1", name: "Melhores Livros: Ficção!" }));
  assert.equal(nameKey(db, "t1"), "melhores livros ficcao");

  repo.updateTournamentStatus("t1", "active", 1);
  assert.equal(nameKey(db, "t1"), "melhores livros ficcao");

  repo.renameTournament("t1", "Hábitos Atómicos");
  assert.equal(nameKey(db, "t1"), "habitos atomicos");
  assert.equal(repo.getTournament("t1")?.name, "Hábitos Atómicos");
});

test("opening a database fills name_key on rows that have none", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes) VALUES ('old1', 'u1', 'Hábitos Atómicos', 4, 60), ('old2', 'u1', '!!!', 4, 60)`).run();
  db.prepare(`INSERT INTO tournaments (id, owner_user_id, name, name_key, bracket_size, round_duration_minutes) VALUES ('kept', 'u1', 'Kept', 'custom', 4, 60)`).run();
  assert.equal(nameKey(db, "old1"), null);

  applyArenaMigrations(db);

  assert.equal(nameKey(db, "old1"), "habitos atomicos");
  assert.equal(nameKey(db, "old2"), "");
  assert.equal(nameKey(db, "kept"), "custom");
});

test("a database from before name_key gets the column, the public index and filled keys", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO tournaments (id, owner_user_id, name, name_key, bracket_size, round_duration_minutes) VALUES ('old', 'u1', 'Hábitos Atómicos', 'stale', 4, 60)`).run();
  db.exec(`ALTER TABLE tournaments DROP COLUMN name_key`);
  db.exec(`DROP INDEX idx_tournaments_public`);
  assert.ok(!columnNames(db, "tournaments").includes("name_key"));

  applyArenaMigrations(db);

  assert.ok(columnNames(db, "tournaments").includes("name_key"));
  assert.equal(nameKey(db, "old"), "habitos atomicos");
  const index = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tournaments_public'`).get();
  assert.ok(index, "the public listing index exists after migrating");
});

test("discoverWindow returns started tournaments whose name_key contains the needle, newest first, up to the limit", () => {
  const repo = createSqliteArenaRepository(freshDb());
  repo.insertTournament(tournament({ id: "habits", name: "Hábitos Atómicos", status: "active", created_at: "2026-01-01T00:00:00.000Z" }));
  repo.insertTournament(tournament({ id: "fantasy", name: "Fantasy Cup", status: "active", owner_user_id: "u2", created_at: "2026-02-01T00:00:00.000Z" }));
  repo.insertTournament(tournament({ id: "done", name: "Hábitos Concluídos", status: "completed", created_at: "2026-03-01T00:00:00.000Z" }));
  repo.insertTournament(tournament({ id: "draft", name: "Hábitos rascunho", status: "seeding", created_at: "2026-04-01T00:00:00.000Z" }));
  const ids = (needle: string, limit = 10) => repo.discoverWindow(needle, limit).map((r) => r.id);

  assert.deepEqual(ids("habitos"), ["done", "habits"]);
  assert.deepEqual(ids("habitos", 1), ["done"]);
  assert.deepEqual(ids("habitos atom"), ["habits"]);
  assert.deepEqual(ids("fantasy"), ["fantasy"]);
  assert.deepEqual(ids("nothing like it"), []);
  assert.deepEqual(ids(""), ["done", "fantasy", "habits"]);
  assert.deepEqual(ids("", 2), ["done", "fantasy"]);
  assert.deepEqual(repo.discoverWindow("fantasy", 10).map((r) => ({ ...r })), [{ id: "fantasy", created_at: "2026-02-01T00:00:00.000Z", owner_user_id: "u2" }]);
});

test("a renamed tournament is found by its new name and no longer by the old one", () => {
  const repo = createSqliteArenaRepository(freshDb());
  repo.insertTournament(tournament({ id: "t1", name: "Old name", status: "active" }));
  repo.renameTournament("t1", "Novo Título");

  assert.deepEqual(repo.discoverWindow("novo titulo", 10).map((r) => r.id), ["t1"]);
  assert.deepEqual(repo.discoverWindow("old name", 10), []);
});

test("listPublicByIds returns the started tournaments among the ids and nothing else", () => {
  const repo = createSqliteArenaRepository(freshDb());
  repo.insertTournament(tournament({ id: "t1", status: "active" }));
  repo.insertTournament(tournament({ id: "t2", status: "completed" }));
  repo.insertTournament(tournament({ id: "t3", status: "active" }));
  repo.insertTournament(tournament({ id: "draft", status: "seeding" }));

  assert.deepEqual(repo.listPublicByIds(["t1", "draft", "ghost", "t3"]).map((r) => r.id).sort(), ["t1", "t3"]);
  assert.deepEqual(repo.listPublicByIds([]), []);
});

test("votedAmong returns the requested tournaments the account has voted in, never its own", () => {
  const db = freshDb();
  seedTournament(db, "t1", "u1", "One");
  seedTournament(db, "t2", "u1", "Two");
  seedTournament(db, "t3", "voter-1", "Own");
  seedTournament(db, "t4", "u1", "Anonymous only");
  seedTournament(db, "t5", "u1", "Other voter");
  const repo = createSqliteArenaRepository(db);
  repo.insertVote(vote("v1", "duel-t1", "tok-1", "voter-1", "2026-01-01T00:00:00.000Z"));
  repo.insertVote(vote("v2", "duel-t2", "tok-1", "voter-1", "2026-01-02T00:00:00.000Z"));
  repo.insertVote(vote("v3", "duel-t3", "tok-1", "voter-1", "2026-01-03T00:00:00.000Z"));
  repo.insertVote(vote("v4", "duel-t4", "tok-2", null, "2026-01-04T00:00:00.000Z"));
  repo.insertVote(vote("v5", "duel-t5", "tok-3", "voter-2", "2026-01-05T00:00:00.000Z"));
  const sorted = (ids: string[]) => [...ids].sort();

  assert.deepEqual(sorted(repo.votedAmong("voter-1", ["t1", "t3", "t4", "t5", "ghost"])), ["t1"]);
  assert.deepEqual(sorted(repo.votedAmong("voter-1", ["t1", "t2"])), ["t1", "t2"]);
  assert.deepEqual(repo.votedAmong("voter-1", []), []);
  assert.deepEqual(repo.votedAmong("nobody", ["t1", "t2", "t3", "t4", "t5"]), []);
  assert.deepEqual(sorted(repo.votedAmong("voter-1", ["t1", "t2", "t3", "t4", "t5"])), sorted(repo.listVotedByUser("voter-1").map((t) => t.id)));
});

test("a trigger that rolls the transaction back surfaces its own error and keeps every row", () => {
  const db = freshDb();
  seedTournament(db, "t1", "u1", "Mine");
  seedTournament(db, "t2", "u2", "Theirs");
  const repo = createSqliteArenaRepository(db);
  repo.insertVote(vote("v1", "duel-t2", "tok-1", "u1", "2026-01-01T00:00:00.000Z"));
  db.exec("CREATE TRIGGER boom BEFORE UPDATE ON votes BEGIN SELECT RAISE(ROLLBACK, 'trigger boom'); END");
  assert.throws(() => repo.deleteUserData("u1"), /trigger boom/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE owner_user_id = 'u1'").get() as { n: number }).n, 1);
  assert.equal(db.isTransaction, false);
});
