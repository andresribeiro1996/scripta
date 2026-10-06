import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";
import { openSqlite } from "../../../../db/openSqlite.js";
import { migrateQuizzesToWorks } from "./worksPass.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function applyQuizzesMigrations(db: DatabaseSync): void {
  migrateQuizzesToWorks(db);
  db.exec(readFileSync(`${adapterDir}/schema.sql`, "utf8"));
}

export function openQuizzesDb(): DatabaseSync {
  const db = openSqlite(env.QUIZZES_DB_PATH);
  applyQuizzesMigrations(db);

  return db;
}
