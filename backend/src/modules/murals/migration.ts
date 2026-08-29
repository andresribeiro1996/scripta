// Insert half of the embedded-murals migration — see
// backend/src/migrations/runStartupMigrations.ts for the full
// orchestration and modules/library/migration.ts's readEmbeddedMurals
// for the read half this consumes.
//
// Talks to this module's own `murals` table directly (bypassing
// service.ts/MuralsRepository, same as library/migration.ts does with
// its own table) — this is a one-off admin operation over the OLD
// client-shaped JSON (frontend/src/lib/murals.ts's `Mural` interface),
// not a normal CRUD write.

import { createHash, randomUUID } from "node:crypto";
import { openMuralsDb } from "./adapters/sqlite/connection.js";

/** Mirrors modules/library/index.ts's own EmbeddedMuralRow shape — kept
 *  as a separate, structurally-identical type rather than an imported
 *  one so this module's public signature doesn't couple to library's,
 *  matching the plain `{userId, rawMural}[]` shape
 *  runStartupMigrations.ts passes straight through from
 *  readEmbeddedMurals's own return type. */
export interface EmbeddedMuralRow {
  userId: string;
  rawMural: unknown;
}

// Close enough to whatever crypto.randomUUID() actually produces (see
// frontend/src/lib/murals.ts's newId()) — every route Task 1 added
// validates `:id` via zod's own (similarly permissive, see
// zod/v3/types.js's uuidRegex) `.uuid()` check, so this decides whether a
// legacy id still resolves through the new API.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The old frontend id generator falls back to `m_<random base36>` when
 *  `crypto.randomUUID` isn't available (see frontend/src/lib/murals.ts's
 *  `newId()` comment) — every route Task 1 added validates `:id` as a
 *  UUID, so a legacy non-UUID id would be permanently unreachable through
 *  the new API if inserted as-is.
 *
 *  CHOSEN APPROACH (deterministic replacement id, not a lookup guard):
 *  rather than minting a fresh `randomUUID()` per legacy id — simple, but
 *  a SECOND migration run (e.g. after a crash between this insert step
 *  and library/migration.ts's clearEmbeddedMuralsField, so the same
 *  embedded mural gets extracted again) would mint a DIFFERENT
 *  replacement each time, and `INSERT OR IGNORE` keyed on `id` would then
 *  let a genuine duplicate row through — this derives the replacement
 *  deterministically from the legacy id itself. The same legacy id always
 *  hashes to the same replacement UUID, so re-running this insert is a
 *  true no-op via `INSERT OR IGNORE` alone, with no extra lookup query
 *  needed. A lookup-by-user_id+name+created_at guard would also work, but
 *  needs an extra SELECT per row plus a fuzzier match (name/createdAt
 *  could legitimately collide, or change between runs); this is simpler
 *  to get correct. SHA-1 rather than a real UUID v5 library, since
 *  Node's crypto has no v5 built in and a dependency for one hash isn't
 *  worth it — the version/variant nibbles below are only set so the
 *  result LOOKS like a well-formed UUID (matches the UUID-shaped regex
 *  above and zod's `.uuid()`); nothing downstream needs it to be a truly
 *  spec-compliant v5. */
function deterministicReplacementId(legacyId: string): string {
  const digest = createHash("sha1").update(`scripta-legacy-mural-id:${legacyId}`).digest("hex");
  // digest is a 40-char hex string; slicing to 32 chars and indexing
  // within that range is always in bounds, hence the `!`s below.
  const hex = digest.slice(0, 32).split("");
  hex[12] = "5"; // version nibble
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16); // variant bits 10xx
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function resolveId(rawId: unknown): string {
  if (typeof rawId === "string" && rawId.length > 0) {
    return UUID_SHAPE.test(rawId) ? rawId : deterministicReplacementId(rawId);
  }
  // No id at all in the source JSON — shouldn't happen (the old frontend
  // always assigns one via newId()), so there's no stable legacy value to
  // hash a deterministic replacement from. Falls back to a fresh random
  // id; re-migrating this one anomalous row a second time would not be
  // idempotent, but every normal (has-an-id) row is still fully protected
  // by INSERT OR IGNORE + the deterministic id above.
  return randomUUID();
}

/** Maps each extracted legacy mural onto the new table's row shape and
 *  `INSERT OR IGNORE`s it — a no-op for any id (real or deterministically
 *  replaced) that's already present, which is what makes re-running this
 *  after a partial success safe. `share_token` is always NULL here: Task
 *  4 is what ever sets it. */
export function insertMigratedMurals(rows: EmbeddedMuralRow[]): void {
  if (rows.length === 0) return;

  const db = openMuralsDb();
  try {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO murals (id, user_id, name, blocks, cover_image_id, cover_image_url, share_token, created_at, updated_at)
      VALUES ($id, $user_id, $name, $blocks, $cover_image_id, $cover_image_url, $share_token, $created_at, $updated_at)
    `);
    const now = new Date().toISOString();

    for (const { userId, rawMural } of rows) {
      if (typeof rawMural !== "object" || rawMural === null) continue;
      const m = rawMural as Record<string, unknown>;

      insertStmt.run({
        $id: resolveId(m.id),
        $user_id: userId,
        $name: typeof m.name === "string" ? m.name : "Untitled mural",
        $blocks: JSON.stringify(Array.isArray(m.blocks) ? m.blocks : []),
        $cover_image_id: typeof m.coverImageId === "string" ? m.coverImageId : null,
        $cover_image_url: typeof m.coverImageUrl === "string" ? m.coverImageUrl : null,
        $share_token: null,
        $created_at: typeof m.createdAt === "string" ? m.createdAt : now,
        $updated_at: typeof m.updatedAt === "string" ? m.updatedAt : now
      });
    }
  } finally {
    db.close();
  }
}
