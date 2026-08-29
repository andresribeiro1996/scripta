// One-time (well — every-boot, but a no-op the instant there's nothing
// left to migrate) migration moving each user's embedded
// `library.murals[]` array out of modules/library's opaque JSON blob and
// into the new dedicated `murals` table (Task 1). Split into three
// independently-idempotent steps — see modules/library/migration.ts and
// modules/murals/migration.ts for why each step is safe on its own — so
// a crash mid-way never loses data: whatever already landed in the
// murals table stays there (`INSERT OR IGNORE`, keyed on `id`, with a
// deterministic replacement id for legacy non-UUID ids — see
// modules/murals/migration.ts's deterministicReplacementId for why that
// matters here specifically), and the NEXT boot just re-extracts and
// re-inserts (a safe no-op for anything already migrated) rather than
// needing its own separate "has this run" flag/table.
//
// Cheap enough to run on every boot forever: readEmbeddedMurals is one
// SELECT over what's normally a small table, and short-circuits
// everything else the instant no row's JSON still has a `murals` key.
//
// Only imports each module's public index.ts, per the module-boundary
// rule described in app.ts's own header comment — never reaches into
// either module's adapters/domain/service.ts directly.

import { readEmbeddedMurals, clearEmbeddedMuralsField } from "../modules/library/index.js";
import { insertMigratedMurals } from "../modules/murals/index.js";

export function runStartupMigrations(): void {
  const extracted = readEmbeddedMurals();
  if (extracted.length === 0) return;

  insertMigratedMurals(extracted);
  clearEmbeddedMuralsField([...new Set(extracted.map((r) => r.userId))]);
}
