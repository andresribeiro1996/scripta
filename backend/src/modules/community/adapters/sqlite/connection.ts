import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openCommunityDb(): DatabaseSync {
  mkdirSync(dirname(env.COMMUNITY_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.COMMUNITY_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  return db;
}
