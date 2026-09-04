// Opens (and migrates) this module's own SQLite database — mirrors
// modules/arena/adapters/sqlite/connection.ts exactly. A separate file
// from every other module's, per the module-isolation convention.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openTierlistsDb(): DatabaseSync {
  mkdirSync(dirname(env.TIERLISTS_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.TIERLISTS_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  return db;
}
