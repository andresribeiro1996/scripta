// covers' cross-module public surface for other modules that need a
// cache-ONLY, synchronous cover URL lookup — no network call, unlike
// this module's own resolveCover (service.ts), which can reach out to
// Kobo/Open Library/Google Books/Hardcover on a cache miss and is
// authGuard'd specifically because of that cost (see routes.ts's own
// comment on GET /covers/resolve).
//
// First consumer: library/publicResolver.ts's toPublicBookData(), for
// the public GET /murals/shared/:token route — a public, unauthenticated
// request handler that must stay synchronous (per its own
// resolvePublicLibraryData signature) and must never spend this app's
// own external-API quota on a stranger's page view. In the realistic
// case (the mural owner has viewed this book in their own library at
// least once, which already triggers and caches a real resolution via
// the authenticated GET /covers/resolve flow), the cache row already
// exists by the time anyone opens the public mural link.
//
// Opens its own lazy second connection to COVERS_DB_PATH — same idiom
// library/publicResolver.ts's own getDb() already uses for
// LIBRARY_DB_PATH. SQLite in WAL mode supports multiple connections to
// one file just fine, and this keeps a read-only cross-module concern
// decoupled from this module's own plugin.ts/service.ts composition root
// and lifecycle. The module registration order in backend/src/app.ts
// (library is registered before covers) does NOT matter here: this
// opens a raw sqlite file directly via openCoversDb(), never anything
// routed through Fastify's own plugin-registration or request pipeline —
// there is nothing here to be "not ready yet."

import type { DatabaseSync } from "node:sqlite";
import { env } from "../../config/env.js";
import { openCoversDb } from "./adapters/sqlite/connection.js";

export interface PeekCachedCoverParams {
  isbn?: string | null;
  imageId?: string | null;
}

/** Same cache-key convention service.ts's own resolveCover uses
 *  internally (isbn wins when both are present) — kept in sync by
 *  mirroring that exact two-branch ternary rather than re-deriving an
 *  equivalent. A divergence here would silently miss real cache rows
 *  service.ts itself would find for the same book. */
function cacheKeyFor({ isbn, imageId }: PeekCachedCoverParams): string | null {
  return isbn ? `isbn:${isbn}` : imageId ? `kobo:${imageId}` : null;
}

let cached: { db: DatabaseSync; getByCacheKeyStmt: ReturnType<DatabaseSync["prepare"]> } | null = null;
function getStatements() {
  if (!cached) {
    const db = openCoversDb();
    cached = { db, getByCacheKeyStmt: db.prepare(`SELECT id FROM cover_cache WHERE cache_key = ?`) };
  }
  return cached;
}

/** Cache-only, synchronous — a plain SELECT, never a network call.
 *  Returns the same public, unauthenticated URL shape
 *  GET /covers/cached/:id/file already serves (mirrors plugin.ts's own
 *  publicUrlFor), or `null` on a cache miss (including "no isbn/imageId
 *  to even key a lookup by" — an empty/missing identifier is not a
 *  lookup failure, there was simply nothing to look up). */
export function peekCachedCoverUrl(params: PeekCachedCoverParams): string | null {
  const cacheKey = cacheKeyFor(params);
  if (!cacheKey) return null;

  const row = getStatements().getByCacheKeyStmt.get(cacheKey) as { id: string } | undefined;
  if (!row) return null;

  return `${env.PUBLIC_API_URL}/covers/cached/${row.id}/file`;
}
