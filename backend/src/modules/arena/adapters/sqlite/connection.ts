import { normalizeWords } from "@scripta/shared";
import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";
import { openSqlite } from "../../../../db/openSqlite.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openArenaDb(): DatabaseSync {
  const db = openSqlite(env.ARENA_DB_PATH);

  applyArenaMigrations(db);

  return db;
}

/** Schema + column migrations, split out from openArenaDb so it can run
 *  against an in-memory database in tests — same shape as
 *  modules/tierlists' applyTierlistsMigrations. The voter_user_id ALTER
 *  must run BEFORE the schema: schema.sql's partial index on the column
 *  would fail to create against a pre-existing votes table that lacks it. */
export function applyArenaMigrations(db: DatabaseSync): void {
  const tournamentsColumns = db.prepare(`PRAGMA table_info(tournaments)`).all() as { name: string }[];
  if (tournamentsColumns.length > 0 && !tournamentsColumns.some((column) => column.name === "name_key")) {
    db.exec(`ALTER TABLE tournaments ADD COLUMN name_key TEXT`);
  }

  const slotColumns = db.prepare(`PRAGMA table_info(tournament_slots)`).all() as { name: string }[];
  if (slotColumns.length > 0 && !slotColumns.some((column) => column.name === "work_id")) {
    db.exec(`ALTER TABLE tournament_slots ADD COLUMN work_id TEXT`);
  }
  const duelColumns = db.prepare(`PRAGMA table_info(duels)`).all() as { name: string }[];
  for (const column of ["book_a_work_id", "book_b_work_id", "winner_work_id"]) {
    if (duelColumns.length > 0 && !duelColumns.some((existing) => existing.name === column)) {
      db.exec(`ALTER TABLE duels ADD COLUMN ${column} TEXT`);
    }
  }

  const votesExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='votes'`)
    .get() as { name: string } | undefined;
  if (votesExists) {
    const columns = db.prepare(`PRAGMA table_info(votes)`).all() as { name: string }[];
    if (!columns.some((column) => column.name === "voter_user_id")) {
      db.exec(`ALTER TABLE votes ADD COLUMN voter_user_id TEXT`);
    }
    // One-time, before schema.sql creates idx_votes_duel_user: the same
    // account may legitimately hold several votes on one duel already
    // (one per device token, backfilled by linkVotesToUser), and the
    // unique index refuses to create over those. Keep the earliest vote
    // of each (duel, account) group — the one that locked the duel in
    // for that voter at the time — and drop the later duplicates.
    const duelUserIndexExists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_votes_duel_user'`)
      .get();
    if (!duelUserIndexExists) {
      db.exec(
        `DELETE FROM votes WHERE voter_user_id IS NOT NULL AND rowid NOT IN ` +
          `(SELECT MIN(rowid) FROM votes WHERE voter_user_id IS NOT NULL GROUP BY duel_id, voter_user_id)`
      );
    }
  }

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  fillNameKeys(db);
}

function fillNameKeys(db: DatabaseSync): void {
  const stale = db.prepare(`SELECT id, name FROM tournaments WHERE name_key IS NULL`).all() as { id: string; name: string }[];
  if (stale.length === 0) return;
  const update = db.prepare(`UPDATE tournaments SET name_key = ? WHERE id = ? AND name_key IS NULL`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of stale) update.run(normalizeWords(row.name), row.id);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
