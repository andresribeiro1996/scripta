// Opens (and migrates) this module's own SQLite database — mirrors
// modules/library/adapters/sqlite/connection.ts exactly.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openSocialsDb(): DatabaseSync {
  mkdirSync(dirname(env.SOCIALS_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.SOCIALS_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  return db;
}
