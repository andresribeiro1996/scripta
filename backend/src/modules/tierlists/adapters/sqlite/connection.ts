// Opens (and migrates) this module's own SQLite database — mirrors
// modules/arena/adapters/sqlite/connection.ts exactly. A separate file
// from every other module's, per the module-isolation convention.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

/** Schema + column migrations, split out from openTierlistsDb so it can
 *  run against an in-memory database in tests — openTierlistsDb itself
 *  reads env and touches the filesystem, so it can't be unit-tested. */
export function applyTierlistsMigrations(db: DatabaseSync): void {
  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");

  // Check if tierlists table already exists (pre-voting database)
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tierlists'`)
    .get() as { name: string } | undefined;

  if (!tableExists) {
    // Fresh database: run the full schema in one go
    db.exec(schema);
  } else {
    // Pre-voting database: add missing columns first, then create indexes
    const columns = db.prepare(`PRAGMA table_info(tierlists)`).all() as { name: string }[];
    const has = (name: string) => columns.some((c) => c.name === name);
    if (!has("vote_code")) db.exec(`ALTER TABLE tierlists ADD COLUMN vote_code TEXT`);
    if (!has("vote_access")) db.exec(`ALTER TABLE tierlists ADD COLUMN vote_access TEXT NOT NULL DEFAULT 'anonymous'`);
    if (!has("voting_open")) db.exec(`ALTER TABLE tierlists ADD COLUMN voting_open INTEGER NOT NULL DEFAULT 0`);
    if (!has("source_tierlist_id")) db.exec(`ALTER TABLE tierlists ADD COLUMN source_tierlist_id TEXT`);

    // Re-run schema to create any missing tables and indexes
    db.exec(schema);
  }
}

export function openTierlistsDb(): DatabaseSync {
  mkdirSync(dirname(env.TIERLISTS_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.TIERLISTS_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  applyTierlistsMigrations(db);

  return db;
}
