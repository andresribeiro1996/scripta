import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

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
  const path = process.env.COMMUNITY_DB_PATH!;
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
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
  assert.ok(eventIndexNames(db).includes("idx_events_publication_ref"));
  db.close();
});

test("published profiles are indexed by recency, on a new database and on an existing one", () => {
  const path = process.env.COMMUNITY_DB_PATH!;
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
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
