// Opens (and migrates) this module's own SQLite database — a separate
// file from the auth module's, per the module-isolation convention (see
// schema.sql). Nothing in domain/ or service.ts imports this file.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";
import { migrateDocumentsToEntities, type MigrationResult } from "./migrateFromDocuments.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

// The migration has to run during schema init, before anything can read a
// half-migrated library — but its outcome needs reporting from plugin.ts,
// which owns logging. Stashed here and collected once.
let lastMigrationResult: MigrationResult | null = null;

/** Returns the most recent migration result and clears it. */
export function takeMigrationResult(): MigrationResult | null {
  const result = lastMigrationResult;
  lastMigrationResult = null;
  return result;
}

/** Applies the schema and any pending one-off migrations to an already
 *  open database. Split out from openLibraryDb so tests can drive the
 *  exact same setup against an in-memory database without touching
 *  env/filesystem. */
export function initLibrarySchema(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL");
  // The group_books -> groups and mural_blocks -> murals cascades in
  // schema.sql only fire with this on; SQLite defaults it OFF per
  // connection. Without it, deleting a mural would orphan its blocks.
  db.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  lastMigrationResult = migrateDocumentsToEntities(db);
}

export function openLibraryDb(): DatabaseSync {
  mkdirSync(dirname(env.LIBRARY_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.LIBRARY_DB_PATH);
  initLibrarySchema(db);

  return db;
}
