import type { DatabaseSync } from "node:sqlite";
import { MIN_GOOD_WIDTH } from "../domain/constants.js";

export interface ResetReport {
  matched: number;
  restored: number;
  markedMissing: number;
  skipped: number;
}

export async function resetPublisherCovers(
  deps: { db: DatabaseSync; deleteBlob: (key: string) => Promise<void>; now: () => Date },
  options: { origin: string; since: string; apply: boolean }
): Promise<ResetReport> {
  const affected = deps.db
    .prepare(
      `SELECT b.id AS bookId, b.cover_image_id AS imageId FROM books b JOIN cover_images ci ON ci.id = b.cover_image_id
       WHERE ci.source = 'publisher' AND ci.origin = ? AND ci.created_at >= ? AND b.cover_status = 'manual' ORDER BY ci.created_at`
    )
    .all(options.origin, options.since) as Array<{ bookId: string; imageId: string }>;
  const previousStmt = deps.db.prepare(
    `SELECT id, width FROM cover_images WHERE book_id = ? AND id <> ? AND created_at < (SELECT created_at FROM cover_images WHERE id = ?)
       AND (source_url IS NULL OR source_url NOT IN (SELECT source_url FROM cover_rejections WHERE book_id = ?))
     ORDER BY created_at DESC LIMIT 1`
  );
  const updateStmt = deps.db.prepare(`UPDATE books SET cover_image_id = ?, cover_status = ?, cover_checked_at = ? WHERE id = ? AND cover_image_id = ?`);
  const deleteImageStmt = deps.db.prepare(`DELETE FROM cover_images WHERE id = ?`);
  const report: ResetReport = { matched: affected.length, restored: 0, markedMissing: 0, skipped: 0 };
  const at = deps.now().toISOString();
  for (const { bookId, imageId } of affected) {
    const previous = previousStmt.get(bookId, imageId, imageId, bookId) as { id: string; width: number } | undefined;
    if (options.apply) {
      await deps.deleteBlob(`covers/${imageId}.webp`);
      await deps.deleteBlob(`covers/${imageId}-thumb.webp`);
      const status = previous ? (previous.width >= MIN_GOOD_WIDTH ? "good" : "low_res") : "missing";
      deps.db.exec("BEGIN IMMEDIATE");
      let changed: number | bigint;
      try {
        changed = updateStmt.run(previous?.id ?? null, status, at, bookId, imageId).changes;
        if (changed !== 0) deleteImageStmt.run(imageId);
        deps.db.exec("COMMIT");
      } catch (error) {
        deps.db.exec("ROLLBACK");
        throw error;
      }
      if (changed === 0) {
        report.skipped++;
        continue;
      }
    }
    if (previous) report.restored++;
    else report.markedMissing++;
  }
  return report;
}
