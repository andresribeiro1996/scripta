// Adapter-level tests against a real in-memory SQLite database — the SQL
// itself (migrations, the partial unique index, the histogram GROUP BY)
// is exactly what service.test.ts's in-memory fake cannot check.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDir = mkdtempSync(join(tmpdir(), "tierlists-repo-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");

const { applyTierlistsMigrations } = await import("./connection.js");

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
    `INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, data, created_at, updated_at, vote_code)
     VALUES (?, 'u1', 'u1', 'n', '{}', '2026-01-01', '2026-01-01', ?)`
  );
  insert.run("a", null);
  insert.run("b", null);
  insert.run("c", "code1");
  assert.throws(() => insert.run("d", "code1"));
});

const { createSqliteTierlistsRepository } = await import("./sqliteTierlistsRepository.js");
import type { BallotRow, TierlistRow } from "../../domain/types.js";

function row(overrides: Partial<TierlistRow> & { id: string }): TierlistRow {
  return {
    owner_user_id: "u1",
    origin_user_id: "u1",
    name: "List",
    data: JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#fff", workIds: [] }], pool: ["b1", "b2"] }),
    vote_code: null,
    vote_access: "anonymous",
    voting_open: 0,
    source_tierlist_id: null,
    promoted_at: null,
    public_books: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function insertPublished(repo: ReturnType<typeof createSqliteTierlistsRepository>, item: TierlistRow, vote: BallotRow, placements: { workId: string; tierId: string }[]) {
  repo.insert(item);
  repo.saveBallot(vote, placements);
}

function ballot(overrides: Partial<BallotRow> & { id: string; tierlist_id: string }): BallotRow {
  return {
    voter_user_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("publish updates one row with its seeded ballot atomically", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insert(row({ id: "c1" }));
  const published = repo.publish("c1", "u1", row({ id: "c1" }).data, "anonymous", "abc12345", "[]",
    ballot({ id: "bal1", tierlist_id: "c1", voter_user_id: "u1" }),
    [
      { workId: "b1", tierId: "s" },
      { workId: "b2", tierId: "s" }
    ]
  );

  assert.equal(published?.id, "c1");
  assert.equal(repo.listByUser("u1").length, 1);
  assert.equal(repo.getByVoteCode("abc12345")?.id, "c1");
  assert.equal(repo.ballotCount("c1"), 1);
  assert.deepEqual(repo.getPlacements("bal1"), [
    { workId: "b1", tierId: "s" },
    { workId: "b2", tierId: "s" }
  ]);
  assert.equal(repo.publish("c1", "u1", "{}", "members", "second", "[]", ballot({ id: "bal2", tierlist_id: "c1" }), []), undefined);
});

test("promotion removes creator control and preserves public results", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  insertPublished(repo, row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "owner", tierlist_id: "c1", voter_user_id: "u1" }), []);
  repo.saveBallot(ballot({ id: "reader", tierlist_id: "c1", voter_user_id: "u2" }), [{ workId: "b1", tierId: "s" }]);
  assert.equal(repo.eligibleVoteCount("c1", "u1"), 1);
  repo.promote("c1", "2026-02-01T00:00:00.000Z");
  assert.equal(repo.getOwned("c1", "u1"), undefined);
  assert.equal(repo.getPublicById("c1")?.owner_user_id, "__app__");
  assert.equal(repo.getPublicById("c1")?.origin_user_id, "u1");
  assert.equal(repo.delete("c1", "u1"), false);
  assert.equal(repo.getPublicById("c1")?.promoted_at, "2026-02-01T00:00:00.000Z");
  assert.equal(repo.histogram("c1")[0]?.votes, 1);
});

test("creator deletion removes a public list and its ballots before promotion", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  insertPublished(repo, row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "v1", tierlist_id: "c1", voter_user_id: "u2" }), [{ workId: "b1", tierId: "s" }]);
  assert.equal(repo.delete("c1", "u1"), true);
  assert.equal(repo.getByVoteCode("code"), undefined);
  assert.equal(repo.ballotCount("c1"), 0);
  assert.deepEqual(repo.histogram("c1"), []);
});

test("getByVoteCode returns undefined for an unknown code", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  assert.equal(repo.getByVoteCode("nope"), undefined);
});

test("histogram counts each book-tier pair across ballots", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  insertPublished(repo, row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "bal1", tierlist_id: "c1" }), [
    { workId: "b1", tierId: "s" }
  ]);
  repo.saveBallot(ballot({ id: "bal2", tierlist_id: "c1" }), [
    { workId: "b1", tierId: "s" },
    { workId: "b2", tierId: "a" }
  ]);

  const cells = repo.histogram("c1");
  assert.equal(cells.find((c) => c.workId === "b1" && c.tierId === "s")?.votes, 2);
  assert.equal(cells.find((c) => c.workId === "b2" && c.tierId === "a")?.votes, 1);
  assert.equal(repo.ballotCount("c1"), 2);
});

test("saveBallot replaces a ballot's placements rather than appending", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  insertPublished(repo, row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "bal1", tierlist_id: "c1" }), [
    { workId: "b1", tierId: "s" }
  ]);
  repo.saveBallot(ballot({ id: "bal1", tierlist_id: "c1" }), [{ workId: "b1", tierId: "a" }]);

  assert.deepEqual(repo.getPlacements("bal1"), [{ workId: "b1", tierId: "a" }]);
  assert.equal(repo.ballotCount("c1"), 1);
});

test("an account cannot hold two ballots on one tier list", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  insertPublished(repo, row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "bal1", tierlist_id: "c1", voter_user_id: "u9" }), []);
  assert.throws(() => repo.saveBallot(ballot({ id: "bal2", tierlist_id: "c1", voter_user_id: "u9" }), []));
  assert.equal(repo.getBallotByVoter("c1", "u9")?.id, "bal1");
});

test("listPublic returns only community copies, newest first", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  repo.insert(row({ id: "private1" }));
  insertPublished(repo, row({ id: "c1", vote_code: "aaa", created_at: "2026-01-01T00:00:00.000Z" }), ballot({ id: "b1", tierlist_id: "c1" }), []);
  insertPublished(repo, row({ id: "c2", vote_code: "bbb", created_at: "2026-02-01T00:00:00.000Z" }), ballot({ id: "b2", tierlist_id: "c2" }), []);

  assert.deepEqual(repo.listPublic(10, 0).map((t) => t.id), ["c2", "c1"]);
  assert.deepEqual(repo.listPublic(1, 1).map((t) => t.id), ["c1"]);
  assert.equal(repo.ballotCountsByTierlist().get("c1"), 1);
});

test("setVoting changes access and open state, ownership-checked", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  insertPublished(repo, row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "b1", tierlist_id: "c1" }), []);

  assert.equal(repo.setVoting("c1", "u2", { voting_open: 0 }), undefined);
  const updated = repo.setVoting("c1", "u1", { vote_access: "members", voting_open: 0 });
  assert.equal(updated?.vote_access, "members");
  assert.equal(updated?.voting_open, 0);
  assert.equal(repo.getOwned("c1", "u1")?.vote_access, "members");
});


test("deleteUserData removes the user's tier lists with their ballots and unlinks their ballots on anyone else's", async () => {
  const { createSqliteTierlistsRepository } = await import("./sqliteTierlistsRepository.js");
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  db.prepare(`INSERT INTO tierlists (id, owner_user_id, origin_user_id, name) VALUES ('mine', 'leaver', 'leaver', 'Mine'), ('theirs', 'stayer', 'stayer', 'Theirs'), ('copy', 'stayer', 'leaver', 'Copy')`).run();
  db.prepare(`INSERT INTO tierlist_ballots (id, tierlist_id, voter_user_id) VALUES ('b1', 'mine', 'stayer'), ('b2', 'theirs', 'leaver')`).run();
  db.prepare(`INSERT INTO tierlist_ballot_placements (ballot_id, tierlist_id, work_id, tier_id) VALUES ('b1', 'mine', 'k', 'S'), ('b2', 'theirs', 'k', 'A')`).run();
  repo.deleteUserData("leaver");
  assert.deepEqual(db.prepare(`SELECT id FROM tierlists ORDER BY id`).all().map((r) => r.id), ["copy", "theirs"]);
  assert.deepEqual(db.prepare(`SELECT id, voter_user_id FROM tierlist_ballots`).all().map((r) => ({ ...r })), [{ id: "b2", voter_user_id: null }]);
  assert.deepEqual(db.prepare(`SELECT ballot_id FROM tierlist_ballot_placements`).all().map((r) => r.ballot_id), ["b2"]);
});

test("participation counts other people's ballots on the creator's published lists by creation time, and leaves promoted lists out", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  const publicBooks = JSON.stringify([{ coverUrl: "https://covers.test/a.jpg" }]);
  insertPublished(repo, row({ id: "c1", name: "Fantasy", vote_code: "code1", voting_open: 1, public_books: publicBooks }), ballot({ id: "own1", tierlist_id: "c1", voter_user_id: "u1" }), []);
  repo.saveBallot(ballot({ id: "b2", tierlist_id: "c1", voter_user_id: "u2", created_at: "2026-01-02T00:00:00.000Z" }), []);
  repo.saveBallot(ballot({ id: "b3", tierlist_id: "c1", voter_user_id: null, created_at: "2026-01-03T00:00:00.000Z" }), []);
  repo.saveBallot(ballot({ id: "b4", tierlist_id: "c1", voter_user_id: "u3", created_at: "2026-01-04T00:00:00.000Z" }), []);
  repo.saveBallot(ballot({ id: "b2", tierlist_id: "c1", voter_user_id: "u2", created_at: "2026-01-02T00:00:00.000Z", updated_at: "2026-03-01T00:00:00.000Z" }), []);

  insertPublished(repo, row({ id: "c2", name: "Promoted", vote_code: "code2", voting_open: 1 }), ballot({ id: "own2", tierlist_id: "c2", voter_user_id: "u1" }), []);
  repo.saveBallot(ballot({ id: "r2", tierlist_id: "c2", voter_user_id: "u2", created_at: "2026-02-01T00:00:00.000Z" }), []);
  repo.promote("c2", "2026-02-02T00:00:00.000Z");

  repo.insert(row({ id: "draft", name: "Draft" }));
  repo.saveBallot(ballot({ id: "d1", tierlist_id: "draft", voter_user_id: "u2" }), []);
  insertPublished(repo, row({ id: "theirs", owner_user_id: "u9", origin_user_id: "u9", vote_code: "code9", voting_open: 1 }), ballot({ id: "t1", tierlist_id: "theirs", voter_user_id: "u2" }), []);

  const rows = repo.listParticipation("u1", "2026-01-01T00:00:00.000Z").map((r) => ({ ...r })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(rows, [
    { id: "c1", name: "Fantasy", public_books: publicBooks, participants: 3, latest_at: "2026-01-04T00:00:00.000Z" }
  ]);
  assert.deepEqual(repo.listRecentVoters("c1", "u1", 10).map((r) => ({ ...r })), [
    { user_id: "u3", at: "2026-01-04T00:00:00.000Z" },
    { user_id: "u2", at: "2026-01-02T00:00:00.000Z" }
  ]);
  assert.deepEqual(repo.listRecentVoters("c1", "u1", 1).map((r) => r.user_id), ["u3"]);
});

test("participation lists only the lists with a ballot created since the marker, and their counts still cover every ballot", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  insertPublished(repo, row({ id: "quiet", name: "Quiet", vote_code: "code-q", voting_open: 1 }), ballot({ id: "own-q", tierlist_id: "quiet", voter_user_id: "u1" }), []);
  repo.saveBallot(ballot({ id: "q2", tierlist_id: "quiet", voter_user_id: "u2", created_at: "2026-01-02T00:00:00.000Z", updated_at: "2026-03-01T00:00:00.000Z" }), []);
  insertPublished(repo, row({ id: "busy", name: "Busy", vote_code: "code-b", voting_open: 1 }), ballot({ id: "own-b", tierlist_id: "busy", voter_user_id: "u1" }), []);
  repo.saveBallot(ballot({ id: "b2", tierlist_id: "busy", voter_user_id: "u2", created_at: "2026-01-02T00:00:00.000Z" }), []);
  repo.saveBallot(ballot({ id: "b3", tierlist_id: "busy", voter_user_id: "u3", created_at: "2026-02-10T00:00:00.000Z" }), []);
  const listed = (since: string) => repo.listParticipation("u1", since).map((r) => [r.id, r.participants, r.latest_at]).sort();

  assert.deepEqual(listed("2026-01-01T00:00:00.000Z"), [["busy", 2, "2026-02-10T00:00:00.000Z"], ["quiet", 1, "2026-01-02T00:00:00.000Z"]]);
  assert.deepEqual(listed("2026-02-01T00:00:00.000Z"), [["busy", 2, "2026-02-10T00:00:00.000Z"]]);
  assert.deepEqual(listed("2026-02-10T00:00:00.000Z"), [["busy", 2, "2026-02-10T00:00:00.000Z"]]);
  assert.deepEqual(listed("2026-02-10T00:00:00.001Z"), []);
});

function nameKey(db: DatabaseSync, id: string): string | null {
  return (db.prepare(`SELECT name_key FROM tierlists WHERE id = ?`).get(id) as { name_key: string | null }).name_key;
}

test("creating and renaming a tier list keep name_key in step with the name", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "c1", name: "Hábitos Atómicos!" }));
  assert.equal(nameKey(db, "c1"), "habitos atomicos");

  repo.update("c1", "u1", { name: "Sci-Fi: Ñandú" });
  assert.equal(nameKey(db, "c1"), "sci fi nandu");
  assert.equal(repo.getOwned("c1", "u1")?.name, "Sci-Fi: Ñandú");

  repo.update("c1", "u1", { data: "{}" });
  assert.equal(nameKey(db, "c1"), "sci fi nandu");
});

test("publishing and promoting leave name_key matching the name", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "c1", name: "Hábitos Atómicos" }));
  repo.publish("c1", "u1", "{}", "anonymous", "code1", "[]", ballot({ id: "own", tierlist_id: "c1", voter_user_id: "u1" }), []);
  assert.equal(nameKey(db, "c1"), "habitos atomicos");
  repo.promote("c1", "2026-02-01T00:00:00.000Z");
  assert.equal(nameKey(db, "c1"), "habitos atomicos");
});

test("opening a database fills name_key on rows that have none", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO tierlists (id, owner_user_id, origin_user_id, name) VALUES ('old1', 'u1', 'u1', 'Hábitos Atómicos'), ('old2', 'u1', 'u1', '!!!')`).run();
  db.prepare(`INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, name_key) VALUES ('kept', 'u1', 'u1', 'Kept', 'custom')`).run();
  assert.equal(nameKey(db, "old1"), null);

  applyTierlistsMigrations(db);

  assert.equal(nameKey(db, "old1"), "habitos atomicos");
  assert.equal(nameKey(db, "old2"), "");
  assert.equal(nameKey(db, "kept"), "custom");
});

test("a database from before name_key gets the column and fills it for existing rows", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, name_key) VALUES ('old', 'u1', 'u1', 'Hábitos Atómicos', 'stale')`).run();
  db.exec(`ALTER TABLE tierlists DROP COLUMN name_key`);
  assert.ok(!columnNames(db, "tierlists").includes("name_key"));

  applyTierlistsMigrations(db);

  assert.ok(columnNames(db, "tierlists").includes("name_key"));
  assert.equal(nameKey(db, "old"), "habitos atomicos");
});

function publishedList(repo: ReturnType<typeof createSqliteTierlistsRepository>, id: string, name: string, createdAt: string, overrides: Partial<TierlistRow> = {}) {
  insertPublished(repo, row({ id, name, vote_code: `code-${id}`, voting_open: 1, created_at: createdAt, ...overrides }), ballot({ id: `seed-${id}`, tierlist_id: id, voter_user_id: overrides.origin_user_id ?? "u1" }), []);
}

test("discoverWindow returns published tier lists whose name_key contains the needle, newest first, up to the limit", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  publishedList(repo, "habits", "Hábitos Atómicos", "2026-01-01T00:00:00.000Z");
  publishedList(repo, "fantasy", "Fantasy ranked", "2026-02-01T00:00:00.000Z");
  publishedList(repo, "habits-2", "Atomic Habits: Hábitos", "2026-03-01T00:00:00.000Z");
  publishedList(repo, "promoted", "Hábitos promovidos", "2026-04-01T00:00:00.000Z", { owner_user_id: "u2", origin_user_id: "u2" });
  repo.promote("promoted", "2026-04-02T00:00:00.000Z");
  repo.insert(row({ id: "draft", name: "Hábitos privados", created_at: "2026-05-01T00:00:00.000Z" }));
  const ids = (needle: string, limit = 10) => repo.discoverWindow(needle, limit).map((r) => r.id);

  assert.deepEqual(ids("habitos"), ["promoted", "habits-2", "habits"]);
  assert.deepEqual(ids("habitos", 2), ["promoted", "habits-2"]);
  assert.deepEqual(ids("habitos atom"), ["habits"]);
  assert.deepEqual(ids("fantasy"), ["fantasy"]);
  assert.deepEqual(ids("nothing like it"), []);
  assert.deepEqual(ids(""), ["promoted", "habits-2", "fantasy", "habits"]);
  assert.deepEqual(ids("", 3), ["promoted", "habits-2", "fantasy"]);
  assert.deepEqual(repo.discoverWindow("promovidos", 10).map((r) => ({ ...r })), [
    { id: "promoted", created_at: "2026-04-01T00:00:00.000Z", origin_user_id: "u2", promoted_at: "2026-04-02T00:00:00.000Z" }
  ]);
});

test("listPublicByIds returns the published tier lists among the ids and nothing else", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  publishedList(repo, "c1", "One", "2026-01-01T00:00:00.000Z");
  publishedList(repo, "c2", "Two", "2026-02-01T00:00:00.000Z");
  publishedList(repo, "c3", "Three", "2026-03-01T00:00:00.000Z");
  repo.insert(row({ id: "draft", name: "Draft" }));

  assert.deepEqual(repo.listPublicByIds(["c1", "draft", "ghost", "c3"]).map((r) => r.id).sort(), ["c1", "c3"]);
  assert.deepEqual(repo.listPublicByIds([]), []);
});

test("ballotTotalsFor counts ballots and eligible ballots for the requested tier lists only", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  publishedList(repo, "c1", "One", "2026-01-01T00:00:00.000Z");
  publishedList(repo, "c2", "Two", "2026-02-01T00:00:00.000Z", { owner_user_id: "u9", origin_user_id: "u9" });
  publishedList(repo, "c3", "Three", "2026-03-01T00:00:00.000Z");
  repo.insert(row({ id: "empty", name: "Empty", vote_code: "code-empty", voting_open: 1 }));
  const placed = [{ workId: "b1", tierId: "s" }];
  repo.saveBallot(ballot({ id: "c1-u2", tierlist_id: "c1", voter_user_id: "u2" }), placed);
  repo.saveBallot(ballot({ id: "c1-u3", tierlist_id: "c1", voter_user_id: "u3" }), []);
  repo.saveBallot(ballot({ id: "c1-anon", tierlist_id: "c1", voter_user_id: null }), placed);
  repo.saveBallot(ballot({ id: "c2-u1", tierlist_id: "c2", voter_user_id: "u1" }), placed);
  repo.saveBallot(ballot({ id: "c3-u2", tierlist_id: "c3", voter_user_id: "u2" }), placed);
  repo.saveBallot(ballot({ id: "c3-u4", tierlist_id: "c3", voter_user_id: "u4" }), placed);

  const totals = repo.ballotTotalsFor(["c1", "c2", "empty", "ghost"]);

  assert.deepEqual([...totals.keys()].sort(), ["c1", "c2"]);
  assert.deepEqual(totals.get("c1"), { ballots: 4, eligible: 1 });
  assert.deepEqual(totals.get("c2"), { ballots: 2, eligible: 1 });
  for (const [id, origin] of [["c1", "u1"], ["c2", "u9"]] as const) {
    assert.equal(totals.get(id)?.ballots, repo.ballotCount(id));
    assert.equal(totals.get(id)?.eligible, repo.eligibleVoteCount(id, origin));
  }
  assert.deepEqual(repo.ballotTotalsFor([]), new Map());
});

test("votedAmong returns the requested tier lists the account has a ballot on, never its own", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  publishedList(repo, "c1", "One", "2026-01-01T00:00:00.000Z");
  publishedList(repo, "c2", "Two", "2026-02-01T00:00:00.000Z", { owner_user_id: "u3", origin_user_id: "u3" });
  publishedList(repo, "c3", "Three", "2026-03-01T00:00:00.000Z", { owner_user_id: "u3", origin_user_id: "u3" });
  publishedList(repo, "own", "Mine", "2026-04-01T00:00:00.000Z", { owner_user_id: "u2", origin_user_id: "u2" });
  repo.saveBallot(ballot({ id: "c1-u2", tierlist_id: "c1", voter_user_id: "u2" }), []);
  repo.saveBallot(ballot({ id: "c2-u2", tierlist_id: "c2", voter_user_id: "u2" }), []);
  repo.saveBallot(ballot({ id: "c3-anon", tierlist_id: "c3", voter_user_id: null }), []);
  repo.saveBallot(ballot({ id: "c3-u4", tierlist_id: "c3", voter_user_id: "u4" }), []);
  const sorted = (ids: string[]) => [...ids].sort();

  assert.deepEqual(sorted(repo.votedAmong("u2", ["c1", "c3", "own", "ghost"])), ["c1"]);
  assert.deepEqual(sorted(repo.votedAmong("u2", ["c1", "c2"])), ["c1", "c2"]);
  assert.deepEqual(repo.votedAmong("u2", []), []);
  assert.deepEqual(repo.votedAmong("nobody", ["c1", "c2", "c3", "own"]), []);
  assert.deepEqual(sorted(repo.votedAmong("u2", ["c1", "c2", "c3", "own"])), sorted(repo.listVotedByUser("u2").map((r) => r.id)));
  repo.promote("own", "2026-05-01T00:00:00.000Z");
  assert.deepEqual(repo.votedAmong("u2", ["own"]), []);
});

test("a trigger that rolls the transaction back surfaces its own error and keeps every row", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "c1" }));
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON tierlist_ballots BEGIN SELECT RAISE(ROLLBACK, 'trigger boom'); END");
  assert.throws(
    () => repo.publish("c1", "u1", row({ id: "c1" }).data, "anonymous", "abc12345", "[]", ballot({ id: "bal1", tierlist_id: "c1", voter_user_id: "u1" }), []),
    /trigger boom/
  );
  assert.equal(repo.getByVoteCode("abc12345"), undefined);
  assert.equal(repo.listByUser("u1")[0]?.vote_code, null);
  assert.equal(db.isTransaction, false);
});

function workRows(db: DatabaseSync, tierlistId: string) {
  return db.prepare("SELECT work_id FROM tierlist_works WHERE tierlist_id = ? ORDER BY work_id").all(tierlistId).map((r) => r.work_id);
}

const board = (tierWorks: string[], pool: string[]) => JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#fff", workIds: tierWorks }], pool });

test("insert and update replace the list's works with the ones on its board", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t1", data: board(["a"], ["b"]) }));
  assert.deepEqual(workRows(db, "t1"), ["a", "b"]);
  repo.update("t1", "u1", { data: board([], ["b", "c"]) });
  assert.deepEqual(workRows(db, "t1"), ["b", "c"]);
  repo.update("t1", "u1", { name: "Renamed" });
  assert.deepEqual(workRows(db, "t1"), ["b", "c"]);
});

test("an update on a list the user does not own writes no works", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t1", data: board([], ["a"]) }));
  assert.equal(repo.update("t1", "intruder", { data: board([], ["z"]) }), undefined);
  assert.deepEqual(workRows(db, "t1"), ["a"]);
});

test("publish replaces the list's works with the board it publishes", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t1", data: board(["a"], ["b"]) }));
  repo.publish("t1", "u1", board([], ["b", "a"]), "anonymous", "code1", "[]", ballot({ id: "bal1", tierlist_id: "t1", voter_user_id: "u1" }), [{ workId: "a", tierId: "s" }]);
  assert.deepEqual(workRows(db, "t1"), ["a", "b"]);
});

test("a ballot's placements are stored and counted by work", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t1", vote_code: "code1", voting_open: 1, data: board([], ["w1", "w2"]) }));
  repo.saveBallot(ballot({ id: "bal1", tierlist_id: "t1" }), [{ workId: "w1", tierId: "s" }, { workId: "w2", tierId: "s" }]);
  assert.deepEqual(db.prepare("SELECT work_id, tier_id FROM tierlist_ballot_placements WHERE ballot_id = 'bal1' ORDER BY work_id").all().map((r) => ({ ...r })), [{ work_id: "w1", tier_id: "s" }, { work_id: "w2", tier_id: "s" }]);
  assert.deepEqual(repo.histogram("t1").map((c) => [c.workId, c.tierId, c.votes]).sort(), [["w1", "s", 1], ["w2", "s", 1]]);
});

test("deleting a list or a user's data clears its works", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t1", data: board([], ["a"]) }));
  assert.equal(repo.delete("t1", "u1"), true);
  assert.deepEqual(workRows(db, "t1"), []);
  repo.insert(row({ id: "t2", data: board([], ["a"]) }));
  repo.deleteUserData("u1");
  assert.deepEqual(workRows(db, "t2"), []);
});

test("an E1-shaped tier-list database is migrated on open", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tierlists (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, origin_user_id TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT, data TEXT NOT NULL DEFAULT '{}', vote_code TEXT, vote_access TEXT NOT NULL DEFAULT 'anonymous', voting_open INTEGER NOT NULL DEFAULT 0, source_tierlist_id TEXT, promoted_at TEXT, public_books TEXT, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE tierlist_ballots (id TEXT PRIMARY KEY, tierlist_id TEXT NOT NULL, voter_user_id TEXT, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE tierlist_ballot_placements (ballot_id TEXT NOT NULL REFERENCES tierlist_ballots(id) ON DELETE CASCADE, tierlist_id TEXT NOT NULL, book_key TEXT NOT NULL, tier_id TEXT NOT NULL, work_id TEXT, PRIMARY KEY (ballot_id, book_key));
    CREATE TABLE tierlist_works (tierlist_id TEXT NOT NULL, key TEXT NOT NULL, work_id TEXT, PRIMARY KEY (tierlist_id, key));
    CREATE INDEX idx_tierlist_placements_histogram ON tierlist_ballot_placements(tierlist_id, book_key, tier_id);
    CREATE INDEX idx_tierlist_works_work ON tierlist_works(work_id);
    CREATE INDEX idx_tierlist_placements_work ON tierlist_ballot_placements(work_id, tier_id);
    INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, data, vote_code, voting_open, public_books) VALUES
      ('t1', 'u1', 'u1', 'Old', '{"tiers":[{"id":"s","label":"S","color":"#000000","bookKeys":[]}],"pool":["k1","k2","k3"]}', 'code1', 1, '[{"title":"A"},{"title":"A again"},{"title":"C"}]');
    INSERT INTO tierlist_works VALUES ('t1', 'k1', 'w1'), ('t1', 'k2', 'w1'), ('t1', 'k3', 'w3');
    INSERT INTO tierlist_ballots (id, tierlist_id) VALUES ('b1', 't1');
    INSERT INTO tierlist_ballot_placements VALUES ('b1', 't1', 'k1', 's', 'w1'), ('b1', 't1', 'k3', 'a', 'w3');
  `);
  applyTierlistsMigrations(db);
  applyTierlistsMigrations(db);
  const repo = createSqliteTierlistsRepository(db);
  assert.deepEqual(JSON.parse(repo.getByVoteCode("code1")!.data), { tiers: [{ id: "s", label: "S", color: "#000000", workIds: [] }], pool: ["w1", "w3"] });
  assert.deepEqual(repo.histogram("t1").map((c) => [c.workId, c.tierId, c.votes]).sort(), [["w1", "s", 1], ["w3", "a", 1]]);
  assert.deepEqual(workRows(db, "t1"), ["w1", "w3"]);
  for (const table of ["tierlist_ballot_placements", "tierlist_works"]) {
    assert.ok(!columnNames(db, table).includes("book_key"));
    assert.ok(!columnNames(db, table).includes("key"));
  }
  const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((r) => r.name);
  assert.ok(indexes.includes("idx_tierlist_placements_histogram"));
  assert.ok(indexes.includes("idx_tierlist_works_work"));
  assert.ok(!indexes.includes("idx_tierlist_placements_work"));
  assert.ok((db.prepare("PRAGMA index_info(idx_tierlist_placements_histogram)").all() as Array<{ name: string }>).some((c) => c.name === "work_id"));
});

test("published tier lists holding any of the given works, newest first; drafts never", async () => {
  const { createTierlistsService, createTierlistsPublicApi } = await import("../../service.js");
  const repo = createSqliteTierlistsRepository(freshDb());
  const board = (...workIds: string[]) => JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#fff", workIds: [] }], pool: workIds });
  publishedList(repo, "old", "Old", "2026-01-01T00:00:00.000Z", { data: board("w-old", "w-x") });
  publishedList(repo, "both", "Both", "2026-02-01T00:00:00.000Z", { data: board("w-old", "w-new") });
  publishedList(repo, "promoted", "Promoted", "2026-03-01T00:00:00.000Z", { owner_user_id: "u2", origin_user_id: "u2", data: board("w-new") });
  repo.promote("promoted", "2026-03-02T00:00:00.000Z");
  publishedList(repo, "other", "Other", "2026-04-01T00:00:00.000Z", { data: board("w-other") });
  repo.insert(row({ id: "draft", name: "Draft", created_at: "2026-05-01T00:00:00.000Z", data: board("w-old", "w-new") }));

  assert.deepEqual(repo.listPublishedByWorks(["w-new", "w-old"], 20).map((r) => r.id), ["promoted", "both", "old"]);
  assert.deepEqual(repo.listPublishedByWorks(["w-new", "w-old"], 2).map((r) => r.id), ["promoted", "both"]);
  assert.equal(repo.listPublishedByWorks([], 20).length, 0);

  const api = createTierlistsPublicApi(createTierlistsService(repo));
  assert.deepEqual(api.publishedByWorks(["w-new", "w-old"], 20), [
    { id: "promoted", name: "Promoted", path: "/vote/code-promoted", ownerUserId: null },
    { id: "both", name: "Both", path: "/vote/code-both", ownerUserId: "u1" },
    { id: "old", name: "Old", path: "/vote/code-old", ownerUserId: "u1" }
  ]);
});
