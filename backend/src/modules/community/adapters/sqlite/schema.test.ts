import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";

const tempRoot = mkdtempSync(join(tmpdir(), "community-schema-"));
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.AUTH_DB_PATH = join(tempRoot, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(tempRoot, "library.sqlite");
process.env.GALLERY_DB_PATH = join(tempRoot, "gallery.sqlite");
process.env.COMMUNITY_DB_PATH = join(tempRoot, "community.sqlite");

const { openCommunityDb } = await import("./connection.js");

function eventTableColumns(db: DatabaseSync) {
  return (db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>).map((c) => c.name);
}

function eventIndexNames(db: DatabaseSync) {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'").all() as Array<{ name: string }>).map((r) => r.name);
}

function tableInfo(db: DatabaseSync, table: string) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

const NOT_HIDDEN = "type NOT IN (SELECT value FROM json_each('[]'))";

function queryPlan(db: DatabaseSync, sql: string) {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map((row) => row.detail).join(" ");
}

function removeDatabase() {
  const path = process.env.COMMUNITY_DB_PATH!;
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
  return path;
}

test("fresh database gets events payload column, partial unique indexes, and profiles.feed_settings", () => {
  const db = openCommunityDb();
  assert.ok(eventTableColumns(db).includes("payload"));
  const profileCols = (db.prepare("PRAGMA table_info(profiles)").all() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(profileCols.includes("feed_settings"));
  const indexes = eventIndexNames(db);
  assert.ok(indexes.includes("idx_events_publication_ref"));
  assert.ok(indexes.includes("idx_events_user_type_ref"));
  db.close();
});

test("legacy events table is rebuilt preserving rows", () => {
  const path = removeDatabase();
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (ref_type, ref_id)
    );
    INSERT INTO events (id, user_id, type, ref_type, ref_id, created_at)
      VALUES ('e1', 'u1', 'tierlist_published', 'tierlist', 't1', '2026-01-01T00:00:00.000Z'),
             ('e2', 'u2', 'tierlist_published', 'tierlist', 't2', '2026-01-02T00:00:00.000Z');
  `);
  legacy.close();

  const db = openCommunityDb();
  const rows = db.prepare("SELECT id, payload FROM events ORDER BY id").all() as Array<{ id: string; payload: string | null }>;
  assert.equal(rows.length, 2);
  assert.ok(rows[0]);
  assert.equal(rows[0].payload, null);
  assert.ok(eventTableColumns(db).includes("payload"));
  assert.ok(eventTableColumns(db).includes("trace_id"));
  assert.ok(eventIndexNames(db).includes("idx_events_publication_ref"));
  db.close();
});

test("published profiles are indexed by recency, on a new database and on an existing one", () => {
  const path = removeDatabase();
  const existing = new DatabaseSync(path);
  existing.exec("CREATE TABLE profiles (user_id TEXT PRIMARY KEY, published INTEGER NOT NULL DEFAULT 0, mural_id TEXT, published_at TEXT, updated_at TEXT NOT NULL, feed_settings TEXT)");
  existing.close();

  for (const _ of [1, 2]) {
    const db = openCommunityDb();
    const plan = (db.prepare("EXPLAIN QUERY PLAN SELECT * FROM profiles WHERE published = 1 ORDER BY updated_at DESC LIMIT 500").all() as Array<{ detail: string }>).map((row) => row.detail).join(" ");
    assert.match(plan, /idx_profiles_published_updated/);
    assert.doesNotMatch(plan, /TEMP B-TREE/);
    db.close();
  }
});

test("a new database records the trace on events and keeps an events_history of the same shape", () => {
  removeDatabase();
  const db = openCommunityDb();

  assert.deepEqual(eventTableColumns(db).slice(-2), ["trace_id", "source"]);
  assert.deepEqual(tableInfo(db, "events_history"), tableInfo(db, "events"));
  db.close();
});

test("events_history takes rows that repeat a user, type and ref, refuses a repeated id, and is indexed for its reads", () => {
  removeDatabase();
  const db = openCommunityDb();
  const insert = db.prepare("INSERT INTO events_history (id, user_id, type, ref_type, ref_id, payload, created_at, trace_id, source) VALUES (?, 'u1', 'voted_on', 'tierlist', 't1', NULL, '2026-01-01T00:00:00.000Z', NULL, NULL)");

  insert.run("h1");
  insert.run("h2");
  assert.throws(() => insert.run("h1"), /constraint/);
  const byUser = queryPlan(db, `SELECT * FROM events_history WHERE user_id = 'u1' AND (created_at, id) < ('x', 'y') AND ${NOT_HIDDEN} ORDER BY created_at DESC, id DESC LIMIT 20`);
  assert.match(byUser, /idx_events_history_user_time \(user_id=\? AND \(created_at,id\)<\(\?,\?\)\)/);
  assert.doesNotMatch(byUser, /TEMP B-TREE/);
  assert.match(queryPlan(db, "SELECT id FROM events_history WHERE created_at < 'x' LIMIT 1000"), /idx_events_history_time/);
  db.close();
});

test("a profile's recent events after a keyset are found by seeking into the user's index at the keyset, not by walking from the user's newest event", () => {
  removeDatabase();
  const db = openCommunityDb();

  const first = queryPlan(db, `SELECT * FROM events WHERE user_id = 'u1' AND ${NOT_HIDDEN} ORDER BY created_at DESC, id DESC LIMIT 20`);
  assert.match(first, /idx_events_user_time \(user_id=\?\)/);
  const after = queryPlan(db, `SELECT * FROM events WHERE user_id = 'u1' AND created_at <= 'x' AND (created_at < 'x' OR (created_at = 'x' AND id < 'y')) AND ${NOT_HIDDEN} ORDER BY created_at DESC, id DESC LIMIT 20`);
  assert.match(after, /idx_events_user_time \(user_id=\? AND created_at<\?\)/);
  db.close();
});

test("erasing an account finds its history by author and by what is about it through indexes, not a scan", () => {
  removeDatabase();
  const db = openCommunityDb();

  const plan = queryPlan(db, "DELETE FROM events_history WHERE user_id = 'u1' OR (ref_type = 'user' AND ref_id = 'u1')");
  assert.match(plan, /idx_events_history_user_time/);
  assert.match(plan, /idx_events_history_user_ref/);
  assert.doesNotMatch(plan, /SCAN/);
  db.close();
});

test("an events table from before trace ids gains the columns and keeps its rows, and opening again changes nothing", () => {
  const path = removeDatabase();
  const existing = new DatabaseSync(path);
  existing.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO events VALUES ('e1', 'u1', 'voted_on', 'tierlist', 't1', '{"game":"tierlist"}', '2026-01-01T00:00:00.000Z');
  `);
  existing.close();

  for (const _ of [1, 2]) {
    const db = openCommunityDb();
    const rows = db.prepare("SELECT id, payload, trace_id, source FROM events").all().map((row) => ({ ...row }));
    assert.deepEqual(rows, [{ id: "e1", payload: '{"game":"tierlist"}', trace_id: null, source: null }]);
    assert.deepEqual(eventTableColumns(db).slice(-2), ["trace_id", "source"]);
    assert.deepEqual(tableInfo(db, "events_history"), tableInfo(db, "events"));
    db.close();
  }
});

const LEGACY_PROFILES = "CREATE TABLE profiles (user_id TEXT PRIMARY KEY, published INTEGER NOT NULL DEFAULT 0, mural_id TEXT, published_at TEXT, updated_at TEXT NOT NULL, feed_settings TEXT)";

function feedColumns(db: DatabaseSync) {
  return db
    .prepare("SELECT user_id, show_publications AS publications, show_reading AS reading, show_votes AS votes, show_follows AS follows, show_reader_glyph AS glyph FROM profiles ORDER BY user_id")
    .all()
    .map((row) => ({ ...row }));
}

test("the feed settings JSON is copied into the new profile columns, and what can't be read switches every category off and names the user once", () => {
  const path = removeDatabase();
  const existing = new DatabaseSync(path);
  existing.exec(LEGACY_PROFILES);
  const insert = existing.prepare("INSERT INTO profiles (user_id, updated_at, feed_settings) VALUES (?, '2026-09-01T00:00:00.000Z', ?)");
  insert.run("all-chosen", JSON.stringify({ publications: false, reading: true, votes: false, follows: true, readerGlyph: true }));
  insert.run("no-glyph", JSON.stringify({ publications: true, reading: true, votes: true, follows: false }));
  insert.run("unparsable", "{not json");
  insert.run("partial", JSON.stringify({ publications: true, reading: true }));
  insert.run("wrong-type", JSON.stringify({ publications: "yes", reading: true, votes: true, follows: true }));
  insert.run("null-json", "null");
  insert.run("never-chose", null);
  existing.close();

  const warn = mock.method(console, "warn", () => {});
  const db = openCommunityDb();
  const warned = warn.mock.calls.map((call) => String(call.arguments[0]));
  warn.mock.restore();

  assert.deepEqual(feedColumns(db), [
    { user_id: "all-chosen", publications: 0, reading: 1, votes: 0, follows: 1, glyph: 1 },
    { user_id: "never-chose", publications: 1, reading: 0, votes: 1, follows: 1, glyph: 0 },
    { user_id: "no-glyph", publications: 1, reading: 1, votes: 1, follows: 0, glyph: 0 },
    { user_id: "null-json", publications: 0, reading: 0, votes: 0, follows: 0, glyph: 0 },
    { user_id: "partial", publications: 0, reading: 0, votes: 0, follows: 0, glyph: 0 },
    { user_id: "unparsable", publications: 0, reading: 0, votes: 0, follows: 0, glyph: 0 },
    { user_id: "wrong-type", publications: 0, reading: 0, votes: 0, follows: 0, glyph: 0 }
  ]);
  assert.equal(warned.length, 4);
  for (const userId of ["unparsable", "partial", "wrong-type", "null-json"]) assert.ok(warned.some((message) => message.includes(userId)), userId);

  db.exec("UPDATE profiles SET show_votes = 0 WHERE user_id = 'no-glyph'");
  db.close();
  const again = mock.method(console, "warn", () => {});
  const reopened = openCommunityDb();
  again.mock.restore();
  assert.equal(again.mock.callCount(), 0);
  assert.equal(feedColumns(reopened).find((row) => row.user_id === "no-glyph")?.votes, 1);
  reopened.close();
});

test("settings an older build changed in the JSON alone are applied to the columns at the next open, and only the rows that differ are written", () => {
  removeDatabase();
  const db = openCommunityDb();
  const chosen = (publications: boolean) => JSON.stringify({ publications, reading: true, votes: true, follows: true, readerGlyph: false });
  const insert = db.prepare("INSERT INTO profiles (user_id, updated_at, feed_settings, show_publications, show_reading, show_votes, show_follows, show_reader_glyph) VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, ?, ?, ?)");
  insert.run("turned-off", chosen(true), 1, 1, 1, 1, 0);
  insert.run("unchanged", chosen(false), 0, 1, 1, 1, 0);
  insert.run("no-json", null, 1, 0, 1, 1, 0);
  db.exec(`UPDATE profiles SET feed_settings = '{"publications":false,"reading":false,"votes":false,"follows":false}' WHERE user_id = 'turned-off'`);
  db.exec("CREATE TABLE written (user_id TEXT); CREATE TRIGGER log_write AFTER UPDATE ON profiles BEGIN INSERT INTO written VALUES (NEW.user_id); END");
  db.close();

  const reopened = openCommunityDb();

  assert.deepEqual(feedColumns(reopened), [
    { user_id: "no-json", publications: 1, reading: 0, votes: 1, follows: 1, glyph: 0 },
    { user_id: "turned-off", publications: 0, reading: 0, votes: 0, follows: 0, glyph: 0 },
    { user_id: "unchanged", publications: 0, reading: 1, votes: 1, follows: 1, glyph: 0 }
  ]);
  assert.deepEqual(reopened.prepare("SELECT user_id FROM written").all().map((row) => row.user_id), ["turned-off"]);
  reopened.close();
});

test("a second opener that migrates the profile columns while this one waits for its transaction does not make the open fail", () => {
  removeDatabase();
  const legacy = openCommunityDb();
  legacy.exec(`INSERT INTO profiles (user_id, updated_at, feed_settings) VALUES ('u1', '2026-09-01T00:00:00.000Z', '{"publications":false,"reading":true,"votes":false,"follows":true}')`);
  for (const column of ["show_publications", "show_reading", "show_votes", "show_follows", "show_reader_glyph"]) legacy.exec(`ALTER TABLE profiles DROP COLUMN ${column}`);
  legacy.close();
  const originalExec = DatabaseSync.prototype.exec;
  let concurrent: DatabaseSync | undefined;
  let racing = false;
  const exec = mock.method(DatabaseSync.prototype, "exec", function (this: DatabaseSync, sql: string) {
    if (!racing && sql === "BEGIN IMMEDIATE") {
      racing = true;
      concurrent = openCommunityDb();
    }
    return originalExec.call(this, sql);
  });

  let db: DatabaseSync;
  try {
    db = openCommunityDb();
  } finally {
    exec.mock.restore();
  }

  assert.ok(concurrent);
  assert.deepEqual(feedColumns(db), [{ user_id: "u1", publications: 0, reading: 1, votes: 0, follows: 1, glyph: 0 }]);
  concurrent.close();
  db.close();
});

test("a feed settings copy that fails leaves the profiles table as it was, so the next open starts over", () => {
  const path = removeDatabase();
  const existing = new DatabaseSync(path);
  existing.exec(`
    ${LEGACY_PROFILES};
    INSERT INTO profiles (user_id, updated_at, feed_settings) VALUES ('u1', '2026-09-01T00:00:00.000Z', '{"publications":true,"reading":false,"votes":false,"follows":true}');
    CREATE TRIGGER refuse_update BEFORE UPDATE ON profiles BEGIN SELECT RAISE(ABORT, 'refused'); END;
  `);

  assert.throws(() => openCommunityDb(), /refused/);
  assert.equal((existing.prepare("PRAGMA table_info(profiles)").all() as Array<{ name: string }>).some((column) => column.name === "show_votes"), false);

  existing.exec("DROP TRIGGER refuse_update");
  existing.close();
  const db = openCommunityDb();
  assert.deepEqual(feedColumns(db), [{ user_id: "u1", publications: 1, reading: 0, votes: 0, follows: 1, glyph: 0 }]);
  db.close();
});

test("the inbox is keyed to read a viewer's newest rows without a sort, and indexed for removing an author's rows and for expiring by age", () => {
  removeDatabase();
  const db = openCommunityDb();

  assert.deepEqual((tableInfo(db, "feed_inbox") as Array<{ name: string }>).map((column) => column.name), ["viewer_id", "created_at", "event_id", "author_id"]);
  const newest = queryPlan(db, "SELECT event_id FROM feed_inbox WHERE viewer_id = 'v' AND (created_at, event_id) < ('x', 'y') ORDER BY created_at DESC, event_id DESC LIMIT 21");
  assert.match(newest, /PRIMARY KEY \(viewer_id=\? AND \(created_at,event_id\)<\(\?,\?\)\)/);
  assert.doesNotMatch(newest, /TEMP B-TREE/);
  assert.match(queryPlan(db, "DELETE FROM feed_inbox WHERE viewer_id = 'v' AND author_id = 'a'"), /idx_feed_inbox_author/);
  assert.match(queryPlan(db, "DELETE FROM feed_inbox WHERE author_id = 'a'"), /idx_feed_inbox_author/);
  assert.match(queryPlan(db, "SELECT viewer_id FROM feed_inbox WHERE created_at < 'x' LIMIT 1000"), /idx_feed_inbox_time/);
  db.close();
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function databaseWithoutInbox() {
  removeDatabase();
  const db = openCommunityDb();
  const follow = db.prepare("INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)");
  follow.run("f1", "a", daysAgo(90));
  follow.run("f2", "a", daysAgo(90));
  follow.run("f1", "b", daysAgo(90));
  follow.run("f3", "c", daysAgo(90));
  const event = db.prepare("INSERT INTO events (id, user_id, type, ref_type, ref_id, payload, created_at) VALUES (?, ?, ?, 'book', ?, NULL, ?)");
  event.run("a-published", "a", "tierlist_published", "r1", daysAgo(5));
  event.run("a-added", "a", "book_added", "r2", daysAgo(29));
  event.run("a-old", "a", "voted_on", "r3", daysAgo(31));
  event.run("a-following", "a", "following", "r4", daysAgo(1));
  event.run("b-voted", "b", "voted_on", "r5", daysAgo(1));
  event.run("c-old", "c", "book_finished", "r6", daysAgo(60));
  event.run("nobody-published", "nobody", "tournament_published", "r7", daysAgo(1));
  db.exec("DROP TABLE feed_inbox");
  db.close();
}

function inboxPairs(db: DatabaseSync) {
  return db.prepare("SELECT viewer_id, event_id FROM feed_inbox ORDER BY viewer_id, event_id").all().map((row) => [row.viewer_id, row.event_id]);
}

test("a database that predates the inbox gets it filled once, from the feed events of the last 30 days and their authors' followers", () => {
  databaseWithoutInbox();

  const db = openCommunityDb();
  assert.deepEqual(inboxPairs(db), [["f1", "a-added"], ["f1", "a-published"], ["f1", "b-voted"], ["f2", "a-added"], ["f2", "a-published"]]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feed_inbox i JOIN events e ON e.id = i.event_id WHERE i.created_at = e.created_at AND i.author_id = e.user_id").get()?.n, 5);

  db.exec("DELETE FROM feed_inbox WHERE viewer_id = 'f2'");
  db.close();
  const reopened = openCommunityDb();
  assert.deepEqual(inboxPairs(reopened), [["f1", "a-added"], ["f1", "a-published"], ["f1", "b-voted"]]);
  reopened.close();
});

test("a fill that fails leaves no inbox behind, so the next open starts over", () => {
  databaseWithoutInbox();
  const existing = new DatabaseSync(process.env.COMMUNITY_DB_PATH!);
  existing.exec("DROP TABLE follows; CREATE TABLE follows (viewer_id TEXT NOT NULL, followee_id TEXT NOT NULL, created_at TEXT NOT NULL)");

  assert.throws(() => openCommunityDb(), /follower_id/);
  assert.equal(existing.prepare("SELECT 1 FROM sqlite_master WHERE name = 'feed_inbox'").get(), undefined);

  existing.exec(`
    DROP TABLE follows;
    CREATE TABLE follows (follower_id TEXT NOT NULL, followee_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (follower_id, followee_id));
    INSERT INTO follows VALUES ('f1', 'a', '2026-01-01T00:00:00.000Z');
  `);
  existing.close();
  const db = openCommunityDb();
  assert.deepEqual(inboxPairs(db), [["f1", "a-added"], ["f1", "a-published"]]);
  db.close();
});
