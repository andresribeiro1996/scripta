// The SQLite implementation of the MuralsRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// MuralsRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { MuralsRepository } from "../../domain/ports.js";
import type { MuralRow } from "../../domain/types.js";

export function createSqliteMuralsRepository(db: DatabaseSync): MuralsRepository {
  const insertStmt = db.prepare(`
    INSERT INTO murals (id, user_id, name, blocks, cover_image_id, cover_image_url, share_token, created_at, updated_at)
    VALUES ($id, $user_id, $name, $blocks, $cover_image_id, $cover_image_url, $share_token, $created_at, $updated_at)
  `);
  const listStmt = db.prepare(`SELECT * FROM murals WHERE user_id = ? ORDER BY created_at DESC`);
  const getOwnedStmt = db.prepare(`SELECT * FROM murals WHERE id = ? AND user_id = ?`);
  // Full-row SET rather than a dynamic per-field statement: update()
  // below always merges the patch onto a freshly-read row first, so every
  // column already has its final value by the time this runs.
  const updateStmt = db.prepare(`
    UPDATE murals
    SET name = $name, blocks = $blocks, cover_image_id = $cover_image_id, cover_image_url = $cover_image_url, updated_at = $updated_at
    WHERE id = $id AND user_id = $user_id
  `);
  const deleteStmt = db.prepare(`DELETE FROM murals WHERE id = ? AND user_id = ?`);
  const setShareTokenStmt = db.prepare(`UPDATE murals SET share_token = $share_token, updated_at = $updated_at WHERE id = $id AND user_id = $user_id`);
  const getByShareTokenStmt = db.prepare(`SELECT * FROM murals WHERE share_token = ?`);

  return {
    listByUser(userId) {
      return listStmt.all(userId) as unknown as MuralRow[];
    },

    getOwned(id, userId) {
      return getOwnedStmt.get(id, userId) as MuralRow | undefined;
    },

    insert(row) {
      insertStmt.run({
        $id: row.id,
        $user_id: row.user_id,
        $name: row.name,
        $blocks: row.blocks,
        $cover_image_id: row.cover_image_id,
        $cover_image_url: row.cover_image_url,
        $share_token: row.share_token,
        $created_at: row.created_at,
        $updated_at: row.updated_at
      });
    },

    update(id, userId, patch) {
      const existing = getOwnedStmt.get(id, userId) as MuralRow | undefined;
      if (!existing) return undefined;

      const updatedAt = new Date().toISOString();
      const merged: MuralRow = { ...existing, ...patch, updated_at: updatedAt };
      updateStmt.run({
        $id: id,
        $user_id: userId,
        $name: merged.name,
        $blocks: merged.blocks,
        $cover_image_id: merged.cover_image_id,
        $cover_image_url: merged.cover_image_url,
        $updated_at: updatedAt
      });
      return merged;
    },

    delete(id, userId) {
      const result = deleteStmt.run(id, userId);
      return result.changes > 0;
    },

    setShareToken(id, userId, token) {
      const existing = getOwnedStmt.get(id, userId) as MuralRow | undefined;
      if (!existing) return undefined;

      const updatedAt = new Date().toISOString();
      setShareTokenStmt.run({ $id: id, $user_id: userId, $share_token: token, $updated_at: updatedAt });
      return { ...existing, share_token: token, updated_at: updatedAt };
    },

    getByShareToken(token) {
      return getByShareTokenStmt.get(token) as MuralRow | undefined;
    }
  };
}
