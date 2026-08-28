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

  return db;
}
