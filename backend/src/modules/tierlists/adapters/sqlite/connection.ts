import { normalizeWords } from "@scripta/shared";
import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";
import { openSqlite } from "../../../../db/openSqlite.js";
import { migrateTierlistsToWorks } from "./worksPass.js";

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
    if (!has("promoted_at")) db.exec(`ALTER TABLE tierlists ADD COLUMN promoted_at TEXT`);
    if (!has("public_books")) db.exec(`ALTER TABLE tierlists ADD COLUMN public_books TEXT`);
    if (!has("name_key")) db.exec(`ALTER TABLE tierlists ADD COLUMN name_key TEXT`);
    if (!has("origin_user_id")) {
      db.exec(`ALTER TABLE tierlists ADD COLUMN origin_user_id TEXT`);
      db.exec(`UPDATE tierlists SET origin_user_id = owner_user_id WHERE origin_user_id IS NULL`);
    }

    migrateTierlistsToWorks(db);

    // Re-run schema to create any missing tables and indexes
    db.exec(schema);
  }

  fillNameKeys(db);
}

function fillNameKeys(db: DatabaseSync): void {
  const stale = db.prepare(`SELECT id, name FROM tierlists WHERE name_key IS NULL`).all() as { id: string; name: string }[];
  if (stale.length === 0) return;
  const update = db.prepare(`UPDATE tierlists SET name_key = ? WHERE id = ? AND name_key IS NULL`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of stale) update.run(normalizeWords(row.name), row.id);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function openTierlistsDb(): DatabaseSync {
  const db = openSqlite(env.TIERLISTS_DB_PATH);
  applyTierlistsMigrations(db);

  return db;
}
