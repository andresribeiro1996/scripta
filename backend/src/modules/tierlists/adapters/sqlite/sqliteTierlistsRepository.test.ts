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
    data: JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#fff", bookKeys: [] }], pool: ["b1", "b2"] }),
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

function insertPublished(repo: ReturnType<typeof createSqliteTierlistsRepository>, item: TierlistRow, vote: BallotRow, placements: { bookKey: string; tierId: string }[]) {
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
      { bookKey: "b1", tierId: "s" },
      { bookKey: "b2", tierId: "s" }
    ]
  );

  assert.equal(published?.id, "c1");
  assert.equal(repo.listByUser("u1").length, 1);
  assert.equal(repo.getByVoteCode("abc12345")?.id, "c1");
  assert.equal(repo.ballotCount("c1"), 1);
  assert.deepEqual(repo.getPlacements("bal1"), [
    { bookKey: "b1", tierId: "s" },
    { bookKey: "b2", tierId: "s" }
  ]);
  assert.equal(repo.publish("c1", "u1", "{}", "members", "second", "[]", ballot({ id: "bal2", tierlist_id: "c1" }), []), undefined);
});

test("promotion removes creator control and preserves public results", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  insertPublished(repo, row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "owner", tierlist_id: "c1", voter_user_id: "u1" }), []);
  repo.saveBallot(ballot({ id: "reader", tierlist_id: "c1", voter_user_id: "u2" }), [{ bookKey: "b1", tierId: "s" }]);
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
  insertPublished(repo, row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "v1", tierlist_id: "c1", voter_user_id: "u2" }), [{ bookKey: "b1", tierId: "s" }]);
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
  insertPublished(repo, row({ id: "c1", vote_code: "code", voting_open: 1 }), ballot({ id: "bal1", tierlist_id: "c1" }), [
    { bookKey: "b1", tierId: "s" }
  ]);
  repo.saveBallot(ballot({ id: "bal1", tierlist_id: "c1" }), [{ bookKey: "b1", tierId: "a" }]);

  assert.deepEqual(repo.getPlacements("bal1"), [{ bookKey: "b1", tierId: "a" }]);
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
  db.prepare(`INSERT INTO tierlist_ballot_placements (ballot_id, tierlist_id, book_key, tier_id) VALUES ('b1', 'mine', 'k', 'S'), ('b2', 'theirs', 'k', 'A')`).run();
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

test("rekeyBooks rewrites the owner's unpublished tier lists only", async () => {
  const { createSqliteTierlistsRepository } = await import("./sqliteTierlistsRepository.js");
  const db = freshDb();
  const insert = db.prepare("INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, data, vote_code, created_at, updated_at) VALUES (?, ?, ?, 'n', ?, ?, 't0', 't0')");
  const data = JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: ["old"] }], pool: ["new", "y"] });
  insert.run("draft", "u1", "u1", data, null);
  insert.run("published", "u1", "u1", data, "CODE1");
  insert.run("other", "u2", "u2", data, null);
  createSqliteTierlistsRepository(db).rekeyBooks("u1", ["old"], "new", null);
  const read = (id: string) => db.prepare("SELECT data, updated_at FROM tierlists WHERE id = ?").get(id) as { data: string; updated_at: string };
  assert.deepEqual(JSON.parse(read("draft").data), { tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: ["new"] }], pool: ["y"] });
  assert.notEqual(read("draft").updated_at, "t0");
  assert.equal(read("published").data, data);
  assert.equal(read("other").data, data);
});

test("rekeying a private list moves its works rows to the kept copy", async () => {
  const { createSqliteTierlistsRepository } = await import("./sqliteTierlistsRepository.js");
  const db = freshDb();
  db.prepare("INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, data, created_at, updated_at) VALUES ('t1', 'u1', 'u1', 'n', ?, 't0', 't0')").run(
    JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: [] }], pool: ["k-old"] })
  );
  db.prepare("INSERT INTO tierlist_works (tierlist_id, key, work_id) VALUES ('t1', 'k-old', 'w-old')").run();
  createSqliteTierlistsRepository(db).rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  const list = db.prepare("SELECT data FROM tierlists WHERE id = 't1'").get() as { data: string };
  assert.deepEqual((JSON.parse(list.data) as { pool: string[] }).pool, ["k-keep"]);
  const works = db.prepare("SELECT key, work_id FROM tierlist_works WHERE tierlist_id = 't1'").all();
  assert.deepEqual(works.map((row) => ({ ...row })), [{ key: "k-keep", work_id: "w-keep" }]);
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
  const placed = [{ bookKey: "b1", tierId: "s" }];
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

const works = (entries: Array<[string, string | null]>) => new Map(entries);

function workRows(db: DatabaseSync, tierlistId: string) {
  return db.prepare("SELECT key, work_id FROM tierlist_works WHERE tierlist_id = ? ORDER BY key").all(tierlistId).map((r) => ({ ...r }));
}

function placementWorks(db: DatabaseSync, ballotId: string) {
  return db.prepare("SELECT book_key, work_id FROM tierlist_ballot_placements WHERE ballot_id = ? ORDER BY book_key").all(ballotId).map((r) => ({ ...r }));
}

test("insert and update write the list's works in step with its data", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t1", data: JSON.stringify({ tiers: [], pool: ["a", "b"] }) }), works([["a", "w1"], ["b", null]]));
  repo.update("t1", "u1", { data: JSON.stringify({ tiers: [], pool: ["b", "c"] }) }, works([["b", null], ["c", "w3"]]));
  assert.deepEqual(workRows(db, "t1"), [{ key: "b", work_id: null }, { key: "c", work_id: "w3" }]);
});

test("an update without works leaves the stored works alone", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t1" }), works([["a", "w1"]]));
  repo.update("t1", "u1", { name: "Renamed" });
  assert.deepEqual(workRows(db, "t1"), [{ key: "a", work_id: "w1" }]);
});

test("an update on a list the user does not own writes no works", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t1" }), works([["a", "w1"]]));
  assert.equal(repo.update("t1", "intruder", { name: "x" }, works([["a", "w9"]])), undefined);
  assert.deepEqual(workRows(db, "t1"), [{ key: "a", work_id: "w1" }]);
});

test("a ballot placement takes its work from the list", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t1", vote_code: "code1", voting_open: 1 }), works([["a", "w1"]]));
  repo.saveBallot(ballot({ id: "bal1", tierlist_id: "t1", voter_user_id: "u2" }), [{ bookKey: "a", tierId: "s" }]);
  assert.deepEqual(placementWorks(db, "bal1"), [{ book_key: "a", work_id: "w1" }]);
});

test("a ballot on a list with no works rows yet still saves with a NULL work", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t2", vote_code: "code2", voting_open: 1 }));
  repo.saveBallot(ballot({ id: "bal2", tierlist_id: "t2", voter_user_id: "u2" }), [{ bookKey: "a", tierId: "s" }]);
  assert.deepEqual(placementWorks(db, "bal2"), [{ book_key: "a", work_id: null }]);
});

test("deleting a list or a user's data clears its works", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "t1" }), works([["a", "w1"]]));
  assert.equal(repo.delete("t1", "u1"), true);
  assert.deepEqual(workRows(db, "t1"), []);
  repo.insert(row({ id: "t2" }), works([["a", "w1"]]));
  repo.deleteUserData("u1");
  assert.deepEqual(workRows(db, "t2"), []);
});

test("an existing database gains the placement work column", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tierlists (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, origin_user_id TEXT NOT NULL,
      name TEXT NOT NULL, name_key TEXT, data TEXT NOT NULL DEFAULT '{}',
      vote_code TEXT, vote_access TEXT NOT NULL DEFAULT 'anonymous',
      voting_open INTEGER NOT NULL DEFAULT 0, source_tierlist_id TEXT, promoted_at TEXT,
      public_books TEXT, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE tierlist_ballots (
      id TEXT PRIMARY KEY, tierlist_id TEXT NOT NULL, voter_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE tierlist_ballot_placements (
      ballot_id TEXT NOT NULL REFERENCES tierlist_ballots(id) ON DELETE CASCADE,
      tierlist_id TEXT NOT NULL, book_key TEXT NOT NULL, tier_id TEXT NOT NULL,
      PRIMARY KEY (ballot_id, book_key)
    );
  `);
  assert.ok(!columnNames(db, "tierlist_ballot_placements").includes("work_id"));
  applyTierlistsMigrations(db);
  assert.ok(columnNames(db, "tierlist_ballot_placements").includes("work_id"));
  assert.ok(columnNames(db, "tierlist_works").includes("work_id"));
});

test("a ballot on two keys sharing one work stores both placements with that work and keeps the histogram per key", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(row({ id: "w1", vote_code: "code", voting_open: 1 }));
  db.prepare("INSERT INTO tierlist_works (tierlist_id, key, work_id) VALUES ('w1', 'b1', 'work-1'), ('w1', 'b2', 'work-1')").run();
  repo.saveBallot(ballot({ id: "bal1", tierlist_id: "w1" }), [{ bookKey: "b1", tierId: "s" }, { bookKey: "b2", tierId: "s" }]);
  const stored = db.prepare("SELECT book_key, work_id FROM tierlist_ballot_placements WHERE ballot_id = 'bal1' ORDER BY book_key").all();
  assert.deepEqual(stored.map((r) => ({ ...r })), [{ book_key: "b1", work_id: "work-1" }, { book_key: "b2", work_id: "work-1" }]);
  assert.deepEqual(repo.histogram("w1").map((c) => [c.bookKey, c.tierId, c.votes]).sort(), [["b1", "s", 1], ["b2", "s", 1]]);
});

test("rekeying keeps a stored work when the merge could not resolve one", () => {
  const db = freshDb();
  db.prepare("INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, data, created_at, updated_at) VALUES ('t1', 'u1', 'u1', 'n', ?, 't0', 't0')").run(
    JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: [] }], pool: ["k-old", "k-keep"] })
  );
  db.prepare("INSERT INTO tierlist_works (tierlist_id, key, work_id) VALUES ('t1', 'k-old', 'w-old'), ('t1', 'k-keep', 'w-keep')").run();
  createSqliteTierlistsRepository(db).rekeyBooks("u1", ["k-old"], "k-keep", null);
  const works = db.prepare("SELECT key, work_id FROM tierlist_works WHERE tierlist_id = 't1'").all();
  assert.deepEqual(works.map((r) => ({ ...r })), [{ key: "k-keep", work_id: "w-keep" }]);
});
