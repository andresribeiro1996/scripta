import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";
import { openSqlite } from "../../../../db/openSqlite.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openWaitlistDb(): DatabaseSync {
  const db = openSqlite(env.WAITLIST_DB_PATH);

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  return db;
}
