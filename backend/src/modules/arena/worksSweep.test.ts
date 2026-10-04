import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "arena-works-sweep-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.ARENA_DB_PATH = join(scratch, "arena.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyArenaMigrations } = await import("./adapters/sqlite/connection.js");
const { createArenaWorksStep } = await import("./worksSweep.js");

test("the arena step fills slot and duel works from titles, then the winner", () => {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  db.prepare("INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes, status) VALUES ('t1', 'u1', 'n', 2, 60, 'active')").run();
  const slot = db.prepare("INSERT INTO tournament_slots (tournament_id, slot_index, book_key, title, author, work_id) VALUES ('t1', ?, ?, ?, ?, NULL)");
  slot.run(0, "k1", "Dune", "Frank Herbert");
  slot.run(1, "k2", "Orlando", "Virginia Woolf");
  db.prepare(
    `INSERT INTO duels (id, tournament_id, round_number, duel_index, book_a_key, book_a_title, book_a_author, book_b_key, book_b_title, book_b_author, winner_key, status, opens_at, closes_at, settled_at)
     VALUES ('d1', 't1', 1, 0, 'k1', 'Dune', 'Frank Herbert', 'k2', 'Orlando', 'Virginia Woolf', 'k2', 'settled', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z', '2026-01-01T01:00:00.000Z')`
  ).run();
  const calls: Array<[string, string[]]> = [];
  const step = createArenaWorksStep(db, (owner, entries) => {
    calls.push([owner, entries.map((entry) => entry.key)]);
    return new Map(entries.map((entry) => [entry.key, { workId: `w-${entry.title}`, title: entry.title ?? null }]));
  });
  const batch = step(0, 250);
  assert.equal(batch.visited, 1);
  assert.deepEqual(calls, [["u1", ["k1", "k2"]]]);
  const slots = db.prepare("SELECT book_key, work_id FROM tournament_slots ORDER BY slot_index").all() as Array<{ book_key: string; work_id: string | null }>;
  assert.deepEqual(slots.map((row) => ({ ...row })), [{ book_key: "k1", work_id: "w-Dune" }, { book_key: "k2", work_id: "w-Orlando" }]);
  const duel = db.prepare("SELECT book_a_work_id, book_b_work_id, winner_work_id FROM duels").get();
  assert.deepEqual({ ...duel }, { book_a_work_id: "w-Dune", book_b_work_id: "w-Orlando", winner_work_id: "w-Orlando" });
  assert.equal(step(batch.lastRowid, 250).visited, 0);
});
