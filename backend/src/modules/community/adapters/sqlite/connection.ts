import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeFeedSettings, type FeedSettings } from "@scripta/shared/community";
import { env } from "../../../../config/env.js";
import { FEED_EVENT_TYPES, FEED_WINDOW_MS } from "../../domain/feed.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openCommunityDb(): DatabaseSync {
  mkdirSync(dirname(env.COMMUNITY_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.COMMUNITY_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  if (tableExists(db, "feed_inbox")) db.exec(schema);
  else applySchemaAndFillInbox(db, schema);
  migrateSchema(db, schema);

  return db;
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

function applySchemaAndFillInbox(db: DatabaseSync, schema: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(schema);
    db.prepare(`
      INSERT INTO feed_inbox (viewer_id, created_at, event_id, author_id)
      SELECT f.follower_id, e.created_at, e.id, e.user_id
      FROM events e JOIN follows f ON f.followee_id = e.user_id
      WHERE e.type IN (SELECT value FROM json_each(?)) AND e.created_at >= ?
    `).run(JSON.stringify(FEED_EVENT_TYPES), new Date(Date.now() - FEED_WINDOW_MS).toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const ALL_OFF: FeedSettings = { publications: false, reading: false, votes: false, follows: false, readerGlyph: false };

function parseFeedSettings(raw: string): FeedSettings | null {
  try {
    return normalizeFeedSettings(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function addFeedSettingColumns(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      ALTER TABLE profiles ADD COLUMN show_publications INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE profiles ADD COLUMN show_reading INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE profiles ADD COLUMN show_votes INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE profiles ADD COLUMN show_follows INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE profiles ADD COLUMN show_reader_glyph INTEGER NOT NULL DEFAULT 0;
    `);
    const copy = db.prepare(`
      UPDATE profiles SET
        show_publications = $show_publications,
        show_reading = $show_reading,
        show_votes = $show_votes,
        show_follows = $show_follows,
        show_reader_glyph = $show_reader_glyph
      WHERE user_id = $user_id
    `);
    for (const row of db.prepare("SELECT user_id, feed_settings FROM profiles WHERE feed_settings IS NOT NULL").all() as Array<{ user_id: string; feed_settings: string }>) {
      const parsed = parseFeedSettings(row.feed_settings);
      if (!parsed) console.warn(`[community] feed settings of user ${row.user_id} are unreadable; all of its feed categories are switched off`);
      const settings = parsed ?? ALL_OFF;
      copy.run({
        $user_id: row.user_id,
        $show_publications: Number(settings.publications),
        $show_reading: Number(settings.reading),
        $show_votes: Number(settings.votes),
        $show_follows: Number(settings.follows),
        $show_reader_glyph: Number(settings.readerGlyph ?? false)
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrateSchema(db: DatabaseSync, schema: string): void {
  if (!tableColumns(db, "events").includes("payload")) {
    db.exec(`
      CREATE TABLE events_new (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
        ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
      );
      INSERT INTO events_new (id, user_id, type, ref_type, ref_id, payload, created_at)
        SELECT id, user_id, type, ref_type, ref_id, NULL, created_at FROM events;
      DROP TABLE events;
      ALTER TABLE events_new RENAME TO events;
    `);
    db.exec(schema);
  }
  if (!tableColumns(db, "profiles").includes("feed_settings")) {
    db.exec("ALTER TABLE profiles ADD COLUMN feed_settings TEXT");
  }
  if (!tableColumns(db, "profiles").includes("show_publications")) addFeedSettingColumns(db);
  const eventColumns = tableColumns(db, "events");
  if (!eventColumns.includes("trace_id")) db.exec("ALTER TABLE events ADD COLUMN trace_id TEXT");
  if (!eventColumns.includes("source")) db.exec("ALTER TABLE events ADD COLUMN source TEXT");
}
