// One-time (well — every-boot, but cheap and a no-op once nothing is
// left) migration step: pulls the `murals` array embedded in each user's
// opaque library JSON blob out into plain data, for
// modules/murals/migration.ts's insertMigratedMurals to write into its
// own dedicated table. See backend/src/migrations/runStartupMigrations.ts
// for the full three-step orchestration this is one third of.
//
// Talks to this module's own SQLite table directly (bypassing
// service.ts/LibraryRepository) — this is a one-off admin operation over
// the raw JSON, not a normal document read/write.

import { openLibraryDb } from "./adapters/sqlite/connection.js";

/** One embedded mural pulled out of one user's library JSON, still in its
 *  original (frontend `Mural`-shaped, see frontend/src/lib/murals.ts) raw
 *  form — modules/murals/migration.ts is the only thing that interprets
 *  `rawMural`; this module doesn't know or care about its shape beyond
 *  "found inside a `murals` array". */
export interface EmbeddedMuralRow {
  userId: string;
  rawMural: unknown;
}

/** Pure read — scans every row's JSON for a `murals` array and collects
 *  each element paired with the owning user id. Never writes anything
 *  back (see clearEmbeddedMuralsField below for the write half, which is
 *  only ever called once the extracted rows have actually been inserted
 *  elsewhere). Safe against a fresh empty database (returns []) and safe
 *  to call repeatedly — it just reflects whatever `library_documents`
 *  currently holds, so it naturally returns [] once every row's `murals`
 *  key has been cleared. */
export function readEmbeddedMurals(): EmbeddedMuralRow[] {
  const db = openLibraryDb();
  try {
    const rows = db.prepare(`SELECT user_id, data FROM library_documents`).all() as Array<{ user_id: string; data: string }>;
    const extracted: EmbeddedMuralRow[] = [];
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data);
      } catch {
        // Malformed JSON is a pre-existing data problem this migration
        // has no business trying to fix — skip it, same tolerant
        // treatment as a mural entry with an unexpected shape gets in
        // modules/murals/migration.ts.
        continue;
      }
      const murals = (parsed as { murals?: unknown } | null)?.murals;
      if (!Array.isArray(murals)) continue;
      for (const rawMural of murals) {
        extracted.push({ userId: row.user_id, rawMural });
      }
    }
    return extracted;
  } finally {
    db.close();
  }
}

/** Removes the `murals` key entirely (not `[]`) from exactly the given
 *  users' library JSON — matches `LibraryData.murals?` already being
 *  "absent until first created" (frontend/src/api/library.ts), so a
 *  migrated user's library document looks exactly like one that never
 *  had murals embedded in it at all.
 *
 *  Only ever called after modules/murals/migration.ts's
 *  insertMigratedMurals has already succeeded for these same user ids —
 *  this step is the one that actually "commits" the migration for them.
 *  Re-reads each row fresh (rather than trusting whatever
 *  readEmbeddedMurals saw earlier) so a slow-changing document written
 *  to between the two steps doesn't get clobbered, and is a no-op for
 *  any user whose `murals` key is already gone (or who has no row at
 *  all), so re-running it is always safe. */
export function clearEmbeddedMuralsField(userIds: string[]): void {
  if (userIds.length === 0) return;
  const db = openLibraryDb();
  try {
    const getStmt = db.prepare(`SELECT data FROM library_documents WHERE user_id = ?`);
    const updateStmt = db.prepare(`UPDATE library_documents SET data = ?, updated_at = ? WHERE user_id = ?`);
    for (const userId of userIds) {
      const row = getStmt.get(userId) as { data: string } | undefined;
      if (!row) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.data);
      } catch {
        continue;
      }
      if (!("murals" in parsed)) continue;

      delete parsed.murals;
      updateStmt.run(JSON.stringify(parsed), new Date().toISOString(), userId);
    }
  } finally {
    db.close();
  }
}
