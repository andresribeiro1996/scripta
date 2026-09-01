// The SQLite implementation of the CoverCacheRepository port. Only file
// in this module that knows SQL for the cache table — service.ts only
// ever sees the CoverCacheRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { CoverCacheRepository } from "../../domain/ports.js";
import type { CachedCoverRow } from "../../domain/types.js";

export function createSqliteCoverCacheRepository(db: DatabaseSync): CoverCacheRepository {
  const getStmt = db.prepare(`SELECT * FROM cover_cache WHERE cache_key = ?`);
  // OR IGNORE, not a plain INSERT — two requests resolving the SAME
  // uncached book concurrently (two browser tabs, or React StrictMode's
  // own double-effect firing in dev) can both pass the "is it cached
  // yet" read before either has written, since that read is separated
  // from the eventual write by real `await`ed network calls (see
  // service.ts's own resolveCover). Without OR IGNORE, the loser's
  // insert would throw on cache_key's UNIQUE constraint — an unhandled
  // exception crashing what should be a harmless, silently-absorbed
  // race, not a real error. `run().changes` tells service.ts whether
  // THIS call actually won and inserted, or lost and should read back
  // whichever row the winner wrote instead.
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO cover_cache (id, cache_key, source, mime_type, extension, width, height, byte_size, created_at)
    VALUES ($id, $cache_key, $source, $mime_type, $extension, $width, $height, $byte_size, $created_at)
  `);

  return {
    async getByCacheKey(cacheKey) {
      return getStmt.get(cacheKey) as CachedCoverRow | undefined;
    },

    async insert(row) {
      const result = insertStmt.run({
        $id: row.id,
        $cache_key: row.cache_key,
        $source: row.source,
        $mime_type: row.mime_type,
        $extension: row.extension,
        $width: row.width,
        $height: row.height,
        $byte_size: row.byte_size,
        $created_at: row.created_at
      });
      return result.changes > 0;
    }
  };
}
