import type { DatabaseSync } from "node:sqlite";
import { openCommunityDb } from "./adapters/sqlite/connection.js";

export function applyHomeMuralMigration(
  rows: Array<{ userId: string; muralId: string }>,
  db: DatabaseSync = openCommunityDb()
): void {
  if (rows.length === 0) return;
  const upsert = db.prepare(`
    INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at)
    VALUES ($user_id, 0, $mural_id, NULL, $updated_at)
    ON CONFLICT(user_id) DO UPDATE SET
      mural_id = excluded.mural_id,
      updated_at = excluded.updated_at
    WHERE profiles.mural_id IS NULL
  `);
  const now = new Date().toISOString();
  for (const row of rows) {
    upsert.run({ $user_id: row.userId, $mural_id: row.muralId, $updated_at: now });
  }
}
