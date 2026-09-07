// Opens (and migrates) this module's SQLite database. This file is
// SQLite-specific infrastructure — nothing in domain/ or service.ts
// imports it; only sqliteAuthRepository.ts (the other half of this
// adapter) and plugin.ts (the composition root) do.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

/** Schema + column migrations, split out from openAuthDb so it can run
 *  against an in-memory database in tests — openAuthDb itself reads env
 *  and touches the filesystem, so it can't be unit-tested (same split as
 *  modules/tierlists/adapters/sqlite/connection.ts's applyTierlistsMigrations). */
export function applyAuthMigrations(db: DatabaseSync): void {
  // schema.sql's CREATE TABLE only shapes a FRESH database — an existing
  // one keeps its old columns, so the avatar_id column (added after this
  // table already existed in the wild) is patched in here with the same
  // "run on every boot, no-op once applied" spirit as CREATE IF NOT
  // EXISTS. PRAGMA on a missing table returns no rows, which correctly
  // skips this on a first boot (schema.sql below creates the table with
  // the column already in it).
  const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (columns.length > 0 && !columns.some((column) => column.name === "avatar_id")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_id TEXT");
  }

  // Task 4A: same "patch an existing table, no-op on a fresh one" story as
  // avatar_id above — rotated_at/replaced_by back the refresh-rotation
  // grace window (service.ts) and didn't exist before this change.
  const refreshTokenColumns = db.prepare("PRAGMA table_info(refresh_tokens)").all() as Array<{ name: string }>;
  if (refreshTokenColumns.length > 0) {
    if (!refreshTokenColumns.some((column) => column.name === "rotated_at")) {
      db.exec("ALTER TABLE refresh_tokens ADD COLUMN rotated_at TEXT");
    }
    if (!refreshTokenColumns.some((column) => column.name === "replaced_by")) {
      db.exec("ALTER TABLE refresh_tokens ADD COLUMN replaced_by TEXT");
    }
  }

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);
}

export function openAuthDb(): DatabaseSync {
  mkdirSync(dirname(env.AUTH_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.AUTH_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  applyAuthMigrations(db);

  return db;
}
