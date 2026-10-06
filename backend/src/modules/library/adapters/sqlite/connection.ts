// Opens (and migrates) this module's own SQLite database — a separate
// file from the auth module's, per the module-isolation convention (see
// schema.sql). Nothing in domain/ or service.ts imports this file.

import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";
import { openSqlite } from "../../../../db/openSqlite.js";
import { LIBRARY_DERIVED_VERSION } from "../../domain/constants.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function applyLibrarySchema(db: DatabaseSync, derivedVersion = LIBRARY_DERIVED_VERSION): void {
  const { user_version: storedVersion } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const rederive = storedVersion < derivedVersion;
  if (rederive) db.exec("DROP TABLE IF EXISTS library_derived; DROP TABLE IF EXISTS library_match_keys");
  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  // Retrofit: `library_documents` already existed with real rows before
  // sharing was added, and CREATE TABLE IF NOT EXISTS above is a no-op
  // against an existing table — it will never add this column on its
  // own. PRAGMA table_info + a conditional ALTER TABLE is the idempotent
  // substitute: safe to run on every boot, since after the first run the
  // `some()` check below just finds the column already there.
  const columns = db.prepare(`PRAGMA table_info(library_documents)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "share_token")) {
    db.exec(`ALTER TABLE library_documents ADD COLUMN share_token TEXT`);
  }
  // ALTER TABLE ADD COLUMN can't itself carry a UNIQUE constraint (only
  // CREATE TABLE can) — a partial unique index is the substitute: unique
  // among non-null tokens, doesn't choke on every unshared row being NULL.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_library_documents_share_token
           ON library_documents(share_token) WHERE share_token IS NOT NULL`);
  const bookColumns = db.prepare(`PRAGMA table_info(library_books)`).all() as { name: string }[];
  if (!bookColumns.some((c) => c.name === "work_id")) {
    db.exec(`ALTER TABLE library_books ADD COLUMN work_id TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_library_books_work ON library_books (work_id, user_id)`);
  if (rederive) db.exec(`PRAGMA user_version = ${derivedVersion}`);
}

export function openLibraryDb(): DatabaseSync {
  const db = openSqlite(env.LIBRARY_DB_PATH);
  applyLibrarySchema(db);

  return db;
}
