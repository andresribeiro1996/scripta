import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openCommunityDb(): DatabaseSync {
  mkdirSync(dirname(env.COMMUNITY_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.COMMUNITY_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);
  migrateSchema(db, schema);

  return db;
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
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
}
