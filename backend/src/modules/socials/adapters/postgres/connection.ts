// Applies this module's Postgres schema. The counterpart of
// adapters/sqlite/connection.ts, minus the connecting: the pool is shared
// across modules (see src/shared/postgres/pool.ts), so this owns only the
// schema, not the connection.

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export async function initSocialsSchema(pool: Pool): Promise<void> {
  await pool.query(readFileSync(`${adapterDir}/schema.sql`, "utf8"));
}
