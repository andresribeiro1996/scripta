// Opens (and migrates) this module's own SQLite database — mirrors
// modules/tierlists/adapters/sqlite/connection.ts. A new module with no
// legacy databases: migrations are just "run the schema".

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function applyQuizzesMigrations(db: DatabaseSync): void {
  db.exec(readFileSync(`${adapterDir}/schema.sql`, "utf8"));
}

export function openQuizzesDb(): DatabaseSync {
  mkdirSync(dirname(env.QUIZZES_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.QUIZZES_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  applyQuizzesMigrations(db);

  return db;
}
