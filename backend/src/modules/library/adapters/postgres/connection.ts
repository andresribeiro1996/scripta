// Opens (and migrates) this module's Postgres schema. The counterpart of
// adapters/sqlite/connection.ts; nothing in domain/ or service.ts imports
// either.

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

/** Applies the schema to an already-open pool. Split out from
 *  openLibraryPool so tests can drive the same setup against their own
 *  throwaway database. */
export async function initLibrarySchema(pool: pg.Pool): Promise<void> {
  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  await pool.query(schema);
}

export async function openLibraryPool(): Promise<pg.Pool> {
  if (!env.DATABASE_URL) {
    throw new Error("openLibraryPool() called without DATABASE_URL set — plugin.ts should have chosen the SQLite adapter.");
  }

  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    // Managed Postgres (Neon, Supabase, Fly) terminates TLS with a chain
    // the container may not have a root for. Verification is controlled
    // by DATABASE_SSL rather than disabled outright, so turning it off is
    // a deliberate, visible choice in the deployment's own config.
    ssl: env.DATABASE_SSL === "no-verify" ? { rejectUnauthorized: false } : env.DATABASE_SSL === "off" ? false : undefined,
    // A single small instance does not need a large pool, and a free-tier
    // Postgres will refuse connections long before the app needs them.
    max: env.DATABASE_POOL_MAX
  });

  await initLibrarySchema(pool);
  return pool;
}
