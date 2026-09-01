// The SQLite implementation of the GalleryRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// GalleryRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { GalleryRepository } from "../../domain/ports.js";
import type { GalleryImageRow } from "../../domain/types.js";

export function createSqliteGalleryRepository(db: DatabaseSync): GalleryRepository {
  const insertStmt = db.prepare(`
    INSERT INTO gallery_images (id, user_id, filename, mime_type, extension, width, height, byte_size, created_at)
    VALUES ($id, $user_id, $filename, $mime_type, $extension, $width, $height, $byte_size, $created_at)
  `);
  const listStmt = db.prepare(`SELECT * FROM gallery_images WHERE user_id = ? ORDER BY created_at DESC`);
  const getByIdStmt = db.prepare(`SELECT * FROM gallery_images WHERE id = ?`);
  const getOwnedStmt = db.prepare(`SELECT * FROM gallery_images WHERE id = ? AND user_id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM gallery_images WHERE id = ? AND user_id = ?`);
  const totalBytesStmt = db.prepare(`SELECT COALESCE(SUM(byte_size), 0) AS total FROM gallery_images WHERE user_id = ?`);

  return {
    async listImages(userId) {
      return listStmt.all(userId) as unknown as GalleryImageRow[];
    },

    async insertImage(row) {
      insertStmt.run({
        $id: row.id,
        $user_id: row.user_id,
        $filename: row.filename,
        $mime_type: row.mime_type,
        $extension: row.extension,
        $width: row.width,
        $height: row.height,
        $byte_size: row.byte_size,
        $created_at: row.created_at
      });
    },

    async getImageById(id) {
      return getByIdStmt.get(id) as GalleryImageRow | undefined;
    },

    async getOwnedImage(id, userId) {
      return getOwnedStmt.get(id, userId) as GalleryImageRow | undefined;
    },

    async deleteImage(id, userId) {
      const result = deleteStmt.run(id, userId);
      return result.changes > 0;
    },

    async totalBytesForUser(userId) {
      const row = totalBytesStmt.get(userId) as { total: number };
      return row.total;
    }
  };
}
