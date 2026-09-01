// The Postgres implementation of the GalleryRepository port. A sibling of
// adapters/sqlite/, not a replacement — service.ts is untouched.
//
// This is metadata only; the image bytes live in adapters/fs or
// adapters/s3 behind the separate ImageBlobStore port.

import type { Pool } from "pg";
import type { GalleryRepository } from "../../domain/ports.js";
import type { GalleryImageRow } from "../../domain/types.js";

function toRow(raw: Record<string, unknown> | undefined): GalleryImageRow | undefined {
  if (!raw) return undefined;
  return {
    ...raw,
    // The domain speaks ISO strings; node-postgres hands back Date objects.
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : raw.created_at,
    // byte_size is BIGINT, which node-postgres returns as a STRING to
    // avoid losing precision past 2^53. The domain wants a number, and
    // these are image sizes — comfortably inside the safe range.
    byte_size: typeof raw.byte_size === "string" ? Number(raw.byte_size) : raw.byte_size
  } as GalleryImageRow;
}

export function createPgGalleryRepository(pool: Pool): GalleryRepository {
  return {
    async listImages(userId) {
      const { rows } = await pool.query(`SELECT * FROM gallery_images WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
      return rows.map((row) => toRow(row)!);
    },

    async insertImage(row) {
      await pool.query(
        `INSERT INTO gallery_images (id, user_id, filename, mime_type, extension, width, height, byte_size, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [row.id, row.user_id, row.filename, row.mime_type, row.extension, row.width, row.height, row.byte_size, row.created_at]
      );
    },

    async getImageById(id) {
      // No ownership filter, deliberately — this backs the public
      // GET /gallery/:id/file route, which is guarded only by the id being
      // an unguessable UUID. See domain/ports.ts.
      const { rows } = await pool.query(`SELECT * FROM gallery_images WHERE id = $1`, [id]);
      return toRow(rows[0]);
    },

    async getOwnedImage(id, userId) {
      const { rows } = await pool.query(`SELECT * FROM gallery_images WHERE id = $1 AND user_id = $2`, [id, userId]);
      return toRow(rows[0]);
    },

    async deleteImage(id, userId) {
      // The ownership check is in the WHERE clause rather than a prior
      // read, so there is no window between checking and deleting. The
      // boolean tells service.ts whether a row was actually this user's —
      // which is what separates "deleted" from a 404.
      const result = await pool.query(`DELETE FROM gallery_images WHERE id = $1 AND user_id = $2`, [id, userId]);
      return (result.rowCount ?? 0) > 0;
    },

    async totalBytesForUser(userId) {
      // COALESCE so a user with no images gets 0 rather than NULL, and a
      // cast to BIGINT then a string→Number conversion for the same
      // precision reason as byte_size above.
      const { rows } = await pool.query(`SELECT COALESCE(SUM(byte_size), 0) AS total FROM gallery_images WHERE user_id = $1`, [
        userId
      ]);
      const total = rows[0]?.total;
      return typeof total === "string" ? Number(total) : ((total as number) ?? 0);
    }
  };
}
