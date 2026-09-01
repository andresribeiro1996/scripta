// The Postgres implementation of the CoverCacheRepository port. A sibling
// of adapters/sqlite/, not a replacement — service.ts is untouched.

import type { Pool } from "pg";
import type { CoverCacheRepository } from "../../domain/ports.js";
import type { CachedCoverRow } from "../../domain/types.js";

function toRow(raw: Record<string, unknown> | undefined): CachedCoverRow | undefined {
  if (!raw) return undefined;
  // The domain speaks ISO strings; node-postgres hands back Date objects.
  return { ...raw, created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : raw.created_at } as CachedCoverRow;
}

export function createPgCoverCacheRepository(pool: Pool): CoverCacheRepository {
  return {
    async getByCacheKey(cacheKey) {
      const { rows } = await pool.query(`SELECT * FROM cover_cache WHERE cache_key = $1`, [cacheKey]);
      return toRow(rows[0]);
    },

    async insert(row) {
      // ON CONFLICT DO NOTHING, matching SQLite's INSERT OR IGNORE: two
      // requests can resolve the same book concurrently, and the loser
      // must absorb that quietly rather than throwing. rowCount tells
      // service.ts whether THIS call won, so it knows to read back
      // whichever row the winner actually wrote.
      const result = await pool.query(
        `INSERT INTO cover_cache (id, cache_key, source, mime_type, extension, width, height, byte_size, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (cache_key) DO NOTHING`,
        [row.id, row.cache_key, row.source, row.mime_type, row.extension, row.width, row.height, row.byte_size, row.created_at]
      );
      return (result.rowCount ?? 0) > 0;
    }
  };
}
