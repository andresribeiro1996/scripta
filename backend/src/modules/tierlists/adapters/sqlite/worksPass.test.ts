import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrateTierlistsToWorks, rewriteBoard } from "./worksPass.js";

const works = new Map([["k1", "w1"], ["k2", "w1"], ["k3", "w3"]]);

test("rewriteBoard swaps keys for works, tiers before pool, first edition wins, orphans dropped", () => {
  const data = JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: ["k2"] }], pool: ["k1", "k3", "k-orphan"] });
  assert.deepEqual(rewriteBoard(data, null, works).keys, ["k2", "k3"]);
  assert.deepEqual(JSON.parse(rewriteBoard(data, null, works).data), { tiers: [{ id: "s", label: "S", color: "#000000", workIds: ["w1"] }], pool: ["w3"] });
});

test("a snapshot is zipped with the old pool and follows the new one, else it is cleared", () => {
  const data = JSON.stringify({ tiers: [], pool: ["k1", "k2", "k3"] });
  const books = [{ title: "A" }, { title: "A again" }, { title: "C" }];
  const rewritten = rewriteBoard(data, JSON.stringify(books), works);
  assert.deepEqual(JSON.parse(rewritten.data).pool, ["w1", "w3"]);
  assert.deepEqual(JSON.parse(rewritten.publicBooks!), [{ title: "A", key: "k1", workId: "w1" }, { title: "C", key: "k3", workId: "w3" }]);
  assert.equal(rewriteBoard(data, JSON.stringify(books.slice(0, 2)), works).publicBooks, null);
  assert.equal(rewriteBoard(data, null, works).publicBooks, null);
});

function e1Db() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tierlists (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, origin_user_id TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT, data TEXT NOT NULL DEFAULT '{}', vote_code TEXT, vote_access TEXT NOT NULL DEFAULT 'anonymous', voting_open INTEGER NOT NULL DEFAULT 0, source_tierlist_id TEXT, promoted_at TEXT, public_books TEXT, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE tierlist_ballots (id TEXT PRIMARY KEY, tierlist_id TEXT NOT NULL, voter_user_id TEXT, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE tierlist_ballot_placements (ballot_id TEXT NOT NULL REFERENCES tierlist_ballots(id) ON DELETE CASCADE, tierlist_id TEXT NOT NULL, book_key TEXT NOT NULL, tier_id TEXT NOT NULL, work_id TEXT, PRIMARY KEY (ballot_id, book_key));
    CREATE TABLE tierlist_works (tierlist_id TEXT NOT NULL, key TEXT NOT NULL, work_id TEXT, PRIMARY KEY (tierlist_id, key));
    INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, data, vote_code, voting_open, public_books) VALUES
      ('t1', '__app__', 'u1', 'Promoted', '{"tiers":[{"id":"s","label":"S","color":"#000000","bookKeys":[]}],"pool":["k1","k2","k3"]}', 'code1', 0, '[{"title":"A"},{"title":"A again"},{"title":"C"}]');
    INSERT INTO tierlist_works VALUES ('t1', 'k1', 'w1'), ('t1', 'k2', 'w1'), ('t1', 'k3', 'w3');
    INSERT INTO tierlist_ballots (id, tierlist_id) VALUES ('b1', 't1');
    INSERT INTO tierlist_ballot_placements VALUES ('b1', 't1', 'k2', 's', 'w1'), ('b1', 't1', 'k1', 'a', 'w1'), ('b1', 't1', 'k3', 's', 'w3');
  `);
  return db;
}

test("the pass rewrites a promoted list, keeps each ballot's first placement per work, and rebuilds the side tables", () => {
  const db = e1Db();
  migrateTierlistsToWorks(db);
  const row = db.prepare("SELECT data, public_books FROM tierlists WHERE id = 't1'").get() as { data: string; public_books: string };
  assert.deepEqual(JSON.parse(row.data).pool, ["w1", "w3"]);
  assert.equal(JSON.parse(row.public_books).length, 2);
  assert.deepEqual(db.prepare("SELECT work_id, tier_id FROM tierlist_ballot_placements ORDER BY work_id").all().map((r) => ({ ...r })), [
    { work_id: "w1", tier_id: "a" },
    { work_id: "w3", tier_id: "s" }
  ]);
  assert.deepEqual(db.prepare("SELECT work_id FROM tierlist_works ORDER BY work_id").all().map((r) => ({ ...r })), [{ work_id: "w1" }, { work_id: "w3" }]);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
  migrateTierlistsToWorks(db);
  assert.deepEqual(JSON.parse((db.prepare("SELECT data FROM tierlists").get() as { data: string }).data).pool, ["w1", "w3"]);
});

test("a placement takes its work from tierlist_works, not the id stored at ballot time", () => {
  const db = e1Db();
  db.exec("UPDATE tierlist_ballot_placements SET work_id = 'wOld' WHERE book_key = 'k3'");
  migrateTierlistsToWorks(db);
  assert.deepEqual(db.prepare("SELECT work_id FROM tierlist_ballot_placements WHERE tier_id = 's'").all().map((r) => ({ ...r })), [{ work_id: "w3" }]);
  const stale = e1Db();
  stale.exec("UPDATE tierlist_works SET work_id = 'wNew' WHERE key = 'k3'; UPDATE tierlist_ballot_placements SET work_id = 'wOld' WHERE book_key = 'k3'");
  migrateTierlistsToWorks(stale);
  assert.deepEqual(stale.prepare("SELECT work_id FROM tierlist_ballot_placements ORDER BY work_id").all().map((r) => ({ ...r })), [{ work_id: "w1" }, { work_id: "wNew" }]);
});

test("invalid board JSON throws and rolls the pass back", () => {
  const db = e1Db();
  db.exec("UPDATE tierlists SET data = '{broken'");
  assert.throws(() => migrateTierlistsToWorks(db), SyntaxError);
  assert.ok((db.prepare("PRAGMA table_info(tierlist_works)").all() as Array<{ name: string }>).some((c) => c.name === "key"));
});
