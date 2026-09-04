// The SQLite implementation of the TierlistsRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// TierlistsRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { TierlistsRepository } from "../../domain/ports.js";
import type { TierlistRow } from "../../domain/types.js";

export function createSqliteTierlistsRepository(db: DatabaseSync): TierlistsRepository {
  const insertStmt = db.prepare(`
    INSERT INTO tierlists (id, owner_user_id, name, data, created_at, updated_at)
    VALUES ($id, $owner_user_id, $name, $data, $created_at, $updated_at)
  `);
  const listStmt = db.prepare(`SELECT * FROM tierlists WHERE owner_user_id = ? ORDER BY created_at DESC`);
  const getOwnedStmt = db.prepare(`SELECT * FROM tierlists WHERE id = ? AND owner_user_id = ?`);
  // Full-row SET rather than a dynamic per-field statement: update()
  // below always merges the patch onto a freshly-read row first, so every
  // column already has its final value by the time this runs.
  const updateStmt = db.prepare(`
    UPDATE tierlists
    SET name = $name, data = $data, updated_at = $updated_at
    WHERE id = $id AND owner_user_id = $owner_user_id
  `);
  const deleteStmt = db.prepare(`DELETE FROM tierlists WHERE id = ? AND owner_user_id = ?`);

  return {
    listByUser(userId) {
      return listStmt.all(userId) as unknown as TierlistRow[];
    },

    getOwned(id, userId) {
      return getOwnedStmt.get(id, userId) as TierlistRow | undefined;
    },

    insert(row) {
      insertStmt.run({
        $id: row.id,
        $owner_user_id: row.owner_user_id,
        $name: row.name,
        $data: row.data,
        $created_at: row.created_at,
        $updated_at: row.updated_at
      });
    },

    update(id, userId, patch) {
      const existing = getOwnedStmt.get(id, userId) as TierlistRow | undefined;
      if (!existing) return undefined;

      const updatedAt = new Date().toISOString();
      const merged: TierlistRow = { ...existing, ...patch, updated_at: updatedAt };
      updateStmt.run({
        $id: id,
        $owner_user_id: userId,
        $name: merged.name,
        $data: merged.data,
        $updated_at: updatedAt
      });
      return merged;
    },

    delete(id, userId) {
      const result = deleteStmt.run(id, userId);
      return result.changes > 0;
    }
  };
}
