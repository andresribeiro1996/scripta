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

export function openAuthDb(): DatabaseSync {
  mkdirSync(dirname(env.AUTH_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.AUTH_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  return db;
}
