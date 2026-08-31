// One-off migration: explode the pre-normalisation `library_documents`
// blob rows into the entity tables.
//
// Runs at boot, once, guarded by `schema_migrations`. It is deliberately
// NON-DESTRUCTIVE — `library_documents` is left exactly as it was, so a
// rollback is "deploy the old build" rather than "restore last night's
// backup". Slice 3 drops the table once the per-entity API has been live
// long enough to trust (see docs/DEPLOYMENT-PLAN.md).
//
// Skips any user who already has a `library_settings` row: that means
// they were written by the new code path, and the blob is the stale copy,
// not the source of truth.

import type { DatabaseSync } from "node:sqlite";
import { toContents } from "../../domain/document.js";
import { createSqliteLibraryRepository } from "./sqliteLibraryRepository.js";

const MIGRATION_NAME = "0001_documents_to_entities";

export interface MigrationResult {
  /** False when the migration had already run and was skipped entirely. */
  ran: boolean;
  migrated: number;
  skipped: number;
  failed: Array<{ userId: string; reason: string }>;
}

export async function migrateDocumentsToEntities(db: DatabaseSync): Promise<MigrationResult> {
  const already = db.prepare(`SELECT name FROM schema_migrations WHERE name = ?`).get(MIGRATION_NAME);
  if (already) return { ran: false, migrated: 0, skipped: 0, failed: [] };

  const documents = db.prepare(`SELECT user_id, data, updated_at FROM library_documents`).all() as Array<
    Record<string, unknown>
  >;

  const repository = createSqliteLibraryRepository(db);
  const hasSettings = db.prepare(`SELECT user_id FROM library_settings WHERE user_id = ?`);

  let migrated = 0;
  let skipped = 0;
  const failed: MigrationResult["failed"] = [];

  for (const row of documents) {
    const userId = String(row.user_id);
    try {
      if (hasSettings.get(userId)) {
        skipped++;
        continue;
      }

      const data = JSON.parse(String(row.data)) as unknown;
      const updatedAt = typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString();
      // Version 1: this is the first normalised write for this user, and
      // nothing has had a chance to make a conflicting one yet.
      await repository.replaceContents(userId, toContents(data, 1, updatedAt));
      migrated++;
    } catch (err) {
      // One malformed document must not stop every other user from being
      // migrated. The blob is still there untouched, so a failure here is
      // recoverable by hand rather than lost.
      failed.push({ userId, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // Recorded even when some rows failed: re-running wouldn't fix a
  // malformed document, and leaving it unrecorded would re-attempt the
  // whole table on every boot. The failures are reported to the caller
  // (and logged by plugin.ts) so they're visible rather than silent.
  db.prepare(`INSERT INTO schema_migrations (name) VALUES (?)`).run(MIGRATION_NAME);

  return { ran: true, migrated, skipped, failed };
}
