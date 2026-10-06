// Opens (and migrates) this module's own SQLite database — mirrors
// modules/library/adapters/sqlite/connection.ts exactly. A separate file
// from every other module's, per the module-isolation convention.

import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";
import { openSqlite } from "../../../../db/openSqlite.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openGalleryDb(): DatabaseSync {
  const db = openSqlite(env.GALLERY_DB_PATH);

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  return db;
}
