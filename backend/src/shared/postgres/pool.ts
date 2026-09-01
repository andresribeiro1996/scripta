// One Postgres connection pool for the whole process, shared by every
// module that has a Postgres adapter.
//
// Deliberately shared rather than one pool per module, which is what the
// one-SQLite-file-per-module convention would suggest. A pool is a set of
// real TCP connections to one server, and five modules each holding
// DATABASE_POOL_MAX of them would open five times as many as intended —
// enough to exhaust a free-tier Postgres (Neon's smallest allows a
// handful) while the app sits idle. The module boundary is about who owns
// which TABLES, not about who owns a socket.
//
// A note on that boundary: under SQLite each module has its own FILE, so
// the isolation is enforced by the filesystem. In Postgres they share one
// database and the boundary becomes a convention — each adapter touches
// only its own module's tables. Every module's table names are currently
// distinct (users/refresh_tokens, library_*, gallery_images, cover_cache,
// social_connections), so nothing collides; a module adding a
// generically-named table would need to check. `schema_migrations` is
// already taken, by library.

import pg from "pg";
import { env } from "../../config/env.js";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;

  if (!env.DATABASE_URL) {
    throw new Error("getPool() called without DATABASE_URL set — the caller should have chosen a SQLite adapter.");
  }

  pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    // Managed Postgres (Neon, Supabase, Fly) terminates TLS with a chain
    // the container may not have a root for. Controlled by DATABASE_SSL
    // rather than disabled outright, so turning verification off is a
    // deliberate, visible choice in the deployment's own config.
    ssl: env.DATABASE_SSL === "no-verify" ? { rejectUnauthorized: false } : env.DATABASE_SSL === "off" ? false : undefined,
    max: env.DATABASE_POOL_MAX
  });

  return pool;
}

/** Closes the pool. Called once on server shutdown — without it a rolling
 *  deploy leaves connections held until the provider times them out, and a
 *  small managed Postgres has few to spare. */
export async function closePool(): Promise<void> {
  const current = pool;
  pool = null;
  await current?.end();
}
