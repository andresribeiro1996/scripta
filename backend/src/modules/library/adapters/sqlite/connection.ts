// Opens (and migrates) this module's own SQLite database — a separate
// file from the auth module's, per the module-isolation convention (see
// schema.sql). Nothing in domain/ or service.ts imports this file.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openLibraryDb(): DatabaseSync {
  mkdirSync(dirname(env.LIBRARY_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.LIBRARY_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");

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

  return db;
}
